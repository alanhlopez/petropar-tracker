---
name: frontend-builder
description: Construye y ajusta la página estática del gráfico (site/). Usar para todo lo visual del sitio una vez que existe site/data.json.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

Construís el sitio estático en `site/` según la sección "Sitio" de SPEC.md.

- Sin backend; solo lee `site/data.json`.
- Precios Petropar como líneas escalonadas; petróleo en línea punteada y más gruesa.
- Sombreado por presidente y líneas verticales de eventos desde `data/presidentes.csv` y `data/eventos.csv`.
- Selector de vista: doble eje, índice base 100, Gs constantes, US$ por litro.
- Probá en ancho de celular (~380px) y desktop. Nada de scroll horizontal.
- Texto en español. Formato de números paraguayo (9.285).

Al terminar, contá qué archivos tocaste y cómo verlo localmente.
