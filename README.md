# Petropar tracker

Serie histórica de los precios de surtidor de Petropar (desde 2009-01-02) comparada con el
petróleo Brent y el diésel ULSD, sombreada por período presidencial. Se actualiza sola: un
scraper revisa la página de Petropar cada 6 h y, si hay cambio, abre un Pull Request que una
persona aprueba antes de publicar.

La especificación completa (fuentes, modelo de datos, reglas) está en [SPEC.md](SPEC.md).

## Estructura

| Carpeta | Qué hay |
|---|---|
| `data/raw/` | Fuentes originales congeladas (solo lectura; los tests verifican sus hashes) |
| `data/` | Histórico vigente (`precios_petropar.csv`), productos, presidentes, eventos, petróleo |
| `data/capturas/` | HTML de Petropar guardado en cada cambio de precio (auditoría) |
| `etl/` | Scraper, descarga de la EIA, armado de `site/data.json`, imagen para compartir (`og_image.py`), avisos por issues |
| `site/` | Página estática (D3) que lee `site/data.json` |
| `tests/` | pytest, sin red (fixtures HTML reales y respuestas simuladas de la EIA) |
| `.github/workflows/` | Automatización (ver abajo) |

## Correr local

Requiere Python 3.12 y `pdftotext` (poppler) para el test del documento oficial.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
brew install poppler            # o: sudo apt-get install poppler-utils

.venv/bin/python -m pytest -q                                   # tests
.venv/bin/python -m etl.scrape_petropar --sin-escribir          # scraper contra la página real, sin tocar data/
EIA_API_KEY=... .venv/bin/python -m etl.fetch_oil               # petróleo (incremental)
.venv/bin/python -m etl.build_site_data                         # regenera site/data.json

cd site && python3 -m http.server 8000                          # ver el sitio en http://localhost:8000
```

Sin `--sin-escribir`, el scraper agrega filas a `data/precios_petropar.csv` (nunca reescribe las
existentes) y guarda la captura en `data/capturas/`. El resumen de cada corrida queda en
`resumen_scraper.json`.

## Automatización (GitHub Actions)

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `scrape.yml` | cada 6 h | Scraper. Si hay cambio corre pytest y abre un PR en `precios/<clave>`. Nunca hace push a main. |
| `oil.yml` | diario | Datos de la EIA; commit directo a main de `petroleo.csv` y `site/data.json`. |
| `sitio.yml` | push a main que toca `data/*.csv` | Regenera y commitea `site/data.json` (p. ej. al aprobar un PR de precios). |
| `frescura.yml` | cada 3 h | Si `scrape.yml` no tuvo una corrida exitosa en 24 h, abre un issue `scraper-roto`. |
| `tests.yml` | push y PR | pytest. |

Avisos por issues de GitHub (sin correo): `scraper-roto`, `precio-nuevo` (con link al PR) y
`revisar` (reglas de plausibilidad). Hay un solo issue abierto por etiqueta y la misma alerta no
se repite; `scraper-roto` se cierra solo cuando el scraper vuelve a andar. El HTML descargado
queda como artifact de cada corrida.

### Configuración necesaria en GitHub

- Secret **`EIA_API_KEY`**: clave gratuita de https://www.eia.gov/opendata/register.php.
- *Settings → Actions → General → Workflow permissions*: activar **"Allow GitHub Actions to
  create and approve pull requests"** (si no, el scraper no puede abrir el PR). También por API:
  `gh api -X PUT repos/<dueño>/<repo>/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
- Nada más: `GITHUB_TOKEN` alcanza para PRs, issues y commits.

Nota: en los PR que abre el scraper con `GITHUB_TOKEN`, `tests.yml` no llega a correr (GitHub
muestra una corrida en rojo sin jobs que no indica tests fallidos); por eso `scrape.yml` corre
pytest antes de abrirlos.

## Cómo aprobar un PR de precios

1. Llega el issue `precio-nuevo` con el link al PR (y `revisar` si alguna regla saltó).
2. En el PR, comparar la tabla de filas nuevas con la página de Petropar
   (https://www.petropar.gov.py/?page_id=4460) y con la captura en `data/capturas/`.
3. Revisar las alertas, si las hay. Las más comunes:
   - `vigencia_vieja` / `vigencia_lejana`: Petropar no actualizó la fecha de vigencia; la fila
     entra con `fecha_estado = a_confirmar`. Si se conoce la fecha real (por prensa), corregirla
     después como corrección aprobada registrada en `data/correcciones_capturas.csv`.
   - `conflicto_historico`: la página publica un precio "vigente desde" una fecha en la que el
     histórico (p. ej. el documento oficial) tiene otro. No aprobar a ciegas: revisar la fuente y,
     si se aprueba igual, anotar el conflicto en la fila (corrección aprobada registrada en
     `data/correcciones_capturas.csv`).
   - `fecha_ajustada`: dos cambios seguidos antes de que rija el anterior; la fecha se corrió al
     día siguiente del último registro, `a_confirmar`.
   - `vigencia_discrepante`: sin cambio de precio, pero la página publica otra vigencia que la del
     histórico; solo informativo.
   - `variacion`, `orden`, `rango`, `multiplo_5`, `control_cruzado`: posible error de carga en
     la página; verificar antes de aprobar.
4. Si está bien: **Merge**. `sitio.yml` regenera `site/data.json` y el sitio se actualiza.
   Si está mal: cerrar el PR sin mergear (la misma propuesta no se vuelve a abrir) y corregir a
   mano si hace falta.
5. `precio-nuevo` se cierra solo cuando no quedan PRs de precios abiertos, y `revisar` cuando
   además una corrida sale sin alertas. Se pueden cerrar a mano antes.

Hay un solo PR de precios abierto a la vez: si Petropar cambia de nuevo mientras uno espera, el
cambio se avisa en el issue `precio-nuevo` y se propone en un PR nuevo apenas se mergee o cierre
el pendiente. Un PR cerrado sin mergear no se vuelve a abrir para el mismo cambio.

Ojo al rechazar: el scraper compara contra main, así que mientras Petropar siga publicando ese
precio lo va a seguir detectando como cambio (el issue `precio-nuevo` queda abierto) y lo va a
volver a incluir si después cambia otro producto. Si la página está mal, avisar a Petropar; si
el precio es correcto pero la fecha no, conviene mergear y corregir la fecha después como
corrección aprobada.

Reglas que no se negocian (ver CLAUDE.md): nunca inventar ni completar precios (sin fuente va
`a_confirmar`), no reescribir filas existentes salvo corrección aprobada y registrada, y
`data/raw/` no se edita.

## Publicación (Vercel)

El sitio es estático y no tiene paso de build: Vercel solo sirve la carpeta `site/`.

1. Entrar a https://vercel.com/signup y elegir **Continue with GitHub** (plan Hobby, gratis;
   alcanza para un repo privado de una cuenta personal).
2. En el panel: **Add New… → Project**.
3. En *Import Git Repository*, si `petropar-tracker` no aparece: **Adjust GitHub App
   Permissions** → *Only select repositories* → elegir `alanhlopez/petropar-tracker` → **Save**.
   Volver a Vercel y tocar **Import** junto al repo.
4. En *Configure Project*:
   - **Project Name**: define la URL. El proyecto actual se llama `combuspy-tracker` →
     https://combuspy-tracker.vercel.app (si se cambia, actualizar la variable `SITIO_URL`,
     ver abajo).
   - **Framework Preset**: `Other`.
   - **Root Directory**: **Edit** → elegir `site` → **Continue**. **Obligatorio**: con la raíz
     del repo se publicarían `data/raw/` (el PDF de la AIP), los CSV, los workflows y todo lo demás.
   - **Build and Output Settings**: dejar todo vacío/por defecto (sin *Build Command*, sin
     *Install Command*; el *Output Directory* es la propia carpeta `site`).
   - **Environment Variables**: ninguna. Si Vercel muestra una fila vacía, borrarla con **−**.
     La `EIA_API_KEY` va solo en los secrets de GitHub Actions, nunca en Vercel.
5. **Deploy**. Al minuto da la URL de producción.
6. **Verificar** el deploy:
   - la URL carga el gráfico y muestra "Datos al …" con la fecha esperada;
   - `https://<url>/data/raw/` devuelve **404** (prueba de que el *Root Directory* es `site`):
     `curl -s -o /dev/null -w '%{http_code}\n' https://combuspy-tracker.vercel.app/data/raw/`
7. Recomendado, en **Settings** del proyecto:
   - *Git → Production Branch*: `main` (ya viene así).
   - *Build and Deployment → Root Directory*: activar **Skip deployments when there are no
     changes to the root directory or its dependencies**, para no redesplegar con commits que
     no tocan `site/`.
   - *Deployment Protection*: dejar *Vercel Authentication* solo para las **Preview
     Deployments** (la producción tiene que ser pública para compartirla).
8. Opcional: *Settings → Domains* para un dominio propio.

Qué pasa después, sin tocar nada:

- Cada push a main que cambie `site/` publica en producción: los commits diarios de `oil.yml`,
  los de `sitio.yml` al aprobar un PR de precios y los cambios de código.
- Los PR del scraper no tocan `site/`, así que no generan preview; el sitio se actualiza cuando
  se mergean y `sitio.yml` regenera `data.json`.
- Si un deploy falla, Vercel lo marca en el commit de GitHub y manda un correo a la cuenta.
- `frescura.yml` compara el `data.json` publicado con el de main: si el publicado tiene más de
  48 h de atraso, abre un issue `deploy-atrasado` (aviso de que Vercel dejó de desplegar). La URL
  sale de la variable del repo `SITIO_URL` (por defecto https://combuspy-tracker.vercel.app).

### Riesgo: commits del bot y plan Hobby

**Estado actual: el repo es público, así que esto no aplica** (se hizo público el 28/10/2026
justamente por esto: con el repo privado, Vercel bloqueaba hasta los commits locales, porque salían
con un email que GitHub no asocia a la cuenta).

Los commits de `oil.yml` y `sitio.yml` los hace `github-actions[bot]`. En el plan Hobby con repo
privado, Vercel bloquea los deploys de commits cuyo autor no es el dueño de la cuenta. Si el repo
vuelve a ser privado, verificarlo con el primer commit automático en *Vercel → Deployments* (o en
el commit en GitHub: el check "Vercel" dice "Deployment was blocked"). Las salidas, en orden de
preferencia:

1. **Hacer el repo público** (Settings → General → Danger Zone → Change visibility). No hay
   secrets en el código y los datos son públicos.
2. **Commitear con la cuenta del dueño**: crear las variables del repo `GIT_AUTHOR_NAME` y
   `GIT_AUTHOR_EMAIL` (Settings → Secrets and variables → Actions → *Variables*) y usarlas en
   `oil.yml` y `sitio.yml` en lugar de `github-actions[bot]`:
   `git config user.name "${{ vars.GIT_AUTHOR_NAME }}"` y lo mismo con el email. No hardcodear
   el email en el repo.
3. **Deploy Hook** (ya implementado, desactivado): en Vercel, *Settings → Git → Deploy Hooks* →
   crear uno para la rama `main`, y guardar su URL como secret del repo `VERCEL_DEPLOY_HOOK`.
   Con el secret cargado, `oil.yml` y `sitio.yml` lo llaman después de cada commit; sin el
   secret, ese paso se saltea.
