"""Histórico combinado: fuente oficial AIP 90150 (2009–2024) + prensa/planilla (2025+)."""
import hashlib
import shutil

import pytest

from etl.aip_90150 import PDF, extraer_texto, parsear
from etl.io_csv import COLUMNAS_PRECIOS, DATA, leer_csv
from etl.migrar_historico import (
    COLUMNAS_REPORTE, CORTE_OFICIAL, OFICIAL, REPORTE, URL_OFICIAL, construir, main,
)

SHA256 = {
    PDF: "bb52d563f3b05608a727619e68993d506f99956a6ed8233b94684ca441079699",
    OFICIAL: "c2e2ac47813a00adfb689b31dbc2ecebc893956ef4c4d0d93f8997652dd59336",
}
# Productos que no existían al inicio de la serie: no se extrapolan hacia atrás
PRIMERA_FECHA = {
    "diesel_pora": "2009-01-02",
    "nafta_aratiri97": "2009-01-02",
    "nafta_kape88": "2009-01-09",
    "diesel_mbarete": "2011-05-26",
    "nafta_oikoite93": "2015-01-06",
    "nafta_ecoflex85": "2015-01-06",
}


@pytest.fixture(scope="module")
def productos():
    return {p["product_id"]: p for p in leer_csv(DATA / "productos.csv")}


@pytest.fixture(scope="module")
def construido(productos):
    return construir(productos)


@pytest.fixture(scope="module")
def oficiales_csv():
    return leer_csv(OFICIAL)


@pytest.fixture(scope="module")
def precios():
    return leer_csv(DATA / "precios_petropar.csv")


@pytest.mark.parametrize("ruta", list(SHA256))
def test_fuentes_crudas_congeladas(ruta):
    assert hashlib.sha256(ruta.read_bytes()).hexdigest() == SHA256[ruta]


def test_csv_oficial_coincide_con_pdf(oficiales_csv):
    # Sin pdftotext este test tiene que fallar, no saltarse: es la garantía de los precios oficiales.
    assert shutil.which("pdftotext"), "falta pdftotext (instalar poppler-utils)"
    pdf = parsear(extraer_texto())
    clave = lambda f, pag: (pag, f["vigencia_desde"], f["producto"])
    en_pdf = {clave(f, f["pagina"]): f for f in pdf}
    en_csv = {clave(r, 1 if r["fuente"].endswith("pág. 1") else 2): r for r in oficiales_csv}
    assert len(pdf) == len(en_pdf) == len(oficiales_csv) == len(en_csv) == 400
    assert en_pdf.keys() == en_csv.keys()
    for k, r in en_csv.items():
        f = en_pdf[k]
        assert int(r["precio_gs"]) == f["precio_gs"], k
        if r["vigencia_hasta"] != f["vigencia_hasta"]:
            # única corrección permitida: el typo anotado en el CSV
            assert "typo" in r["nota"], k
            assert (f["vigencia_hasta"], r["vigencia_hasta"]) == ("2021-02-04", "2022-02-04"), k


def test_tipo_precio_por_pagina(oficiales_csv):
    for r in oficiales_csv:
        esperado = "max_o_sugerido_venta_publico" if r["fuente"].endswith("pág. 1") else "venta_publico"
        assert r["tipo_precio"] == esperado


def test_conteo_y_precios_oficiales_intactos(oficiales_csv, construido, precios):
    serie, _, solapadas = construido
    cargadas = [p for p in precios if p["fuente_url"] == URL_OFICIAL]
    assert len(oficiales_csv) == len(cargadas) + len(solapadas)
    assert len(solapadas) == 4
    en_serie = {(p["fecha_vigencia"], p["product_id"]): p for p in cargadas}
    for o in oficiales_csv:
        p = en_serie[(o["vigencia_desde"], o["producto"])]
        assert p["precio_gs"] == o["precio_gs"]
        assert (p["estado"], p["fecha_estado"]) == ("verificado", "confirmada")


def test_archivo_coincide_con_la_construccion(construido, precios):
    """precios_petropar.csv arranca siendo exactamente la construcción (luego solo se agregan filas)."""
    serie, _, _ = construido
    assert list(precios[0]) == COLUMNAS_PRECIOS
    assert precios[: len(serie)] == serie


def test_reporte_de_conflictos_coincide(construido):
    _, reporte, _ = construido
    en_disco = leer_csv(REPORTE)
    assert list(en_disco[0]) == COLUMNAS_REPORTE
    assert en_disco == reporte


def test_fuente_oficial_primero(precios):
    """Hasta el corte, todo sale del documento oficial; después, nada."""
    for p in precios:
        if p["fecha_vigencia"] <= CORTE_OFICIAL:
            assert p["fuente_url"] == URL_OFICIAL, p
        else:
            assert p["fuente_url"] != URL_OFICIAL, p


def test_sin_extrapolar_hacia_atras(precios):
    primeras: dict[str, str] = {}
    for p in precios:
        primeras.setdefault(p["product_id"], p["fecha_vigencia"])
        primeras[p["product_id"]] = min(primeras[p["product_id"]], p["fecha_vigencia"])
    # productos que se agreguen después (ej. GLP vía scraper) no cuentan acá
    assert {k: primeras[k] for k in PRIMERA_FECHA} == PRIMERA_FECHA
    assert min(primeras.values()) == "2009-01-02"


def test_nada_despues_de_datos_hasta(productos, precios):
    for p in precios:
        hasta = productos[p["product_id"]]["datos_hasta"]
        assert not hasta or p["fecha_vigencia"] <= hasta, p


def test_correccion_aprobada_2026_01_28(precios):
    assert not [p for p in precios if p["fecha_vigencia"] == "2026-02-01"]
    filas = {p["product_id"]: p for p in precios if p["fecha_vigencia"] == "2026-01-28"}
    assert {k: v["precio_gs"] for k, v in filas.items()} == {
        "diesel_mbarete": "8050", "diesel_pora": "6250", "nafta_aratiri97": "7040",
        "nafta_oikoite93": "5690", "nafta_kape88": "5190",
    }
    for f in filas.values():
        assert (f["estado"], f["fecha_estado"]) == ("verificado", "confirmada")
        assert f["nota"] == "antes derivado de ABC 28-10-2026 con fecha placeholder 2026-02-01"


def test_anotaciones_pisan_nota_sin_tocar_precio(precios, oficiales_csv):
    anotaciones = {(a["fecha_vigencia"], a["product_id"]): a["nota"]
                   for a in leer_csv(DATA / "anotaciones.csv")}
    oficial = {(o["vigencia_desde"], o["producto"]): o["precio_gs"] for o in oficiales_csv}
    vistas = 0
    for p in precios:
        clave = (p["fecha_vigencia"], p["product_id"])
        if clave in anotaciones:
            assert p["nota"] == anotaciones[clave]
            assert p["precio_gs"] == oficial[clave]
            vistas += 1
    assert vistas == len(anotaciones) == 7


def test_no_reescribe_si_ya_existe(tmp_path, monkeypatch):
    import etl.migrar_historico as mh
    destino = tmp_path / "precios.csv"
    destino.write_text("no tocar")
    monkeypatch.setattr(mh, "DESTINO", destino)
    monkeypatch.setattr(mh, "REPORTE", tmp_path / "reporte.csv")
    assert main() == 1
    assert destino.read_text() == "no tocar"
    assert not (tmp_path / "reporte.csv").exists()
