"""Genera site/data.json desde los CSV de data/ (lo único que lee el sitio).

- Precios Petropar por producto, en orden de fecha, con tipo_precio, estado,
  fecha_estado, fuente, URLs (lista) y nota para el tooltip.
- Petróleo en US$/galón: serie diaria (tooltip) y promedio mensual (línea).
- Presidentes y eventos (solo los que tienen mostrar=true).
Si todavía no existe data/petroleo.csv, las series de petróleo salen vacías.
"""
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from etl.io_csv import DATA, RAIZ, leer_csv

ASUNCION = ZoneInfo("America/Asuncion")

SALIDA = RAIZ / "site" / "data.json"


def fecha_valida(valor: str, donde: str) -> str:
    """Un dato roto tiene que cortar la generación, no llegar al sitio como "" o NaN."""
    try:
        date.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ValueError(f"Fecha inválida {valor!r} en {donde}") from None
    return valor


def precio_valido(valor: str, donde: str) -> int:
    try:
        precio = int(valor)
    except (TypeError, ValueError):
        raise ValueError(f"Precio inválido {valor!r} en {donde}") from None
    if precio <= 0:
        raise ValueError(f"Precio inválido {valor!r} en {donde}")
    return precio


def productos_json(productos: list[dict]) -> list[dict]:
    return [{"id": p["product_id"], "nombre": p["nombre_actual"], "tipo": p["tipo"],
             "unidad": p["unidad"], "datos_hasta": p["datos_hasta"] or None} for p in productos]


def precios_json(precios: list[dict], ids: set[str]) -> dict[str, list[dict]]:
    series: dict[str, list[dict]] = {pid: [] for pid in sorted(ids)}
    for f in sorted(precios, key=lambda f: (f["product_id"], f["fecha_vigencia"])):
        if f["product_id"] not in ids:
            raise ValueError(f"Precio de un producto que no está en productos.csv: {f['product_id']}")
        donde = f"precios_petropar.csv ({f['product_id']} {f['fecha_vigencia']!r})"
        series[f["product_id"]].append({
            "fecha": fecha_valida(f["fecha_vigencia"], donde),
            "precio": precio_valido(f["precio_gs"], donde),
            "tipo_precio": f["tipo_precio"],
            "estado": f["estado"],
            "fecha_estado": f["fecha_estado"],
            "firme": f["estado"] == "verificado" and f["fecha_estado"] == "confirmada",
            "fuente": f["fuente"],
            "urls": [u.strip() for u in f["fuente_url"].split(" | ") if u.strip()],
            "nota": f["nota"],
        })
    return series


def petroleo_json(petroleo: list[dict]) -> dict[str, dict]:
    salida = {}
    for serie in ("wti", "ulsd"):
        diario = sorted((f["fecha"], float(f["valor_usd"])) for f in petroleo
                        if f["serie"] == serie and f["unidad"] == "usd_gal")
        por_mes: dict[str, list[float]] = defaultdict(list)
        for fecha, valor in diario:
            por_mes[fecha[:7]].append(valor)
        salida[serie] = {
            "unidad": "usd_gal",
            "diario": [[fecha, round(valor, 4)] for fecha, valor in diario],
            "mensual": [[f"{mes}-01", round(sum(v) / len(v), 4)] for mes, v in sorted(por_mes.items())],
        }
    return salida


def eventos_json(eventos: list[dict]) -> list[dict]:
    salida = []
    for e in eventos:
        mostrar = e["mostrar"].strip().lower()
        if mostrar not in {"true", "false"}:
            raise ValueError(f"eventos.csv: mostrar debe ser true/false, no {e['mostrar']!r}")
        if mostrar == "false":
            continue
        donde = f"eventos.csv ({e['etiqueta']!r})"
        salida.append({"fecha": fecha_valida(e["fecha"], donde),
                       "fecha_fin": fecha_valida(e["fecha_fin"], donde) if e["fecha_fin"] else None,
                       "tipo": e["tipo"], "etiqueta": e["etiqueta"], "fuente": e["fuente"],
                       "url": e["fuente_url"] or None, "nota": e["nota"]})
    return salida


def construir(data: Path = DATA, ahora: datetime | None = None) -> dict:
    productos = leer_csv(data / "productos.csv")
    precios = leer_csv(data / "precios_petropar.csv")
    petroleo = leer_csv(data / "petroleo.csv") if (data / "petroleo.csv").exists() else []
    ids = {p["product_id"] for p in productos}
    series_oil = petroleo_json(petroleo)
    ahora = ahora or datetime.now(timezone.utc)
    hoy = ahora.astimezone(ASUNCION).date().isoformat()
    return {
        "generado": ahora.isoformat(timespec="seconds"),
        "ultimo_dato": {
            # una fila "rige mañana" (vigencia_vieja, fecha_ajustada) no adelanta la fecha del encabezado
            "petropar": max((f["fecha_vigencia"] for f in precios if f["fecha_vigencia"] <= hoy), default=None),
            **{s: (v["diario"][-1][0] if v["diario"] else None) for s, v in series_oil.items()},
        },
        "productos": productos_json(productos),
        "precios": precios_json(precios, ids),
        "petroleo": series_oil,
        "presidentes": [{"nombre": p["nombre"], "inicio": p["inicio"], "fin": p["fin"] or None}
                        for p in leer_csv(data / "presidentes.csv")],
        "eventos": eventos_json(leer_csv(data / "eventos.csv")),
    }


def main() -> int:
    datos = construir()
    SALIDA.parent.mkdir(exist_ok=True)
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    total = sum(len(s) for s in datos["precios"].values())
    print(f"{SALIDA.relative_to(RAIZ)}: {total} precios, "
          f"{len(datos['petroleo']['wti']['diario'])} días WTI, {len(datos['eventos'])} eventos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
