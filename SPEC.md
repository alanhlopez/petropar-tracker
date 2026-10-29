# SPEC — Tracker de precios de combustibles Petropar vs. petróleo

## Objetivo
Página web pública con la serie temporal de precios de surtidor de Petropar (desde 2009-01-02)
comparada con el precio internacional del petróleo/diésel, sombreada por período presidencial,
que se actualiza sola cuando Petropar cambia precios — con aprobación humana antes de publicar.

## Fuentes
| Dato | Fuente | Frecuencia |
|---|---|---|
| Precios Petropar vigentes (principal) | https://www.petropar.gov.py/?page_id=4460 (tabla `table.pp-tabla`: producto, precio, vigencia por producto) | cada 6 h |
| Precios Petropar vigentes (control cruzado) | https://www.petropar.gov.py/wp-content/price/index.html (HTML estático, sin fecha de vigencia, sin charset) | cada 6 h |
| Histórico Petropar 2009-01-02 → 2024-12-31 (oficial) | Respuesta AIP N° 90150 de Petropar (17-03-2025): `data/raw/petropar_AIP_90150.pdf` = https://informacionpublica.paraguay.gov.py/public/2025/1742301348_1_RespuestaSolicitudN90150.pdf, parseado en `data/raw/petropar_historico_oficial_2009_2024.csv` | única |
| Histórico Petropar desde 2025-01-01 | `data/raw/petropar_precios_v0.csv` (prensa y planilla, reconstruido a mano, formato ancho) | manual |
| WTI diario (US$/bbl) | EIA API v2, serie RWTC | diario |
| Diésel ULSD Costa del Golfo (US$/gal) | EIA API v2 | diario |

Todo lo de `data/raw/` está congelado y es de solo lectura (los tests verifican su hash).
Fuente oficial primero: donde hay documento oficial, reemplaza a prensa y planilla.

## Modelo de datos (formato largo)
- `data/productos.csv`: product_id, nombre_actual, nombres_historicos (separados por `|`; ej. "Eco 85"/"Nafta Econo 85" → "Kape 88", "Tipo III"/"Diésel común"/"Gasoil Tipo III" → "Porã", "Tipo I"/"Gasoil Tipo I" → "Mbarete", "Eco 90 Especial" → "Oikoite 93", "Ecoplus 95" → "Aratiri 97"), tipo (diesel/nafta/glp), unidad (litro/kg), datos_hasta (vacío = sin hueco; si tiene fecha, ahí empieza un hueco: el sitio corta la línea en esa fecha y la retoma en la siguiente fila, que solo puede venir del scraper)
  - Productos: Diésel Mbarete (desde 2011-05-26), Diésel Porã, Aratiri 97, Oikoite 93 (desde 2015), Kape 88, Ecoflex 85 (desde 2015; hueco desde 2024-12-31), Ñande Gas (GLP) por kg y por litro (entran con la primera captura del scraper, con la vigencia que publica Petropar).
  - Las filas de prensa y planilla (pre-AIP) se reescriben solo vía `data/correcciones_aprobadas.csv`; las notas, vía `data/anotaciones.csv` (fecha_vigencia, product_id, nota), que pisa la nota del raw al construir la serie sin tocar `data/raw/`.
  - Nunca extrapolar un producto hacia atrás de su primera fecha con dato.
- `data/precios_petropar.csv`: fecha_vigencia, product_id, precio_gs, unidad, tipo_precio, estado, fecha_estado, fuente, fuente_url, nota, captured_at
  - `tipo_precio`: `max_o_sugerido_venta_publico` (2009–2014, página 1 del documento AIP 90150: "Max y/o Sugerido de venta al Público") | `venta_publico` (página 2 en adelante y todo lo posterior). En 2015 las dos páginas se solapan con el mismo precio: queda la fila de página 2.
  - `estado` (¿el precio está verificado?): verificado | derivado | planilla | a_confirmar (`a_confirmar` = precio sin fuente).
  - `fecha_estado` (¿la fecha de vigencia está verificada?): confirmada | a_confirmar.
  - `fuente`: cita en texto tal como figura en el histórico (ej. "ABC 16-10-2021").
  - `fuente_url`: URL exacta; vacía hasta que se encuentre. Si hay varias, separadas por ` | `.
  - `nota`: aclaraciones (lo que en el histórico estaba entre paréntesis, en estado o en fuente).
  - Correcciones de filas existentes: solo con aprobación explícita, registradas en `data/correcciones_aprobadas.csv` (fecha_original, fecha_nueva, estado, fecha_estado, fuente, fuente_url, nota, aprobado_el; nunca cambian el precio) y en un commit propio que lo diga. Las filas agregadas por el scraper se corrigen igual, pero se registran en `data/correcciones_capturas.csv` (fecha_vigencia, product_id, captured_at, estado, fecha_estado, nota, aprobado_el).
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
1. `etl/scrape_petropar.py`: lee la página principal (`?page_id=4460`) y la de control (`index.html`), normaliza ("Porã" con encoding roto, "G. 9.285" → 9285, Ñande Gas por kg y por litro como productos distintos) y compara con el último precio registrado de cada producto.
   - Sin cambio → no escribe nada (igual corre las reglas de plausibilidad y las informa).
   - Con cambio → agrega filas con estado `verificado` (el precio sale de la página oficial, fuente_url = página principal), `captured_at`, y:
     - fecha_vigencia = vigencia publicada, fecha_estado `confirmada` solo si está a ±3 días de la captura (la página no siempre actualiza la vigencia); si está más lejos, se guarda igual pero `a_confirmar`, alerta `vigencia_lejana`;
     - salvo que la vigencia publicada no sea posterior al último registro del producto: entonces fecha_vigencia = día siguiente a la captura en hora de Asunción (Petropar anuncia de noche y rige 00:00), fecha_estado `a_confirmar` y alerta `vigencia_vieja`.
     - si la nueva fecha cayera en o antes del último registro (ej. ya hay una fila `a_confirmar` de mañana y hubo otro cambio hoy), se corre al día siguiente de ese registro, `a_confirmar`, alerta `fecha_ajustada`.
   - Con cambio guarda primero el HTML crudo de las dos páginas en `data/capturas/AAAA-MM-DDTHHMMSSZ/` (hora UTC de captured_at; auditoría, va en el PR) y después agrega las filas (solo agrega).
   - Siempre escribe un resumen JSON (`--resumen`, por defecto `resumen_scraper.json`, ignorado por git) — también ante errores — con: estado (ok|error), tipo_error (no_responde|estructura|interno), url, cambio, revisar, clave_cambio y clave_alertas (huellas estables entre corridas para no duplicar PR ni issues), alertas, filas nuevas y precios vigentes.
   - `--artefactos DIR` copia el HTML descargado en toda corrida (incluso con error) para adjuntarlo como artifact.
   - `--sin-escribir` corre todas las reglas y escribe el resumen, sin tocar `data/`.
   - **Validación en tres niveles:**
     - **(a) Estructura — falla dura** (exit 1, resumen con `estado: error`): una página no responde (3 intentos), no está la tabla o su encabezado cambió, falta alguno de los 8 productos esperados, aparece un producto desconocido o repetido, o un precio o fecha no se puede convertir.
     - **(b) Plausibilidad — no bloquea; el PR va con etiqueta `revisar`:** precio entre 2.000 y 30.000; múltiplo de 5 (solo diésel y naftas: el GLP por kg es 7.374); Mbarete > Porã y Aratiri > Oikoite > Kape; variación contra el precio anterior menor a ±25 %; precio igual en las dos páginas (control cruzado); vigencia publicada posterior al último registro (`vigencia_vieja`); si no lo es y el histórico tiene otro precio vigente en esa fecha, `conflicto_historico` (caso real: Ecoflex 7.330 "desde 13/08/2024" contra 7.730 del AIP 90150); sin cambio de precio, la vigencia publicada coincide con la fecha en que empezó ese precio en el histórico, si esa fecha está confirmada (`vigencia_discrepante`; caso real: el 28/10/2026 Petropar seguía publicando 24/09 para los diésel ya subidos el 28/10).
     - **(c) Frescura:** si no hubo una corrida exitosa del scraper en 24 h, aviso (lo controla el workflow, no el script).
2. `etl/fetch_oil.py`: baja WTI y ULSD de la EIA (API key en secret `EIA_API_KEY`), incremental.
   - Endpoint `/v2/petroleum/pri/spt/data/`, `frequency=daily`, `data[0]=value`, filtro por `facets[series][]`.
   - `RWTC` (WTI Cushing) llega en `$/BBL`; se guarda tal cual (unidad `usd_bbl`) y también ÷42 (unidad `usd_gal`).
   - `EER_EPD2DXL0_PF4_RGC_DPG` (ULSD Costa del Golfo) llega en `$/GAL`; se guarda con unidad `usd_gal`.
   - Validar `units` de cada serie (`$/BBL` y `$/GAL`) y fallar si no coincide.
   - Carga inicial con `start=2009-01-01` (acompaña el inicio de la serie Petropar); después incremental con `start` = última fecha guardada por serie (sin duplicar).
   - Máximo 5000 filas por pedido: paginar con `offset` mientras haga falta según `total`.
3. `etl/build_site_data.py`: genera `site/data.json` desde los CSV (petróleo en US$/galón diario + promedio mensual; eventos solo con `mostrar=true`; sin `petroleo.csv` las series salen vacías).
4. Tests (pytest) con fixtures HTML guardados (capturas reales de las dos páginas y variantes): precios normales, encoding roto, página vacía, estructura distinta, y un test por cada regla de estructura y de plausibilidad. EIA con respuestas simuladas (sin red).

## Automatización (GitHub Actions)
- `scrape.yml`: cron cada 6 h → scraper → PR si hay cambio (nunca push directo a main). Un solo PR de precios abierto a la vez: si ya hay uno, el cambio nuevo se avisa en el issue y se propone cuando ese se resuelva; un PR rechazado no se vuelve a abrir.
- `oil.yml`: cron diario → commit de datos de petróleo (sin revisión, es dato de API oficial).
- Frescura: chequeo programado de la última corrida exitosa de `scrape.yml`; si pasaron más de 24 h, aviso.
- **Notificaciones con issues de GitHub (sin SMTP):**
  - `scraper-roto`: el scraper falló (estructura) o no hubo corrida exitosa en 24 h.
  - `precio-nuevo`: hubo cambio de precio, con link al PR.
  - `revisar`: se disparó alguna regla de plausibilidad (la misma etiqueta va en el PR si lo hay).
  - El HTML capturado se adjunta como artifact del workflow y el issue lleva el link a la corrida.
  - Un issue abierto por etiqueta: si ya hay uno, se comenta en vez de abrir otro.

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

## v2: comparación con emblemas privados
Por categoría de producto (diésel común / diésel premium, nafta 88–90, nafta 93–95, nafta 97+): un producto por vista y varios emblemas en el mismo gráfico. No implementar todavía.

## Fuera de alcance (por ahora)
- Precios de emblemas privados (ver v2).
- Histórico pre-2009 (sin fuente oficial encontrada todavía).
