# SPEC — Tracker de precios de combustibles Petropar vs. petróleo

## Objetivo
Página web pública con la serie temporal de precios de surtidor de Petropar (desde 2009-01-02)
comparada con el precio internacional del petróleo/diésel, sombreada por período presidencial,
que se actualiza sola cuando Petropar cambia precios — con aprobación humana antes de publicar.

## Fuentes
| Dato | Fuente | Frecuencia |
|---|---|---|
| Precios Petropar (vigentes) | https://www.petropar.gov.py/wp-content/price/index.html (HTML estático, SIN fecha de vigencia) | cada 6 h |
| Histórico Petropar 2009-01-02 → 2024-12-31 (oficial) | Respuesta AIP N° 90150 de Petropar (17-03-2025): `data/raw/petropar_AIP_90150.pdf` = https://informacionpublica.paraguay.gov.py/public/2025/1742301348_1_RespuestaSolicitudN90150.pdf, parseado en `data/raw/petropar_historico_oficial_2009_2024.csv` | única |
| Histórico Petropar desde 2025-01-01 | `data/raw/petropar_precios_v0.csv` (prensa y planilla, reconstruido a mano, formato ancho) | manual |

Todo lo de `data/raw/` está congelado y es de solo lectura (los tests verifican su hash).
Fuente oficial primero: donde hay documento oficial, reemplaza a prensa y planilla.
| WTI diario (US$/bbl) | EIA API v2, serie RWTC | diario |
| Diésel ULSD Costa del Golfo (US$/gal) | EIA API v2 | diario |

## Modelo de datos (formato largo)
- `data/productos.csv`: product_id, nombre_actual, nombres_historicos (separados por `|`; ej. "Eco 85"/"Nafta Econo 85" → "Kape 88", "Tipo III"/"Diésel común"/"Gasoil Tipo III" → "Porã", "Tipo I"/"Gasoil Tipo I" → "Mbarete", "Eco 90 Especial" → "Oikoite 93", "Ecoplus 95" → "Aratiri 97"), tipo (diesel/nafta/glp), unidad (litro/kg), datos_hasta (vacío = serie al día; si tiene fecha, el sitio no extiende la línea después de esa fecha)
  - Productos: Diésel Mbarete (desde 2011-05-26), Diésel Porã, Aratiri 97, Oikoite 93 (desde 2015), Kape 88, Ecoflex 85 (desde 2015; sin datos después de 2024-12-31 por ahora), GLP kg y GLP litro.
  - Nunca extrapolar un producto hacia atrás de su primera fecha con dato.
- `data/precios_petropar.csv`: fecha_vigencia, product_id, precio_gs, unidad, tipo_precio, estado, fecha_estado, fuente, fuente_url, nota, captured_at
  - `tipo_precio`: `max_o_sugerido_venta_publico` (2009–2014, página 1 del documento AIP 90150: "Max y/o Sugerido de venta al Público") | `venta_publico` (página 2 en adelante y todo lo posterior). En 2015 las dos páginas se solapan con el mismo precio: queda la fila de página 2.
  - `estado` (¿el precio está verificado?): verificado | derivado | planilla | a_confirmar (`a_confirmar` = precio sin fuente).
  - `fecha_estado` (¿la fecha de vigencia está verificada?): confirmada | a_confirmar.
  - `fuente`: cita en texto tal como figura en el histórico (ej. "ABC 16-10-2021").
  - `fuente_url`: URL exacta; vacía hasta que se encuentre. Si hay varias, separadas por ` | `.
  - `nota`: aclaraciones (lo que en el histórico estaba entre paréntesis, en estado o en fuente).
  - Correcciones de filas existentes: solo con aprobación explícita, registradas en `data/correcciones_aprobadas.csv` (fecha_original, fecha_nueva, estado, fecha_estado, fuente, fuente_url, nota, aprobado_el; nunca cambian el precio) y en un commit propio que lo diga.
  - Una fila está "firme" solo si estado = verificado y fecha_estado = confirmada; cualquier otra combinación se marca en el sitio.
- `data/petroleo.csv`: fecha, serie (wti|ulsd), valor_usd, unidad — dato diario.
- `data/presidentes.csv`: nombre, inicio, fin (intervalo [inicio, fin): el `fin` de uno es el `inicio` del siguiente; `fin` vacío = mandato en curso)
  - Presidentes: Lugo (2008-08-15), Franco (2012-06-22), Cartes (2013-08-15), Abdo (2018-08-15), Peña (2023-08-15).
- `data/eventos.csv`: fecha, fecha_fin, tipo (hito|promo), etiqueta, mostrar (true|false), fuente, fuente_url, nota (ej. pandemia OMS 2020-03-11 / 2023-05-05). Las bajas temporales o promociones que no figuran en el documento oficial van acá como `promo`, no a la serie principal. `mostrar=false` para promos de un día en pocas estaciones (2016–2017): quedan documentadas pero no se dibujan.
- `data/reports/conflictos_fuentes.csv`: fecha, producto, valor_prensa, valor_oficial, fuente_prensa, nota — filas de prensa/planilla 2009–2024 cuyo precio no coincide con el oficial vigente ese día.

`etl/migrar_historico.py` (corrida única) arma `precios_petropar.csv` y el reporte desde `data/raw/`:
2009–2024 sale del documento oficial; desde 2025 sale de `petropar_precios_v0.csv` sin perder estado ni fuente.
`etl/aip_90150.py` parsea el PDF (`pdftotext -layout`) y el test lo compara fila por fila con el CSV oficial
(400 filas = 396 cargadas + 4 solapamientos de 2015).

## ETL
1. `etl/scrape_petropar.py`: lee la página, normaliza ("Porã" con encoding roto, "G. 9.285" → 9285, GLP en kg y litro como productos distintos), compara con el último precio por producto. Si hay cambio → agrega filas con estado `verificado` (el precio sale de la página oficial, fuente_url = la página), fecha_estado `a_confirmar`, fecha_vigencia = día siguiente a captured_at (Petropar anuncia la noche anterior y rige 00:00) y abre un Pull Request. Si no hay cambio → no hace nada. Si el HTML cambió de estructura o no hay productos → falla con error claro.
2. `etl/fetch_oil.py`: baja WTI y ULSD de la EIA (API key en secret `EIA_API_KEY`), incremental.
   - Endpoint `/v2/petroleum/pri/spt/data/`, `frequency=daily`, `data[0]=value`, filtro por `facets[series][]`.
   - `RWTC` (WTI Cushing) llega en `$/BBL`; se guarda tal cual (unidad `usd_bbl`) y también ÷42 (unidad `usd_gal`).
   - `EER_EPD2DXL0_PF4_RGC_DPG` (ULSD Costa del Golfo) llega en `$/GAL`; se guarda con unidad `usd_gal`.
   - Validar `units` de cada serie (`$/BBL` y `$/GAL`) y fallar si no coincide.
   - Carga inicial con `start=2009-01-01` (acompaña el inicio de la serie Petropar); después incremental con `start` = última fecha guardada por serie (sin duplicar).
   - Máximo 5000 filas por pedido: paginar con `offset` mientras haga falta según `total`.
3. `etl/build_site_data.py`: genera `site/data.json` desde los CSV.
4. Tests (pytest) con fixtures HTML guardados: precios normales, encoding roto, página vacía, estructura distinta.

## Automatización (GitHub Actions)
- `scrape.yml`: cron cada 6 h → scraper → PR si hay cambio (nunca push directo a main).
- `oil.yml`: cron diario → commit de datos de petróleo (sin revisión, es dato de API oficial).
- Notificación de falla por email de GitHub Actions.

## Sitio (Vercel, estático)
- Una página, sin backend. Lee `data.json`.
- Gráfico de líneas escalonadas (precios administrados) + petróleo en línea de puntos (promedio mensual; el tooltip muestra el valor diario del día más cercano).
- Sombreado por presidente (5 mandatos desde Lugo), líneas verticales de eventos (pandemia) y marcas de promociones (`tipo = promo`, solo `mostrar = true`; con `fecha_fin` como franja), distinguibles de los hitos.
- GLP (kg y litro) NO va en el eje de los combustibles líquidos: otro producto, otra unidad y otra escala. Va en un gráfico chico aparte o en una pestaña.
- Selector de vista: (a) doble eje Gs / US$ por galón, (b) índice base 100.
- Selector de productos y de serie internacional (WTI / ULSD).
- Tooltip con precio, fecha de vigencia, tipo_precio ("máximo y/o sugerido" vs "venta al público"), estado, fecha_estado y link a la fuente.
- Marcados visualmente los puntos que no son estado `verificado` + fecha_estado `confirmada`.
- Paleta categórica (orden fijo por producto; el color sigue al producto aunque se filtre):

  | Producto | Claro | Oscuro |
  |---|---|---|
  | Diésel Mbarete | `#2a78d6` | `#3987e5` |
  | Diésel Porã | `#eb6834` | `#d95926` |
  | Aratiri 97 | `#1baf7a` | `#199e70` |
  | Oikoite 93 | `#eda100` | `#c98500` |
  | Kape 88 | `#e87ba4` | `#d55181` |
  | Ecoflex 85 | `#008300` | `#008300` |

  Validada con el validador de daltonismo (pares adyacentes, el criterio para líneas): pasa en claro (fondo `#fcfcfb`) y oscuro (`#1a1a19`).
  En claro, Aratiri, Oikoite y Kape quedan bajo 3:1 de contraste con el fondo → obligatorio etiqueta directa al final de cada línea + leyenda + tabla.
  Considerando todos los pares, Porã (naranja) y Ecoflex (verde) se confunden con protanopía (ΔE 3,2) → no depender solo del color: etiquetas directas y tooltip con nombre.
- Nota metodológica: nominal vs real, escalas independientes en doble eje, huecos conocidos, fuentes (oficial AIP 90150 hasta 2024, prensa desde 2025), cambio de tipo_precio (2009–2014 precio máximo y/o sugerido; desde 2015 precio de venta al público) y productos que aparecen después del inicio (Mbarete 2011, Oikoite y Ecoflex 2015).
- Responsive (se va a compartir en celular), español, tema claro/oscuro.
- Referencia visual: `data/referencia_grafico.png`.

## Definición de terminado
- `pytest` pasa.
- El scraper corre localmente y detecta los precios vigentes de hoy.
- `build_site_data.py` genera un JSON que el sitio renderiza sin errores en móvil y desktop.
- Workflows validados (actionlint) y probados con `workflow_dispatch`.
- README con cómo correr local, secrets necesarios y cómo aprobar un PR de precios.

## v2
- Fuentes: tipo de cambio PYG/USD (BCP, diario) e IPC (INE, mensual).
- Vistas del sitio: (c) Gs constantes (IPC), (d) US$ por litro.

## Fuera de alcance (por ahora)
- Precios de emblemas privados.
- Histórico pre-2009 (sin fuente oficial encontrada todavía).
