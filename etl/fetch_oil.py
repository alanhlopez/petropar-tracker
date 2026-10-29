"""Precios internacionales diarios desde la EIA (API v2) -> data/petroleo.csv.

- RWTC (WTI Cushing) y RBRTE (Brent Europa, FOB) llegan en $/BBL: se guardan en usd_bbl y también
  ÷42 en usd_gal. El sitio muestra Brent; WTI se sigue guardando pero no se muestra.
- EER_EPD2DXL0_PF4_RGC_DPG (ULSD Costa del Golfo) llega en $/GAL: se guarda en usd_gal.

Incremental: pide desde la última fecha guardada de cada serie (o 2009-01-01 la
primera vez) y agrega solo fechas nuevas. Pagina con offset de a 5000 filas.
La API key se lee de la variable de entorno EIA_API_KEY (secret en GitHub).
"""
import os
import sys

import requests

from etl.io_csv import DATA, escribir_csv, leer_csv

URL = "https://api.eia.gov/v2/petroleum/pri/spt/data/"
PETROLEO = DATA / "petroleo.csv"
COLUMNAS = ["fecha", "serie", "valor_usd", "unidad"]
INICIO = "2009-01-01"
PAGINA = 5000
GALONES_POR_BARRIL = 42
# serie EIA -> (serie nuestra, unidad que tiene que devolver la API)
SERIES = {
    "RWTC": ("wti", "$/BBL"),
    "RBRTE": ("brent", "$/BBL"),
    "EER_EPD2DXL0_PF4_RGC_DPG": ("ulsd", "$/GAL"),
}


# series en barriles: se guardan en usd_bbl y en usd_gal (÷42)
EN_BARRILES = {serie for serie, unidad in SERIES.values() if unidad == "$/BBL"}


class ErrorEIA(Exception):
    pass


def pedir_pagina(api_key: str, serie_eia: str, inicio: str, offset: int) -> dict:
    params = {
        "api_key": api_key,
        "frequency": "daily",
        "data[0]": "value",
        "facets[series][]": serie_eia,
        "start": inicio,
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "offset": offset,
        "length": PAGINA,
    }
    # Ningún mensaje de error incluye la URL ni el texto de la excepción de requests: llevan la api_key.
    try:
        r = requests.get(URL, params=params, timeout=60)
    except requests.RequestException as e:
        raise ErrorEIA(f"Error de red con la EIA para {serie_eia}: {type(e).__name__}") from None
    if r.status_code != 200:
        raise ErrorEIA(f"EIA respondió {r.status_code} para {serie_eia}")
    try:
        respuesta = r.json().get("response")
    except ValueError:
        raise ErrorEIA(f"Respuesta de la EIA que no es JSON para {serie_eia}") from None
    if not isinstance(respuesta, dict) or "data" not in respuesta or "total" not in respuesta:
        raise ErrorEIA(f"Respuesta de la EIA sin 'response.data' o 'response.total' para {serie_eia}")
    return respuesta


def descargar_serie(api_key: str, serie_eia: str, inicio: str) -> list[dict]:
    """Todas las filas desde `inicio`, paginando mientras offset < total."""
    filas, offset = [], 0
    while True:
        respuesta = pedir_pagina(api_key, serie_eia, inicio, offset)
        filas += respuesta["data"]
        total = int(respuesta["total"])
        offset += PAGINA
        if offset >= total or not respuesta["data"]:
            break
    return filas


def convertir(serie_eia: str, filas_eia: list[dict]) -> list[dict]:
    serie, unidad_esperada = SERIES[serie_eia]
    filas = []
    for f in filas_eia:
        if f.get("series") != serie_eia:
            raise ErrorEIA(f"Fila de otra serie: {f.get('series')!r} (se pidió {serie_eia})")
        if f.get("units") != unidad_esperada:
            raise ErrorEIA(f"{serie_eia}: unidad {f.get('units')!r}, se esperaba {unidad_esperada!r}")
        if f.get("value") in (None, ""):
            continue  # feriados o días sin cotización
        try:
            valor = float(f["value"])  # puede ser negativo: WTI 2020-04-20
        except (TypeError, ValueError):
            raise ErrorEIA(f"{serie_eia} {f.get('period')}: valor no numérico {f['value']!r}") from None
        fecha = f["period"]
        if serie in EN_BARRILES:
            filas.append({"fecha": fecha, "serie": serie, "valor_usd": f"{valor:.2f}", "unidad": "usd_bbl"})
            filas.append({"fecha": fecha, "serie": serie,
                          "valor_usd": f"{valor / GALONES_POR_BARRIL:.4f}", "unidad": "usd_gal"})
        else:
            filas.append({"fecha": fecha, "serie": serie, "valor_usd": f"{valor:.4f}", "unidad": "usd_gal"})
    return filas


def actualizar(api_key: str, existentes: list[dict]) -> list[dict]:
    """Devuelve las filas nuevas (sin duplicar fecha+serie+unidad ya guardadas)."""
    claves = {(f["fecha"], f["serie"], f["unidad"]) for f in existentes}
    nuevas = []
    for serie_eia, (serie, _) in SERIES.items():
        # desde la última fecha de la unidad más atrasada (las series en barriles se guardan en usd_bbl y usd_gal)
        unidades = ("usd_bbl", "usd_gal") if serie in EN_BARRILES else ("usd_gal",)
        ultimas = [max((f["fecha"] for f in existentes if (f["serie"], f["unidad"]) == (serie, u)), default=None)
                   for u in unidades]
        inicio = INICIO if None in ultimas else min(ultimas)
        for f in convertir(serie_eia, descargar_serie(api_key, serie_eia, inicio)):
            clave = (f["fecha"], f["serie"], f["unidad"])
            if clave not in claves:
                claves.add(clave)
                nuevas.append(f)
    return nuevas


def main() -> int:
    api_key = os.environ.get("EIA_API_KEY")
    if not api_key:
        print("Falta la variable de entorno EIA_API_KEY", file=sys.stderr)
        return 1
    existentes = leer_csv(PETROLEO) if PETROLEO.exists() else []
    try:
        nuevas = actualizar(api_key, existentes)
    except ErrorEIA as e:
        print(f"ERROR EIA: {e}", file=sys.stderr)
        return 1
    todas = sorted(existentes + nuevas, key=lambda f: (f["serie"], f["unidad"], f["fecha"]))
    escribir_csv(PETROLEO, COLUMNAS, todas)
    print(f"{len(nuevas)} filas nuevas en {PETROLEO.name} ({len(todas)} en total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
