"""site/data.json: estructura, promedio mensual, filtros y datos faltantes.

Los tests trabajan sobre una copia de data/ y solo afirman sobre lo que ellos mismos
agregan, para no romperse cuando el scraper sume filas reales.
"""
import json
import shutil
from datetime import datetime, timezone

import pytest

import etl.build_site_data as bs
from etl.io_csv import DATA, escribir_csv, leer_csv

AHORA = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)
URL_AIP = "https://informacionpublica.paraguay.gov.py/public/2025/1742301348_1_RespuestaSolicitudN90150.pdf"


@pytest.fixture
def data(tmp_path):
    """Copia de data/ sin petroleo.csv, para modificar sin tocar el repo."""
    destino = tmp_path / "data"
    destino.mkdir()
    for nombre in ("productos.csv", "precios_petropar.csv", "presidentes.csv", "eventos.csv"):
        shutil.copy(DATA / nombre, destino / nombre)
    return destino


def agregar_precio(data, linea: str):
    with open(data / "precios_petropar.csv", "a", encoding="utf-8") as f:
        f.write(linea + "\n")


def test_sin_petroleo_genera_series_vacias(data):
    datos = bs.construir(data, AHORA)
    assert datos["petroleo"]["wti"] == {"unidad": "usd_gal", "diario": [], "mensual": []}
    assert datos["ultimo_dato"]["wti"] is None
    json.dumps(datos)  # serializable


def test_precios_y_marcas(data):
    agregar_precio(data, "2099-01-01,diesel_pora,9300,litro,venta_publico,verificado,a_confirmar,x,,,2098-12-31T15:00:00+00:00")
    datos = bs.construir(data, AHORA)
    pora = datos["precios"]["diesel_pora"]
    assert pora[0] == {
        "fecha": "2009-01-02", "precio": 4270, "tipo_precio": "max_o_sugerido_venta_publico",
        "estado": "verificado", "fecha_estado": "confirmada", "firme": True,
        "fuente": "Petropar, Respuesta AIP Solicitud N° 90150 (17-03-2025), pág. 1",
        "urls": [URL_AIP], "nota": "",
    }
    assert [p["fecha"] for p in pora] == sorted(p["fecha"] for p in pora)
    assert pora[-1]["fecha"] == "2099-01-01" and pora[-1]["firme"] is False
    # varias URLs separadas por " | " se convierten en lista
    assert len(next(p for p in datos["precios"]["diesel_mbarete"] if p["fecha"] == "2026-01-28")["urls"]) == 2


def test_producto_sin_precios_sale_con_lista_vacia(data):
    productos = leer_csv(data / "productos.csv")
    productos.append({**productos[0], "product_id": "producto_sin_datos", "nombre_actual": "Sin datos"})
    escribir_csv(data / "productos.csv", list(productos[0]), productos)
    datos = bs.construir(data, AHORA)
    assert datos["precios"]["producto_sin_datos"] == []
    assert {p["id"] for p in datos["productos"]} == set(datos["precios"])


def test_precio_de_producto_desconocido_falla(data):
    agregar_precio(data, "2099-01-01,nafta_inventada,1000,litro,venta_publico,verificado,confirmada,x,,,")
    with pytest.raises(ValueError, match="nafta_inventada"):
        bs.construir(data, AHORA)


@pytest.mark.parametrize("linea,mensaje", [
    (",diesel_pora,9300,litro,venta_publico,verificado,confirmada,x,,,", "Fecha inválida"),
    ("2099-01-01,diesel_pora,,litro,venta_publico,verificado,confirmada,x,,,", "Precio inválido"),
    ("2099-01-01,diesel_pora,0,litro,venta_publico,verificado,confirmada,x,,,", "Precio inválido"),
])
def test_fecha_o_precio_faltante_falla_con_mensaje_claro(data, linea, mensaje):
    agregar_precio(data, linea)
    with pytest.raises(ValueError, match=mensaje):
        bs.construir(data, AHORA)


def test_promedio_mensual_y_diario(data):
    escribir_csv(data / "petroleo.csv", ["fecha", "serie", "valor_usd", "unidad"], [
        {"fecha": "2026-09-30", "serie": "wti", "valor_usd": "2.0000", "unidad": "usd_gal"},
        {"fecha": "2026-10-01", "serie": "wti", "valor_usd": "2.0000", "unidad": "usd_gal"},
        {"fecha": "2026-10-02", "serie": "wti", "valor_usd": "3.0000", "unidad": "usd_gal"},
        {"fecha": "2026-10-02", "serie": "wti", "valor_usd": "126.00", "unidad": "usd_bbl"},
        {"fecha": "2026-10-02", "serie": "ulsd", "valor_usd": "3.1000", "unidad": "usd_gal"},
    ])
    oil = bs.construir(data, AHORA)["petroleo"]
    assert oil["wti"]["mensual"] == [["2026-09-01", 2.0], ["2026-10-01", 2.5]]  # usd_bbl no se mezcla
    assert oil["wti"]["diario"][-1] == ["2026-10-02", 3.0]
    assert oil["ulsd"]["mensual"] == [["2026-10-01", 3.1]]


def test_solo_eventos_con_mostrar_true(data):
    escribir_csv(data / "eventos.csv",
                 ["fecha", "fecha_fin", "tipo", "etiqueta", "mostrar", "fuente", "fuente_url", "nota"], [
                     {"fecha": "2020-01-01", "fecha_fin": "", "tipo": "hito", "etiqueta": "visible",
                      "mostrar": "true", "fuente": "", "fuente_url": "", "nota": ""},
                     {"fecha": "2020-02-01", "fecha_fin": "2020-02-01", "tipo": "promo", "etiqueta": "oculta",
                      "mostrar": "false", "fuente": "x", "fuente_url": "https://x", "nota": ""},
                     {"fecha": "2020-03-01", "fecha_fin": "", "tipo": "hito", "etiqueta": "mayúscula",
                      "mostrar": "True", "fuente": "", "fuente_url": "", "nota": ""},
                 ])
    assert [e["etiqueta"] for e in bs.construir(data, AHORA)["eventos"]] == ["visible", "mayúscula"]


def test_mostrar_invalido_falla(data):
    with open(data / "eventos.csv", "a", encoding="utf-8") as f:
        f.write("2020-01-01,,hito,x,si,,,\n")
    with pytest.raises(ValueError, match="mostrar"):
        bs.construir(data, AHORA)


def test_presidente_en_curso_sin_fin(data):
    presidentes = bs.construir(data, AHORA)["presidentes"]
    assert presidentes[0]["nombre"] == "Fernando Lugo"
    assert presidentes[-1]["fin"] is None


def test_ultimo_dato_no_adelanta_fechas_futuras(data):
    antes = bs.construir(data, AHORA)["ultimo_dato"]["petropar"]
    agregar_precio(data, "2099-01-01,diesel_pora,9300,litro,venta_publico,verificado,a_confirmar,x,,,2098-12-31T15:00:00+00:00")
    datos = bs.construir(data, AHORA)
    assert datos["ultimo_dato"]["petropar"] == antes
    assert datos["precios"]["diesel_pora"][-1]["fecha"] == "2099-01-01"  # la fila igual se publica


# --- tarjetas de "Precios hoy" -------------------------------------------------

def test_tarjetas_muestran_el_ultimo_precio_del_csv_y_el_cambio_contra_el_anterior():
    """Contra el CSV real: precio = última fila; cambio = contra el precio distinto inmediatamente anterior."""
    datos = bs.construir(ahora=AHORA)
    por_producto: dict[str, list[dict]] = {}
    for f in sorted(leer_csv(DATA / "precios_petropar.csv"), key=lambda f: f["fecha_vigencia"]):
        por_producto.setdefault(f["product_id"], []).append(f)
    orden = [p["product_id"] for p in leer_csv(DATA / "productos.csv")]
    assert [t["id"] for t in datos["tarjetas"]] == orden
    for t in datos["tarjetas"]:
        filas = por_producto.get(t["id"], [])
        if not filas:
            assert t["precio"] is None
            continue
        ultima = filas[-1]
        assert (t["precio"], t["fecha"]) == (int(ultima["precio_gs"]), ultima["fecha_vigencia"])
        assert t["por_confirmar"] == ((ultima["estado"], ultima["fecha_estado"]) != ("verificado", "confirmada"))
        distintas = [f for f in filas if f["precio_gs"] != ultima["precio_gs"]]
        if not distintas:
            assert t["cambio"] is None
            continue
        anterior = int(distintas[-1]["precio_gs"])
        assert t["cambio"]["precio_anterior"] == anterior
        assert t["cambio"]["abs"] == t["precio"] - anterior
        assert t["cambio"]["pct"] == round((t["precio"] / anterior - 1) * 100, 1)
        # rige desde el inicio de la racha final de ese precio, no desde la última reconfirmación
        i = len(filas) - 1
        while i > 0 and filas[i - 1]["precio_gs"] == ultima["precio_gs"]:
            i -= 1
        assert t["vigente_desde"] == t["cambio"]["desde"] == filas[i]["fecha_vigencia"]


def serie(*filas, fecha_estado="confirmada"):
    return [{"fecha": f, "precio": p, "estado": "verificado", "fecha_estado": fecha_estado,
             "firme": fecha_estado == "confirmada"} for f, p in filas]


def test_tarjeta_cambio_desde_el_inicio_de_la_racha_y_variacion_anual():
    producto = [{"product_id": "x", "unidad": "litro", "datos_hasta": ""}]
    filas = serie(("2025-06-01", 6000), ("2026-02-01", 7000), ("2026-05-01", 7500), ("2026-08-01", 7500))
    [t] = bs.tarjetas_json(producto, {"x": filas}, datetime(2026, 10, 28).date())
    assert t["precio"] == 7500 and t["fecha"] == "2026-08-01"
    assert t["cambio"] == {"desde": "2026-05-01", "precio_anterior": 7000, "fecha_anterior": "2026-02-01",
                           "tras_hueco": False, "abs": 500, "pct": 7.1}
    assert t["vigente_desde"] == "2026-05-01" and t["fecha_vigencia_confirmada"]
    assert t["anual"] == {"fecha": "2025-10-28", "precio": 6000, "abs": 1500, "pct": 25.0}


def test_tarjeta_no_compara_a_traves_de_un_hueco():
    producto = [{"product_id": "x", "unidad": "litro", "datos_hasta": "2024-12-31"}]
    filas = serie(("2024-11-08", 7730), ("2026-10-29", 7330))
    [t] = bs.tarjetas_json(producto, {"x": filas}, datetime(2026, 10, 28).date())
    assert t["anual"] is None  # hace un año cae en el hueco: no se arrastra 7.730
    assert t["cambio"]["tras_hueco"] and t["cambio"]["abs"] == -400


def test_tarjeta_sin_historia_previa_ni_datos():
    productos = [{"product_id": "a", "unidad": "kg", "datos_hasta": ""},
                 {"product_id": "b", "unidad": "litro", "datos_hasta": ""}]
    a, b = bs.tarjetas_json(productos, {"a": serie(("2026-01-10", 7374))}, datetime(2026, 10, 28).date())
    assert a["cambio"] is None and a["anual"] is None  # empezó hace menos de un año
    assert b == {"id": "b", "precio": None}


def test_sin_variacion_anual_si_la_vigencia_de_hace_un_anio_no_esta_confirmada():
    # caso GLP: única fila con vigencia publicada 2025-05-23 pero a_confirmar
    producto = [{"product_id": "x", "unidad": "kg", "datos_hasta": ""}]
    filas = serie(("2025-05-23", 7374), fecha_estado="a_confirmar")
    [t] = bs.tarjetas_json(producto, {"x": filas}, datetime(2026, 10, 28).date())
    assert t["anual"] is None and t["por_confirmar"] and not t["fecha_vigencia_confirmada"]
