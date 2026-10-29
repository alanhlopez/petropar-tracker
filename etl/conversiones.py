"""Vistas "US$ por litro" y "Gs constantes" (site/data.json).

- US$ por litro: cada precio se divide por el tipo de cambio de referencia del BCP en su fecha de vigencia
  (data/tipo_cambio.csv; si ese día no hubo cotización, la última anterior). Nunca una cotización posterior.
- Gs constantes: data/ipc.csv (IPC mensual del BCP, carga manual documentada en el README). El sitio deflacta
  con base en el último mes disponible: valor_real = precio * IPC(base) / IPC(mes).
"""
import bisect
from pathlib import Path

from etl.io_csv import leer_csv


def tipo_cambio(data: Path) -> list[tuple[str, float]]:
    ruta = data / "tipo_cambio.csv"
    filas = leer_csv(ruta) if ruta.exists() else []
    serie = sorted((f["fecha"], float(f["gs_por_usd"])) for f in filas)
    for (a, _), (b, _) in zip(serie, serie[1:]):
        if a == b:
            raise ValueError(f"tipo_cambio.csv: fecha repetida {a}")
    return serie


def cotizacion_en(serie: list[tuple[str, float]], fecha: str) -> tuple[str, float] | None:
    """Cotización del día o la última anterior (fines de semana y feriados); None si no hay ninguna antes."""
    i = bisect.bisect_right(serie, (fecha, float("inf"))) - 1
    return serie[i] if i >= 0 else None


def usd_por_litro(precio_gs: int, fecha: str, serie: list[tuple[str, float]]) -> dict | None:
    c = cotizacion_en(serie, fecha)
    if not c:
        return None
    return {"usd": round(precio_gs / c[1], 4), "tc": c[1], "tc_fecha": c[0]}


def ipc_json(data: Path) -> dict | None:
    ruta = data / "ipc.csv"
    filas = leer_csv(ruta) if ruta.exists() else []
    if not filas:
        return None
    serie = []
    for f in filas:
        mes = f["mes"]
        if len(mes) != 7 or mes[4] != "-" or not (mes[:4] + mes[5:]).isdigit() or not 1 <= int(mes[5:]) <= 12:
            raise ValueError(f"ipc.csv: mes inválido {mes!r} (formato AAAA-MM)")
        try:
            v = float(f["ipc"])
        except ValueError:
            raise ValueError(f"ipc.csv: IPC inválido en {mes}: {f['ipc']!r}") from None
        if v <= 0:
            raise ValueError(f"ipc.csv: IPC no positivo en {mes}")
        if not f["fuente"]:
            raise ValueError(f"ipc.csv: falta la fuente en {mes}")
        serie.append([mes, v])
    serie.sort()
    meses = [m for m, _ in serie]
    if len(set(meses)) != len(meses):
        raise ValueError("ipc.csv: hay meses repetidos")
    return {"base": meses[-1], "serie": serie, "fuente": filas[-1]["fuente"],
            "fuente_url": filas[-1]["fuente_url"], "descargado_el": max(f["descargado_el"] for f in filas)}
