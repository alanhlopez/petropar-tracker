"""Emblemas privados: validación de data/precios_privados.csv y "últimos cambios reportados"."""
import shutil
from datetime import date

import pytest

from etl.io_csv import DATA, escribir_csv, leer_csv
from etl.privados import CATEGORIAS, privados_json

COLUMNAS = ["fecha_vigencia", "emblema", "producto_comercial", "categoria", "precio_gs", "estado",
            "fecha_estado", "fuente", "fuente_url", "nota"]
HOY = date(2026, 10, 29)


@pytest.fixture
def data(tmp_path):
    for nombre in ("emblemas.csv", "equivalencias.csv"):
        shutil.copy(DATA / nombre, tmp_path / nombre)
    return tmp_path


def fila(fecha, emblema, producto, categoria, precio, estado="verificado", fecha_estado="confirmada"):
    return {"fecha_vigencia": fecha, "emblema": emblema, "producto_comercial": producto, "categoria": categoria,
            "precio_gs": str(precio), "estado": estado, "fecha_estado": fecha_estado,
            "fuente": "Última Hora 03/08/2026", "fuente_url": "https://www.ultimahora.com/x", "nota": ""}


def escribir(data, *filas):
    escribir_csv(data / "precios_privados.csv", COLUMNAS, list(filas))


def test_ultimo_precio_por_emblema_y_categoria(data):
    escribir(data,
             fila("2026-08-02", "copetrol", "Diésel Go S50", "Diésel común", 8690),
             fila("2026-10-26", "copetrol", "Diésel Go S50", "Diésel común", 9490),
             fila("2026-10-25", "copetrol", "Suprema 97", "Nafta 97+", 9150, fecha_estado="a_confirmar"))
    p = privados_json(data, HOY)
    assert p["categorias"] == CATEGORIAS
    ult = {(u["emblema"], u["categoria"]): u for u in p["ultimos"]}
    assert ult[("copetrol", "Diésel común")]["precio"] == 9490
    assert ult[("copetrol", "Diésel común")]["dias"] == 3 and not ult[("copetrol", "Diésel común")]["viejo"]
    assert not ult[("copetrol", "Nafta 97+")]["firme"]   # fecha de vigencia por confirmar
    assert len(p["historial"]) == 3


def test_otra_nota_con_el_mismo_precio_no_mueve_la_fecha(data):
    escribir(data, fila("2026-10-23", "petromax", "Diésel tipo III", "Diésel común", 9490),
             {**fila("2026-10-26", "petromax", "Diésel común", "Diésel común", 9490), "fuente": "Última Hora 26/10/2026"})
    [u] = privados_json(data, HOY)["ultimos"]
    assert u["fecha"] == "2026-10-23"


def test_precio_de_mas_de_7_dias_se_marca_viejo(data):
    escribir(data, fila("2026-10-21", "shell", "Nafta 88 octanos", "Nafta 88–90", 6990),
             fila("2026-10-22", "shell", "Nafta 93 octanos", "Nafta 93–95", 7490))
    ult = {u["categoria"]: u for u in privados_json(data, HOY)["ultimos"]}
    assert ult["Nafta 88–90"]["viejo"] and not ult["Nafta 93–95"]["viejo"]   # 8 días vs 7


def test_precio_de_mas_de_6_meses_no_se_publica_como_ultimo(data):
    escribir(data, fila("2026-03-11", "shell", "Gasoil grado III", "Diésel común", 6990))
    p = privados_json(data, HOY)
    assert p["ultimos"] == [] and len(p["historial"]) == 1


def test_sin_precios_privados_sale_vacio(data):
    p = privados_json(data, HOY)
    assert p["ultimos"] == [] and p["historial"] == []
    assert [e["id"] for e in p["emblemas"]] == ["shell", "petrobras", "copetrol", "puma", "petromax"]


@pytest.mark.parametrize("cambio,error", [
    ({"emblema": "esso"}, "emblema desconocido"),
    ({"categoria": "Nafta 90"}, "categoría"),
    ({"producto_comercial": "Suprema 97", "categoria": "Nafta 93–95"}, "equivalencias.csv"),
    ({"precio_gs": "9.490"}, "precio inválido"),
    ({"estado": "estimado"}, "estado"),
    ({"fuente_url": ""}, "fuente y URL"),
    ({"fecha_vigencia": "26/10/2026"}, "fecha inválida"),
])
def test_filas_invalidas_cortan_la_generacion(data, cambio, error):
    escribir(data, {**fila("2026-10-26", "copetrol", "Diésel Go S50", "Diésel común", 9490), **cambio})
    with pytest.raises(ValueError, match=error):
        privados_json(data, HOY)


def test_precio_repetido_de_la_misma_fuente_falla(data):
    f = fila("2026-10-26", "copetrol", "Diésel Go S50", "Diésel común", 9490)
    escribir(data, f, {**f, "precio_gs": "9500"})
    with pytest.raises(ValueError, match="repetido"):
        privados_json(data, HOY)


def test_dos_fuentes_con_valores_distintos_el_mismo_dia_no_son_firmes(data):
    a = fila("2026-10-26", "shell", "Gasoil grado III", "Diésel común", 6900)
    b = {**a, "precio_gs": "6990", "fuente": "Última Hora 12/03/2026"}
    escribir(data, a, b)
    [u] = privados_json(data, HOY)["ultimos"]
    assert not u["firme"] and "6900" in u["nota"] and "6990" in u["nota"]


def test_sin_categoria_queda_en_historial_pero_no_en_la_tabla(data):
    escribir(data, fila("2026-08-12", "petrobras", "Prix", "", 5990))
    p = privados_json(data, HOY)
    assert p["ultimos"] == [] and len(p["historial"]) == 1


def test_csv_real_valido_y_con_fuente():
    """El CSV del repo pasa la validación y todo precio tiene URL de una nota (nunca fulltanque)."""
    privados_json(DATA, HOY)
    for f in leer_csv(DATA / "precios_privados.csv"):
        assert "fulltanque" not in f["fuente_url"]


def test_equivalencias_usan_categorias_de_productos():
    validas = {p["categoria"] for p in leer_csv(DATA / "productos.csv")}
    for e in leer_csv(DATA / "equivalencias.csv"):
        assert e["categoria"] in validas and e["categoria"] in CATEGORIAS, e


@pytest.mark.parametrize("producto,categoria", [
    ("Euro5", "Diésel común"), ("Diesel Euro 5", "Diésel común"), ("Diésel Euro 5", "Diésel común"),
    ("Grid", "Nafta 93–95"), ("Nafta Grid", "Nafta 93–95"),
    ("Euro6", ""), ("Prix", ""),   # sin equivalencia: quedan sin categoría
])
def test_categoria_vacia_se_completa_con_equivalencias(data, producto, categoria):
    escribir(data, fila("2026-10-24", "petrobras", producto, "", 9490))
    assert privados_json(data, HOY)["historial"][0]["categoria"] == categoria


def test_mismo_nombre_con_otro_tipo_no_se_confunde(data):
    # V-Power Diésel es premium; V-Power Nafta no hereda esa categoría
    escribir(data, fila("2026-10-23", "shell", "V-Power Nafta", "", 9190))
    assert privados_json(data, HOY)["historial"][0]["categoria"] == ""
