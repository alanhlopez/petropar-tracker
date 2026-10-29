"""Scraper de precios vigentes de Petropar.

Fuente principal: https://www.petropar.gov.py/?page_id=4460 (tabla con vigencia por producto).
Control cruzado: https://www.petropar.gov.py/wp-content/price/index.html (sin fechas).

Tres niveles de validación (ver SPEC.md):
  a) Estructura: falla dura (exit 1) si una página no responde, falta la tabla
     o cambió su forma, falta un producto o un precio/fecha no se puede convertir.
  b) Plausibilidad: rango, múltiplo de 5, orden entre productos, variación,
     control cruzado y vigencias. No bloquea: genera alertas -> etiqueta "revisar".
  c) Frescura: la controla el workflow (última corrida exitosa < 24 h).

Si hay cambio de precio guarda el HTML de las dos páginas en
data/capturas/<captured_at>/ y después agrega filas a data/precios_petropar.csv
(nunca reescribe las existentes). Siempre escribe un resumen JSON (--resumen) y,
con --artefactos, una copia del HTML descargado para adjuntar al issue.
"""
import argparse
import hashlib
import json
import re
import sys
import time
import traceback
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from etl.io_csv import COLUMNAS_PRECIOS, DATA, RAIZ, escribir_csv, leer_csv

URL_VIGENCIA = "https://www.petropar.gov.py/?page_id=4460"
URL_INDEX = "https://www.petropar.gov.py/wp-content/price/index.html"
PRECIOS = DATA / "precios_petropar.csv"
PRODUCTOS = DATA / "productos.csv"
CAPTURAS = DATA / "capturas"
TZ = ZoneInfo("America/Asuncion")

PRODUCTOS_ESPERADOS = {
    "diesel_mbarete", "diesel_pora", "nafta_kape88", "nafta_oikoite93",
    "nafta_aratiri97", "nafta_ecoflex85", "glp_kg", "glp_litro",
}
# Palabra clave (ya normalizada) -> product_id. El GLP se separa por unidad.
CLAVES = [
    ("mbarete", "diesel_mbarete"),
    ("pora", "diesel_pora"),
    ("kape", "nafta_kape88"),
    ("oikoite", "nafta_oikoite93"),
    ("aratiri", "nafta_aratiri97"),
    ("ecoflex", "nafta_ecoflex85"),
]
PRECIO_MIN, PRECIO_MAX = 2_000, 30_000
VARIACION_MAX = 0.25
# La página no siempre actualiza la vigencia: solo se confía si está cerca de la captura
DIAS_VIGENCIA_CONFIABLE = 3
# (mayor, menor): el primero tiene que costar más que el segundo
ORDEN = [
    ("diesel_mbarete", "diesel_pora"),
    ("nafta_aratiri97", "nafta_oikoite93"),
    ("nafta_oikoite93", "nafta_kape88"),
]
LIQUIDOS = {"diesel_mbarete", "diesel_pora", "nafta_kape88", "nafta_oikoite93",
            "nafta_aratiri97", "nafta_ecoflex85"}


class ErrorEstructura(Exception):
    """La página cambió de forma: no se puede confiar en nada de lo leído."""
    tipo = "estructura"


class ErrorRed(ErrorEstructura):
    """La página no responde."""
    tipo = "no_responde"

    def __init__(self, url: str, detalle: str):
        super().__init__(f"La página no responde: {url} ({detalle})")
        self.url = url


@dataclass
class Vigente:
    precio: int
    vigencia: date | None  # None en el control cruzado (index.html no tiene fechas)


# --- normalización -----------------------------------------------------------

def decodificar(contenido: bytes) -> str:
    """index.html declara UTF-8 pero trae bytes cp1252: si no es UTF-8 válido, cp1252."""
    try:
        return contenido.decode("utf-8")
    except UnicodeDecodeError:
        return contenido.decode("cp1252", errors="replace")


def arreglar_mojibake(texto: str) -> str:
    """'PorÃ£' (UTF-8 leído como cp1252) -> 'Porã'. Repite por si hubo doble codificación."""
    for _ in range(3):
        if "Ã" not in texto and "Â" not in texto:
            break
        try:
            texto = texto.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
    return texto


def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", arreglar_mojibake(texto))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", texto).strip().lower()


def identificar(nombre: str, unidad: str = "") -> str:
    n = normalizar(f"{nombre} {unidad}")
    if re.search(r"\bnande gas\b|\bglp\b", n):
        if re.search(r"\b(kgs?|kilos?|kilogramos?)\b", n):
            return "glp_kg"
        if re.search(r"\b(l|lts?|litros?)\b", n):
            return "glp_litro"
        raise ErrorEstructura(f"GLP sin unidad reconocible: {nombre!r}")
    encontrados = {pid for clave, pid in CLAVES if re.search(rf"\b{clave}\b", n)}
    if len(encontrados) != 1:
        raise ErrorEstructura(f"Producto desconocido o ambiguo en la página: {nombre!r}")
    return encontrados.pop()


def parsear_precio(texto: str) -> tuple[int, str]:
    """'G. 9.285' -> (9285, ''); 'G. 7.374/KG' -> (7374, 'kg'). También 'Gs.' y '₲'."""
    m = re.fullmatch(r"(?:gs?\.?|₲)\s*(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:/\s*(\w+))?", normalizar(texto))
    if not m:
        raise ErrorEstructura(f"Precio que no se puede convertir: {texto!r}")
    return int(m[1].replace(".", "")), (m[2] or "")


def parsear_fecha(texto: str) -> date:
    try:
        return datetime.strptime(texto.strip(), "%d/%m/%Y").date()
    except ValueError:
        raise ErrorEstructura(f"Fecha de vigencia que no se puede convertir: {texto!r}") from None


# --- parsers -----------------------------------------------------------------

def parsear_vigencia(html: str) -> dict[str, Vigente]:
    tabla = BeautifulSoup(html, "html.parser").select_one("table.pp-tabla")
    if tabla is None:
        raise ErrorEstructura("No se encontró la tabla de precios (table.pp-tabla)")
    encabezado = [normalizar(th.get_text()) for th in tabla.select("thead th")]
    if encabezado != ["producto", "precio", "vigencia"]:
        raise ErrorEstructura(f"Encabezado de tabla inesperado: {encabezado}")
    vigentes: dict[str, Vigente] = {}
    for tr in tabla.select("tbody tr"):
        celdas = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(celdas) != 3:
            raise ErrorEstructura(f"Fila con {len(celdas)} celdas: {celdas}")
        nombre, precio_txt, vigencia_txt = celdas
        precio, unidad = parsear_precio(precio_txt)
        pid = identificar(nombre, unidad)
        if pid in vigentes:
            raise ErrorEstructura(f"Producto repetido en la tabla: {pid}")
        vigentes[pid] = Vigente(precio, parsear_fecha(vigencia_txt))
    return vigentes


def parsear_index(html: str) -> dict[str, Vigente]:
    control: dict[str, Vigente] = {}
    for li in BeautifulSoup(html, "html.parser").select("ul.container li"):
        texto = li.get_text(" ", strip=True)
        m = re.fullmatch(r"(?P<nombre>.+?)\s+-\s+(?P<precio>G\..+)", texto)
        if not m:
            raise ErrorEstructura(f"Ítem de index.html con forma inesperada: {texto!r}")
        precio, unidad = parsear_precio(m["precio"])
        pid = identificar(m["nombre"], unidad)
        if pid in control:
            raise ErrorEstructura(f"Producto repetido en index.html: {pid}")
        control[pid] = Vigente(precio, None)
    return control


def verificar_estructura(vigentes: dict, control: dict) -> None:
    for nombre, encontrados in (("página de vigencias", vigentes), ("index.html", control)):
        if not encontrados:
            raise ErrorEstructura(f"No hay productos en {nombre}")
        faltan = PRODUCTOS_ESPERADOS - set(encontrados)
        if faltan:
            raise ErrorEstructura(f"Faltan productos en {nombre}: {sorted(faltan)}")


# --- reglas de plausibilidad ------------------------------------------------

def alerta(regla: str, producto: str, detalle: str) -> dict:
    return {"regla": regla, "producto": producto, "detalle": detalle}


def reglas_snapshot(vigentes: dict[str, Vigente], control: dict[str, Vigente]) -> list[dict]:
    """Reglas que miran la foto completa de precios, haya o no cambio."""
    alertas = []
    for pid, v in sorted(vigentes.items()):
        if not PRECIO_MIN <= v.precio <= PRECIO_MAX:
            alertas.append(alerta("rango", pid, f"{v.precio} fuera de {PRECIO_MIN}–{PRECIO_MAX}"))
        if pid in LIQUIDOS and v.precio % 5:
            alertas.append(alerta("multiplo_5", pid, f"{v.precio} no es múltiplo de 5"))
        if pid in control and control[pid].precio != v.precio:
            alertas.append(alerta("control_cruzado", pid,
                                  f"página de vigencias {v.precio} vs index.html {control[pid].precio}"))
    for mayor, menor in ORDEN:
        if mayor in vigentes and menor in vigentes and vigentes[mayor].precio <= vigentes[menor].precio:
            alertas.append(alerta("orden", f"{mayor}>{menor}",
                                  f"{vigentes[mayor].precio} <= {vigentes[menor].precio}"))
    return alertas


def ultimos_registros(historia: list[dict]) -> dict[str, dict]:
    ultimos: dict[str, dict] = {}
    for fila in sorted(historia, key=lambda f: f["fecha_vigencia"]):
        ultimos[fila["product_id"]] = fila
    return ultimos


def inicio_precio_vigente(historia: list[dict]) -> dict[str, dict]:
    """Primera fila de la racha final de precio igual (v0 repite precios sin cambio en filas posteriores)."""
    inicios: dict[str, dict] = {}
    for fila in sorted(historia, key=lambda f: f["fecha_vigencia"]):
        previa = inicios.get(fila["product_id"])
        if previa is None or previa["precio_gs"] != fila["precio_gs"]:
            inicios[fila["product_id"]] = fila
    return inicios


def precio_en(historia: list[dict], pid: str, dia: date) -> dict | None:
    """Fila del histórico vigente para el producto en ese día (la última con fecha_vigencia <= dia)."""
    filas = [f for f in historia if f["product_id"] == pid and f["fecha_vigencia"] <= dia.isoformat()]
    return max(filas, key=lambda f: f["fecha_vigencia"], default=None)


def detectar_cambios(vigentes: dict[str, Vigente], historia: list[dict],
                     productos: dict[str, dict], ahora: datetime) -> tuple[list[dict], list[dict]]:
    """Devuelve (filas nuevas, alertas por producto)."""
    ultimos = ultimos_registros(historia)
    inicios = inicio_precio_vigente(historia)
    hoy = ahora.astimezone(TZ).date()
    respaldo = hoy + timedelta(days=1)  # anuncia de noche, rige 00:00
    captured_at = ahora.astimezone(timezone.utc).isoformat(timespec="seconds")
    nuevas, alertas = [], []
    for pid, v in sorted(vigentes.items()):
        previo = ultimos.get(pid)
        if previo and int(previo["precio_gs"]) == v.precio:
            # sin cambio: igual se avisa si la vigencia publicada contradice una fecha confirmada
            inicio = inicios[pid]
            if inicio["fecha_estado"] == "confirmada" and v.vigencia.isoformat() != inicio["fecha_vigencia"]:
                alertas.append(alerta("vigencia_discrepante", pid,
                                      f"precio {v.precio} igual, pero la página publica vigencia "
                                      f"{v.vigencia.isoformat()} y el histórico dice {inicio['fecha_vigencia']}"))
            continue
        notas = []
        fecha, fecha_estado = v.vigencia, "confirmada"
        posterior = not previo or v.vigencia > date.fromisoformat(previo["fecha_vigencia"])
        if posterior and abs((v.vigencia - hoy).days) > DIAS_VIGENCIA_CONFIABLE:
            fecha_estado = "a_confirmar"
            detalle = (f"vigencia publicada {v.vigencia.isoformat()} a más de {DIAS_VIGENCIA_CONFIABLE} "
                       f"días de la captura ({hoy.isoformat()})")
            alertas.append(alerta("vigencia_lejana", pid, detalle))
            notas.append(detalle)
        if previo:
            anterior = int(previo["precio_gs"])
            variacion = v.precio / anterior - 1
            if abs(variacion) >= VARIACION_MAX:
                alertas.append(alerta("variacion", pid, f"{anterior} -> {v.precio} ({variacion:+.1%})"))
            ultima = date.fromisoformat(previo["fecha_vigencia"])
            if v.vigencia <= ultima:
                fecha, fecha_estado = respaldo, "a_confirmar"
                detalle = (f"vigencia publicada {v.vigencia.isoformat()} no es posterior al último "
                           f"registro ({previo['fecha_vigencia']}); se usa {respaldo.isoformat()}")
                alertas.append(alerta("vigencia_vieja", pid, detalle))
                notas.append(detalle)
                # el histórico ya dice qué precio regía en la vigencia publicada: si no coincide, avisar
                regia = precio_en(historia, pid, v.vigencia)
                if regia and int(regia["precio_gs"]) != v.precio:
                    alertas.append(alerta("conflicto_historico", pid,
                                          f"la página dice {v.precio} desde {v.vigencia.isoformat()}, pero el "
                                          f"histórico tiene {regia['precio_gs']} ese día (desde "
                                          f"{regia['fecha_vigencia']}, {regia['estado']}/{regia['fecha_estado']})"))
            if fecha <= ultima:
                # ej.: ya hay una fila a_confirmar de mañana y hubo otro cambio el mismo día
                fecha, fecha_estado = ultima + timedelta(days=1), "a_confirmar"
                detalle = f"fecha corrida a {fecha.isoformat()} para no pisar el registro del {previo['fecha_vigencia']}"
                alertas.append(alerta("fecha_ajustada", pid, detalle))
                notas.append(detalle)
        nuevas.append({
            "fecha_vigencia": fecha.isoformat(),
            "product_id": pid,
            "precio_gs": str(v.precio),
            "unidad": productos[pid]["unidad"],
            "tipo_precio": "venta_publico",
            "estado": "verificado",
            "fecha_estado": fecha_estado,
            "fuente": "Petropar, precios vigentes (petropar.gov.py)",
            "fuente_url": URL_VIGENCIA,
            "nota": "; ".join(notas),
            "captured_at": captured_at,
        })
    return nuevas, alertas


def clave(items: list[str]) -> str:
    """Huella estable para que el workflow no duplique PRs ni issues entre corridas."""
    return hashlib.sha256("\n".join(sorted(items)).encode()).hexdigest()[:12] if items else ""


# --- red y archivo -----------------------------------------------------------

def descargar(url: str, intentos: int = 3) -> bytes:
    detalle = ""
    for i in range(intentos):
        try:
            r = requests.get(url, timeout=30, headers={"User-Agent": "petropar-tracker (+github)"})
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            detalle = type(e).__name__
            if i < intentos - 1:
                time.sleep(2 ** i)
    raise ErrorRed(url, f"{intentos} intentos, último error {detalle}")


def con_url(url: str, parsear, html: str):
    """Corre el parser y, si la estructura falla, deja anotada la página para el resumen y el issue."""
    try:
        return parsear(html)
    except ErrorEstructura as e:
        e.url = getattr(e, "url", None) or url
        raise


def ejecutar(crudo_vigencia: bytes, crudo_index: bytes, ahora: datetime,
             precios: Path | None = None) -> dict:
    """Corre todas las reglas sobre HTML ya descargado. No escribe nada: devuelve el resumen."""
    vigentes = con_url(URL_VIGENCIA, parsear_vigencia, decodificar(crudo_vigencia))
    control = con_url(URL_INDEX, parsear_index, decodificar(crudo_index))
    verificar_estructura(vigentes, control)

    productos = {p["product_id"]: p for p in leer_csv(PRODUCTOS)}
    historia = leer_csv(precios or PRECIOS)
    nuevas, alertas_producto = detectar_cambios(vigentes, historia, productos, ahora)
    alertas = reglas_snapshot(vigentes, control) + alertas_producto
    return {
        "estado": "ok",
        "captured_at": ahora.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "cambio": bool(nuevas),
        "revisar": bool(alertas),
        "clave_cambio": clave([f"{f['product_id']}={f['precio_gs']}" for f in nuevas]),
        "clave_alertas": clave([f"{a['regla']}:{a['producto']}" for a in alertas]),
        "alertas": alertas,
        "filas_nuevas": nuevas,
        "vigentes": {pid: {"precio": v.precio, "vigencia": v.vigencia.isoformat()}
                     for pid, v in sorted(vigentes.items())},
    }


def registrar(resumen: dict, crudos: dict[str, bytes], ahora: datetime,
              precios: Path | None = None) -> Path:
    """Guarda la captura y después agrega las filas nuevas (solo agrega, nunca reescribe)."""
    precios = precios or PRECIOS
    carpeta = CAPTURAS / ahora.astimezone(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    carpeta.mkdir(parents=True, exist_ok=True)
    for nombre, contenido in crudos.items():
        (carpeta / nombre).write_bytes(contenido)
    historia = leer_csv(precios)
    escribir_csv(precios, COLUMNAS_PRECIOS, historia + resumen["filas_nuevas"])
    return carpeta


def escribir_json(ruta: Path, datos: dict) -> None:
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Scraper de precios vigentes de Petropar")
    p.add_argument("--resumen", type=Path, default=Path("resumen_scraper.json"),
                   help="dónde escribir el resumen JSON para el workflow")
    p.add_argument("--artefactos", type=Path,
                   help="carpeta donde copiar el HTML descargado en toda corrida (artifact del workflow)")
    p.add_argument("--vigencia-html", type=Path, help="usar este archivo en vez de descargar")
    p.add_argument("--index-html", type=Path, help="usar este archivo en vez de descargar")
    p.add_argument("--sin-escribir", action="store_true",
                   help="corre todas las reglas y escribe el resumen, sin tocar data/")
    args = p.parse_args(argv)
    ahora = datetime.now(timezone.utc)
    crudos: dict[str, bytes] = {}

    def guardar_artefactos():
        if args.artefactos:
            args.artefactos.mkdir(parents=True, exist_ok=True)
            for nombre, contenido in crudos.items():
                (args.artefactos / nombre).write_bytes(contenido)

    try:
        crudos["vigencia.html"] = (args.vigencia_html.read_bytes() if args.vigencia_html
                                   else descargar(URL_VIGENCIA))
        crudos["index.html"] = args.index_html.read_bytes() if args.index_html else descargar(URL_INDEX)
        resumen = ejecutar(crudos["vigencia.html"], crudos["index.html"], ahora)
        if resumen["cambio"] and not args.sin_escribir:
            captura = registrar(resumen, crudos, ahora)
            resumen["captura"] = str(captura.relative_to(RAIZ) if captura.is_relative_to(RAIZ) else captura)
    except Exception as e:  # noqa: BLE001 — toda falla tiene que dejar resumen para el issue
        tipo = e.tipo if isinstance(e, ErrorEstructura) else "interno"
        resumen = {"estado": "error", "tipo_error": tipo, "error": str(e),
                   "url": getattr(e, "url", None), "captured_at": ahora.isoformat(timespec="seconds"),
                   "cambio": False, "revisar": False, "clave_cambio": "", "clave_alertas": "",
                   "alertas": [], "filas_nuevas": []}
        guardar_artefactos()
        escribir_json(args.resumen, resumen)
        print(f"ERROR ({tipo}): {e}", file=sys.stderr)
        if tipo == "interno":
            traceback.print_exc()
        return 1

    guardar_artefactos()
    escribir_json(args.resumen, resumen)
    print(f"cambio={resumen['cambio']} revisar={resumen['revisar']} "
          f"filas_nuevas={len(resumen['filas_nuevas'])} alertas={len(resumen['alertas'])}"
          + (" (sin escribir)" if args.sin_escribir else ""))
    for f in resumen["filas_nuevas"]:
        print(f"  NUEVA {f['product_id']:16} {int(f['precio_gs']):>7,} vigencia {f['fecha_vigencia']} "
              f"({f['fecha_estado']})".replace(",", "."))
    for a in resumen["alertas"]:
        print(f"  [{a['regla']}] {a['producto']}: {a['detalle']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
