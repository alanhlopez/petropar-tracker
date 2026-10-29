"""Genera site/data.json desde los CSV de data/ (lo único que lee el sitio).

- Precios Petropar por producto, en orden de fecha, con tipo_precio, estado,
  fecha_estado, fuente, URLs (lista) y nota para el tooltip.
- Petróleo en US$/galón: serie diaria (tooltip) y promedio mensual (línea).
- Presidentes y eventos (solo los que tienen mostrar=true).
- Tarjetas de "Precios hoy": último precio de cada producto, el cambio contra el precio
  inmediatamente anterior y la variación contra el precio vigente hace un año (nunca a
  través de un hueco: si esa fecha cae en un período sin fuente, no hay comparación).
Si todavía no existe data/petroleo.csv, las series de petróleo salen vacías.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from etl.io_csv import DATA, RAIZ, leer_csv

ASUNCION = ZoneInfo("America/Asuncion")
# sin flecha de cambio si el precio anterior con fuente es más viejo que esto (o hay un hueco)
DIAS_MAX_FLECHA = 183

SALIDA = RAIZ / "site" / "data.json"


def fecha_valida(valor: str, donde: str) -> str:
    """Un dato roto tiene que cortar la generación, no llegar al sitio como "" o NaN."""
    try:
        date.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ValueError(f"Fecha inválida {valor!r} en {donde}") from None
    return valor


def precio_valido(valor: str, donde: str) -> int:
    try:
        precio = int(valor)
    except (TypeError, ValueError):
        raise ValueError(f"Precio inválido {valor!r} en {donde}") from None
    if precio <= 0:
        raise ValueError(f"Precio inválido {valor!r} en {donde}")
    return precio


def productos_json(productos: list[dict]) -> list[dict]:
    return [{"id": p["product_id"], "nombre": p["nombre_actual"], "tipo": p["tipo"],
             "unidad": p["unidad"], "datos_hasta": p["datos_hasta"] or None,
             "categoria": p["categoria"]} for p in productos]


def hace_un_anio(dia: date) -> date:
    try:
        return dia.replace(year=dia.year - 1)
    except ValueError:  # 29 de febrero
        return dia - timedelta(days=365)


def precio_vigente_en(filas: list[dict], dia: str, datos_hasta: str | None) -> dict | None:
    """Fila vigente ese día, o None si no hay dato, si el día cae en un hueco (sin arrastrar
    precios) o si la fecha de vigencia de esa fila no está confirmada (no se sabe si ya regía)."""
    previas = [f for f in filas if f["fecha"] <= dia]
    if not previas:
        return None
    fila = previas[-1]
    if datos_hasta and fila["fecha"] <= datos_hasta < dia:
        return None
    if fila["fecha_estado"] != "confirmada":
        return None
    return fila


def variacion(nuevo: int, viejo: int) -> dict:
    # un solo redondeo, a 1 decimal: el sitio lo muestra tal cual
    return {"abs": nuevo - viejo, "pct": round((nuevo / viejo - 1) * 100, 1)}


def tarjetas_json(productos: list[dict], series: dict[str, list[dict]], hoy: date) -> list[dict]:
    """Una tarjeta por producto, en el orden de productos.csv (diésel, naftas por octanaje, GLP)."""
    tarjetas = []
    for p in productos:
        pid, hasta = p["product_id"], p["datos_hasta"] or None
        filas = series.get(pid, [])
        if not filas:
            tarjetas.append({"id": pid, "precio": None})
            continue
        actual = filas[-1]
        # inicio de la racha final de precio igual: ahí fue el último cambio
        i = len(filas) - 1
        while i > 0 and filas[i - 1]["precio"] == actual["precio"]:
            i -= 1
        anterior = filas[i - 1] if i > 0 else None
        cambio = None
        if anterior:
            tras_hueco = bool(hasta and anterior["fecha"] <= hasta < filas[i]["fecha"])
            antiguedad = (date.fromisoformat(filas[i]["fecha"]) - date.fromisoformat(anterior["fecha"])).days
            cambio = {"desde": filas[i]["fecha"], "precio_anterior": anterior["precio"],
                      "fecha_anterior": anterior["fecha"], "tras_hueco": tras_hueco,
                      # la flecha afirma "cambió de X a Y": solo si X es reciente y no hay hueco entre ambos
                      "flecha": not tras_hueco and antiguedad <= DIAS_MAX_FLECHA,
                      **variacion(actual["precio"], anterior["precio"])}
        dia = hace_un_anio(hoy).isoformat()
        previo = precio_vigente_en(filas, dia, hasta)
        tarjetas.append({
            "id": pid, "precio": actual["precio"], "fecha": actual["fecha"], "unidad": p["unidad"],
            # desde cuándo rige este precio: inicio de la racha final (la última fila puede ser
            # una reconfirmación del mismo precio)
            "vigente_desde": filas[i]["fecha"], "fecha_vigencia_confirmada": filas[i]["fecha_estado"] == "confirmada",
            "estado": actual["estado"], "fecha_estado": actual["fecha_estado"],
            "por_confirmar": not actual["firme"], "cambio": cambio,
            "anual": ({"fecha": dia, "precio": previo["precio"], **variacion(actual["precio"], previo["precio"])}
                      if previo else None),
        })
    return tarjetas


def precios_json(precios: list[dict], ids: set[str]) -> dict[str, list[dict]]:
    series: dict[str, list[dict]] = {pid: [] for pid in sorted(ids)}
    for f in sorted(precios, key=lambda f: (f["product_id"], f["fecha_vigencia"])):
        if f["product_id"] not in ids:
            raise ValueError(f"Precio de un producto que no está en productos.csv: {f['product_id']}")
        donde = f"precios_petropar.csv ({f['product_id']} {f['fecha_vigencia']!r})"
        series[f["product_id"]].append({
            "fecha": fecha_valida(f["fecha_vigencia"], donde),
            "precio": precio_valido(f["precio_gs"], donde),
            "tipo_precio": f["tipo_precio"],
            "estado": f["estado"],
            "fecha_estado": f["fecha_estado"],
            "firme": f["estado"] == "verificado" and f["fecha_estado"] == "confirmada",
            "fuente": f["fuente"],
            "urls": [u.strip() for u in f["fuente_url"].split(" | ") if u.strip()],
            "nota": f["nota"],
        })
    return series


def petroleo_json(petroleo: list[dict]) -> dict[str, dict]:
    salida = {}
    for serie in ("wti", "ulsd"):
        diario = sorted((f["fecha"], float(f["valor_usd"])) for f in petroleo
                        if f["serie"] == serie and f["unidad"] == "usd_gal")
        por_mes: dict[str, list[float]] = defaultdict(list)
        for fecha, valor in diario:
            por_mes[fecha[:7]].append(valor)
        salida[serie] = {
            "unidad": "usd_gal",
            "diario": [[fecha, round(valor, 4)] for fecha, valor in diario],
            "mensual": [[f"{mes}-01", round(sum(v) / len(v), 4)] for mes, v in sorted(por_mes.items())],
        }
    return salida


def eventos_json(eventos: list[dict]) -> list[dict]:
    salida = []
    for e in eventos:
        mostrar = e["mostrar"].strip().lower()
        if mostrar not in {"true", "false"}:
            raise ValueError(f"eventos.csv: mostrar debe ser true/false, no {e['mostrar']!r}")
        if mostrar == "false":
            continue
        donde = f"eventos.csv ({e['etiqueta']!r})"
        salida.append({"fecha": fecha_valida(e["fecha"], donde),
                       "fecha_fin": fecha_valida(e["fecha_fin"], donde) if e["fecha_fin"] else None,
                       "tipo": e["tipo"], "etiqueta": e["etiqueta"], "fuente": e["fuente"],
                       "url": e["fuente_url"] or None, "nota": e["nota"]})
    return salida


def construir(data: Path = DATA, ahora: datetime | None = None) -> dict:
    productos = leer_csv(data / "productos.csv")
    precios = leer_csv(data / "precios_petropar.csv")
    petroleo = leer_csv(data / "petroleo.csv") if (data / "petroleo.csv").exists() else []
    ids = {p["product_id"] for p in productos}
    series_oil = petroleo_json(petroleo)
    series = precios_json(precios, ids)
    ahora = ahora or datetime.now(timezone.utc)
    hoy = ahora.astimezone(ASUNCION).date().isoformat()
    return {
        "generado": ahora.isoformat(timespec="seconds"),
        "ultimo_dato": {
            # una fila "rige mañana" (vigencia_vieja, fecha_ajustada) no adelanta la fecha del encabezado
            "petropar": max((f["fecha_vigencia"] for f in precios if f["fecha_vigencia"] <= hoy), default=None),
            **{s: (v["diario"][-1][0] if v["diario"] else None) for s, v in series_oil.items()},
        },
        "ultima_captura": max((f["captured_at"] for f in precios if f["captured_at"]), default=None),
        "productos": productos_json(productos),
        "precios": series,
        "tarjetas": tarjetas_json(productos, series, ahora.astimezone(ASUNCION).date()),
        "petroleo": series_oil,
        "presidentes": [{"nombre": p["nombre"], "inicio": p["inicio"], "fin": p["fin"] or None}
                        for p in leer_csv(data / "presidentes.csv")],
        "eventos": eventos_json(leer_csv(data / "eventos.csv")),
    }


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Genera site/data.json desde los CSV de data/").parse_args(argv)
    datos = construir()
    SALIDA.parent.mkdir(exist_ok=True)
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    total = sum(len(s) for s in datos["precios"].values())
    print(f"{SALIDA.relative_to(RAIZ)}: {total} precios, "
          f"{len(datos['petroleo']['wti']['diario'])} días WTI, {len(datos['eventos'])} eventos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
