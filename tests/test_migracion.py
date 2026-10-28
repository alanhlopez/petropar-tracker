"""La migración de v0 no pierde nada: desde el formato largo se reconstruye el original exacto."""
import hashlib

import pytest

from etl.io_csv import DATA, ESTADOS, FECHA_ESTADOS, leer_csv
from etl.migrate_wide_to_long import ORIGEN, migrar, parsear_estado, parsear_fuente

SHA256_ORIGINAL = "ea118e66fd8a381e5c600840a8d2c131d72b2f55f536329b1e38bfe3a9ad66ce"


@pytest.fixture(scope="module")
def productos():
    return {p["product_id"]: p for p in leer_csv(DATA / "productos.csv")}


@pytest.fixture(scope="module")
def originales():
    return leer_csv(ORIGEN)


@pytest.fixture(scope="module")
def largas(originales, productos):
    return migrar(originales, productos)


def test_original_congelado():
    assert hashlib.sha256(ORIGEN.read_bytes()).hexdigest() == SHA256_ORIGINAL


def reconstruir(fila: dict, nota_en: str) -> tuple[str, str]:
    """Devuelve (estado, fuente) originales, con la nota en la columna `nota_en`."""
    estado, fuente = fila["estado"], fila["fuente"]
    if fila["nota"] and nota_en == "estado":
        estado += f" ({fila['nota']})"
    if fila["nota"] and nota_en == "fuente":
        fuente += f" ({fila['nota']})"
    if fila["nota"] and nota_en == "fuente_invertida":
        fuente = f"{fila['nota']} ({fuente})"
    if fila["fecha_estado"] == "a_confirmar":
        estado += " - fecha a confirmar"
    return estado, fuente


def test_reconstruye_original_exacto(originales, largas):
    columnas_producto = [c for c in originales[0] if c not in {"fecha", "estado", "fuente"}]
    por_fecha: dict[str, list[dict]] = {}
    for f in largas:
        por_fecha.setdefault(f["fecha_vigencia"], []).append(f)

    assert list(por_fecha) == [o["fecha"] for o in originales]
    for o in originales:
        filas = por_fecha[o["fecha"]]
        reconstruida = {c: "" for c in columnas_producto}
        reconstruida.update({f["product_id"]: f["precio_gs"] for f in filas})
        assert {c: o[c] for c in columnas_producto} == reconstruida, o["fecha"]
        for f in filas:
            candidatas = {reconstruir(f, lugar)
                          for lugar in ("estado", "fuente", "fuente_invertida")}
            assert (o["estado"], o["fuente"]) in candidatas, (o["fecha"], f["product_id"])


def test_valores_validos(largas):
    assert {f["estado"] for f in largas} <= ESTADOS
    assert {f["fecha_estado"] for f in largas} <= FECHA_ESTADOS
    claves = [(f["fecha_vigencia"], f["product_id"]) for f in largas]
    assert len(claves) == len(set(claves))


@pytest.mark.parametrize("texto,esperado", [
    ("verificado", ("verificado", "confirmada", "")),
    ("verificado (Aratiri/Oikoite: UH 26-08-2016)",
     ("verificado", "confirmada", "Aratiri/Oikoite: UH 26-08-2016")),
    ("planilla - fecha a confirmar", ("planilla", "a_confirmar", "")),
    ("derivado - fecha a confirmar", ("derivado", "a_confirmar", "")),
])
def test_parsear_estado(texto, esperado):
    assert parsear_estado(texto) == esperado


def test_estado_desconocido_falla():
    with pytest.raises(ValueError, match="no reconocido"):
        parsear_estado("dudoso")


@pytest.mark.parametrize("texto,esperado", [
    ("La Nacion 09-05-2017", ("La Nacion 09-05-2017", "")),
    ("ABC 12-04-2022 (rige 13/04)", ("ABC 12-04-2022", "rige 13/04")),
    ("La Nacion 24-03-2026 (Aratiri 7940 en nota = typo)",
     ("La Nacion 24-03-2026", "Aratiri 7940 en nota = typo")),
    ("fin de baja temporal (ABC 29-03-2023 / UH 18-05-2023)",
     ("ABC 29-03-2023 / UH 18-05-2023", "fin de baja temporal")),
    ("Extra / 1000 Noticias (encadenado)", ("Extra / 1000 Noticias", "encadenado")),
])
def test_parsear_fuente(texto, esperado):
    assert parsear_fuente(texto) == esperado


def test_fuente_con_parentesis_en_el_medio_falla():
    with pytest.raises(ValueError, match="paréntesis"):
        parsear_fuente("ABC (x) 12-04-2022")


@pytest.mark.parametrize("precio", ["0", "²", "9.285", "-100"])
def test_precio_invalido_falla(productos, precio):
    fila = {"fecha": "2020-01-01", "diesel_pora": precio, "estado": "verificado", "fuente": "x"}
    with pytest.raises(ValueError, match="entero positivo"):
        migrar([fila], productos)


def test_fechas_desordenadas_fallan(productos):
    base = {"diesel_pora": "5000", "estado": "verificado", "fuente": "x"}
    with pytest.raises(ValueError, match="fuera de orden"):
        migrar([{**base, "fecha": "2020-02-01"}, {**base, "fecha": "2020-01-01"}], productos)
