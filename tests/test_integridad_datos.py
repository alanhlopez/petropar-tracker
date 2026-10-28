"""Integridad de los CSV de data/ (los que se versionan y alimentan el sitio)."""
from datetime import date

from etl.io_csv import DATA, ESTADOS, FECHA_ESTADOS, TIPOS_PRECIO, leer_csv


def test_productos():
    productos = leer_csv(DATA / "productos.csv")
    ids = [p["product_id"] for p in productos]
    assert len(ids) == len(set(ids))
    assert {p["tipo"] for p in productos} <= {"diesel", "nafta", "glp"}
    assert {p["unidad"] for p in productos} <= {"litro", "kg"}
    glp = {p["product_id"]: p["unidad"] for p in productos if p["tipo"] == "glp"}
    assert sorted(glp.values()) == ["kg", "litro"]
    historicos = {n for p in productos for n in p["nombres_historicos"].split("|") if n}
    assert {"Tipo I", "Tipo III", "Diésel común", "Eco 85",
            "Eco 90 Especial", "Ecoplus 95"} <= historicos
    for p in productos:
        if p["datos_hasta"]:
            date.fromisoformat(p["datos_hasta"])


def test_precios():
    productos = {p["product_id"]: p for p in leer_csv(DATA / "productos.csv")}
    precios = leer_csv(DATA / "precios_petropar.csv")
    claves = set()
    for f in precios:
        date.fromisoformat(f["fecha_vigencia"])
        assert f["product_id"] in productos
        assert f["unidad"] == productos[f["product_id"]]["unidad"]
        assert int(f["precio_gs"]) > 0
        assert f["tipo_precio"] in TIPOS_PRECIO
        assert f["estado"] in ESTADOS
        assert f["fecha_estado"] in FECHA_ESTADOS
        clave = (f["fecha_vigencia"], f["product_id"])
        assert clave not in claves, clave
        claves.add(clave)


def test_presidentes_contiguos():
    presidentes = leer_csv(DATA / "presidentes.csv")
    for anterior, siguiente in zip(presidentes, presidentes[1:]):
        assert date.fromisoformat(anterior["inicio"]) < date.fromisoformat(anterior["fin"])
        assert anterior["fin"] == siguiente["inicio"]
    assert presidentes[-1]["fin"] == ""  # mandato en curso
    # la serie (2009-01-02) cae dentro del primer mandato
    assert presidentes[0]["inicio"] <= "2009-01-02" < presidentes[0]["fin"]


def test_eventos():
    for e in leer_csv(DATA / "eventos.csv"):
        date.fromisoformat(e["fecha"])
        if e["fecha_fin"]:
            assert date.fromisoformat(e["fecha"]) <= date.fromisoformat(e["fecha_fin"])
        assert e["tipo"] in {"hito", "promo"}
        assert e["mostrar"] in {"true", "false"}
        assert e["etiqueta"]
        if e["tipo"] == "promo":
            assert e["fuente"] and e["fuente_url"].startswith("https://")
