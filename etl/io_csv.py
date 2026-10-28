"""Lectura y escritura de los CSV del proyecto (UTF-8, saltos de línea \\n)."""
import csv
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"

COLUMNAS_PRECIOS = [
    "fecha_vigencia", "product_id", "precio_gs", "unidad", "tipo_precio", "estado",
    "fecha_estado", "fuente", "fuente_url", "nota", "captured_at",
]
ESTADOS = {"verificado", "derivado", "planilla", "a_confirmar"}
FECHA_ESTADOS = {"confirmada", "a_confirmar"}
TIPOS_PRECIO = {"max_o_sugerido_venta_publico", "venta_publico"}


def leer_csv(ruta: Path) -> list[dict]:
    with open(ruta, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def escribir_csv(ruta: Path, columnas: list[str], filas: list[dict]) -> None:
    with open(ruta, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columnas, lineterminator="\n")
        w.writeheader()
        w.writerows(filas)
