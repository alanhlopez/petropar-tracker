"""Scraper: estructura (falla dura), plausibilidad (alertas "revisar") y detección de cambios."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

import etl.scrape_petropar as sp
from etl.io_csv import COLUMNAS_PRECIOS, escribir_csv, leer_csv

FIX = Path(__file__).parent / "fixtures"
AHORA = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)  # 12:00 en Asunción
SNAPSHOT = {  # lo que dice vigencia_normal.html
    "diesel_pora": (9285, "2026-09-24"), "diesel_mbarete": (11395, "2026-09-24"),
    "nafta_kape88": (6990, "2026-08-17"), "nafta_oikoite93": (7490, "2026-08-17"),
    "nafta_aratiri97": (8990, "2026-09-24"), "glp_kg": (7374, "2025-05-23"),
    "glp_litro": (4240, "2025-05-23"), "nafta_ecoflex85": (7330, "2024-08-13"),
}
NOMBRE_TD = {"diesel_pora": "Diésel Porã", "diesel_mbarete": "Diésel Mbarete",
             "nafta_kape88": "Nafta Kape 88", "nafta_oikoite93": "Nafta Oikoite 93",
             "nafta_aratiri97": "Nafta Aratiri 97", "nafta_ecoflex85": "EcoFlex 85"}


def leer(nombre: str) -> bytes:
    return (FIX / nombre).read_bytes()


def con_fila(html: bytes, pid: str, precio: str | None = None, fecha: str | None = None) -> bytes:
    """Cambia precio y/o vigencia de un producto en vigencia_normal.html."""
    texto = html.decode("utf-8")
    patron = re.compile(rf"<tr><td>{re.escape(NOMBRE_TD[pid])}</td><td>([^<]*)</td><td>([^<]*)</td></tr>")
    m = patron.search(texto)
    assert m, pid
    nueva = f"<tr><td>{NOMBRE_TD[pid]}</td><td>{precio or m[1]}</td><td>{fecha or m[2]}</td></tr>"
    return texto.replace(m[0], nueva).encode("utf-8")


def historia(tmp_path: Path, cambios: dict[str, tuple[int, str]] | None = None) -> Path:
    """Histórico mínimo igual a la foto actual, salvo los productos en `cambios`."""
    filas = []
    for pid, (precio, fecha) in {**SNAPSHOT, **(cambios or {})}.items():
        filas.append({c: "" for c in COLUMNAS_PRECIOS} | {
            "fecha_vigencia": fecha, "product_id": pid, "precio_gs": str(precio),
            "unidad": "kg" if pid == "glp_kg" else "litro", "tipo_precio": "venta_publico",
            "estado": "verificado", "fecha_estado": "confirmada"})
    ruta = tmp_path / "precios.csv"
    escribir_csv(ruta, COLUMNAS_PRECIOS, filas)
    return ruta


def correr(tmp_path, vigencia=None, index=None, cambios=None):
    ruta = historia(tmp_path, cambios)
    resumen = sp.ejecutar(vigencia or leer("vigencia_normal.html"),
                          index or leer("index_normal.html"), AHORA, precios=ruta)
    return resumen, ruta


def reglas(resumen) -> set[tuple[str, str]]:
    return {(a["regla"], a["producto"]) for a in resumen["alertas"]}


# --- parseo y normalización -------------------------------------------------

def test_precios_normales():
    vigentes = sp.parsear_vigencia(sp.decodificar(leer("vigencia_normal.html")))
    assert {pid: (v.precio, v.vigencia.isoformat()) for pid, v in vigentes.items()} == SNAPSHOT
    control = sp.parsear_index(sp.decodificar(leer("index_normal.html")))
    assert {pid: v.precio for pid, v in control.items()} == {k: v[0] for k, v in SNAPSHOT.items()}


@pytest.mark.parametrize("vigencia,index", [
    ("vigencia_encoding_roto.html", "index_normal.html"),
    ("vigencia_normal.html", "index_encoding_roto.html"),
])
def test_encoding_roto(vigencia, index):
    assert sp.parsear_vigencia(sp.decodificar(leer(vigencia)))["diesel_pora"].precio == 9285
    assert sp.parsear_index(sp.decodificar(leer(index)))["diesel_pora"].precio == 9285


def test_mojibake_de_nande_gas():
    """Acá el arreglo es imprescindible: sin él "Ã‘ande" no se reconoce como Ñande Gas."""
    html = (leer("vigencia_normal.html").decode("utf-8")
            .replace("Ñande Gas por Kilogramo", "Ã‘ande Gas por Kilogramo")).encode("utf-8")
    assert sp.parsear_vigencia(sp.decodificar(html))["glp_kg"].precio == 7374


@pytest.mark.parametrize("roto,sano", [
    ("PorÃ£", "Porã"), ("Ã‘ande", "Ñande"), ("DiÃ©sel", "Diésel"),
    ("PorÃƒÂ£", "Porã"),  # doble codificación
    ("Porã", "Porã"),
])
def test_arreglar_mojibake(roto, sano):
    assert sp.arreglar_mojibake(roto) == sano


def test_index_con_bytes_cp1252_se_decodifica():
    # index.html real declara UTF-8 pero trae bytes cp1252 (comillas \x94, "cach\xe9")
    with pytest.raises(UnicodeDecodeError):
        leer("index_normal.html").decode("utf-8")
    assert "glp_kg" in sp.parsear_index(sp.decodificar(leer("index_normal.html")))


@pytest.mark.parametrize("texto,esperado", [
    ("G. 9.285", (9285, "")), ("G. 11.395", (11395, "")),
    ("G. 7.374/KG", (7374, "kg")), ("G. 4.240/litro", (4240, "litro")), ("G.950", (950, "")),
    ("Gs. 9.285", (9285, "")), ("₲ 9.285", (9285, "")), ("gs 7.374/kg", (7374, "kg")),
])
def test_parsear_precio(texto, esperado):
    assert sp.parsear_precio(texto) == esperado


# --- a) estructura: falla dura ------------------------------------------------

@pytest.mark.parametrize("fixture,mensaje", [
    ("vigencia_vacia.html", "No se encontró la tabla"),
    ("vigencia_estructura_distinta.html", "No se encontró la tabla"),
])
def test_estructura_rota_falla(tmp_path, fixture, mensaje):
    with pytest.raises(sp.ErrorEstructura, match=mensaje):
        correr(tmp_path, vigencia=leer(fixture))


def test_tabla_sin_filas_falla(tmp_path):
    html = re.sub(r"<tbody>.*?</tbody>", "<tbody></tbody>",
                  leer("vigencia_normal.html").decode("utf-8"), flags=re.S).encode("utf-8")
    with pytest.raises(sp.ErrorEstructura, match="No hay productos"):
        correr(tmp_path, vigencia=html)


def test_falta_un_producto_falla(tmp_path):
    html = re.sub(r"<tr><td>EcoFlex 85</td>.*?</tr>", "",
                  leer("vigencia_normal.html").decode("utf-8")).encode("utf-8")
    with pytest.raises(sp.ErrorEstructura, match="Faltan productos en página de vigencias.*nafta_ecoflex85"):
        correr(tmp_path, vigencia=html)


def test_falta_un_producto_solo_en_index_falla(tmp_path):
    index = re.sub(rb"<li>[^\n]*EcoFLEX[^\n]*</li>", b"", leer("index_normal.html"))
    with pytest.raises(sp.ErrorEstructura, match="Faltan productos en index.html.*nafta_ecoflex85"):
        correr(tmp_path, index=index)


@pytest.mark.parametrize("nombre", ["Nafta Nueva 100", "Nafta Kape Oikoite"])
def test_producto_desconocido_o_ambiguo_falla(tmp_path, nombre):
    html = leer("vigencia_normal.html").replace("EcoFlex 85".encode(), nombre.encode())
    with pytest.raises(sp.ErrorEstructura, match="Producto desconocido o ambiguo"):
        correr(tmp_path, vigencia=html)


def test_encabezado_cambiado_falla(tmp_path):
    html = leer("vigencia_normal.html").replace(b"<th>Vigencia</th>", b"<th>Desde</th>")
    assert html != leer("vigencia_normal.html")
    with pytest.raises(sp.ErrorEstructura, match="Encabezado"):
        correr(tmp_path, vigencia=html)


def test_fila_con_celdas_de_mas_falla(tmp_path):
    html = leer("vigencia_normal.html").replace(b"<td>24/09/2026</td></tr>", b"<td>24/09/2026</td><td>x</td></tr>", 1)
    with pytest.raises(sp.ErrorEstructura, match="4 celdas"):
        correr(tmp_path, vigencia=html)


def test_producto_repetido_falla(tmp_path):
    fila = b"<tr><td>Nafta Kape 88</td><td>G. 6.990</td><td>17/08/2026</td></tr>"
    html = leer("vigencia_normal.html").replace(fila, fila + fila)
    with pytest.raises(sp.ErrorEstructura, match="repetido en la tabla"):
        correr(tmp_path, vigencia=html)
    index = leer("index_normal.html")
    item = re.search(rb"<li>[^\n]*KAPE[^\n]*</li>", index)[0]
    with pytest.raises(sp.ErrorEstructura, match="repetido en index.html"):
        correr(tmp_path, index=index.replace(item, item + item))


def test_item_de_index_con_forma_inesperada_falla(tmp_path):
    index = leer("index_normal.html").replace(b"NAFTA KAPE 88 - G. 6.990", b"NAFTA KAPE 88: consultar")
    with pytest.raises(sp.ErrorEstructura, match="forma inesperada"):
        correr(tmp_path, index=index)


def test_glp_sin_unidad_falla(tmp_path):
    index = leer("index_normal.html").replace(b"G. 7.374/KG", b"G. 7.374")
    with pytest.raises(sp.ErrorEstructura, match="GLP sin unidad"):
        correr(tmp_path, index=index)


@pytest.mark.parametrize("precio", ["G. 9,285", "consultar", "G. 9.28"])
def test_precio_no_convertible_falla(tmp_path, precio):
    with pytest.raises(sp.ErrorEstructura, match="Precio que no se puede convertir"):
        correr(tmp_path, vigencia=con_fila(leer("vigencia_normal.html"), "diesel_pora", precio=precio))


def test_fecha_no_convertible_falla(tmp_path):
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", fecha="24-09-2026")
    with pytest.raises(sp.ErrorEstructura, match="Fecha de vigencia"):
        correr(tmp_path, vigencia=html)


def test_pagina_no_responde_tras_3_intentos(monkeypatch):
    llamadas, esperas = [], []

    def caida(*a, **k):
        llamadas.append(1)
        raise requests.ConnectionError("sin red")
    monkeypatch.setattr(sp.requests, "get", caida)
    monkeypatch.setattr(sp.time, "sleep", esperas.append)
    with pytest.raises(sp.ErrorRed, match="no responde") as e:
        sp.descargar(sp.URL_VIGENCIA)
    assert len(llamadas) == 3
    assert esperas == [1, 2]  # no espera después del último intento
    assert e.value.url == sp.URL_VIGENCIA and e.value.tipo == "no_responde"


def test_main_con_error_escribe_resumen_completo_y_artefactos(tmp_path):
    resumen, artefactos = tmp_path / "r.json", tmp_path / "artefactos"
    codigo = sp.main(["--vigencia-html", str(FIX / "vigencia_vacia.html"),
                      "--index-html", str(FIX / "index_normal.html"),
                      "--resumen", str(resumen), "--artefactos", str(artefactos)])
    assert codigo == 1
    r = json.loads(resumen.read_text())
    assert (r["estado"], r["tipo_error"], r["cambio"], r["revisar"], r["alertas"]) == \
        ("error", "estructura", False, False, [])
    # el HTML que rompió el parseo queda para adjuntar al issue "scraper-roto"
    assert (artefactos / "vigencia.html").read_bytes() == leer("vigencia_vacia.html")


def test_main_error_inesperado_tambien_deja_resumen(tmp_path, monkeypatch):
    def explota(*a, **k):
        raise KeyError("columna")
    monkeypatch.setattr(sp, "ejecutar", explota)
    resumen = tmp_path / "r.json"
    assert sp.main(["--vigencia-html", str(FIX / "vigencia_normal.html"),
                    "--index-html", str(FIX / "index_normal.html"), "--resumen", str(resumen)]) == 1
    assert json.loads(resumen.read_text())["tipo_error"] == "interno"


# --- detección de cambios -------------------------------------------------------

def test_sin_cambio_no_escribe(tmp_path):
    resumen, ruta = correr(tmp_path)
    antes = ruta.read_bytes()
    assert resumen["cambio"] is False and resumen["filas_nuevas"] == []
    assert resumen["alertas"] == []
    assert ruta.read_bytes() == antes


def test_cambio_usa_vigencia_publicada(tmp_path):
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", fecha="29/10/2026")
    resumen, ruta = correr(tmp_path, vigencia=html, cambios={"diesel_pora": (9000, "2026-09-01")})
    assert resumen["cambio"] and not resumen["revisar"]
    [fila] = resumen["filas_nuevas"]
    assert (fila["product_id"], fila["precio_gs"], fila["fecha_vigencia"]) == ("diesel_pora", "9285", "2026-10-29")
    assert (fila["estado"], fila["fecha_estado"], fila["fuente_url"]) == ("verificado", "confirmada", sp.URL_VIGENCIA)
    assert fila["captured_at"] == "2026-10-28T15:00:00+00:00"
    antes = leer_csv(ruta)
    assert len(antes) == len(SNAPSHOT)  # ejecutar() no escribe


def test_registrar_solo_agrega_y_guarda_captura(tmp_path, monkeypatch):
    monkeypatch.setattr(sp, "CAPTURAS", tmp_path / "capturas")
    resumen, ruta = correr(tmp_path, cambios={"diesel_pora": (9000, "2026-09-01")})
    antes = ruta.read_bytes()
    crudos = {"vigencia.html": leer("vigencia_normal.html"), "index.html": leer("index_normal.html")}
    carpeta = sp.registrar(resumen, crudos, AHORA, precios=ruta)
    assert ruta.read_bytes().startswith(antes)  # las filas existentes quedan byte a byte
    assert leer_csv(ruta)[-1] == resumen["filas_nuevas"][0]
    assert carpeta.name == "2026-10-28T150000Z"
    assert (carpeta / "vigencia.html").read_bytes() == crudos["vigencia.html"]


def test_producto_sin_historia_entra_con_su_vigencia(tmp_path):
    ruta = historia(tmp_path)
    filas = [f for f in leer_csv(ruta) if not f["product_id"].startswith("glp")]
    escribir_csv(ruta, COLUMNAS_PRECIOS, filas)
    resumen = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA, precios=ruta)
    nuevas = {f["product_id"]: (f["fecha_vigencia"], f["fecha_estado"]) for f in resumen["filas_nuevas"]}
    # la vigencia publicada (2025-05-23) está lejos de la captura: se guarda, pero a confirmar
    assert nuevas == {"glp_kg": ("2025-05-23", "a_confirmar"), "glp_litro": ("2025-05-23", "a_confirmar")}
    assert {("vigencia_lejana", "glp_kg"), ("vigencia_lejana", "glp_litro")} <= reglas(resumen)


@pytest.mark.parametrize("publicada,fecha_estado", [
    ("24/10/2026", "a_confirmar"),  # 4 días antes de la captura (28/10)
    ("25/10/2026", "confirmada"),   # 3 días antes
    ("31/10/2026", "confirmada"),   # 3 días después (anuncio anticipado)
    ("01/11/2026", "a_confirmar"),  # 4 días después
])
def test_regla_vigencia_lejana(tmp_path, publicada, fecha_estado):
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", fecha=publicada)
    resumen, _ = correr(tmp_path, vigencia=html, cambios={"diesel_pora": (9000, "2026-09-01")})
    [fila] = resumen["filas_nuevas"]
    assert fila["fecha_estado"] == fecha_estado
    assert (("vigencia_lejana", "diesel_pora") in reglas(resumen)) is (fecha_estado == "a_confirmar")


# --- b) plausibilidad: alertas "revisar" (no bloquean) ----------------------

def test_vigencia_vieja_queda_a_confirmar(tmp_path):
    resumen, _ = correr(tmp_path, cambios={"diesel_pora": (9000, "2026-10-01")})
    [fila] = resumen["filas_nuevas"]
    assert fila["fecha_vigencia"] == "2026-10-29"  # día siguiente a la captura, hora de Asunción
    assert fila["fecha_estado"] == "a_confirmar"
    assert ("vigencia_vieja", "diesel_pora") in reglas(resumen)
    assert resumen["revisar"]
    assert not any(r == "conflicto_historico" for r, _ in reglas(resumen))  # sin filas en esa fecha


def test_conflicto_historico_si_la_vigencia_vieja_contradice_el_historico(tmp_path):
    # caso Ecoflex: la página publica un precio "vigente desde" una fecha en la que el histórico tiene otro
    _, ruta = correr(tmp_path, cambios={"diesel_pora": (9000, "2026-10-01")})
    filas = leer_csv(ruta)
    filas.append(filas[[f["product_id"] for f in filas].index("diesel_pora")] | {
        "fecha_vigencia": "2026-09-01", "precio_gs": "9100"})
    escribir_csv(ruta, COLUMNAS_PRECIOS, filas)
    resumen = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA, precios=ruta)
    assert ("conflicto_historico", "diesel_pora") in reglas(resumen)
    [a] = [a for a in resumen["alertas"] if a["regla"] == "conflicto_historico"]
    assert "9100" in a["detalle"] and "2026-09-01" in a["detalle"]
    [fila] = resumen["filas_nuevas"]
    assert a["detalle"] in fila["nota"]  # la fila lleva el conflicto desde la captura


@pytest.mark.parametrize("ahora,esperado", [
    (datetime(2026, 10, 29, 1, 0, tzinfo=timezone.utc), "2026-10-29"),  # 28/10 22:00 en Asunción
    # Paraguay usa UTC-3 todo el año desde oct-2024. Con una base de zonas vieja (UTC-4 en
    # otoño), 03:30 UTC del 15/04 sería 23:30 del 14/04 y daría 2026-04-15.
    (datetime(2026, 4, 15, 3, 30, tzinfo=timezone.utc), "2026-04-16"),
])
def test_dia_siguiente_en_hora_de_asuncion(tmp_path, ahora, esperado):
    # vigencia publicada (01/01) anterior al último registro (01/02) -> se usa el día siguiente a la captura
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", fecha="01/01/2026")
    ruta = historia(tmp_path, {"diesel_pora": (9000, "2026-02-01")})
    resumen = sp.ejecutar(html, leer("index_normal.html"), ahora, precios=ruta)
    [fila] = resumen["filas_nuevas"]
    assert (fila["fecha_vigencia"], fila["fecha_estado"]) == (esperado, "a_confirmar")


def test_segundo_cambio_no_pisa_fila_a_confirmar(tmp_path):
    # ya hay una fila a_confirmar de mañana (29/10) y Petropar vuelve a cambiar el precio hoy
    ruta = historia(tmp_path, {"diesel_pora": (9000, "2026-10-29")})
    resumen = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA, precios=ruta)
    [fila] = resumen["filas_nuevas"]
    assert (fila["fecha_vigencia"], fila["fecha_estado"]) == ("2026-10-30", "a_confirmar")
    assert ("fecha_ajustada", "diesel_pora") in reglas(resumen)


def test_vigencia_discrepante_sin_cambio_de_precio(tmp_path):
    # caso real 28/10/2026: mismo precio, pero la página publica una vigencia anterior a la nuestra
    resumen, _ = correr(tmp_path, cambios={"diesel_pora": (9285, "2026-10-28")})
    assert not resumen["cambio"] and resumen["revisar"]
    assert ("vigencia_discrepante", "diesel_pora") in reglas(resumen)


def test_vigencia_se_compara_con_el_inicio_del_precio_no_con_filas_repetidas(tmp_path):
    # v0 repite precios sin cambio: Kape 6.990 desde 17/08 también figura en una fila del 28/10
    ruta = historia(tmp_path)
    filas = leer_csv(ruta)
    repetida = next(f for f in filas if f["product_id"] == "nafta_kape88")
    escribir_csv(ruta, COLUMNAS_PRECIOS, filas + [dict(repetida, fecha_vigencia="2026-10-28")])
    resumen = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA, precios=ruta)
    assert resumen["alertas"] == []


def test_vigencia_discrepante_no_se_repite_si_ya_esta_a_confirmar(tmp_path):
    ruta = historia(tmp_path, {"diesel_pora": (9285, "2026-10-28")})
    filas = leer_csv(ruta)
    for f in filas:
        if f["product_id"] == "diesel_pora":
            f["fecha_estado"] = "a_confirmar"
    escribir_csv(ruta, COLUMNAS_PRECIOS, filas)
    resumen = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA, precios=ruta)
    assert resumen["alertas"] == []


@pytest.mark.parametrize("precio,dispara", [
    ("G. 1.995", True), ("G. 2.000", False), ("G. 30.000", False), ("G. 30.005", True),
])
def test_regla_rango(tmp_path, precio, dispara):
    html = con_fila(leer("vigencia_normal.html"), "nafta_kape88", precio=precio)
    assert (("rango", "nafta_kape88") in reglas(correr(tmp_path, vigencia=html)[0])) is dispara


def test_regla_multiplo_de_5(tmp_path):
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", precio="G. 9.287")
    resumen, _ = correr(tmp_path, vigencia=html)
    assert ("multiplo_5", "diesel_pora") in reglas(resumen)
    assert resumen["cambio"]  # no bloquea: el cambio igual se registra
    # el GLP por kg (7.374) no se evalúa con esta regla
    assert ("multiplo_5", "glp_kg") not in reglas(resumen)


@pytest.mark.parametrize("pid,precio,par", [
    ("diesel_pora", "G. 11.500", "diesel_mbarete>diesel_pora"),
    ("nafta_oikoite93", "G. 9.000", "nafta_aratiri97>nafta_oikoite93"),
    ("nafta_kape88", "G. 7.490", "nafta_oikoite93>nafta_kape88"),
])
def test_regla_orden(tmp_path, pid, precio, par):
    html = con_fila(leer("vigencia_normal.html"), pid, precio=precio)
    assert ("orden", par) in reglas(correr(tmp_path, vigencia=html)[0])


@pytest.mark.parametrize("precio,dispara", [
    ("G. 12.500", True),    # +25 % justo: dispara (tiene que ser menor a ±25 %)
    ("G. 12.495", False),   # +24,95 %
    ("G. 7.500", True),     # -25 % justo
    ("G. 7.505", False),    # -24,95 %
])
def test_regla_variacion(tmp_path, precio, dispara):
    # Porã anterior 10.000 (redondo, para probar el borde exacto); Mbarete alto para no disparar "orden"
    html = con_fila(leer("vigencia_normal.html"), "diesel_pora", precio=precio, fecha="28/10/2026")
    html = con_fila(html, "diesel_mbarete", precio="G. 13.000")
    resumen, _ = correr(tmp_path, vigencia=html, cambios={"diesel_pora": (10000, "2026-09-24"),
                                                          "diesel_mbarete": (13000, "2026-09-24")})
    assert (("variacion", "diesel_pora") in reglas(resumen)) is dispara


def test_regla_control_cruzado(tmp_path):
    index = leer("index_normal.html").replace(b"G. 9.285", b"G. 9.300")
    resumen, _ = correr(tmp_path, index=index)
    assert ("control_cruzado", "diesel_pora") in reglas(resumen)
    assert resumen["revisar"] and not resumen["cambio"]


def test_claves_estables_entre_corridas(tmp_path):
    """Dos corridas con el mismo cambio pendiente dan la misma clave (el workflow no duplica el PR)."""
    cambios = {"diesel_pora": (9000, "2026-10-01")}
    r1 = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), AHORA,
                     precios=historia(tmp_path, cambios))
    seis_horas = datetime(2026, 10, 28, 21, 0, tzinfo=timezone.utc)
    r2 = sp.ejecutar(leer("vigencia_normal.html"), leer("index_normal.html"), seis_horas,
                     precios=historia(tmp_path, cambios))
    assert r1["clave_cambio"] and r1["clave_cambio"] == r2["clave_cambio"]
    assert r1["clave_alertas"] == r2["clave_alertas"]


# --- punta a punta ----------------------------------------------------------------

def test_main_sin_escribir_corre_reglas_y_escribe_resumen(tmp_path, monkeypatch):
    ruta = historia(tmp_path, {"diesel_pora": (9000, "2026-09-01")})
    monkeypatch.setattr(sp, "PRECIOS", ruta)
    antes = ruta.read_bytes()
    resumen_json = tmp_path / "r.json"
    assert sp.main(["--vigencia-html", str(FIX / "vigencia_normal.html"),
                    "--index-html", str(FIX / "index_normal.html"),
                    "--resumen", str(resumen_json), "--sin-escribir"]) == 0
    r = json.loads(resumen_json.read_text())
    assert r["cambio"] and "captura" not in r
    assert ruta.read_bytes() == antes

def test_main_con_cambio_guarda_captura_y_resumen(tmp_path, monkeypatch):
    monkeypatch.setattr(sp, "PRECIOS", historia(tmp_path, {"diesel_pora": (9000, "2026-09-01")}))
    monkeypatch.setattr(sp, "CAPTURAS", tmp_path / "capturas")
    resumen_json = tmp_path / "r.json"
    codigo = sp.main(["--vigencia-html", str(FIX / "vigencia_normal.html"),
                      "--index-html", str(FIX / "index_normal.html"), "--resumen", str(resumen_json)])
    assert codigo == 0
    resumen = json.loads(resumen_json.read_text())
    assert resumen["cambio"]
    captura = Path(resumen["captura"])
    assert captura.parent == tmp_path / "capturas"
    assert (captura / "vigencia.html").read_bytes() == leer("vigencia_normal.html")
    assert (captura / "index.html").read_bytes() == leer("index_normal.html")


def test_error_de_estructura_lleva_la_url_de_la_pagina(tmp_path):
    ruta = tmp_path / "resumen.json"
    sp.main(["--vigencia-html", str(FIX / "vigencia_estructura_distinta.html"),
             "--index-html", str(FIX / "index_normal.html"), "--sin-escribir", "--resumen", str(ruta)])
    resumen = json.loads(ruta.read_text())
    assert resumen["tipo_error"] == "estructura" and resumen["url"] == sp.URL_VIGENCIA


@pytest.mark.parametrize("unidad,pid", [
    ("kg", "glp_kg"), ("kgs", "glp_kg"), ("kilo", "glp_kg"), ("kilogramos", "glp_kg"),
    ("l", "glp_litro"), ("lt", "glp_litro"), ("lts", "glp_litro"), ("litros", "glp_litro"),
])
def test_unidades_de_glp(unidad, pid):
    assert sp.identificar("Ñande Gas", unidad) == pid
