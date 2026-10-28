"""Arma data/precios_petropar.csv desde las dos fuentes históricas (corrida única).

- 2009-01-02 a 2024-12-31: respuesta oficial AIP N° 90150 de Petropar
  (data/raw/petropar_historico_oficial_2009_2024.csv). Fuente oficial primero.
- Desde 2025-01-01: prensa y planilla (data/raw/petropar_precios_v0.csv).

Las filas de prensa/planilla de 2009–2024 no entran en la serie. Las que no
coinciden con el precio oficial vigente ese día quedan en
data/reports/conflictos_fuentes.csv.

Las correcciones a filas de prensa aprobadas explícitamente por el usuario
están en data/correcciones_aprobadas.csv (cambian fecha, estado y fuente de
todas las filas de una fecha, nunca el precio).

En 2015 las dos páginas del PDF se solapan (mismo día, mismo producto, mismo
precio): queda la fila de la página 2 (venta al público) y la de la página 1 se
descarta. El conteo es: filas del PDF = filas cargadas + solapamientos.

Solo crea los archivos si no existen: nunca reescribe el histórico vigente.
"""
import sys
from datetime import date

from etl.io_csv import COLUMNAS_PRECIOS, DATA, escribir_csv, leer_csv
from etl.migrate_wide_to_long import ORIGEN as ORIGEN_V0, migrar

OFICIAL = DATA / "raw" / "petropar_historico_oficial_2009_2024.csv"
URL_OFICIAL = ("https://informacionpublica.paraguay.gov.py/public/2025/"
               "1742301348_1_RespuestaSolicitudN90150.pdf")
CORTE_OFICIAL = "2024-12-31"  # último "hasta" del documento oficial
DESTINO = DATA / "precios_petropar.csv"
REPORTE = DATA / "reports" / "conflictos_fuentes.csv"
CORRECCIONES = DATA / "correcciones_aprobadas.csv"
# Notas reescritas en la capa procesada (pisan la nota del raw, que queda intacto)
ANOTACIONES = DATA / "anotaciones.csv"
COLUMNAS_REPORTE = ["fecha", "producto", "valor_prensa", "valor_oficial", "fuente_prensa", "nota"]
# Filas de prensa con precios de promoción que el documento oficial no registra (ver eventos.csv)
PROMOS = {
    "2016-08-04": "precios de promoción de un día (ver eventos.csv, promos 2016)",
    "2023-03-31": "baja temporal que no figura en el documento oficial: ver eventos.csv (promo)",
}


def filas_oficiales(oficiales: list[dict], productos: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """Devuelve (filas para la serie, solapamientos de página 1 descartados)."""
    por_clave: dict[tuple[str, str], dict] = {}
    solapadas = []
    for o in oficiales:
        clave = (o["vigencia_desde"], o["producto"])
        if clave in por_clave:
            previa = por_clave[clave]
            if previa["precio_gs"] != o["precio_gs"]:
                raise ValueError(f"Solapamiento con precios distintos en {clave}")
            # se queda la de página 2 (venta al público)
            if o["tipo_precio"] == "venta_publico":
                por_clave[clave], o = o, previa
            solapadas.append(o)
            continue
        por_clave[clave] = o

    filas = []
    for o in sorted(por_clave.values(), key=lambda o: (o["vigencia_desde"], o["producto"])):
        if o["producto"] not in productos:
            raise ValueError(f"Producto oficial sin entrada en productos.csv: {o['producto']}")
        filas.append({
            "fecha_vigencia": o["vigencia_desde"],
            "product_id": o["producto"],
            "precio_gs": o["precio_gs"],
            "unidad": productos[o["producto"]]["unidad"],
            "tipo_precio": o["tipo_precio"],
            "estado": "verificado",
            "fecha_estado": "confirmada",
            "fuente": o["fuente"],
            "fuente_url": URL_OFICIAL,
            "nota": o["nota"],
            "captured_at": "",
        })
    return filas, solapadas


def precio_vigente(serie: list[dict], producto: str, fecha: str) -> str:
    """Último precio de `producto` con fecha_vigencia <= fecha ("" si no había)."""
    vigente = ""
    for f in serie:
        if f["product_id"] == producto and f["fecha_vigencia"] <= fecha:
            vigente = f["precio_gs"]
    return vigente


def desfase(oficiales: list[dict], p: dict, dias: int = 10) -> str:
    """Fecha oficial posterior y cercana desde la que rige el precio que dice la prensa.

    La prensa fecha el anuncio y el documento oficial la entrada en vigencia, así
    que solo se mira hacia adelante. Devuelve "" si no hay.
    """
    fecha = date.fromisoformat(p["fecha_vigencia"])
    for o in oficiales:
        atraso = (date.fromisoformat(o["fecha_vigencia"]) - fecha).days
        if o["product_id"] == p["product_id"] and o["precio_gs"] == p["precio_gs"] and 0 < atraso <= dias:
            return o["fecha_vigencia"]
    return ""


def aplicar_correcciones(filas: list[dict], correcciones: list[dict]) -> list[dict]:
    for c in correcciones:
        afectadas = [f for f in filas if f["fecha_vigencia"] == c["fecha_original"]]
        if not afectadas:
            raise ValueError(f"Corrección sin filas: {c['fecha_original']}")
        for f in afectadas:
            f.update({"fecha_vigencia": c["fecha_nueva"]}
                     | {k: c[k] for k in ("estado", "fecha_estado", "fuente", "fuente_url", "nota")})
    return sorted(filas, key=lambda f: f["fecha_vigencia"])  # sort estable: respeta el orden por producto


def aplicar_anotaciones(filas: list[dict], anotaciones: list[dict]) -> list[dict]:
    por_clave = {(f["fecha_vigencia"], f["product_id"]): f for f in filas}
    for a in anotaciones:
        clave = (a["fecha_vigencia"], a["product_id"])
        if clave not in por_clave:
            raise ValueError(f"Anotación sin fila: {clave}")
        por_clave[clave]["nota"] = a["nota"]
    return filas


def conflictos(prensa: list[dict], oficiales: list[dict]) -> list[dict]:
    reporte = []
    for p in prensa:
        if p["fecha_vigencia"] > CORTE_OFICIAL:
            continue
        oficial = precio_vigente(oficiales, p["product_id"], p["fecha_vigencia"])
        if oficial == p["precio_gs"]:
            continue
        if p["fecha_vigencia"] in PROMOS:
            nota = PROMOS[p["fecha_vigencia"]]
        elif fecha_oficial := desfase(oficiales, p):
            nota = f"solo desfase de fecha: el oficial tiene ese precio desde {fecha_oficial}"
        else:
            nota = "precio distinto"
        reporte.append({
            "fecha": p["fecha_vigencia"],
            "producto": p["product_id"],
            "valor_prensa": p["precio_gs"],
            "valor_oficial": oficial,
            "fuente_prensa": " / ".join(x for x in (p["fuente"], p["nota"]) if x),
            "nota": nota,
        })
    return reporte


def construir(productos: dict[str, dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Devuelve (serie, conflictos, solapamientos)."""
    oficiales, solapadas = filas_oficiales(leer_csv(OFICIAL), productos)
    prensa = migrar(leer_csv(ORIGEN_V0), productos)
    posteriores = aplicar_correcciones(
        [dict(p) for p in prensa if p["fecha_vigencia"] > CORTE_OFICIAL], leer_csv(CORRECCIONES))
    serie = aplicar_anotaciones(oficiales + posteriores, leer_csv(ANOTACIONES))
    return serie, conflictos(prensa, oficiales), solapadas


def main() -> int:
    if DESTINO.exists() or REPORTE.exists():
        print("precios_petropar.csv o el reporte ya existen; no se reescriben.", file=sys.stderr)
        return 1
    productos = {p["product_id"]: p for p in leer_csv(DATA / "productos.csv")}
    serie, reporte, solapadas = construir(productos)
    escribir_csv(DESTINO, COLUMNAS_PRECIOS, serie)
    REPORTE.parent.mkdir(exist_ok=True)
    escribir_csv(REPORTE, COLUMNAS_REPORTE, reporte)
    print(f"{len(serie)} filas en {DESTINO.name}, {len(reporte)} conflictos, "
          f"{len(solapadas)} solapamientos de página 1 descartados")
    return 0


if __name__ == "__main__":
    sys.exit(main())
