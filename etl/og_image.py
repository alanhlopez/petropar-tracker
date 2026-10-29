"""Imagen para compartir (og:image, 1200×630): captura del gráfico con Chrome headless.

Sirve site/ por HTTP en un puerto local, abre index.html?og=1&tema=claro (modo imagen: solo título y
gráfico) y guarda site/og.png. Necesita Chrome o Chromium (los runners de GitHub ya lo traen) y red para
cargar D3 desde jsdelivr. Uso: python -m etl.og_image [--salida site/og.png]
"""
import argparse
import functools
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
CANDIDATOS = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def buscar_chrome() -> str:
    for c in (os.environ.get("CHROME"), *CANDIDATOS):
        if c and (shutil.which(c) or Path(c).exists()):
            return shutil.which(c) or c
    raise SystemExit("No encontré Chrome/Chromium (definí CHROME con la ruta).")


class Silencioso(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def generar(salida: Path) -> None:
    """Genera en un temporal y solo reemplaza `salida` si el gráfico se dibujó: si D3 o los datos no
    cargan, Chrome igual saca una captura (vacía) y no hay que commitearla."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html?og=1&tema=claro"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            base = [buscar_chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--no-first-run", "--no-default-browser-check", "--force-device-scale-factor=1",
                    "--window-size=1200,630", "--virtual-time-budget=8000"]
            dom = subprocess.run([*base, f"--user-data-dir={tmp}/p1", "--dump-dom", url],
                                 check=True, capture_output=True, text=True, timeout=90).stdout
            if 'id="chart-liq"><svg' not in dom or "og-fuente" not in dom:
                raise SystemExit("El gráfico no se dibujó (¿falló D3 o data.json?): no se toca og.png.")
            png = Path(tmp) / "og.png"
            subprocess.run([*base, f"--user-data-dir={tmp}/p2", f"--screenshot={png}", url],
                           check=True, capture_output=True, timeout=90)
            if not png.exists() or png.stat().st_size < 10_000:
                raise SystemExit("La captura no se generó bien: no se toca og.png.")
            shutil.move(png, salida)
    finally:
        srv.shutdown()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--salida", type=Path, default=SITE / "og.png")
    generar(ap.parse_args().salida)


if __name__ == "__main__":
    main()
