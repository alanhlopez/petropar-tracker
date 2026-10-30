"""Avisos de los workflows como issues de GitHub (sin SMTP), vía la CLI `gh`.

Etiquetas (ver SPEC.md, Automatización):
  scraper-roto  el scraper falló o no hubo corrida exitosa en 24 h
  precio-nuevo  hubo cambio de precio, con link al PR
  revisar       se disparó alguna regla de plausibilidad
  deploy-atrasado  el data.json publicado tiene más de 48 h de atraso respecto de main
  ipc-atrasado  data/ipc.csv no tiene el IPC del mes anterior (carga manual: recordatorio por correo)

Un issue abierto por etiqueta: si ya hay uno se comenta en vez de abrir otro.
Cada aviso lleva una marca <!-- clave: ... --> (clave_cambio / clave_alertas del
resumen); si la marca ya figura en el issue no se repite, así una alerta que
persiste no comenta cada 6 h. Cuando el scraper vuelve a andar se cierra el
issue `scraper-roto`.

Subcomandos:
  scraper   procesa resumen_scraper.json después de una corrida de scrape.yml
  frescura  avisa si la última corrida exitosa de scrape.yml tiene más de 24 h y, con
            --sitio-url, si el sitio publicado quedó atrasado respecto de main
  pr        imprime el cuerpo del PR de precios (markdown) a partir del resumen
  etiquetas crea o actualiza las etiquetas (antes de abrir el PR con ellas)
  ipc       desde el día DIA_IPC de cada mes, avisa si data/ipc.csv no tiene el mes anterior; lo cierra al cargarse
"""
import argparse
import json
import subprocess
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ETIQUETAS = {
    "scraper-roto": ("d73a4a", "El scraper falló o no corrió en 24 h"),
    "precio-nuevo": ("0e8a16", "Petropar cambió precios: hay un PR para aprobar"),
    "revisar": ("fbca04", "Se disparó una regla de plausibilidad"),
    "deploy-atrasado": ("5319e7", "El sitio publicado no refleja main: Vercel dejó de desplegar"),
    "ipc-atrasado": ("1d76db", "Falta cargar el IPC del mes anterior (carga manual)"),
}
HORAS_FRESCURA = 24
HORAS_DEPLOY = 48
DATA_JSON = Path(__file__).resolve().parent.parent / "site" / "data.json"
IPC_CSV = Path(__file__).resolve().parent.parent / "data" / "ipc.csv"
# el BCP publica el IPC de un mes en los primeros días hábiles del siguiente: desde el día 10 se espera que esté
DIA_IPC = 10
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
         "noviembre", "diciembre"]


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


def generado(datos: dict) -> datetime:
    return datetime.fromisoformat(datos["generado"])


def aviso_deploy(publicado: dict | None, en_main: dict, url: str, run_url: str,
                 horas: int = HORAS_DEPLOY) -> Aviso | None:
    """None si el sitio publicado está al día (o a menos de `horas` de main)."""
    if publicado is None:
        cuerpo = f"No se pudo leer `{url}/data.json`: el sitio puede estar caído o sin publicar."
        clave = f"deploy:sin-datos:{generado(en_main).isoformat()}"
    else:
        atraso = generado(en_main) - generado(publicado)
        if atraso <= timedelta(hours=horas):
            return None
        cuerpo = (f"El `data.json` publicado en {url} es del {publicado['generado']} y el de main del "
                  f"{en_main['generado']} ({atraso.days} d {atraso.seconds // 3600} h de atraso). "
                  "Vercel dejó de desplegar: ver *Vercel → Deployments* y la sección \"Riesgo: commits "
                  "del bot y plan Hobby\" del README.")
        clave = f"deploy:{publicado['generado']}"
    return Aviso("deploy-atrasado", "Sitio publicado atrasado", f"{cuerpo}\n\n[Chequeo]({run_url})", clave)


def mes_anterior(hoy) -> str:
    return f"{hoy.year - (hoy.month == 1)}-{(hoy.month - 2) % 12 + 1:02d}"


def ultimo_mes_ipc(ruta: Path = IPC_CSV) -> str | None:
    if not ruta.exists():
        return None
    meses = [linea.split(",", 1)[0] for linea in ruta.read_text(encoding="utf-8").splitlines()[1:] if linea.strip()]
    return max(meses) if meses else None


def aviso_ipc(ultimo: str | None, hoy, run_url: str, avisar_a: str = "") -> Aviso | None:
    """None si el IPC está al día (o todavía no es el día DIA_IPC del mes)."""
    esperado = mes_anterior(hoy)
    if hoy.day < DIA_IPC or (ultimo and ultimo >= esperado):
        return None
    nombre = f"{MESES[int(esperado[5:]) - 1]} de {esperado[:4]}"
    menciona = f"@{avisar_a} " if avisar_a else ""
    cuerpo = (f"{menciona}Falta cargar el IPC de **{nombre}**: el último mes en `data/ipc.csv` es "
              f"{ultimo or 'ninguno'}. Mientras tanto, la vista \"Gs constantes\" muestra sin deflactar los meses "
              "posteriores.\n\n"
              "Pasos (ver README, \"IPC: carga manual\"):\n"
              "1. Bajar el \"Anexo Estadístico del Informe Económico\" de https://www.bcp.gov.py y guardarlo en `data/`.\n"
              "2. `python -m etl.importar_ipc data/Anexo_Estadístico_del_Informe_Económico_DD_MM_AAAA.xlsx "
              "--descargado AAAA-MM-DD`\n"
              "3. `python -m etl.build_site_data` y `pytest -q`; commit y push de `data/ipc.csv` y `site/data.json`.\n\n"
              "Este issue se cierra solo cuando `data/ipc.csv` en main tenga ese mes.\n\n"
              f"[Chequeo]({run_url})")
    return Aviso("ipc-atrasado", f"Cargar el IPC de {nombre}", cuerpo, f"ipc:{esperado}")


def leer_publicado(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/data.json", timeout=30) as r:
            return json.load(r)
    except (OSError, ValueError, KeyError):
        return None


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
    f.add_argument("--sitio-url", default="", help="URL del sitio publicado (vacío = no se chequea)")
    r = sub.add_parser("pr")
    r.add_argument("--resumen", type=Path, default=Path("resumen_scraper.json"))
    r.add_argument("--run-url", required=True)
    sub.add_parser("etiquetas")
    i = sub.add_parser("ipc")
    i.add_argument("--run-url", required=True)
    i.add_argument("--avisar-a", default="", help="usuario de GitHub a mencionar (le llega por correo)")
    i.add_argument("--hoy", default="", help="AAAA-MM-DD (para pruebas; por defecto, hoy en UTC)")
    args = p.parse_args(argv)

    if args.comando == "pr":
        print(cuerpo_pr(leer_resumen(args.resumen), args.run_url), end="")
        return 0

    asegurar_etiquetas(gh)
    if args.comando == "etiquetas":
        return 0
    if args.comando == "ipc":
        ultimo = ultimo_mes_ipc(IPC_CSV)
        hoy = datetime.fromisoformat(args.hoy).date() if args.hoy else datetime.now(timezone.utc).date()
        aviso = aviso_ipc(ultimo, hoy, args.run_url, args.avisar_a)
        if aviso:
            print(f"{aviso.etiqueta}: {avisar(aviso, gh)}")
        elif ultimo and ultimo >= mes_anterior(hoy) and \
                cerrar("ipc-atrasado", f"IPC cargado hasta {ultimo}: {args.run_url}", gh):
            print("ipc-atrasado: cerrado")
        return 0
    if args.comando == "scraper":
        resumen = leer_resumen(args.resumen)
        avisos = avisos_scraper(resumen, args.run_url, args.pr_url or None, args.pr_pendiente)
        if resumen["estado"] == "ok" and cerrar("scraper-roto", f"El scraper volvió a andar: {args.run_url}", gh):
            print("scraper-roto: cerrado")
        sin_prs = resumen["estado"] == "ok" and not prs_de_precios_abiertos(gh)
        if (sin_prs and not resumen["cambio"]
                and cerrar("precio-nuevo", f"Sin PRs de precios pendientes: {args.run_url}", gh)):
            print("precio-nuevo: cerrado")
        if (sin_prs and not resumen["revisar"]
                and cerrar("revisar", f"Ninguna regla de plausibilidad disparada: {args.run_url}", gh)):
            print("revisar: cerrado")
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
        if args.sitio_url:
            url = args.sitio_url.rstrip("/")
            aviso = aviso_deploy(leer_publicado(url), json.loads(DATA_JSON.read_text(encoding="utf-8")),
                                 url, args.run_url)
            if aviso:
                avisos.append(aviso)
            elif cerrar("deploy-atrasado", f"El sitio publicado volvió a estar al día: {args.run_url}", gh):
                print("deploy-atrasado: cerrado")
    for aviso in avisos:
        print(f"{aviso.etiqueta}: {avisar(aviso, gh)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
