"""Importador del IPC del BCP: lee el Cuadro 15 de un xlsx (armado acá, mínimo) y valida formato."""
import zipfile

import pytest

import etl.importar_ipc as imp

WB = ('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      '<sheet name="CUADRO 15" sheetId="1" r:id="rId1"/></sheets></workbook>')
RELS = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>')


def xlsx(tmp_path, filas, titulo="Índice de precios al consumidor - Área Metropolitana de Asunción.", base="Base Diciembre 2017 = 100."):
    textos = [titulo, base, "Año", "Índice general"]
    celdas = [("A8", "s", 0), ("A10", "s", 1), ("A12", "s", 2), ("V12", "s", 3)]
    for i, (serial, valor) in enumerate(filas, start=15):
        celdas += [(f"A{i}", None, serial), (f"V{i}", None, valor)]
    hoja = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>' + "".join(
        '<c r="%s"%s><v>%s</v></c>' % (r, ' t="s"' if t else "", v) for r, t, v in celdas) + "</row></sheetData></worksheet>"
    ss = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + "".join(f"<si><t>{t}</t></si>" for t in textos) + "</sst>"
    ruta = tmp_path / "anexo.xlsx"
    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("xl/workbook.xml", WB); z.writestr("xl/_rels/workbook.xml.rels", RELS)
        z.writestr("xl/worksheets/sheet1.xml", hoja); z.writestr("xl/sharedStrings.xml", ss)
    return ruta


# 39814 = 2009-01-01, 39845 = 2009-02-01, 39873 = 2009-03-01 (fechas seriales de Excel)
def test_lee_indice_general_desde_2009(tmp_path):
    ruta = xlsx(tmp_path, [(39783, "68.9"), (39814, "69.3745970342"), (39845, "69.18"), (39873, "154.19999999999999")])
    serie = imp.extraer(imp.leer_hoja(ruta, "CUADRO 15"))
    assert serie == [("2009-01", 69.3745970342), ("2009-02", 69.18), ("2009-03", 154.2)]   # dic-2008 queda afuera
    assert imp.numero(154.19999999999999) == "154.2"


def test_mes_faltante_falla(tmp_path):
    ruta = xlsx(tmp_path, [(39814, "69.3"), (39873, "69.5")])
    with pytest.raises(imp.ErrorIPC, match="falta un mes"):
        imp.extraer(imp.leer_hoja(ruta, "CUADRO 15"))


def test_otra_base_falla(tmp_path):
    ruta = xlsx(tmp_path, [(39814, "69.3")], base="Base 2007 = 100.")
    with pytest.raises(imp.ErrorIPC, match="base"):
        imp.extraer(imp.leer_hoja(ruta, "CUADRO 15"))
