# Petropar tracker

Leer SPEC.md antes de cualquier tarea: es la definición de terminado.

- Responder y comentar en español.
- Python 3.12, dependencias en requirements.txt. Tests: `pytest -q`.
- Nunca inventar ni completar precios. Un precio sin fuente va con estado `a_confirmar`.
- El scraper nunca escribe directo en main: siempre vía Pull Request.
- `data/raw/petropar_precios_v0.csv` es el histórico original curado a mano: congelado, de solo lectura, nunca se edita.
- `data/precios_petropar.csv` es el histórico vigente: no reescribir filas existentes, solo agregar (o corregir con aprobación explícita).
- Gráficos: nada de colores arcoíris (= gradientes de tono para una sola variable; la paleta categórica de 5 colores de la referencia está bien); petróleo siempre en línea punteada; precios Petropar como líneas escalonadas (step-after).
