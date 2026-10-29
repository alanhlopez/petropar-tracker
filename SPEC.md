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
| Brent diario (US$/bbl) | EIA API v2, serie RBRTE (Europe Brent Spot Price FOB) | diario |
| WTI diario (US$/bbl) | EIA API v2, serie RWTC (se guarda, no se muestra en el sitio) | diario |
| Diésel ULSD Costa del Golfo (US$/gal) | EIA API v2 | diario |

Todo lo de `data/raw/` está congelado y es de solo lectura (los tests verifican su hash).
Fuente oficial primero: donde hay documento oficial, reemplaza a prensa y planilla.

## Modelo de datos (formato largo)
- `data/productos.csv`: product_id, nombre_actual, nombres_historicos (separados por `|`; ej. "Eco 85"/"Nafta Econo 85" → "Kape 88", "Tipo III"/"Diésel común"/"Gasoil Tipo III" → "Porã", "Tipo I"/"Gasoil Tipo I" → "Mbarete", "Eco 90 Especial" → "Oikoite 93", "Ecoplus 95" → "Aratiri 97"), tipo (diesel/nafta/glp), unidad (litro/kg), datos_hasta (vacío = sin hueco; si tiene fecha, ahí empieza un hueco: el sitio corta la línea en esa fecha y la retoma en la siguiente fila, que solo puede venir del scraper); categoria (categoría genérica para comparar con emblemas privados: Diésel premium, Diésel común, Nafta 97+, Nafta 93–95, Nafta 88–90, Nafta con etanol (flex), GLP)
  - Productos: Diésel Mbarete (desde 2011-05-26), Diésel Porã, Aratiri 97, Oikoite 93 (desde 2015), Kape 88, Ecoflex 85 (desde 2015; hueco desde 2024-12-31), Ñande Gas (GLP) por kg y por litro.
  - GLP: el documento oficial (AIP 90150) y la planilla original no lo traen. Histórico con fuente desde 2018 (litro) y 2023 (kg): prensa y capturas de la web de Petropar en Wayback (`data/raw/wayback/`), kg y litro siempre por separado (nunca convertir una unidad en otra). Lo que no se puede asignar a una unidad va `a_confirmar`.
- `data/huecos.csv`: product_id, desde, hasta, nota. Períodos sin fuente entre dos filas (hubo cambios sin fecha conocida): la línea se corta en `desde` y retoma en la fila de `hasta`, que tiene que existir. Junto con `datos_hasta` forman `productos[i].huecos` en `data.json`, la única fuente de huecos del sitio. Nunca se arrastra un precio a través de un hueco (ni en el gráfico, ni en el cambio de las tarjetas, ni en la variación anual).
  - Las filas de prensa y planilla (pre-AIP) se reescriben solo vía `data/correcciones_aprobadas.csv`; las notas, vía `data/anotaciones.csv` (fecha_vigencia, product_id, nota), que pisa la nota del raw al construir la serie sin tocar `data/raw/`.
  - Nunca extrapolar un producto hacia atrás de su primera fecha con dato.
- `data/precios_petropar.csv`: fecha_vigencia, product_id, precio_gs, unidad, tipo_precio, estado, fecha_estado, fuente, fuente_url, nota, captured_at
  - `tipo_precio`: `max_o_sugerido_venta_publico` (2009–2014, página 1 del documento AIP 90150: "Max y/o Sugerido de venta al Público") | `venta_publico` (página 2 en adelante y todo lo posterior). En 2015 las dos páginas se solapan con el mismo precio: queda la fila de página 2.
  - `estado` (¿el precio está verificado?): verificado | derivado | planilla | a_confirmar (`a_confirmar` = precio sin fuente).
  - `fecha_estado` (¿la fecha de vigencia está verificada?): confirmada | a_confirmar.
  - `fuente`: cita en texto tal como figura en el histórico (ej. "ABC 16-10-2021").
  - `fuente_url`: URL exacta; vacía hasta que se encuentre. Si hay varias, separadas por ` | `.
  - `nota`: aclaraciones (lo que en el histórico estaba entre paréntesis, en estado o en fuente).
  - Correcciones de filas existentes: solo con aprobación explícita, registradas en `data/correcciones_aprobadas.csv` (fecha_original, fecha_nueva, estado, fecha_estado, fuente, fuente_url, nota, aprobado_el; nunca cambian el precio) y en un commit propio que lo diga. Las filas agregadas por el scraper se corrigen igual, pero se registran en `data/correcciones_capturas.csv` (fecha_vigencia, product_id, captured_at, precio_gs, estado, fecha_estado, nota, aprobado_el; el precio registrado tiene que coincidir con la fila).
  - Una fila está "firme" solo si estado = verificado y fecha_estado = confirmada; cualquier otra combinación se marca en el sitio.
- `data/petroleo.csv`: fecha, serie (brent|wti|ulsd), valor_usd, unidad — dato diario.
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
     - **(c) Frescura:** si no hubo una corrida exitosa del scraper en 24 h, aviso (lo controla el workflow, no el script). Además, si el `data.json` publicado en producción (variable `SITIO_URL`) tiene más de 48 h de atraso respecto del de main, issue `deploy-atrasado` (Vercel dejó de desplegar).
2. `etl/fetch_oil.py`: baja Brent, WTI y ULSD de la EIA (API key en secret `EIA_API_KEY`), incremental.
   - Endpoint `/v2/petroleum/pri/spt/data/`, `frequency=daily`, `data[0]=value`, filtro por `facets[series][]`.
   - `RBRTE` (Brent) y `RWTC` (WTI Cushing) llegan en `$/BBL` (se valida la unidad); se guardan tal cual (unidad `usd_bbl`) y también ÷42 (unidad `usd_gal`). Carga inicial desde 2009-01-01 e incremental.
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
  - `deploy-atrasado`: el sitio publicado no refleja main desde hace más de 48 h.
  - El HTML capturado se adjunta como artifact del workflow y el issue lleva el link a la corrida.
  - Un issue abierto por etiqueta: si ya hay uno, se comenta en vez de abrir otro.

## Sitio (Vercel, estático)
- Una página, sin backend. Lee `data.json`. Dos secciones, en este orden:
  1. **"Precios hoy"**: lista sin contenedor (filetes finos entre filas), una fila por producto (diésel, naftas de mayor a menor octanaje, GLP). Grilla real, igual en todas las filas y en las dos columnas de desktop: punto de color | nombre | precio (a la derecha, `tabular-nums`, unidad de ancho fijo) | variación | fecha. Variación como píldora suave sin porcentaje ("▲ 600" sobre rojo muy claro, "▼ 300" sobre verde muy claro, texto oscuro del mismo tono). Sin variación si el precio actual está por confirmar, si el precio anterior con fuente tiene más de 6 meses respecto de hoy o si hay un hueco sin datos entre ambos (`cambio.flecha`, calculado y testeado en `build_site_data.py`). "por confirmar": texto chico gris en versalitas (y sin fecha si la vigencia no está confirmada). GLP: el precio por kg en la línea principal y el por litro como texto secundario debajo. Encabezado "Precios Petropar hoy" y debajo "Verificado DD/MM/AAAA HH:MM · Planta Villa Elisa; puede variar a más de 50 km" (API pública de GitHub; si falla, último cambio capturado). Botón "Descargar" de contorno arriba a la derecha: CSV de precios vigentes / CSV del histórico (generados en el navegador desde `data.json`). 2 columnas desde 1000 px, 1 en celular con las 7 filas en la primera pantalla. La categoría genérica queda en `data.json` (para los privados) pero no se muestra. Tocar una fila deja solo ese producto en el gráfico y baja hasta él.
  2. **"Histórico"**: el gráfico con sus controles: pestañas con subrayado (Combustibles / GLP), segmentados livianos (grupo gris muy claro, opción activa blanca con sombra sutil; Vista, Serie y Período en una fila si entran), aviso del doble eje como nota chica gris debajo del gráfico, frescura del petróleo en texto secundario y botón "Descargar imagen" (PNG siempre en tema claro, con título, fuente y fecha).
- Estilo editorial (referencias: Our World in Data, FT, El Surti): menos cajas, más tipografía y alineación. Una sola familia (Inter), escala de espaciado 4/8/16/24/32/48, ancho máximo 1100 px centrado, sin emojis en la interfaz.
- Pie: fuentes (Petropar – AIP N° 90150, prensa, página oficial; EIA con atribución), link a la metodología, autor, última actualización y link al repo.
- Metadatos para compartir: `<title>`, description, `og:image` 1200×630 (`site/og.png`, captura del gráfico con `?og=1` generada por `etl/og_image.py` con Chrome headless en `sitio.yml`) y favicon simple (`site/favicon.svg`, sin logos de marcas).
- Gráfico de líneas escalonadas (precios administrados) + petróleo en línea de puntos gris medio (claro `#52514e`, oscuro `#9a998f`; trazo fino para no dominar sobre los combustibles; promedio mensual; el tooltip muestra el valor diario del día más cercano). Etiqueta final del petróleo con unidad ("Brent US$ 2,41/gal"). Ningún texto nombra una serie fija: eje derecho, etiqueta final, tooltip, frescura, PNG y pie de fuentes dicen la serie activa.
- Huecos: nunca arrastrar un precio a través de un período sin fuente. El hueco (desde `datos_hasta` hasta la fila siguiente) se dibuja sin línea, con marcadores en el último punto conocido y en el primero posterior, y tooltip "sin datos entre X e Y".
- Tramo 2009–2014 (`tipo_precio = max_o_sugerido_venta_publico`, rango derivado de los datos): trama sutil de fondo con la etiqueta "Precio máximo/sugerido"; explicado en tooltip y nota metodológica.
- Hitos en color neutro (tinta secundaria), con etiquetas en una franja superior reservada que no se superpone a los datos. Promos: banda con trama entre inicio y fin; sin fin, marcador ▲ sobre el eje X.
- Leyenda inferior solo con la clave de símbolos (punto no firme, borde de hueco, hito, promo, precio máximo/sugerido, sombreado presidencial); productos y petróleo se identifican por chips y etiquetas finales (en móvil, bloque debajo del gráfico).
- Sombreado por presidente (5 mandatos desde Lugo), líneas verticales de eventos (pandemia) y marcas de promociones (`tipo = promo`, solo `mostrar = true`; con `fecha_fin` como franja), distinguibles de los hitos.
- GLP (kg y litro) NO va en el eje de los combustibles líquidos: otro producto, otra unidad y otra escala. Va en un gráfico chico aparte o en una pestaña.
- Selector de vista: (a) doble eje Gs / US$ por galón, (b) índice base 100.
- Selector de productos y de serie internacional: Brent (por defecto) / ULSD / Ocultar. WTI se guarda en `petroleo.csv` pero no se publica en `data.json`. Nota metodológica: "Brent: referencia internacional del crudo. ULSD (Costa del Golfo, EE.UU.): referencia del diésel refinado; Paraguay importa derivados, no crudo."
- Chips de productos con estado activo (relleno suave + ✓) e inactivo (contorno gris, texto atenuado) claro; el anillo es solo para foco de teclado.
- "Ver datos en tabla" (desplegable al final): histórico completo, filtrable por producto y años.
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
  | Ecoflex 85 | `#6250d6` | `#9085e9` |

  Validada con el validador de daltonismo (pares adyacentes en el orden de dibujo, el criterio para líneas): pasa en claro (fondo `#fcfcfb`; peor CVD ΔE 9,1, visión normal 19,6) y oscuro (`#1a1a19`; peor CVD ΔE 8,4, visión normal 19,3). Ecoflex pasó del verde al violeta (slot 7) en oct-2026.
  En claro, Aratiri (2,74), Oikoite (2,11) y Kape (2,62) quedan bajo 3:1 de contraste con el fondo → etiquetas, tooltips y chips con texto en tinta del tema y muestra de color al lado, más la tabla. En oscuro, todos ≥ 3:1.
  Nunca depender solo del color: etiquetas directas y tooltip con nombre.
- Nota metodológica: nominal vs real, escalas independientes en doble eje, huecos conocidos, fuentes (oficial AIP 90150 hasta 2024, prensa desde 2025), cambio de tipo_precio (2009–2014 precio máximo y/o sugerido; desde 2015 precio de venta al público) y productos que aparecen después del inicio (Mbarete 2011, Oikoite y Ecoflex 2015).
- Responsive (se va a compartir en celular), español. Tema claro por defecto (fondo `#fcfcfb`, texto `#0b0b0b`), sin seguir la preferencia del sistema; botón sol/luna para oscuro, recordado en localStorage (con try/catch); `?tema=oscuro` fuerza oscuro en esa visita. Toda exportación a imagen sale en tema claro.
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

## v2: emblemas privados (CombusPy)
No implementar todavía. Primero el relevamiento de fuentes: `data/reports/relevamiento_emblemas.md`.

El sitio se publica como **CombusPy** (proyecto de Vercel `combuspy-tracker`, https://combuspy-tracker.vercel.app).
Mantener `site/` organizado para sumar secciones sin romper la URL actual.

### Estructura del sitio
- **Portada de privados: "Últimos cambios reportados"** (decidido el 29/10/2026, ver relevamiento: ningún emblema
  publica precios en un canal propio legible). Cada precio con su fecha de vigencia y la nota de prensa; nunca
  se presenta como "precio de hoy". Petropar sigue con "Precios hoy".
- **Portada "Precios hoy"** (solo si un emblema llega a tener fuente sostenible): precios actuales de Petropar y de los emblemas privados por categoría
  (diésel común, diésel premium, nafta 88–90, nafta 93–95, nafta 97+).
  - Filtro por marca y por categoría.
  - Desktop: tabla marca × categoría. Móvil: tarjetas.
  - Resaltar el más barato de cada categoría.
  - Cada precio muestra "verificado el DD/MM" y la fuente; si tiene más de 7 días, se ve atenuado y con aviso.
- **Sección "Histórico"**: el gráfico actual de Petropar, más un selector Petropar / privados. En modo privados
  muestra **una categoría a la vez** con varias marcas (nunca todas las combinaciones juntas).
- Nombre de marca siempre en texto, con su logo chico a la izquierda (decidido el 29/10/2026; antes: sin logos).
  Logos en `site/logos/`, sobre fondo blanco para que se vean igual en tema oscuro; se usan solo para identificar
  al emblema. Origen: favicon oficial de shell.com.py; ícono de copetrol.com.py; ícono de petromax.com.py; ícono
  de petropar.gov.py; logo de pumaenergy.com (recortado al puma); Petrobras de Wikimedia Commons
  (Petrobras_horizontal_logo.svg, recortado al "BR").
- Precio de referencia: lista en **Gran Asunción**. Aclararlo en la página (en el interior puede variar).

### Datos
- `data/equivalencias.csv`: emblema, producto_comercial, categoria (mismas etiquetas que `productos.csv`), desde, hasta, fuente (texto + URL). Solo equivalencias respaldadas por la fuente; las inferidas por orden de precios quedan en el relevamiento.
- Mismas reglas que Petropar: nunca inventar ni completar precios; sin fuente va `a_confirmar`; histórico de solo agregar.
- `data/emblemas.csv` (emblema, nombre, cuota_2025, nota) y `data/precios_privados.csv` (fecha_vigencia, emblema,
  producto_comercial, categoria, precio_gs, estado, fecha_estado, fuente, fuente_url, nota): solo precios
  explícitos de notas abiertas, nunca montos de suba sumados a un precio anterior ni datos de fulltanque.net.
  Categoría vacía si la nota no permite asignarla sin inferir por precio (queda en el historial, no en la tabla).
  Dos notas con valores distintos el mismo día se cargan las dos y la celda sale "por confirmar".
- `etl/privados.py` arma `privados` en `data.json`: último precio por emblema y categoría (la fecha es la primera
  nota que reportó ese precio), atenuado si tiene más de 7 días, y omitido ("sin dato reciente") si tiene más de
  6 meses. La tabla muestra Petropar como fila de referencia con su precio vigente. Sin "más barato resaltado":
  los precios tienen fechas distintas y no se comparan.

## Fuera de alcance (por ahora)
- Precios de emblemas privados (ver v2).
- Histórico pre-2009 (sin fuente oficial encontrada todavía).
