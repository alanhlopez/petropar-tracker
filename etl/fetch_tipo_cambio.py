"""Tipo de cambio de referencia del BCP (guaraníes por dólar) -> data/tipo_cambio.csv.

Fuente: "Cotización Referencial de Monedas - Histórico Anual" del Banco Central del Paraguay
(https://www.bcp.gov.py/webapps/web/cotizacion/monedas-historica), una planilla por año con una fila por día
y una columna por mes. "ND" = día sin cotización (fines de semana y feriados): no se guarda ni se completa.

Incremental: baja los años que faltan desde 2009 y siempre el año en curso (y el anterior en enero).
Solo agrega fechas nuevas: no reescribe valores ya guardados.
"""
import sys
from datetime import date

import requests
from bs4 import BeautifulSoup

from etl.io_csv import DATA, escribir_csv, leer_csv

URL = "https://www.bcp.gov.py/webapps/web/cotizacion/monedas-historica"
TIPO_CAMBIO = DATA / "tipo_cambio.csv"
COLUMNAS = ["fecha", "gs_por_usd", "fuente"]
FUENTE = "BCP, cotización referencial (histórico anual)"
INICIO = 2009
UA = {"User-Agent": "petropar-tracker (+https://github.com/alanhlopez/petropar-tracker)"}


class ErrorBCP(Exception):
    pass


def numero(texto: str) -> float | None:
    t = texto.strip()
    if not t or t.upper() == "ND":
        return None
    try:
        return float(t.replace(".", "").replace(",", "."))
    except ValueError:
        raise ErrorBCP(f"valor no numérico en la planilla del BCP: {texto!r}") from None


def parsear(html: str, anio: int) -> list[dict]:
    """Planilla anual -> [{fecha, gs_por_usd}] (solo días con cotización)."""
    sopa = BeautifulSoup(html, "html.parser")
    titulo = sopa.get_text(" ", strip=True)
    if f"AÑO {anio}" not in titulo.upper() or "DOLAR" not in titulo.upper():
        raise ErrorBCP(f"la respuesta del BCP no es la planilla de dólares de {anio}")
    tabla = next((t for t in sopa.find_all("table") if len(t.find_all("tr")) >= 30), None)
    if tabla is None:
        raise ErrorBCP(f"no encontré la tabla de cotizaciones de {anio}")
    filas = tabla.find_all("tr")
    cab = [c.get_text(strip=True).upper() for c in filas[0].find_all(["td", "th"])]
    if cab[:2] != ["#", "ENE"] or len(cab) != 13:
        raise ErrorBCP(f"encabezado inesperado en la planilla de {anio}: {cab}")
    salida = []
    for tr in filas[1:]:
        celdas = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(celdas) != 13 or not celdas[0].isdigit():
            continue
        dia = int(celdas[0])
        for mes, texto in enumerate(celdas[1:], start=1):
            valor = numero(texto)
            if valor is None:
                continue
            try:
                fecha = date(anio, mes, dia)
            except ValueError:
                raise ErrorBCP(f"cotización en una fecha que no existe: {dia}/{mes}/{anio}") from None
            if not 1000 < valor < 100000:
                raise ErrorBCP(f"cotización fuera de rango el {fecha}: {valor}")
            salida.append({"fecha": fecha.isoformat(), "gs_por_usd": f"{valor:.2f}", "fuente": FUENTE})
    return sorted(salida, key=lambda f: f["fecha"])


def bajar_anio(anio: int) -> list[dict]:
    try:
        r = requests.post(URL, data={"anho": str(anio), "moneda": "USD"}, headers=UA, timeout=60)
    except requests.RequestException as e:
        raise ErrorBCP(f"error de red con el BCP ({anio}): {type(e).__name__}") from None
    if r.status_code != 200:
        raise ErrorBCP(f"el BCP respondió {r.status_code} para {anio}")
    return parsear(r.text, anio)


def anios_a_bajar(existentes: list[dict], hoy: date) -> list[int]:
    tenidos = {f["fecha"][:4] for f in existentes}
    anios = [a for a in range(INICIO, hoy.year + 1) if str(a) not in tenidos]
    recientes = [hoy.year] + ([hoy.year - 1] if hoy.month == 1 else [])
    return sorted(set(anios) | set(recientes))


def actualizar(existentes: list[dict], hoy: date) -> list[dict]:
    fechas = {f["fecha"] for f in existentes}
    nuevas = []
    for anio in anios_a_bajar(existentes, hoy):
        nuevas += [f for f in bajar_anio(anio) if f["fecha"] not in fechas and f["fecha"] <= hoy.isoformat()]
    return nuevas


def main() -> int:
    existentes = leer_csv(TIPO_CAMBIO) if TIPO_CAMBIO.exists() else []
    try:
        nuevas = actualizar(existentes, date.today())
    except ErrorBCP as e:
        print(f"ERROR BCP: {e}", file=sys.stderr)
        return 1
    todas = sorted(existentes + nuevas, key=lambda f: f["fecha"])
    escribir_csv(TIPO_CAMBIO, COLUMNAS, todas)
    print(f"{len(nuevas)} cotizaciones nuevas en {TIPO_CAMBIO.name} ({len(todas)} en total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
