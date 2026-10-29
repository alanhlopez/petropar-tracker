"""site/rango.js (navegación temporal del gráfico): se prueba con node, que corre la misma lógica que el navegador."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RANGO = Path(__file__).resolve().parent.parent / "site" / "rango.js"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node no está instalado")


def js(expr: str):
    """Evalúa una expresión con R = require('site/rango.js') y devuelve el resultado como JSON."""
    codigo = f"const R = require({json.dumps(str(RANGO))}); console.log(JSON.stringify({expr}));"
    salida = subprocess.run([NODE, "-e", codigo], check=True, capture_output=True, text=True).stdout
    return json.loads(salida)


FILAS = json.dumps([{"fecha": "2024-01-10", "precio": 6000}, {"fecha": "2025-03-01", "precio": 6500},
                    {"fecha": "2025-06-15", "precio": 7000}, {"fecha": "2026-08-17", "precio": 9000}])


def test_variacion_usa_el_precio_vigente_al_inicio_del_rango():
    # el rango empieza el 2025-05-01: el vigente es 6.500 (desde 2025-03-01), no el primer cambio dentro (7.000)
    v = js(f"R.variacion({FILAS}, '2025-05-01', '2026-10-29', [])")
    assert v["inicio"]["precio"] == 6500 and v["fin"]["precio"] == 9000
    assert v["abs"] == 2500 and v["pct"] == 38.5


def test_variacion_sin_cambios_en_el_rango_es_cero():
    v = js(f"R.variacion({FILAS}, '2025-07-01', '2026-01-01', [])")
    assert v["abs"] == 0 and v["pct"] == 0


def test_sin_variacion_antes_del_primer_dato_o_a_traves_de_un_hueco():
    # antes del primer dato (a más de 31 días): variación desde el primer dato, marcada con su fecha
    assert js(f"R.variacion({FILAS}, '2023-01-01', '2026-10-29', [])")["desde"] == "2024-01-10"
    hueco = json.dumps([{"desde": "2025-08-01", "hasta": "2026-08-17"}])
    assert js(f"R.variacion({FILAS}, '2025-07-01', '2026-10-29', {hueco})") is None
    # el inicio cae dentro del hueco: no se arrastra el precio anterior
    assert js(f"R.vigenteEn({FILAS}, '2025-12-01', {hueco})") is None


def test_presets_terminan_en_el_ultimo_dato():
    r = js("['1m','6m','ytd','1a','5a','10a','todo'].map(k => { const x = R.preset(k, '2009-01-02', '2026-10-29');"
           " return [R.iso(x.desde), R.iso(x.hasta)]; })")
    assert r == [["2026-09-29", "2026-10-29"], ["2026-04-29", "2026-10-29"], ["2026-01-01", "2026-10-29"],
                 ["2025-10-29", "2026-10-29"], ["2021-10-29", "2026-10-29"], ["2016-10-29", "2026-10-29"],
                 ["2009-01-02", "2026-10-29"]]


def test_limites_y_zoom_minimo_de_un_mes():
    # más chico que un mes: crece alrededor del centro
    r = js("(x => [R.iso(x.desde), R.iso(x.hasta)])(R.limitar('2026-03-10', '2026-03-12', '2009-01-02', '2026-10-29'))")
    assert r == ["2026-02-24", "2026-03-26"]
    # fuera de los datos: se corre hacia adentro sin cambiar el ancho
    r = js("(x => [R.iso(x.desde), R.iso(x.hasta)])(R.limitar('2026-09-01', '2027-03-01', '2009-01-02', '2026-10-29'))")
    assert r == ["2026-05-01", "2026-10-29"]   # 181 días, pegado al último dato


def test_preset_activo_y_rango_personalizado():
    assert js("R.presetDe('2026-01-01', '2026-10-29', '2009-01-02', '2026-10-29')") == "ytd"
    assert js("R.presetDe('2023-10-29', '2026-10-29', '2009-01-02', '2026-10-29')") is None   # 3 años: personalizado


def test_petroleo_diario_hasta_2_anios_y_nivel_del_eje():
    assert js("R.petroleoDiario('2024-10-29', '2026-10-29')") is True
    assert js("R.petroleoDiario('2021-10-29', '2026-10-29')") is False
    assert js("[R.nivelEje('2009-01-02','2026-10-29'), R.nivelEje('2025-10-29','2026-10-29'), R.nivelEje('2026-09-29','2026-10-29')]") \
        == ["anios", "meses", "dias"]


def test_primer_dato_dentro_de_los_31_dias_cuenta_como_inicio():
    # caso Kape 88: "Todo" empieza el 02/01/2009 y su primer dato es del 09/01/2009
    filas = json.dumps([{"fecha": "2009-01-09", "precio": 3650}, {"fecha": "2026-08-17", "precio": 6990}])
    v = js(f"R.variacion({filas}, '2009-01-02', '2026-10-29', [])")
    assert v["inicio"]["precio"] == 3650 and v["pct"] == 91.5 and v["desde"] is None


def test_producto_que_empieza_despues_del_rango_va_desde_su_primer_dato():
    # caso Diésel Mbarete: empieza en 2011, el rango "Todo" en 2009
    filas = json.dumps([{"fecha": "2011-03-15", "precio": 5000}, {"fecha": "2026-10-28", "precio": 11395}])
    v = js(f"R.variacion({filas}, '2009-01-02', '2026-10-29', [])")
    assert v["inicio"]["precio"] == 5000 and v["pct"] == 127.9 and v["desde"] == "2011-03-15"


def test_unico_dato_al_final_no_tiene_variacion():
    filas = json.dumps([{"fecha": "2026-10-20", "precio": 7330}])
    assert js(f"R.variacion({filas}, '2025-10-29', '2026-10-29', [])") is None
