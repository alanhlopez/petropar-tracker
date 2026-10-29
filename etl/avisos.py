"""Avisos de los workflows como issues de GitHub (sin SMTP), vía la CLI `gh`.

Etiquetas (ver SPEC.md, Automatización):
  scraper-roto  el scraper falló o no hubo corrida exitosa en 24 h
  precio-nuevo  hubo cambio de precio, con link al PR
  revisar       se disparó alguna regla de plausibilidad

Un issue abierto por etiqueta: si ya hay uno se comenta en vez de abrir otro.
Cada aviso lleva una marca <!-- clave: ... --> (clave_cambio / clave_alertas del
resumen); si la marca ya figura en el issue no se repite, así una alerta que
persiste no comenta cada 6 h. Cuando el scraper vuelve a andar se cierra el
issue `scraper-roto`.

Subcomandos:
  scraper   procesa resumen_scraper.json después de una corrida de scrape.yml
  frescura  avisa si la última corrida exitosa de scrape.yml tiene más de 24 h
  pr        imprime el cuerpo del PR de precios (markdown) a partir del resumen
  etiquetas crea o actualiza las etiquetas (antes de abrir el PR con ellas)
"""
import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ETIQUETAS = {
    "scraper-roto": ("d73a4a", "El scraper falló o no corrió en 24 h"),
    "precio-nuevo": ("0e8a16", "Petropar cambió precios: hay un PR para aprobar"),
    "revisar": ("fbca04", "Se disparó una regla de plausibilidad"),
}
HORAS_FRESCURA = 24


@dataclass
class Aviso:
    etiqueta: str
    titulo: str
    cuerpo: str
    clave: str


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def marca(clave: str) -> str:
    return f"<!-- clave: {clave} -->"


# --- contenido (puro, testeable) ---------------------------------------------

def tabla_filas(filas: list[dict]) -> str:
    if not filas:
        return ""
    lineas = ["| Producto | Precio (Gs) | Vigencia | fecha_estado |", "|---|---:|---|---|"]
    for f in filas:
        precio = f"{int(f['precio_gs']):,}".replace(",", ".")
        lineas.append(f"| {f['product_id']} | {precio} | {f['fecha_vigencia']} | {f['fecha_estado']} |")
    return "\n".join(lineas)


def lista_alertas(alertas: list[dict]) -> str:
    return "\n".join(f"- `{a['regla']}` {a['producto']}: {a['detalle']}" for a in alertas)


def cuerpo_pr(resumen: dict, run_url: str) -> str:
    partes = [
        "Cambio de precios detectado por el scraper. **Revisar antes de aprobar**: "
        "comparar con la página de Petropar y con la captura en `" + resumen.get("captura", "data/capturas/") + "`.",
        "",
        tabla_filas(resumen["filas_nuevas"]),
        "",
        f"Fuente: {resumen.get('url') or 'https://www.petropar.gov.py/?page_id=4460'} · "
        f"captura {resumen['captured_at']} · [corrida]({run_url})",
    ]
    if resumen["alertas"]:
        partes += ["", "### Alertas de plausibilidad (etiqueta `revisar`)", "", lista_alertas(resumen["alertas"])]
    return "\n".join(partes) + "\n"


def avisos_scraper(resumen: dict, run_url: str, pr_url: str | None, pr_pendiente: bool = False) -> list[Aviso]:
    if resumen["estado"] == "error":
        tipo = resumen.get("tipo_error", "interno")
        # ~~~~ en vez de ``` y truncado: el error puede traer texto de la página
        error = str(resumen.get("error", ""))[:2000].replace("~~~~", "~ ~ ~ ~")
        cuerpo = (f"El scraper falló (`{tipo}`).\n\n~~~~\n{error}\n~~~~\n\n"
                  f"URL: {resumen.get('url') or '—'}\n\n"
                  f"[Corrida con el HTML capturado como artifact]({run_url})")
        return [Aviso("scraper-roto", "Scraper roto", cuerpo, f"error:{tipo}:{resumen.get('url')}")]

    avisos = []
    if resumen["cambio"]:
        if pr_pendiente:
            pr = (f"Hay un PR de precios sin resolver ({pr_url}): este cambio se propone en un PR nuevo "
                  "cuando ese se mergee o se cierre.")
        else:
            pr = f"PR: {pr_url}" if pr_url else "No se pudo abrir el PR: ver la corrida."
        cuerpo = f"Petropar cambió precios.\n\n{tabla_filas(resumen['filas_nuevas'])}\n\n{pr}\n\n[Corrida]({run_url})"
        # la clave incluye el estado del PR: pasar de "pendiente" a "PR abierto" tiene que avisarse
        estado_pr = "pendiente" if pr_pendiente else (pr_url or "sin-pr")
        avisos.append(Aviso("precio-nuevo", "Precio nuevo de Petropar", cuerpo,
                            f"cambio:{resumen['clave_cambio']}:{estado_pr}"))
    if resumen["revisar"]:
        cuerpo = (f"Reglas de plausibilidad disparadas:\n\n{lista_alertas(resumen['alertas'])}\n\n"
                  + (f"PR: {pr_url}\n\n" if pr_url and not pr_pendiente else "") + f"[Corrida]({run_url})")
        avisos.append(Aviso("revisar", "Revisar precios de Petropar", cuerpo,
                            f"alertas:{resumen['clave_alertas']}"))
    return avisos


def frescura_vencida(ultima: datetime | None, ahora: datetime, horas: int = HORAS_FRESCURA) -> bool:
    return ultima is None or ahora - ultima > timedelta(hours=horas)


def leer_resumen(ruta: Path) -> dict:
    """Si el scraper murió sin dejar resumen, se trata como error interno."""
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {"estado": "error", "tipo_error": "interno", "error": f"sin resumen legible: {e}",
                "url": None, "cambio": False, "revisar": False, "alertas": [], "filas_nuevas": []}


# --- GitHub --------------------------------------------------------------------

def asegurar_etiquetas(gh=gh) -> None:
    for nombre, (color, descripcion) in ETIQUETAS.items():
        gh("label", "create", nombre, "--color", color, "--description", descripcion, "--force")


def issue_abierto(etiqueta: str, gh=gh) -> int | None:
    issues = json.loads(gh("issue", "list", "--label", etiqueta, "--state", "open",
                           "--json", "number", "--limit", "1"))
    return issues[0]["number"] if issues else None


def avisar(aviso: Aviso, gh=gh) -> str:
    """Abre o comenta el issue de la etiqueta. Devuelve: creado | comentado | repetido."""
    texto = f"{aviso.cuerpo}\n\n{marca(aviso.clave)}"
    numero = issue_abierto(aviso.etiqueta, gh)
    if numero is None:
        gh("issue", "create", "--title", aviso.titulo, "--label", aviso.etiqueta, "--body", texto)
        return "creado"
    issue = json.loads(gh("issue", "view", str(numero), "--json", "body,comments"))
    if any(marca(aviso.clave) in t for t in [issue["body"], *(c["body"] for c in issue["comments"])]):
        return "repetido"
    gh("issue", "comment", str(numero), "--body", texto)
    return "comentado"


def cerrar(etiqueta: str, comentario: str, gh=gh) -> bool:
    numero = issue_abierto(etiqueta, gh)
    if numero is None:
        return False
    gh("issue", "close", str(numero), "--comment", comentario)
    return True


def prs_de_precios_abiertos(gh=gh) -> bool:
    return bool(json.loads(gh("pr", "list", "--label", "precio-nuevo", "--state", "open",
                              "--json", "number", "--limit", "1")))


def ultima_corrida_exitosa(workflow: str, gh=gh) -> datetime | None:
    corridas = json.loads(gh("run", "list", "--workflow", workflow, "--status", "success",
                             "--limit", "1", "--json", "createdAt"))
    if not corridas:
        return None
    return datetime.fromisoformat(corridas[0]["createdAt"].replace("Z", "+00:00"))


# --- CLI -------------------------------------------------------------------------

def main(argv: list[str] | None = None, gh=gh) -> int:
    p = argparse.ArgumentParser(description="Avisos del scraper como issues de GitHub")
    sub = p.add_subparsers(dest="comando", required=True)
    s = sub.add_parser("scraper")
    s.add_argument("--resumen", type=Path, default=Path("resumen_scraper.json"))
    s.add_argument("--run-url", required=True)
    s.add_argument("--pr-url", default="")
    s.add_argument("--pr-pendiente", action="store_true",
                   help="el cambio no abrió PR porque hay otro de precios sin resolver")
    f = sub.add_parser("frescura")
    f.add_argument("--workflow", default="scrape.yml")
    f.add_argument("--run-url", required=True)
    r = sub.add_parser("pr")
    r.add_argument("--resumen", type=Path, default=Path("resumen_scraper.json"))
    r.add_argument("--run-url", required=True)
    sub.add_parser("etiquetas")
    args = p.parse_args(argv)

    if args.comando == "pr":
        print(cuerpo_pr(leer_resumen(args.resumen), args.run_url), end="")
        return 0

    asegurar_etiquetas(gh)
    if args.comando == "etiquetas":
        return 0
    if args.comando == "scraper":
        resumen = leer_resumen(args.resumen)
        avisos = avisos_scraper(resumen, args.run_url, args.pr_url or None, args.pr_pendiente)
        if resumen["estado"] == "ok" and cerrar("scraper-roto", f"El scraper volvió a andar: {args.run_url}", gh):
            print("scraper-roto: cerrado")
        if (resumen["estado"] == "ok" and not resumen["cambio"] and not prs_de_precios_abiertos(gh)
                and cerrar("precio-nuevo", f"Sin PRs de precios pendientes: {args.run_url}", gh)):
            print("precio-nuevo: cerrado")
    else:
        ultima = ultima_corrida_exitosa(args.workflow, gh)
        ahora = datetime.now(timezone.utc)
        avisos = []
        if frescura_vencida(ultima, ahora):
            desde = ultima.isoformat(timespec="minutes") if ultima else "nunca"
            avisos.append(Aviso("scraper-roto", "Scraper roto",
                                f"No hubo una corrida exitosa de `{args.workflow}` en {HORAS_FRESCURA} h "
                                f"(última: {desde}).\n\n[Chequeo]({args.run_url})",
                                f"frescura:{desde}"))
    for aviso in avisos:
        print(f"{aviso.etiqueta}: {avisar(aviso, gh)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
