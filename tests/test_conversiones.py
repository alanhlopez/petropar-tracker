"""Vistas US$ por litro y Gs constantes: tipo de cambio en la fecha de vigencia e IPC."""
import pytest

from etl import conversiones as cv
from etl.io_csv import DATA, escribir_csv, leer_csv

SERIE = [("2024-01-02", 7281.04), ("2024-01-03", 7262.13), ("2024-01-05", 7270.00)]


def test_usa_la_cotizacion_del_dia_o_la_ultima_anterior():
    assert cv.cotizacion_en(SERIE, "2024-01-03") == ("2024-01-03", 7262.13)
    assert cv.cotizacion_en(SERIE, "2024-01-04") == ("2024-01-03", 7262.13)   # sin cotización: la anterior
    assert cv.cotizacion_en(SERIE, "2024-01-01") is None                       # nunca una posterior


def test_usd_por_litro():
    assert cv.usd_por_litro(7262, "2024-01-04", SERIE) == {"usd": round(7262 / 7262.13, 4), "tc": 7262.13, "tc_fecha": "2024-01-03"}


def test_todos_los_precios_reales_tienen_usd_con_cotizacion_previa_o_del_dia():
    serie = cv.tipo_cambio(DATA)
    assert serie, "falta data/tipo_cambio.csv"
    for f in leer_csv(DATA / "precios_petropar.csv"):
        u = cv.usd_por_litro(int(f["precio_gs"]), f["fecha_vigencia"], serie)
        assert u and u["tc_fecha"] <= f["fecha_vigencia"], f


COLS = ["mes", "ipc", "fuente", "fuente_url", "descargado_el"]


def test_ipc_base_es_el_ultimo_mes(tmp_path):
    escribir_csv(tmp_path / "ipc.csv", COLS, [
        {"mes": "2026-09", "ipc": "150.2", "fuente": "BCP", "fuente_url": "https://www.bcp.gov.py", "descargado_el": "2026-10-29"},
        {"mes": "2009-01", "ipc": "60.1", "fuente": "BCP", "fuente_url": "https://www.bcp.gov.py", "descargado_el": "2026-10-29"},
    ])
    i = cv.ipc_json(tmp_path)
    assert i["base"] == "2026-09" and i["serie"][0] == ["2009-01", 60.1]


def test_sin_ipc_la_vista_queda_desactivada(tmp_path):
    escribir_csv(tmp_path / "ipc.csv", COLS, [])
    assert cv.ipc_json(tmp_path) is None


@pytest.mark.parametrize("fila,error", [
    ({"mes": "2026-13"}, "mes inválido"), ({"mes": "09/2026"}, "mes inválido"),
    ({"ipc": "ciento"}, "IPC inválido"), ({"ipc": "-1"}, "no positivo"), ({"fuente": ""}, "fuente"),
])
def test_ipc_invalido_falla(tmp_path, fila, error):
    base = {"mes": "2026-09", "ipc": "150.2", "fuente": "BCP", "fuente_url": "", "descargado_el": "2026-10-29"}
    escribir_csv(tmp_path / "ipc.csv", COLS, [{**base, **fila}])
    with pytest.raises(ValueError, match=error):
        cv.ipc_json(tmp_path)
