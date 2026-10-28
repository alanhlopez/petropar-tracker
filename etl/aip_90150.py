"""Parser de la respuesta AIP N° 90150 de Petropar (data/raw/petropar_AIP_90150.pdf).

Extrae el texto con `pdftotext -layout` y devuelve una fila por precio publicado,
tal como figura en el PDF (sin corregir nada). Sirve para verificar
data/raw/petropar_historico_oficial_2009_2024.csv.

- Página 1: "A partir del <fecha>  <precio>", en dos columnas por bloque
  (GASOIL: Tipo III | Tipo I; NAFTAS: Econo 85 | Ecoplus 95). Precio máximo y/o sugerido.
- Página 2: tabla Desde/Hasta con 6 productos. Precio de venta al público.
"""
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path

from etl.io_csv import DATA

PDF = DATA / "raw" / "petropar_AIP_90150.pdf"

MESES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"], start=1)}

# Columna (izquierda, derecha) de cada bloque de la página 1
BLOQUES_PAG1 = {
    "GASOIL": ("diesel_pora", "diesel_mbarete"),
    "NAFTAS": ("nafta_kape88", "nafta_aratiri97"),
}
# Orden de columnas de la página 2: Diesel Pora, Diesel Mbarete, Kape 88, Oikoite 93, Aratiri 97, Ecoflex 85
COLUMNAS_PAG2 = ["diesel_pora", "diesel_mbarete", "nafta_kape88",
                 "nafta_oikoite93", "nafta_aratiri97", "nafta_ecoflex85"]
# La columna derecha de la página 1 empieza más allá de este carácter
CORTE_COLUMNAS = 90

RE_PAG1 = re.compile(
    r"A\s+(?:partir|aprtir)\s+del?\s+(?P<dia>\d{1,2})\s*(?:de\s+)?"
    r"(?P<mes>" + "|".join(MESES) + r")\s*(?:de\s+)?(?P<anio>\d{4})\s+(?P<precio>[\d.]+),00",
    re.IGNORECASE,
)
RE_FECHA_DMY = r"\d{1,2}/\d{1,2}/\d{4}"
RE_PAG2 = re.compile(
    rf"^\s*(?P<desde>{RE_FECHA_DMY})\s+(?P<hasta>{RE_FECHA_DMY})\s+(?P<precios>(?:[\d.]+\s+){{5}}[\d.]+)\s*$"
)


def extraer_texto(pdf: Path = PDF) -> str:
    if not shutil.which("pdftotext"):
        raise RuntimeError("Falta pdftotext (poppler-utils)")
    return subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                          check=True, capture_output=True, text=True).stdout


def _dmy(texto: str) -> str:
    d, m, a = (int(x) for x in texto.split("/"))
    return date(a, m, d).isoformat()


def _precio(texto: str) -> int:
    if not re.fullmatch(r"\d{1,3}(?:\.\d{3})*", texto):
        raise ValueError(f"Precio con formato inesperado: {texto!r}")
    return int(texto.replace(".", ""))


def parsear_pagina1(texto: str) -> list[dict]:
    filas, bloque = [], None
    for linea in texto.splitlines():
        if linea.strip() in BLOQUES_PAG1:
            bloque = linea.strip()
            continue
        for m in RE_PAG1.finditer(linea):
            if bloque is None:
                raise ValueError(f"Precio fuera de bloque GASOIL/NAFTAS: {linea!r}")
            izquierda, derecha = BLOQUES_PAG1[bloque]
            filas.append({
                "vigencia_desde": date(int(m["anio"]), MESES[m["mes"].lower()], int(m["dia"])).isoformat(),
                "vigencia_hasta": "",
                "producto": izquierda if m.start() < CORTE_COLUMNAS else derecha,
                "precio_gs": _precio(m["precio"]),
                "pagina": 1,
            })
    return filas


def parsear_pagina2(texto: str) -> list[dict]:
    filas = []
    for linea in texto.splitlines():
        m = RE_PAG2.match(linea)
        if not m:
            continue
        precios = m["precios"].split()
        for producto, precio in zip(COLUMNAS_PAG2, precios, strict=True):
            filas.append({
                "vigencia_desde": _dmy(m["desde"]),
                "vigencia_hasta": _dmy(m["hasta"]),
                "producto": producto,
                "precio_gs": _precio(precio),
                "pagina": 2,
            })
    return filas


def parsear(texto: str) -> list[dict]:
    paginas = texto.split("Página 1 de 2")
    if len(paginas) != 2:
        raise ValueError("No se encontró el corte entre página 1 y página 2")
    return parsear_pagina1(paginas[0]) + parsear_pagina2(paginas[1])
