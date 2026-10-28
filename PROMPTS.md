# Prompts para pegar en Claude Code (en orden)

## 1. Plan (sin escribir código todavía)
Leé SPEC.md y CLAUDE.md. Proponé un plan por etapas (modelo de datos, ETL, tests, workflows, sitio) y la estructura de carpetas. Hacé las preguntas que necesites antes de empezar.

## 2. Datos
Migrá data/raw/petropar_precios_v0.csv al modelo largo de SPEC.md (productos, precios_petropar, presidentes, eventos) sin perder estado ni fuente. Después usá el agente data-historian para investigar las filas con estado derivado, planilla o a_confirmar y mostrame lo que encuentre antes de incorporarlo.

## 3. ETL + tests
Implementá etl/scrape_petropar.py, etl/fetch_oil.py y etl/build_site_data.py con sus tests según SPEC.md. Corré el scraper contra la página real y mostrame los precios que detecta.

## 4. Workflows
Creá los workflows de GitHub Actions de SPEC.md. El scraper abre un PR, nunca hace push a main.

## 5. Sitio
Usá el agente frontend-builder para construir site/ según SPEC.md, tomando data/referencia_grafico.png como referencia visual.

## 6. Revisión
Usá el agente reviewer para revisar todo contra SPEC.md. Corregí los bloqueantes e importantes y volvé a pedir revisión.

## 7. Publicar
Escribí el README, hacé commit y push a GitHub.
