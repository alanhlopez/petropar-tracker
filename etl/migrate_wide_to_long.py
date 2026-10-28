"""Pasa data/raw/petropar_precios_v0.csv (ancho, prensa y planilla) a formato largo.

Una celda vacía en el formato ancho significa "sin cambio ese día", así que solo
se generan filas para las celdas con precio. El estado original se descompone en
estado + fecha_estado + nota, y la aclaración entre paréntesis de la fuente
también pasa a nota, sin perder texto. Lo usa etl/migrar_historico.py.
"""
import re
from datetime import date

from etl.io_csv import DATA

ORIGEN = DATA / "raw" / "petropar_precios_v0.csv"
COLUMNAS_FIJAS = {"fecha", "estado", "fuente"}

# "verificado", "verificado (nota)", "planilla - fecha a confirmar", ...
RE_ESTADO = re.compile(
    r"^(?P<estado>verificado|derivado|planilla)"
    r"(?:\s*\((?P<nota>[^)]*)\))?"
    r"(?P<fecha_a_confirmar>\s*-\s*fecha a confirmar)?$"
)


def parsear_estado(texto: str) -> tuple[str, str, str]:
    """Devuelve (estado, fecha_estado, nota). Falla ante un formato desconocido."""
    m = RE_ESTADO.match(texto.strip())
    if not m:
        raise ValueError(f"Estado no reconocido en el histórico: {texto!r}")
    fecha_estado = "a_confirmar" if m["fecha_a_confirmar"] else "confirmada"
    return m["estado"], fecha_estado, m["nota"] or ""


def parsear_fuente(texto: str) -> tuple[str, str]:
    """Separa "ABC 12-04-2022 (rige 13/04)" en ("ABC 12-04-2022", "rige 13/04").

    Si la cita quedó adentro del paréntesis ("fin de baja temporal (ABC 29-03-2023)"),
    se reconoce porque solo ese lado tiene dígitos, y se invierte.
    """
    m = re.match(r"^(?P<fuente>[^()]*?)\s*(?:\((?P<nota>[^()]*)\))?$", texto.strip())
    if not m:
        raise ValueError(f"Fuente con paréntesis no reconocidos: {texto!r}")
    fuente, nota = m["fuente"], m["nota"] or ""
    if nota and not re.search(r"\d", fuente) and re.search(r"\d", nota):
        fuente, nota = nota, fuente
    return fuente, nota


def migrar(filas_anchas: list[dict], productos: dict[str, dict]) -> list[dict]:
    if not filas_anchas:
        raise ValueError("El histórico original no tiene filas")
    columnas_producto = [c for c in filas_anchas[0] if c not in COLUMNAS_FIJAS]
    desconocidas = set(columnas_producto) - set(productos)
    if desconocidas:
        raise ValueError(f"Columnas sin producto en productos.csv: {sorted(desconocidas)}")

    largas = []
    fecha_anterior = ""
    for fila in filas_anchas:
        date.fromisoformat(fila["fecha"])  # falla si no es AAAA-MM-DD
        if fila["fecha"] <= fecha_anterior:
            raise ValueError(f"Fechas fuera de orden o repetidas: {fila['fecha']}")
        fecha_anterior = fila["fecha"]

        estado, fecha_estado, nota_estado = parsear_estado(fila["estado"])
        fuente, nota_fuente = parsear_fuente(fila["fuente"])
        if nota_estado and nota_fuente:
            raise ValueError(f"Dos notas en {fila['fecha']}: no se pueden separar sin ambigüedad")
        nota = nota_estado or nota_fuente
        for pid in columnas_producto:
            valor = fila[pid].strip()
            if not valor:
                continue
            if not re.fullmatch(r"[1-9][0-9]*", valor):
                raise ValueError(f"Precio no entero positivo en {fila['fecha']} / {pid}: {valor!r}")
            largas.append({
                "fecha_vigencia": fila["fecha"],
                "product_id": pid,
                "precio_gs": valor,
                "unidad": productos[pid]["unidad"],
                "tipo_precio": "venta_publico",
                "estado": estado,
                "fecha_estado": fecha_estado,
                "fuente": fuente,
                "fuente_url": "",
                "nota": nota,
                "captured_at": "",
            })
    return largas
