"""Tipo de cambio del BCP: parseo de la planilla anual (fixture real de 2024) e incremental. Sin red."""
from datetime import date
from pathlib import Path

import pytest

import etl.fetch_tipo_cambio as tc

HTML_2024 = (Path(__file__).parent / "fixtures" / "bcp_usd_2024.html").read_text(encoding="utf-8")


def test_parsea_planilla_anual_y_saltea_dias_sin_cotizacion():
    filas = tc.parsear(HTML_2024, 2024)
    por_fecha = {f["fecha"]: f["gs_por_usd"] for f in filas}
    assert por_fecha["2024-01-02"] == "7281.04" and por_fecha["2024-02-01"] == "7271.63"
    assert por_fecha["2024-12-30"] == "7831.26"
    assert "2024-01-01" not in por_fecha   # ND (feriado)
    assert 240 < len(filas) < 262          # días hábiles del año
    assert [f["fecha"] for f in filas] == sorted(por_fecha)


def test_planilla_de_otro_anio_falla():
    with pytest.raises(tc.ErrorBCP, match="2023"):
        tc.parsear(HTML_2024, 2023)


@pytest.mark.parametrize("texto,valor", [("7.281,04", 7281.04), ("ND", None), ("", None)])
def test_numero(texto, valor):
    assert tc.numero(texto) == valor


def test_incremental_baja_lo_que_falta_y_el_anio_en_curso(monkeypatch):
    pedidos = []

    def bajar(anio):
        pedidos.append(anio)
        return [{"fecha": f"{anio}-03-02", "gs_por_usd": "7000.00", "fuente": tc.FUENTE}]
    monkeypatch.setattr(tc, "bajar_anio", bajar)
    existentes = [{"fecha": f"{a}-03-02", "gs_por_usd": "1", "fuente": "x"} for a in range(2009, 2026)]
    nuevas = tc.actualizar(existentes, date(2026, 10, 29))
    assert pedidos == [2026] and [f["fecha"] for f in nuevas] == ["2026-03-02"]
    pedidos.clear()
    tc.actualizar(existentes, date(2026, 1, 15))
    assert pedidos == [2025, 2026]   # en enero también se revisa el año anterior


def test_no_reescribe_ni_agrega_fechas_futuras(monkeypatch):
    monkeypatch.setattr(tc, "bajar_anio", lambda a: [{"fecha": "2026-10-28", "gs_por_usd": "9", "fuente": "f"},
                                                     {"fecha": "2026-10-30", "gs_por_usd": "9", "fuente": "f"}])
    existentes = [{"fecha": f"{a}-01-02", "gs_por_usd": "1", "fuente": "x"} for a in range(2009, 2026)] + \
                 [{"fecha": "2026-10-28", "gs_por_usd": "7000.00", "fuente": "x"}]
    assert tc.actualizar(existentes, date(2026, 10, 29)) == []
