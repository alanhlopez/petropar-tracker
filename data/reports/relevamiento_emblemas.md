# Relevamiento de emblemas privados (v2)

Relevamiento al 28/10/2026, hecho con búsquedas web y lectura de páginas (agente `data-historian`).
**No incorpora precios**: es la base para decidir fuentes antes de escribir código. Ver SPEC.md,
sección "v2: emblemas privados (CombusPy)".

Advertencias de método:

- Varios resultados de buscadores tienen una fecha distinta de la real de la nota (ej.: una nota de
  Última Hora que el buscador fecha "29 jul 2026" es del 9 de abril de 2026). Antes de cargar
  cualquier precio hay que abrir la nota y confirmar la fecha de **vigencia**.
- Los sitios de Copetrol y Shell devolvieron solo el título (probablemente apps JS); `petrobras.com.py`
  no resolvió y el de Puma dio 404. Por eso "dónde publica precios" quedó **sin confirmar** para la
  mayoría: hay que revisarlo con navegador (web, redes, apps).

## Mercado

- 23 emblemas según el MIC (citado por ABC, julio 2026). Registro MIC de marzo 2026: 2.856 estaciones
  habilitadas ([Surtidores LATAM](https://surtidoreslatam.com/estaciones-servicio-paraguay-alerta-apesa-mic/));
  Apesa estima ~2.600 operativas. Cifras contradictorias entre fuentes: no usarlas como dato duro.
- Cuotas 2025 ([ABC 14/04/2026](https://www.abc.com.py/economia/2026/04/14/estos-son-los-emblemas-que-lideran-el-mercado-de-combustibles-en-el-pais/)):
  Shell 18 %, Petropar 17 %, Petrobras 12 %, Copetrol 10 %, Puma 7 %; Petrosur, Ecop, San Isidro y
  Petromax ~5 % c/u; Petrochaco 4 %; Compasa 3 %; Enex e Integral 2 %; Tega, Fuelpar, 3 Fronteras,
  Enercom, Hidronorte, Copeg y 3MG ~1 %; Corona, Yguazú y Petron, ínfimas.

## Emblemas

| Marca | Dueño actual (fuente, fecha) | Fuente de precios | Formato | Scrapeable | Notas y URLs |
|---|---|---|---|---|---|
| Petropar | Estatal | https://www.petropar.gov.py/?page_id=4460 | HTML | sí | Ya cubierto por `etl/scrape_petropar.py`. |
| Shell (ex Barcos y Rodados) | Barcos & Rodados S.A.; Raízen compró el 50 % y volvió la marca Shell en nov-2021 ([La Nación 03/11/2021](https://www.lanacion.com.py/negocios_edicion_impresa/2021/11/03/raizen-adquirio-el-50-de-barcos-rodados-y-shell-vuelve-a-paraguay/)). Sin noticias posteriores. | sin confirmar (https://www.shell.com.py cargó solo el título) | sin confirmar | sin confirmar | Mayor cuota de mercado. Aparece en prensa y en fulltanque.net. |
| Copetrol | Corporación Paraguaya Distribuidora de Derivados de Petróleo S.A. ([ViaParaguay 10/09/2026](https://viaparaguay.com/en/guias/fuel-stations-paraguay-guide)) | sin confirmar (https://www.copetrol.com.py cargó solo el título) | sin confirmar | sin confirmar | Mayor red por cantidad de estaciones. |
| Petrobras | Copetrol compró el 100 % de Petrobras Paraguay en 2018-19 ([ADN Digital](https://www.adndigital.com.py/copetrol-pago-us-3835-millones-179-estaciones-petrobras-paraguay/)); la marca quedó licenciada (5 años iniciales). | no encontrada (`petrobras.com.py` no resolvió) | sin confirmar | sin confirmar | La marca sigue operando (ABC, oct-2026). No se confirmó si la licencia se renovó. |
| Puma Energy | Vendida en 2019 a Impala Terminals (Trafigura/IFM) ([Última Hora](https://www.ultimahora.com/puma-energy-vende-activos-usd-200-millones-n2847192), [RDN 2020](https://www.rdn.com.py/2020/07/06/multinacional-toma-el-control-de-puma-energy/)); sigue con la marca Puma. | no encontrada (sitio 404) | sin confirmar | sin confirmar | Activa en 2026 ([La Nación 14/01/2026](https://www.lanacion.com.py/negocios/2026/01/14/puma-energy-inaugura-una-nueva-estacion-en-un-punto-estrategico-frente-al-principal-aeropuerto-del-pais/)). Casi nunca aparece con precios en prensa. |
| Enex | 50 % de Gasur SRL desde 2019, el otro 50 % sería de Grupo Cartes ([Revista Plus 22/11/2019](https://revistaplus.com.py/2019/11/22/de-la-mano-de-cartes-y-luksic-shell-vuelve-a-plantar-su-bandera-en-paraguay/), [La Nación 2020](https://www.lanacion.com.py/destacado_edicion_impresa/2020/11/08/con-productos-de-alta-calidad-desembarca-enex-en-paraguay/)). | https://www.enex.com.py/combustibles/ | HTML | no (lista productos, sin precios) | Fuente de nombres comerciales, no de precios. |
| Petromax | Imperial Cía. Distribuidora de Petróleo y Derivados S.A.E. ([cbonds](https://cbonds.com/company/242355/), sin fecha) | no encontrada | sin confirmar | sin confirmar | La prensa cita las pizarras de sus estaciones. |
| Petrosur | Petróleos del Sur S.A. (registros de contratación pública) | no encontrada; tiene app propia ("Petrosur App") | sin confirmar | sin confirmar | App no revisada. |
| Petrochaco, Compasa, Energy, Tega Oil, Fuelpar, Ecop, Copeg, Petron, San Isidro, Integral, otros | sin verificar | no encontradas | sin confirmar | sin confirmar | Algunos aparecen con precios en notas de prensa (Energy, Tega Oil, Compasa). |
| Axion | Copetrol compró sus estaciones en 2018-19 ([Mobility Plaza](https://www.mobilityplaza.org/news/10430)) | — | — | — | Probablemente ya no existe como emblema (no figura en listados de 2026). No confirmado. |
| Esso, Lubripar, Fox | sin dato | — | — | — | No aparecen en ninguna fuente de 2026. No asumir que existen ni que no. |

### Agregador de terceros

- **fulltanque.net** (https://fulltanque.net/precios): tabla HTML por emblema y categoría, actualizada
  al 26/10/2026. Es colaborativa: los usuarios fotografían los tótems de precios ([ABC 03/08/2026](https://www.abc.com.py/nacionales/2026/08/03/app-gratuita-muestra-donde-es-mas-barato-cargar-combustible-tras-nueva-suba/)).
  Sin histórico ni API. Tenía un diésel de Petropar desactualizado. **Scrapeable: parcial**: no es una
  fuente oficial y habría que revisar sus términos de uso.

## Fuentes de histórico

No hay ninguna serie histórica por emblema estructurada y descargable. Lo que existe son **notas de
prensa**, publicadas en cada tanda de subas (cada pocas semanas en 2026: seis tandas hasta el 27/10).

| Fecha de la nota | Medio | Contenido | URL |
|---|---|---|---|
| 09/04/2026 | Última Hora | Shell, Copetrol y Petrobras (parcial) con nombres comerciales, más Petropar | https://www.ultimahora.com/combustibles-emblemas-privados-concretaron-otro-reajuste |
| 02/08/2026 | ABC | Shell, Petrobras, Energy, Petromax y Tega Oil, con fecha de vigencia por emblema | https://www.abc.com.py/economia/2026/08/02/precios-de-combustibles-emblemas-privados-concretan-la-cuarta-suba-del-ano/ |
| 03/08/2026 | Última Hora | Copetrol y Petrobras con nombres comerciales | https://www.ultimahora.com/naftas-y-diesel-suben-500-guaranies-en-los-principales-emblemas |
| 03/08/2026 | ABC | Promedio privados vs. Petropar, febrero a agosto | https://www.abc.com.py/economia/2026/08/03/combustibles-ya-subieron-hasta-39-en-paraguay-cual-es-la-diferencia-de-precios-entre-petropar-y-los-privados/ |
| 18/09/2026 | Surtidores LATAM | Montos de suba por emblema, sin precios absolutos | https://surtidoreslatam.com/diesel-precio-aumento-estaciones-servicio-paraguay-petropar/ |
| 23/10/2026 | ABC | Shell y Petromax con precios y vigencia | https://www.abc.com.py/economia/2026/10/23/sexta-suba-del-gasoil-conozca-que-emblemas-ya-aumentaron-y-cuales-subiran-el-lunes/ |
| 27/10/2026 | ABC | Cronología de subas por emblema, con rangos | https://www.abc.com.py/economia/2026/10/27/mas-emblemas-privados-suben-el-gasoil-y-se-completa-la-sexta-tanda-de-aumentos-del-2026/ |
| 28/10/2026 | ABC | Promedios privados vs. Petropar en 2026, sin marcas | https://abc.com.py/economia/2026/10/28/precios-de-combustibles-cuanto-subieron-el-gasoil-y-las-naftas-en-petropar-y-los-privados-en-2026 |

Encontradas, sin abrir: ABC 28/09/2026 ("así evolucionaron los precios en los últimos seis años",
posible serie), ABC 22/06/2025 (https://www.abc.com.py/economia/2025/06/22/emblemas-privados-vuelven-a-subir-precios-de-todos-los-combustibles-cuanto-cuesta-ahora-cada-litro/),
ABC 29/01/2025, Última Hora 22/10/2026 y 07/09/2026, y Prensa Mercosur 14/09/2026 (Compasa).
No se encontraron tablas por emblema en Hoy, 5Días, MarketData ni La Nación (eso no prueba que no existan).

### Organismos públicos

- **MIC, Observatorio del Mercado de Combustibles** (https://gis.mic.gov.py/visor/#/dashboard):
  importaciones, costos de origen, participación de mercado, ventas y comparación de precios
  ([MIC](https://www.mic.gov.py/observatorio-del-mercado-de-los-combustible-una-herramienta-para-conocer-el-movimiento-de-los-carburantes-en-el-pais/),
  [La Nación 03/12/2023](https://www.lanacion.com.py/negocios/2023/12/03/portal-ofrece-detalles-de-importacion-y-precios-de-combustibles/)).
  **No se pudo ver** si tiene precios minoristas por emblema ni si se puede descargar (es una app JS).
  Es la pista oficial más prometedora.
- MIC, mapa de estaciones por marca: ubicación, no precios. MIC/INTN/SEDECO: el monitoreo encontrado es
  de calidad, no de precios. Viceministerio de Minas y Energía: nada sobre precios por emblema.
- El MIC dice que es "libre mercado" y que cada importador fija sus precios ([ABC 31/07/2026](https://www.abc.com.py/nacionales/2026/07/31/subira-o-no-el-precio-del-combustible-esto-dice-el-mic/)).
- **informacionpublica.paraguay.gov.py**: el buscador general no devolvió pedidos sobre precios por
  emblema y el portal no se pudo consultar por dentro (app JS). Pendiente: buscar a mano o presentar
  un pedido al MIC (Dirección General de Combustibles) por precios minoristas históricos por emblema.

## Equivalencias preliminares (para `data/equivalencias.csv`)

"Inferido" = la categoría sale del octanaje o del orden de precios, no de la fuente. Todo esto tiene
que confirmarse antes de cargarse.

| Marca | Producto | Categoría | Base | Fuente |
|---|---|---|---|---|
| Petropar | Diésel Porã | diésel común | — | SPEC.md |
| Petropar | Diésel Mbarete | diésel premium | — | SPEC.md |
| Petropar | Kape 88 | nafta 88–90 | — | SPEC.md |
| Petropar | Oikoite 93 | nafta 93–95 | — | SPEC.md |
| Petropar | Aratiri 97 | nafta 97+ | — | SPEC.md |
| Shell | Diésel Evolux | diésel común | inferido (orden de precios) | [UH 09/04/2026](https://www.ultimahora.com/combustibles-emblemas-privados-concretaron-otro-reajuste) |
| Shell | Diésel V-Power | diésel premium | inferido | ídem |
| Shell | Nafta Regular | nafta 88–90 | inferido (88 octanos en ABC 23/10) | ídem; [ABC 23/10/2026](https://www.abc.com.py/economia/2026/10/23/sexta-suba-del-gasoil-conozca-que-emblemas-ya-aumentaron-y-cuales-subiran-el-lunes/) |
| Shell | Nafta Super | nafta 93–95 | inferido (93 octanos) | ídem |
| Shell | Nafta V-Power | nafta 97+ | inferido (97 octanos) | ídem |
| Copetrol | Diésel GoS50 | diésel común | inferido | [UH 03/08/2026](https://www.ultimahora.com/naftas-y-diesel-suben-500-guaranies-en-los-principales-emblemas) |
| Copetrol | Diésel Elite S10 | diésel premium | inferido | ídem |
| Copetrol | Nafta Standard (90 aditivada) | nafta 88–90 | octanaje en la fuente | [Infonegocios](https://infonegocios.com.py/infobrand/copetrol-lanza-al-mercado-la-nueva-formulacion-tecno-molecular-de-la-nafta-suprema-97-aditivada) |
| Copetrol | Nafta Supra (95 aditivada) | nafta 93–95 | octanaje en la fuente | ídem |
| Copetrol | Nafta Suprema (97 aditivada) | nafta 97+ | octanaje en la fuente | ídem |
| Copetrol | Quantum 98 E10 | nafta 97+ (¿o aparte?) | duda abierta | ídem |
| Petrobras | Diésel Euro 5 | diésel común | inferido | UH 03/08/2026 |
| Petrobras | Diésel Podium S10 | diésel premium | la fuente lo llama "tipo I" | [Infonegocios](https://infonegocios.com.py/default/en-respuesta-a-la-competencia-petrobras-presenta-el-nuevo-diesel-podium-s10-con-triple-filtrado) |
| Petrobras | Nafta Grid | nafta 93–95 | inferido (precio) | UH 03/08/2026 |
| Petrobras | Súper 97 | nafta 97+ | octanaje en el nombre | UH 03/08/2026 |
| Petrobras | Prix 90 | nafta 88–90 | no verificado (solo buscador) | — |
| Enex | Diésel normal (50 ppm) | diésel común | fuente | https://www.enex.com.py/combustibles/ |
| Enex | Diésel Xtreme (10 ppm) | diésel premium | fuente | ídem |
| Enex | Eco 89+ | nafta 88–90 | octanaje en el nombre | ídem |
| Enex | Extra 94+ | nafta 93–95 | octanaje en el nombre | ídem |
| Enex | Super 97+ | nafta 97+ | octanaje en el nombre | ídem |
| Petromax, Tega Oil, Energy | "tipo III", "tipo I", "nafta súper" (sin nombre comercial) | por tipo | prensa | [ABC 02/08/2026](https://www.abc.com.py/economia/2026/08/02/precios-de-combustibles-emblemas-privados-concretan-la-cuarta-suba-del-ano/) |
| Compasa | Eco 88, 93, 97 especial | 88–90 / 93–95 / 97+ | no verificado (solo buscador) | Prensa Mercosur 14/09/2026 |
| Puma | sin dato | — | — | — |

La prensa (ABC) y fulltanque.net ya usan categorías equivalentes a las de SPEC: diésel común
(tipo III), diésel premium (tipo I), nafta común 88/89, intermedia 93/95 y súper 96/97.

## Dudas abiertas

1. Dónde publica precios cada marca (Copetrol, Shell, Petrobras, Puma, Petromax, Petrosur y el resto).
   Hipótesis sin confirmar: la mayoría solo comunica la lista a sus operadores y a la prensa.
2. Qué muestra realmente el Observatorio del MIC y si se puede descargar.
3. Pedidos de acceso a la información sobre precios por emblema: buscar a mano o presentar uno nuevo.
4. Petrobras: ¿se renovó la licencia de la marca (5 años desde 2019)?
5. Shell: ¿Raízen mantiene el 50 % después de 2021?
6. Puma: ¿sigue bajo Impala/Trafigura? Faltan nombres comerciales y precios.
7. Axion, Esso, Lubripar, Fox: sin presencia verificada en 2026.
8. Quantum 98 de Copetrol: ¿va en "97+" o como categoría aparte?
9. Las notas de prensa de 2026 tienen incoherencias de fecha y de valor: no cargar ningún precio sin
   abrir la nota y confirmar la vigencia.
