"""EIA: unidades, conversión ÷42, paginación, incremental sin duplicar. Sin red: requests simulado."""
import json
from pathlib import Path

import pytest

import etl.fetch_oil as fo

FIX = Path(__file__).parent / "fixtures"


class Respuesta:
    def __init__(self, cuerpo: dict, status: int = 200):
        self.cuerpo, self.status_code = cuerpo, status

    def json(self):
        return self.cuerpo


def fixture(nombre: str) -> dict:
    return json.loads((FIX / nombre).read_text())


@pytest.fixture
def eia(monkeypatch):
    """Simula la API: responde según la serie pedida y registra los parámetros."""
    pedidos = []
    respuestas = {"RWTC": fixture("eia_rwtc.json"), "RBRTE": fixture("eia_rbrte.json"),
                  "EER_EPD2DXL0_PF4_RGC_DPG": fixture("eia_ulsd.json")}

    def get(url, params, timeout):
        pedidos.append(params)
        return Respuesta(respuestas[params["facets[series][]"]])
    monkeypatch.setattr(fo.requests, "get", get)
    return pedidos, respuestas


def test_carga_inicial_convierte_y_saltea_nulos(eia):
    pedidos, _ = eia
    nuevas = fo.actualizar("clave", [])
    assert {p["start"] for p in pedidos} == {"2009-01-01"}
    assert all(p["frequency"] == "daily" and p["data[0]"] == "value" for p in pedidos)
    wti = {(f["fecha"], f["unidad"]): f["valor_usd"] for f in nuevas if f["serie"] == "wti"}
    assert wti == {
        ("2026-10-19", "usd_bbl"): "99.12", ("2026-10-19", "usd_gal"): f"{99.12 / 42:.4f}",
        ("2026-10-20", "usd_bbl"): "100.38", ("2026-10-20", "usd_gal"): f"{100.38 / 42:.4f}",
    }  # el 2026-10-21 viene sin valor y no se guarda
    brent = {(f["fecha"], f["unidad"]): f["valor_usd"] for f in nuevas if f["serie"] == "brent"}
    assert brent == {
        ("2026-10-19", "usd_bbl"): "95.40", ("2026-10-19", "usd_gal"): f"{95.40 / 42:.4f}",
        ("2026-10-20", "usd_bbl"): "96.10", ("2026-10-20", "usd_gal"): f"{96.10 / 42:.4f}",
    }
    ulsd = [(f["fecha"], f["valor_usd"], f["unidad"]) for f in nuevas if f["serie"] == "ulsd"]
    assert ulsd == [("2026-10-19", "3.1050", "usd_gal"), ("2026-10-20", "3.2120", "usd_gal")]


def test_incremental_desde_ultima_fecha_sin_duplicar(eia):
    pedidos, _ = eia
    existentes = [
        {"fecha": "2026-10-19", "serie": "wti", "valor_usd": "99.12", "unidad": "usd_bbl"},
        {"fecha": "2026-10-19", "serie": "wti", "valor_usd": "2.3600", "unidad": "usd_gal"},
        {"fecha": "2026-10-20", "serie": "ulsd", "valor_usd": "3.2120", "unidad": "usd_gal"},
    ]
    nuevas = fo.actualizar("clave", existentes)
    assert {p["facets[series][]"]: p["start"] for p in pedidos} == {
        "RWTC": "2026-10-19", "RBRTE": "2009-01-01", "EER_EPD2DXL0_PF4_RGC_DPG": "2026-10-20"}  # Brent: carga inicial
    claves = [(f["fecha"], f["serie"], f["unidad"]) for f in nuevas]
    assert ("2026-10-19", "wti", "usd_bbl") not in claves
    assert ("2026-10-20", "ulsd", "usd_gal") not in claves
    assert len(claves) == len(set(claves)) == 7  # wti 10-20 (bbl, gal) + brent 10-19 y 10-20 (bbl, gal) + ulsd 10-19


@pytest.mark.parametrize("serie,unidad", [("RWTC", "$/GAL"), ("RBRTE", "$/GAL"), ("EER_EPD2DXL0_PF4_RGC_DPG", "$/BBL")])
def test_unidad_inesperada_falla(eia, serie, unidad):
    _, respuestas = eia
    for f in respuestas[serie]["response"]["data"]:
        f["units"] = unidad
    with pytest.raises(fo.ErrorEIA, match="unidad"):
        fo.actualizar("clave", [])


def test_pagina_con_offset(monkeypatch):
    monkeypatch.setattr(fo, "PAGINA", 2)
    base = fixture("eia_ulsd.json")["response"]["data"][0]
    todas = [dict(base, period=f"2026-01-0{i}") for i in range(1, 6)]  # 5 filas, páginas de 2
    offsets = []

    def get(url, params, timeout):
        offsets.append(params["offset"])
        o = params["offset"]
        return Respuesta({"response": {"total": "5", "data": todas[o:o + params["length"]]}})
    monkeypatch.setattr(fo.requests, "get", get)
    filas = fo.descargar_serie("clave", "EER_EPD2DXL0_PF4_RGC_DPG", "2026-01-01")
    assert offsets == [0, 2, 4]
    assert [f["period"] for f in filas] == [f"2026-01-0{i}" for i in range(1, 6)]


def test_error_http_no_expone_la_clave(monkeypatch):
    monkeypatch.setattr(fo.requests, "get", lambda url, params, timeout: Respuesta({}, 403))
    with pytest.raises(fo.ErrorEIA) as e:
        fo.descargar_serie("CLAVE-SECRETA", "RWTC", "2026-01-01")
    assert "CLAVE-SECRETA" not in str(e.value)


def test_error_de_red_no_expone_la_clave(monkeypatch, capsys):
    """requests incluye la URL (con ?api_key=...) en el mensaje de ConnectionError."""
    def caida(url, params, timeout):
        raise fo.requests.ConnectionError(f"Max retries exceeded with url: {url}?api_key={params['api_key']}")
    monkeypatch.setattr(fo.requests, "get", caida)
    monkeypatch.setenv("EIA_API_KEY", "CLAVE-SECRETA")
    monkeypatch.setattr(fo, "PETROLEO", fo.DATA / "no_existe_petroleo.csv")
    assert fo.main() == 1
    salida = capsys.readouterr()
    assert "CLAVE-SECRETA" not in salida.out + salida.err
    assert "ConnectionError" in salida.err


@pytest.mark.parametrize("respuesta,mensaje", [
    ({"response": {"data": []}}, "total"),
    ({"response": {"total": "1", "data": [{"period": "2026-01-02", "series": "RWTC",
                                           "units": "$/BBL", "value": "n/d"}]}}, "no numérico"),
])
def test_respuesta_mal_formada_falla(monkeypatch, respuesta, mensaje):
    monkeypatch.setattr(fo.requests, "get", lambda url, params, timeout: Respuesta(respuesta))
    with pytest.raises(fo.ErrorEIA, match=mensaje):
        fo.convertir("RWTC", fo.descargar_serie("clave", "RWTC", "2026-01-01"))


def test_wti_negativo_se_guarda(monkeypatch):
    fila = {"period": "2020-04-20", "series": "RWTC", "units": "$/BBL", "value": -37.63}
    assert fo.convertir("RWTC", [fila])[0]["valor_usd"] == "-37.63"


def test_incremental_recupera_unidad_atrasada(eia):
    pedidos, _ = eia
    existentes = [
        {"fecha": "2026-10-20", "serie": "wti", "valor_usd": "100.38", "unidad": "usd_bbl"},
        {"fecha": "2026-10-19", "serie": "wti", "valor_usd": "2.3600", "unidad": "usd_gal"},
    ]
    nuevas = fo.actualizar("clave", existentes)
    assert next(p for p in pedidos if p["facets[series][]"] == "RWTC")["start"] == "2026-10-19"
    assert ("2026-10-20", "wti", "usd_gal") in {(f["fecha"], f["serie"], f["unidad"]) for f in nuevas}


def test_sin_api_key_sale_1(monkeypatch):
    monkeypatch.delenv("EIA_API_KEY", raising=False)
    assert fo.main() == 1
