"""IPC del BCP -> data/ipc.csv, desde el "Anexo Estadístico del Informe Económico" (xlsx) bajado a mano.

Toma el Cuadro 15 (IPC del Área Metropolitana de Asunción, serie empalmada, base diciembre 2017 = 100),
columna "Índice general", desde enero de 2009. Lee el xlsx con la biblioteca estándar (sin dependencias nuevas)
y valida el título, la base y el encabezado antes de escribir: si el BCP cambia el formato, falla.

Uso: python -m etl.importar_ipc data/Anexo_Estadístico_del_Informe_Económico_DD_MM_AAAA.xlsx [--descargado AAAA-MM-DD]
"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, timedelta
from pathlib import Path

from etl.io_csv import DATA, escribir_csv

IPC = DATA / "ipc.csv"
COLUMNAS = ["mes", "ipc", "fuente", "fuente_url", "descargado_el"]
HOJA = "CUADRO 15"
DESDE = "2009-01"
FUENTE_URL = "https://www.bcp.gov.py"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


class ErrorIPC(Exception):
    pass


def leer_hoja(ruta: Path, nombre: str) -> dict[str, str]:
    """Celdas de una hoja del xlsx como {'A15': '33939', ...} (textos compartidos ya resueltos)."""
    with zipfile.ZipFile(ruta) as z:
        textos = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(NS + "si"):
                textos.append("".join(t.text or "" for t in si.iter(NS + "t")))
        libro = z.read("xl/workbook.xml").decode("utf-8")
        rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
        hoja = re.search(r'<sheet [^>]*name="%s"[^>]*r:id="([^"]+)"' % re.escape(nombre), libro)
        if not hoja:
            raise ErrorIPC(f"el archivo no tiene la hoja {nombre!r}")
        destino = re.search(r'<Relationship [^>]*Id="%s"[^>]*Target="([^"]+)"' % hoja.group(1), rels) \
            or re.search(r'<Relationship [^>]*Target="([^"]+)"[^>]*Id="%s"' % hoja.group(1), rels)
        ruta_hoja = "xl/" + destino.group(1).lstrip("/").removeprefix("xl/")
        celdas = {}
        for c in ET.fromstring(z.read(ruta_hoja)).iter(NS + "c"):
            v = c.find(NS + "v")
            if v is not None and v.text is not None:
                celdas[c.get("r")] = textos[int(v.text)] if c.get("t") == "s" else v.text
        return celdas


def mes_excel(serial: str) -> str:
    """Fecha serial de Excel (días desde 1899-12-30) -> 'AAAA-MM'."""
    return (date(1899, 12, 30) + timedelta(days=int(float(serial)))).isoformat()[:7]


def extraer(celdas: dict[str, str]) -> list[tuple[str, float]]:
    texto = " ".join(v for k, v in celdas.items() if re.fullmatch(r"A\d+", k) and int(k[1:]) < 12)
    if "Índice de precios al consumidor" not in texto or "Base Diciembre 2017 = 100" not in texto:
        raise ErrorIPC("el Cuadro 15 no tiene el título o la base esperados (IPC, base diciembre 2017 = 100)")
    col = next((re.match(r"([A-Z]+)", k).group(1) for k, v in celdas.items()
                if v.strip().lower() == "índice general"), None)
    if not col:
        raise ErrorIPC("no encontré la columna 'Índice general' en el Cuadro 15")
    serie = []
    for k, v in celdas.items():
        m = re.fullmatch(r"A(\d+)", k)
        if not m or not re.fullmatch(r"\d+(\.0+)?", v):
            continue
        valor = celdas.get(f"{col}{m.group(1)}")
        if valor is None:
            continue
        mes = mes_excel(v)
        if mes >= DESDE:
            serie.append((mes, float(valor)))
    serie.sort()
    if not serie or serie[0][0] != DESDE:
        raise ErrorIPC(f"la serie no empieza en {DESDE}")
    for (a, _), (b, _) in zip(serie, serie[1:]):
        ay, am = int(a[:4]), int(a[5:])
        if b != f"{ay + (am == 12)}-{am % 12 + 1:02d}":
            raise ErrorIPC(f"falta un mes entre {a} y {b}")
    return serie


def numero(v: float) -> str:
    # tal cual la planilla, sin el ruido de coma flotante (154.19999999999999 -> 154.2)
    return f"{v:.10f}".rstrip("0").rstrip(".")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("--descargado", default=date.today().isoformat(), help="fecha en que se bajó el archivo")
    a = ap.parse_args(argv)
    try:
        serie = extraer(leer_hoja(a.xlsx, HOJA))
    except (ErrorIPC, KeyError, zipfile.BadZipFile) as e:
        print(f"ERROR IPC: {e}", file=sys.stderr)
        return 1
    fuente = f"BCP, Anexo Estadístico del Informe Económico ({a.xlsx.name}), Cuadro 15, Índice general (base dic-2017=100)"
    escribir_csv(IPC, COLUMNAS, [{"mes": m, "ipc": numero(v), "fuente": fuente, "fuente_url": FUENTE_URL,
                                  "descargado_el": a.descargado} for m, v in serie])
    print(f"{IPC.name}: {len(serie)} meses, de {serie[0][0]} a {serie[-1][0]} (base del sitio: {serie[-1][0]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
