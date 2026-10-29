"""Emblemas privados para site/data.json: "últimos cambios reportados" (v2, ver SPEC.md).

Ningún emblema publica precios en un canal propio: los precios salen de notas de prensa cargadas a mano
en data/precios_privados.csv (solo agregar; nunca precios calculados a partir de montos de suba).
Por cada emblema y categoría se publica el último precio reportado, con su fecha de vigencia y su fuente.
"""
from datetime import date
from pathlib import Path

from etl.io_csv import ESTADOS, FECHA_ESTADOS, leer_csv

CATEGORIAS = ["Diésel común", "Diésel premium", "Nafta 88–90", "Nafta 93–95", "Nafta 97+"]
# a partir de cuántos días el precio se muestra atenuado y con aviso
DIAS_VIEJO = 7
# más viejo que esto no se publica como "último reportado" (queda en el historial): puede haber cambios
# posteriores en notas sin categoría asignable (p. ej. Shell Evolux), igual que la regla de 6 meses de Petropar
DIAS_MAX = 183


def _fecha(valor: str, donde: str) -> str:
    try:
        return date.fromisoformat(valor).isoformat()
    except ValueError:
        raise ValueError(f"{donde}: fecha inválida {valor!r}") from None


def _orden_cat(categoria: str) -> int:
    return CATEGORIAS.index(categoria) if categoria in CATEGORIAS else len(CATEGORIAS)


def _validar(filas: list[dict], emblemas: set[str], equivalencias: dict[tuple[str, str], str]) -> None:
    vistos = set()
    for i, f in enumerate(filas, start=2):
        donde = f"precios_privados.csv línea {i}"
        _fecha(f["fecha_vigencia"], donde)
        if f["emblema"] not in emblemas:
            raise ValueError(f"{donde}: emblema desconocido {f['emblema']!r} (ver emblemas.csv)")
        # categoría vacía: la nota no permite asignarla sin inferir por precio; queda en el historial, no en la tabla
        if f["categoria"] and f["categoria"] not in CATEGORIAS:
            raise ValueError(f"{donde}: categoría {f['categoria']!r} no es una de {CATEGORIAS}")
        esperada = equivalencias.get((f["emblema"], f["producto_comercial"]))
        if esperada and f["categoria"] and esperada != f["categoria"]:
            raise ValueError(f"{donde}: {f['producto_comercial']} es {esperada!r} según equivalencias.csv")
        if not f["precio_gs"].isdigit() or int(f["precio_gs"]) <= 0:
            raise ValueError(f"{donde}: precio inválido {f['precio_gs']!r}")
        if f["estado"] not in ESTADOS or f["fecha_estado"] not in FECHA_ESTADOS:
            raise ValueError(f"{donde}: estado {f['estado']!r} / fecha_estado {f['fecha_estado']!r} inválidos")
        if not f["fuente"] or not f["fuente_url"].startswith("http"):
            raise ValueError(f"{donde}: todo precio privado necesita fuente y URL")
        # dos notas pueden dar valores distintos para el mismo día: se cargan las dos, cada una con su fuente
        clave = (f["fecha_vigencia"], f["emblema"], f["producto_comercial"], f["fuente"])
        if clave in vistos:
            raise ValueError(f"{donde}: precio repetido para {clave}")
        vistos.add(clave)


def privados_json(data: Path, hoy: date) -> dict:
    ruta = data / "precios_privados.csv"
    emblemas = leer_csv(data / "emblemas.csv") if (data / "emblemas.csv").exists() else []
    filas = leer_csv(ruta) if ruta.exists() else []
    equivalencias = {(e["emblema"], e["producto_comercial"]): e["categoria"]
                     for e in (leer_csv(data / "equivalencias.csv") if (data / "equivalencias.csv").exists() else [])}
    _validar(filas, {e["emblema"] for e in emblemas}, equivalencias)

    historial = [{
        "fecha": f["fecha_vigencia"], "emblema": f["emblema"], "producto": f["producto_comercial"],
        "categoria": f["categoria"], "precio": int(f["precio_gs"]), "estado": f["estado"],
        "fecha_estado": f["fecha_estado"], "firme": (f["estado"], f["fecha_estado"]) == ("verificado", "confirmada"),
        "fuente": f["fuente"], "url": f["fuente_url"], "nota": f["nota"],
    } for f in sorted(filas, key=lambda f: (f["fecha_vigencia"], f["emblema"], _orden_cat(f["categoria"])))]

    # último precio reportado por emblema y categoría (filas con fecha futura incluidas: "rige desde")
    ultimos: dict[tuple[str, str], dict] = {}
    for h in historial:
        if not h["categoria"]:
            continue
        previo = ultimos.get((h["emblema"], h["categoria"]))
        if previo and previo["precio"] == h["precio"]:
            continue   # otra nota con el mismo precio: se mantiene la primera fecha en que se reportó (inicio de la racha)
        if previo and previo["fecha"] == h["fecha"] and previo["precio"] != h["precio"]:
            # mismo día, dos valores: no se elige; se publica como no firme con los dos valores en la nota
            h = {**h, "firme": False, "nota": f"Fuentes con valores distintos: {previo['precio']} ({previo['fuente']}) y {h['precio']} ({h['fuente']})"}
        ultimos[(h["emblema"], h["categoria"])] = h
    salida_ultimos = []
    for (emblema, categoria), h in ultimos.items():
        dias = (hoy - date.fromisoformat(h["fecha"])).days
        if dias > DIAS_MAX:
            continue
        salida_ultimos.append({**h, "dias": dias, "viejo": dias > DIAS_VIEJO})
    orden = {e["emblema"]: i for i, e in enumerate(emblemas)}
    salida_ultimos.sort(key=lambda u: (orden[u["emblema"]], _orden_cat(u["categoria"])))
    return {
        "categorias": CATEGORIAS,
        "dias_viejo": DIAS_VIEJO,
        "dias_max": DIAS_MAX,
        "emblemas": [{"id": e["emblema"], "nombre": e["nombre"]} for e in emblemas],
        "ultimos": salida_ultimos,
        "historial": historial,
    }
