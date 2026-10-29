# Relevamiento de emblemas privados (v2, etapa 1)

Relevamiento al 29/10/2026 de los 5 emblemas elegidos, hecho por el agente `data-historian` con
búsquedas web y lectura de cada nota (WebFetch). Reemplaza el relevamiento general del 28/10/2026.
**No incorpora precios a `data/`**: los precios de abajo son para decidir fuentes, no para cargar.
Ver SPEC.md, sección "v2: emblemas privados (CombusPy)".

Convenciones:

- **abierta**: la nota se leyó entera. **buscador**: solo se vio el título o el resumen de un buscador.
- Los buscadores ponen fechas equivocadas a muchas notas (casos comprobados: notas de 2016, 2023, 2024 y
  2025 fechadas en 2026). Ningún dato se toma sin abrir la nota y leer la fecha de **vigencia**.
- Varios montos los resumió WebFetch: antes de cargar un precio hay que releer la nota original.

## Resumen para decidir

| | Shell | Petrobras | Copetrol | Puma | Petromax |
|---|---|---|---|---|---|
| Cuota nacional 2025 (ABC) | 18 % | 12 % | 10 % | 7 % | ~5 % |
| Operador confirmado 2025-26 | parcial | no | sí | no | no |
| Publica precios en canal propio | no encontrado | no encontrado | no (app sin precios) | no | no |
| Precio actual con fuente de prensa | naftas, sin diésel | no | no | diésel de sept. (ya superado) | diésel |
| Tandas 2026 con precio por marca (de 6) | 3 (una solo naftas) | 3 parciales | 3 | 1 (solo diésel) | 3 (parciales) |
| Equivalencias confirmadas por fuente | 1 de 5 | 2 de 5 | 3 de 5 (+2 por nombre) | 2 de 5 | 2 de 5 |

**Ninguno de los 5 emblemas tiene una fuente sostenible y oficial de precios** que se pueda leer de forma
automática: ni web con precios, ni app con precios, ni PDF. La prensa (sobre todo Última Hora, y ABC para
fechas de vigencia) publica tablas por marca solo en algunas tandas y casi siempre de Shell, Copetrol y
Petrobras. Puma y Petromax aparecen sobre todo con montos de suba, no con precios.

Con esto, la portada de privados encaja mejor como **"últimos cambios reportados"** (precio, fecha de
vigencia y nota de prensa de cada uno, atenuado si es viejo) que como "precios hoy". La decisión es tuya.

## Selección y presencia en Gran Asunción

- Ranking confirmado: [ABC 14/04/2026](https://www.abc.com.py/economia/2026/04/14/estos-son-los-emblemas-que-lideran-el-mercado-de-combustibles-en-el-pais/)
  (abierta). Año 2025, participación en volumen. Shell 18 % (671 millones de litros), Petropar 17 %,
  Petrobras 12 %, Copetrol 10 %, Puma 7 %; Petrosur, Ecop, Inversiones San Isidro y Petromax ~5 % cada uno.
  **Petromax empata con otros tres**: entra por el criterio pedido, no por ser claramente mayor.
- **Conteo de estaciones en Gran Asunción (Asunción + Central): sin dato para las 5 marcas.** No apareció
  ninguna cifra desagregada por marca y departamento. El visor del MIC (https://gis.mic.gov.py/visor/#/dashboard)
  y su mapa de estaciones son apps JS que no se pudieron consultar sin navegador.
- Cifras nacionales encontradas (todas de ámbito nacional; no sirven como dato de Gran Asunción):

  | Marca | Estaciones | Fecha | Fuente |
  |---|---|---|---|
  | Shell | 363 en 110 ciudades | 10/09/2026 | [ViaParaguay](https://viaparaguay.com/en/guias/fuel-stations-paraguay-guide) (guía secundaria, abierta) |
  | Petrobras | 246 | 10/09/2026 | ídem |
  | Copetrol | 387 en 141 ciudades | 10/09/2026 | ídem |
  | Puma | "más de 160" | 14/01/2026 | [La Nación](https://www.lanacion.com.py/negocios/2026/01/14/puma-energy-inaugura-una-nueva-estacion-en-un-punto-estrategico-frente-al-principal-aeropuerto-del-pais/) (contenido patrocinado, abierta) |
  | Petromax | "más de 100" | sin fecha (web 2026) | [petromax.com.py/estaciones](https://petromax.com.py/estaciones/) (abierta) |

- Contexto: Central tenía 585 de 2.270 estaciones (UH, **15/10/2019**) o 990 (ABC 11/07/2022, datos 2021).
  Las dos cifras se contradicen; no usar ninguna.
- No hay datos para afirmar si Petrosur, Ecop, San Isidro o Enex tienen más presencia que Puma o Petromax en
  Gran Asunción. **Pendiente:** abrir el mapa de estaciones del MIC con navegador y filtrar por
  departamento y marca.

## Emblemas

### Shell

- **Operador.** La sociedad es la ex Barcos & Rodados S.A., que pasó a llamarse **Raízen Paraguay S.A.**
  Raízen compró el 50 % en 2021 y es licenciataria de la marca
  ([ABC brandlab 17/11/2021](https://www.abc.com.py/brandlab/2021/11/17/shell-volvio-con-todo/),
  [La Nación 09/01/2024](https://www.lanacion.com.py/negocios/2024/01/09/vivi-el-verano-con-shell-e-itau-disfrutando-del-15-al-20-de-descuento-en-combustibles/), abiertas).
  **Cambio:** Raízen anunció el 20/12/2024 que baja del 50 % a un máximo de 27,4 % en dos años (plazo
  nov-2026) ([AgFeed](https://agfeed.com.br/negocios/raizen-vende-usinas-de-energia-solar-por-r-475-milhoes-e-reduz-participacao-no-paraguai), abierta).
  ABC 14/04/2026 la llama "Shell (antes Barcos & Rodados)". **Sin confirmar:** el porcentaje actual de
  Raízen y quién compró.
- **Dónde publica precios: no encontrado.** https://www.shell.com.py solo devuelve el título (sitio JS); no
  se vieron precios ni términos de uso. No hay app de Shell Paraguay en las tiendas. Instagram
  (https://www.instagram.com/shellparaguay/) se usa para promos. La lista de precios se comunica a operadores
  y a la prensa ("precios sugeridos", La Nación 21/11/2023).
- **Formato / scraping:** no determinado (web JS). Redes: no automatizar; solo confirmación manual.
- **Productos** (desde nov-2021, [La Nación 13/11/2021](https://www.lanacion.com.py/negocios/2021/11/13/shell-desembarco-oficialmente-a-paraguay-sobre-san-martin/)):
  Fórmula Regular, Fórmula Super y V-Power Nafta; Evolux Diésel y V-Power Diésel. En 2026 la prensa dice
  "Nafta Regular / Super". Ninguna fuente da octanaje ni ppm de Shell: la categoría de las naftas y de
  Evolux se infiere del precio. V-Power Diésel: "premium, bajo azufre, para Euro V y VI" (ABC brandlab).
- **Precios actuales:** naftas en [ABC 23/10/2026](https://www.abc.com.py/economia/2026/10/23/sexta-suba-del-gasoil-conozca-que-emblemas-ya-aumentaron-y-cuales-subiran-el-lunes/)
  (abierta): 88 oct. 6.990, 93 oct. 7.490, 97 oct. 9.190 (bajó 100), alcohol 5.290; **sin fecha de
  vigencia propia**. Diésel: solo el monto (+500 a +615 desde el 26/10, ABC 23, 25 y 27/10); no hay precio
  absoluto. fulltanque.net (26/10, colaborativo) da 97 oct. 9.240 (contradice a ABC), diésel 9.490 y
  premium 11.475.

### Petrobras

- **Operador: sin confirmar para 2025-26.** Copetrol (vía Paraguay Energy) compró el 100 % de Petrobras
  Paraguay en marzo de 2019, con licencia de marca por 5 años iniciales
  ([Infonegocios 12/03/2019](https://infonegocios.com.py/y-ademas/el-gigante-de-las-estaciones-de-servicios-en-paraguay), abierta;
  licencia solo en buscador). No hay fuente sobre la renovación de la licencia ni sobre quién opera hoy.
  ABC 14/04/2026 la cuenta como emblema separado de Copetrol.
- **Dónde publica precios: no encontrado.** `petrobras.com.py` no resuelve; no apareció web, app ni redes
  oficiales de Petrobras Paraguay. Solo prensa y fulltanque.
- **Productos 2026** ([UH 03/08/2026](https://www.ultimahora.com/naftas-y-diesel-suben-500-guaranies-en-los-principales-emblemas), abierta):
  Nafta Grid, Súper 97, Diésel Euro 5, Diésel Podium. Podium S10 es "diésel tipo I"
  ([Infonegocios 02/11/2016](https://infonegocios.com.py/y-ademas/en-respuesta-a-la-competencia-petrobras-presenta-el-nuevo-diesel-podium-s10-con-triple-filtrado), abierta).
  "Prix 90" aparece en UH 21/11/2023 y 12/08/2025 pero no en 2026. Grid y Euro 5: categoría inferida.
- **Precios actuales: sin fuente de prensa.** Ajustó el fin de semana del 24-25/10 (ABC 25/10, sin montos).
  UH 26/10 da Euro5 9.490 y Euro6 11.490 (según el informe de estaciones; a releer). fulltanque (26/10):
  6.990 / 7.490 / 9.290 / 9.490 / 11.490.

### Copetrol

- **Operador (confirmado):** Corporación Paraguaya Distribuidora de Derivados de Petróleo S.A., fundada en
  1973 ([ABC 03/11/2023](https://www.abc.com.py/empresariales/2023/11/03/copetrol-celebra-50-anos-comprometido-con-la-excelencia/), abierta;
  ficha de su app en App Store).
- **Dónde publica precios: no.** https://www.copetrol.com.py solo devuelve el título (sitio JS), igual
  `/precios`. App **Copetrol Vamos** ([App Store](https://apps.apple.com/py/app/copetrol-vamos/id6470316445)):
  fidelidad, pago y localizador; la ficha no muestra precios. Términos de uso no leídos.
- **Productos** (ABC 03/11/2023): Standard 90, Supra 95, Suprema 97 (97 octanos, nueva fórmula desde el
  15/07/2022, [Infonegocios](https://infonegocios.com.py/y-ademas/copetrol-lanza-al-mercado-la-nueva-formulacion-tecno-molecular-de-la-nafta-suprema-97-aditivada)),
  Quantum 98 E10, Diésel Go S50, Diésel Élite S10. Los ppm salen solo del nombre.
- **Precios actuales: sin fuente de prensa.** Diésel +500 a +600 (o +615) desde el 26/10 (ABC 23, 25 y 27/10;
  el tope del rango se contradice). fulltanque (26/10): 6.990 / 7.490 / 9.150 / 9.490 / 11.490.

### Puma Energy

- **Operador: sin confirmar para 2025-26.** Vendida en 2019 a Impala Terminals (Trafigura/IFM), que asumió
  en julio de 2020 ([La Nación 06/07/2020](https://www.lanacion.com.py/negocios/2020/07/06/puma-energy-paraguay-ejecutara-ambicioso-plan-de-crecimiento/), abierta).
  Ninguna fuente posterior nombra al dueño.
- **Dónde publica precios: no.** Web institucional https://www.pumaenergy.com/es/where-we-operate/paraguay
  (abierta) sin productos ni precios; `pumaenergy.com.py` no resuelve. App Puma Pris: no hay ficha para
  Paraguay. Redes: no revisadas.
- **Productos:** "Diésel (Tipo III)" y "ION Diésel (Tipo I, premium)"
  ([UH 15/09/2026](https://www.ultimahora.com/se-concretan-nuevas-subas-en-precios-de-combustibles), abierta).
  Naftas: sin nombres vigentes (los únicos, de 2016, no sirven).
- **Precios:** diésel 8.990 e ION 11.100 hacia el 13/09/2026 (UH 15/09; vigencia no explícita). Subió el
  diésel el 27/10 sin monto propio (ABC 27/10). **Sin precio vigente con fuente.** fulltanque (26/10):
  6.990 / 7.490 / 9.240 / 8.990 / 11.100; las naftas son idénticas a las de Petropar (¿copia?) y el diésel es
  anterior a la suba del 27/10.

### Petromax

- **Operador: sin confirmar con fuente fechada.** Imperial Cía. Distribuidora de Petróleo y Derivados S.A.E.,
  controlada por Monte Alegre S.A., según cbonds e informes FIX 2020-22 (solo buscador, PDF no abiertos).
  La web (https://petromax.com.py/nosotros/) no da razón social; sus oficinas están en el Edificio Corp. Alkan,
  Villa Hayes.
- **Dónde publica precios: no.** La web (WordPress) no tiene precios ni términos de uso. Facebook
  (https://www.facebook.com/PetromaxPy/) e Instagram (https://www.instagram.com/petromaxpy/) sin revisar;
  solo para confirmación manual. Sin app. La prensa cita "los carteles de precios".
- **Productos** ([petromax.com.py/combustibles](https://petromax.com.py/combustibles/), abierta): S10
  (diésel tipo I, <10 ppm), S50 (diésel tipo III, <50 ppm), Alcomax (etanol) y "naftas aditivadas PREMIUM"
  sin octanaje.
- **Precios:** diésel tipo III 9.490 y tipo I 11.490 ([ABC 23/10/2026](https://www.abc.com.py/economia/2026/10/23/sexta-suba-del-gasoil-conozca-que-emblemas-ya-aumentaron-y-cuales-subiran-el-lunes/),
  abierta; vigencia anterior al 23/10, sin fecha). Naftas: sin fuente vigente. ABC 02/08 da súper 9.090,
  UH 15/09 dice que las naftas subieron 300 y fulltanque sigue en 9.090: no cierra.

### Agregador: fulltanque.net

https://fulltanque.net/precios tiene una tabla HTML por emblema y categoría, cargada por usuarios ("con foto
y geolocalización"). Sirve como pista, no como fuente: tiene valores que contradicen a la prensa (Shell 97,
naftas de Puma), no tiene términos de uso visibles ni histórico. **No scrapear sin permiso escrito del
editor.**

## Precios actuales encontrados (no cargados)

Solo los que tienen nota de prensa abierta. "a_confirmar" = el valor tiene fuente pero la fecha de vigencia no.

| Emblema | Producto (categoría) | Gs/L | Vigencia | Estado sugerido | Fuente |
|---|---|---|---|---|---|
| Shell | 88 oct. (nafta 88–90) | 6.990 | antes del 23/10/2026 | fecha a_confirmar | ABC 23/10/2026 |
| Shell | 93 oct. (nafta 93–95) | 7.490 | ídem | fecha a_confirmar | ídem |
| Shell | 97 oct. (nafta 97+) | 9.190 | ¿23 o 26/10? | fecha a_confirmar | ídem |
| Petromax | Diésel tipo III (común) | 9.490 | antes del 23/10/2026 | fecha a_confirmar | ídem |
| Petromax | Diésel tipo I (premium) | 11.490 | ídem | fecha a_confirmar | ídem |
| Puma | Diésel tipo III (común) | 8.990 | ~13/09/2026 (ya superado el 27/10) | histórico | UH 15/09/2026 |
| Puma | ION Diésel (premium) | 11.100 | ídem | histórico | ídem |

Sin precio vigente con fuente: el diésel de Shell, todo Copetrol y Petrobras, las naftas de Puma y Petromax.

## Fuentes de histórico (2024-2026)

No existe ninguna serie por emblema descargable. Solo notas de prensa:

| Nota | Medio | Vigencia | Marcas con precio por producto | URL |
|---|---|---|---|---|
| 28/06/2024 | Última Hora | no dice | Shell (Evolux 7.440, V-Power Diésel 9.240) | https://www.ultimahora.com/un-emblema-privado-se-suma-a-la-baja-en-precio-del-diesel |
| 12/08/2025 | Última Hora | 12/08/2025 | Shell, Copetrol, Petrobras (5 productos c/u) | https://www.ultimahora.com/emblemas-bajan-precios-a-niveles-similares-de-petropar |
| 11/03/2026 | Última Hora | 11/03/2026 | Shell, Copetrol | https://www.ultimahora.com/principales-emblemas-privados-aumentan-sus-precios-de-combustible |
| 12/03/2026 | Última Hora | 11/03/2026 | Shell, Copetrol (diésel 6.990 vs 6.900 de la nota anterior: contradicción) | https://www.ultimahora.com/principales-emblemas-privados-suben-precio-de-sus-combustibles |
| 09/04/2026 | Última Hora | 08 o 09/04/2026 | Shell, Copetrol; Petrobras solo premium | https://www.ultimahora.com/combustibles-emblemas-privados-concretaron-otro-reajuste |
| 02/08/2026 | ABC | Petrobras 01/08, Copetrol 02/08, Shell 03/08 | Petromax (súper, diésel); Shell y Petrobras parcial | https://www.abc.com.py/economia/2026/08/02/precios-de-combustibles-emblemas-privados-concretan-la-cuarta-suba-del-ano/ |
| 03/08/2026 | Última Hora | ~02/08/2026 | Copetrol, Petrobras | https://www.ultimahora.com/naftas-y-diesel-suben-500-guaranies-en-los-principales-emblemas |
| 15/09/2026 | Última Hora | ~13-14/09/2026 | Puma y Petromax (diésel) | https://www.ultimahora.com/se-concretan-nuevas-subas-en-precios-de-combustibles |
| 23/10/2026 | ABC | ver arriba | Shell (naftas), Petromax (diésel) | https://www.abc.com.py/economia/2026/10/23/sexta-suba-del-gasoil-conozca-que-emblemas-ya-aumentaron-y-cuales-subiran-el-lunes/ |
| 26/10/2026 | Última Hora | Petrobras 24/10; Shell y Copetrol 26/10 | Petrobras (diésel); Shell y Copetrol solo montos | https://www.ultimahora.com/gasolineras-privadas-completan-el-reajuste-del-diesel-en-todo-el-pais |

Con montos o precios genéricos, sin precio por marca (sirven para fechas de vigencia): UH 08/03/2024;
Surtidores LATAM 30/01/2025; ABC 22, 23 y 24/06/2025; ABC 12/05/2025; UH 08 y 09/03/2026; ABC 03/08/2026;
ABC 14 y 15/09/2026; RDN 14/09/2026; ABC 17/09/2026; Surtidores LATAM 18/09/2026; ABC 25 y 27/10/2026.
Fuera de rango pero útiles: UH 21/11/2023 y La Nación 21/11/2023 (Shell, Copetrol, Petrobras).

**2024: ninguna nota con precios por marca** salvo la de Shell del 28/06. Cobertura de 2026: de seis
tandas, la 1.ª (marzo) y la 3.ª (abril) tienen Shell y Copetrol; la 4.ª (agosto) Copetrol, Petrobras y
Petromax; la 5.ª (septiembre) Puma y Petromax solo diésel; la 6.ª (octubre) parcial. La 2.ª tanda no se
identificó.

Fechas de buscador corregidas al abrir: UH "emblemas-completan-suba-de-naftas" es del 20/07/2024; UH
"emblemas-privados-anuncian-reducciones..." del 21/11/2023; UH "emblemas-deben-clarificar-precios..." del
04/07/2025; UH "emblemas-inician-suba..." del 08/03/2024; UH "puma-reduce-precio-naftas" del 19/09/2016;
UH "combustibles-semana-clave..." del 09/03/2026. La ABC 02/08/2026 no trae los precios de Shell que le
atribuía el relevamiento anterior.

## Equivalencias (`data/equivalencias.csv`)

El CSV tiene solo lo que la fuente respalda (octanaje, ppm o "tipo I/III" dichos por la marca o la nota).
Quedan **fuera, por inferidas** (la categoría sale solo del orden de precios): Shell Regular, Super,
V-Power Nafta y Evolux; Petrobras Nafta Grid, Diésel Euro 5 y Prix 90; las naftas de Puma y Petromax.
Copetrol Go S50 y Élite S10 entran porque la categoría sale del nombre (S50 / S10 = ppm de azufre), lo que
también es inferencia; están marcadas en la columna fuente. Quantum 98 E10 (Copetrol): falta decidir si va en
"nafta 97+" o aparte.

## Pendientes

1. Abrir con navegador shell.com.py, copetrol.com.py y el mapa de estaciones del MIC (conteo en Gran Asunción).
2. Revisar a mano redes de Petromax, Puma, Shell, Copetrol y Petrobras: si publican pizarras, sirven como
   confirmación manual (nunca automatizada).
3. Pedido de acceso a la información al MIC (Dirección General de Combustibles): precios minoristas por emblema.
4. Pedir a fulltanque.net permiso y términos de uso, si se lo quiere usar.
5. Confirmar dueño actual de Shell (Raízen), Petrobras (licencia) y Puma; razón social de Petromax.
