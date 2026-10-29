"""Avisos por issues: qué se avisa según el resumen, un issue por etiqueta, sin repetir. Sin red: gh simulado."""
import json
from datetime import datetime, timedelta, timezone

import etl.avisos as av

RUN = "https://github.com/x/y/actions/runs/1"
FILA = {"product_id": "mbarete", "precio_gs": "9285", "fecha_vigencia": "2026-10-29", "fecha_estado": "confirmada"}
ALERTA = {"regla": "variacion", "producto": "mbarete", "detalle": "+30 %"}


def resumen(**cambios) -> dict:
    base = {"estado": "ok", "captured_at": "2026-10-28T21:00:00+00:00", "cambio": False, "revisar": False,
            "clave_cambio": "", "clave_alertas": "", "alertas": [], "filas_nuevas": []}
    return base | cambios


class GH:
    """Simula `gh` con issues en memoria y registra cada llamada."""

    def __init__(self, issues=None, corridas=None):
        self.issues = issues or []  # dicts: number, label, body, comments, state
        self.corridas = corridas or []
        self.prs_abiertos = []
        self.llamadas = []

    def __call__(self, *args):
        self.llamadas.append(args)
        match args:
            case ("label", "create", *_):
                return ""
            case ("issue", "list", "--label", etiqueta, *_):
                return json.dumps([{"number": i["number"]} for i in self.issues
                                   if i["label"] == etiqueta and i["state"] == "open"][:1])
            case ("issue", "view", n, *_):
                i = self.issue(n)
                return json.dumps({"body": i["body"], "comments": [{"body": c} for c in i["comments"]]})
            case ("issue", "create", "--title", _, "--label", etiqueta, "--body", cuerpo):
                self.issues.append({"number": len(self.issues) + 1, "label": etiqueta, "body": cuerpo,
                                    "comments": [], "state": "open"})
                return ""
            case ("issue", "comment", n, "--body", cuerpo):
                self.issue(n)["comments"].append(cuerpo)
                return ""
            case ("issue", "close", n, *_):
                self.issue(n)["state"] = "closed"
                return ""
            case ("run", "list", *_):
                return json.dumps(self.corridas)
            case ("pr", "list", *_):
                return json.dumps([{"number": n} for n in self.prs_abiertos])
        raise AssertionError(f"llamada inesperada a gh: {args}")

    def issue(self, n):
        return next(i for i in self.issues if str(i["number"]) == str(n))


def escribir(tmp_path, datos) -> str:
    ruta = tmp_path / "resumen.json"
    ruta.write_text(json.dumps(datos))
    return str(ruta)


def test_sin_cambio_ni_alertas_no_avisa():
    assert av.avisos_scraper(resumen(), RUN, None) == []


def test_error_avisa_scraper_roto_con_link_a_la_corrida():
    [aviso] = av.avisos_scraper(resumen(estado="error", tipo_error="estructura", error="falta la tabla",
                                        url="https://www.petropar.gov.py/?page_id=4460"), RUN, None)
    assert aviso.etiqueta == "scraper-roto"
    assert RUN in aviso.cuerpo and "falta la tabla" in aviso.cuerpo


def test_cambio_con_alertas_avisa_precio_nuevo_con_pr_y_revisar():
    avisos = av.avisos_scraper(resumen(cambio=True, revisar=True, clave_cambio="c1", clave_alertas="a1",
                                       filas_nuevas=[FILA], alertas=[ALERTA]), RUN, "https://github.com/x/y/pull/7")
    assert [a.etiqueta for a in avisos] == ["precio-nuevo", "revisar"]
    assert "pull/7" in avisos[0].cuerpo and "9.285" in avisos[0].cuerpo
    assert "`variacion`" in avisos[1].cuerpo


def test_un_issue_por_etiqueta_y_sin_repetir_la_misma_clave():
    gh = GH()
    aviso = av.Aviso("revisar", "Revisar", "cuerpo", "alertas:a1")
    assert av.avisar(aviso, gh) == "creado"
    assert av.avisar(aviso, gh) == "repetido"
    assert av.avisar(av.Aviso("revisar", "Revisar", "otro", "alertas:a2"), gh) == "comentado"
    assert len(gh.issues) == 1 and len(gh.issues[0]["comments"]) == 1


def test_issue_cerrado_no_cuenta_como_abierto():
    gh = GH(issues=[{"number": 1, "label": "revisar", "body": av.marca("alertas:a1"), "comments": [],
                     "state": "closed"}])
    assert av.avisar(av.Aviso("revisar", "Revisar", "cuerpo", "alertas:a1"), gh) == "creado"


def test_corrida_ok_cierra_scraper_roto(tmp_path):
    gh = GH(issues=[{"number": 1, "label": "scraper-roto", "body": "x", "comments": [], "state": "open"}])
    av.main(["scraper", "--resumen", escribir(tmp_path, resumen()), "--run-url", RUN], gh=gh)
    assert gh.issues[0]["state"] == "closed"


def test_corrida_con_error_no_cierra_y_comenta_una_sola_vez(tmp_path):
    gh = GH(issues=[{"number": 1, "label": "scraper-roto", "body": "x", "comments": [], "state": "open"}])
    ruta = escribir(tmp_path, resumen(estado="error", tipo_error="no_responde", error="timeout", url="u"))
    for _ in range(3):
        av.main(["scraper", "--resumen", ruta, "--run-url", RUN], gh=gh)
    assert gh.issues[0]["state"] == "open" and len(gh.issues[0]["comments"]) == 1


def test_sin_resumen_se_trata_como_error_interno(tmp_path):
    r = av.leer_resumen(tmp_path / "no_existe.json")
    assert r["estado"] == "error" and r["tipo_error"] == "interno"


def test_frescura():
    ahora = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
    assert av.frescura_vencida(None, ahora)
    assert not av.frescura_vencida(ahora - timedelta(hours=23), ahora)
    assert av.frescura_vencida(ahora - timedelta(hours=25), ahora)


def test_frescura_vencida_abre_scraper_roto():
    gh = GH(corridas=[{"createdAt": "2020-01-01T00:00:00Z"}])
    av.main(["frescura", "--run-url", RUN], gh=gh)
    assert [i["label"] for i in gh.issues] == ["scraper-roto"]
    assert "2020-01-01" in gh.issues[0]["body"]


def test_frescura_al_dia_no_avisa():
    reciente = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    gh = GH(corridas=[{"createdAt": reciente}])
    av.main(["frescura", "--run-url", RUN], gh=gh)
    assert gh.issues == []


def test_cuerpo_pr_lista_filas_alertas_y_captura():
    cuerpo = av.cuerpo_pr(resumen(cambio=True, filas_nuevas=[FILA], alertas=[ALERTA],
                                  captura="data/capturas/2026-10-28T210000Z"), RUN)
    assert "| mbarete | 9.285 | 2026-10-29 | confirmada |" in cuerpo
    assert "data/capturas/2026-10-28T210000Z" in cuerpo and "`variacion`" in cuerpo and RUN in cuerpo


def test_cambio_con_pr_de_precios_pendiente_lo_dice():
    [aviso] = av.avisos_scraper(resumen(cambio=True, clave_cambio="c2", filas_nuevas=[FILA]), RUN,
                                "https://github.com/x/y/pull/7", pr_pendiente=True)
    assert "sin resolver" in aviso.cuerpo and "pull/7" in aviso.cuerpo


def test_error_con_texto_de_la_pagina_no_rompe_el_bloque_y_se_trunca():
    [aviso] = av.avisos_scraper(resumen(estado="error", tipo_error="estructura",
                                        error="```" + "x" * 5000 + "~~~~"), RUN, None)
    assert aviso.cuerpo.count("~~~~") == 2 and "x" * 2001 not in aviso.cuerpo


def test_sin_cambio_y_sin_prs_pendientes_cierra_precio_nuevo(tmp_path):
    gh = GH(issues=[{"number": 1, "label": "precio-nuevo", "body": "x", "comments": [], "state": "open"}])
    gh.prs_abiertos = [5]
    ruta = escribir(tmp_path, resumen())
    av.main(["scraper", "--resumen", ruta, "--run-url", RUN], gh=gh)
    assert gh.issues[0]["state"] == "open"  # todavía hay un PR de precios abierto
    gh.prs_abiertos = []
    av.main(["scraper", "--resumen", ruta, "--run-url", RUN], gh=gh)
    assert gh.issues[0]["state"] == "closed"


def test_pr_nuevo_tras_quedar_pendiente_se_avisa():
    gh = GH()
    r = resumen(cambio=True, clave_cambio="c3", filas_nuevas=[FILA])
    [pendiente] = av.avisos_scraper(r, RUN, "https://github.com/x/y/pull/7", pr_pendiente=True)
    assert av.avisar(pendiente, gh) == "creado"
    [otra_vez] = av.avisos_scraper(r, RUN, "https://github.com/x/y/pull/7", pr_pendiente=True)
    assert av.avisar(otra_vez, gh) == "repetido"
    [con_pr] = av.avisos_scraper(r, RUN, "https://github.com/x/y/pull/8")
    assert av.avisar(con_pr, gh) == "comentado" and "pull/8" in gh.issues[0]["comments"][-1]


def test_revisar_no_atribuye_el_pr_pendiente_a_este_cambio():
    avisos = av.avisos_scraper(resumen(cambio=True, revisar=True, clave_cambio="c", clave_alertas="a",
                                       filas_nuevas=[FILA], alertas=[ALERTA]),
                               RUN, "https://github.com/x/y/pull/7", pr_pendiente=True)
    assert "PR: " not in avisos[1].cuerpo
