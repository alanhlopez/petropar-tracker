#!/usr/bin/env bash
# Corre el scraper de Petropar desde esta máquina y abre el PR de precios igual que scrape.yml.
# Para cuando GitHub Actions no llega a petropar.gov.py (ConnectTimeout desde los runners).
#
# Trabaja sobre una copia temporal de origin/main (git worktree): no toca tu rama ni tus cambios.
# Nunca hace push a main: si hay precios nuevos, sube una rama precios/<clave> y abre un PR.
#
# Uso:   scripts/scrape_local.sh            # corrida real (PR si hay cambio + avisos en issues)
#        scripts/scrape_local.sh --prueba   # solo muestra qué haría: no escribe, no sube, no toca issues
# Requiere: .venv con requirements.txt y gh autenticado (gh auth status).
set -euo pipefail

PRUEBA=false
[ "${1:-}" = "--prueba" ] && PRUEBA=true

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY="$REPO/.venv/bin/python"
[ -x "$PY" ] || { echo "Falta $PY (ver README, \"Correr local\")" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh no está autenticado: correr 'gh auth login'" >&2; exit 1; }

git -C "$REPO" fetch -q origin main
WT="$(mktemp -d)/petropar-main"
git -C "$REPO" worktree add -q --detach "$WT" origin/main
trap 'git -C "$REPO" worktree remove --force "$WT"' EXIT
cd "$WT"

RUN_URL="$(gh repo view --json url --jq .url) (corrida local, $(date -u +%Y-%m-%dT%H:%MZ))"

if $PRUEBA; then
  "$PY" -m etl.scrape_petropar --sin-escribir --resumen resumen_scraper.json
  echo "Prueba: no se escribió nada, no se abrió PR ni se tocaron issues."
  exit 0
fi

estado=0
"$PY" -m etl.scrape_petropar --resumen resumen_scraper.json --artefactos artefactos_scraper || estado=$?
cp resumen_scraper.json "$REPO/resumen_scraper.json" # queda a mano para revisar (está en .gitignore)

PR_URL=""; PENDIENTE=""
if [ "$estado" = 0 ] && [ "$(jq -r .cambio resumen_scraper.json)" = true ]; then
  "$PY" -m pytest -q
  CLAVE="$(jq -r .clave_cambio resumen_scraper.json)"
  rama="precios/$CLAVE"
  # misma lógica que scrape.yml: no duplicar un PR ya propuesto ni abrir dos PRs de precios a la vez
  previo=$(gh pr list --state all --label precio-nuevo --limit 200 \
    --json headRefName,state,url,createdAt \
    --jq "[.[] | select(.headRefName == \"$rama\" or (.headRefName | startswith(\"$rama-\")))]
          | sort_by(.createdAt) | last // empty")
  abierto=$(gh pr list --label precio-nuevo --state open --json url --jq '.[0].url // empty')
  case "$(jq -r '.state // empty' <<< "$previo")" in
    OPEN|CLOSED) echo "Ya hay un PR para $rama: no se abre otro."; PR_URL=$(jq -r .url <<< "$previo") ;;
    *)
      [ "$(jq -r '.state // empty' <<< "$previo")" = MERGED ] && rama="precios/$CLAVE-$(date -u +%Y%m%d%H%M)"
      if [ -n "$abierto" ]; then
        echo "Hay un PR de precios sin resolver ($abierto): este cambio se propone después."
        PR_URL="$abierto"; PENDIENTE="--pr-pendiente"
      else
        "$PY" -m etl.avisos pr --resumen resumen_scraper.json --run-url "$RUN_URL" > cuerpo_pr.md
        # autor: tu dirección noreply de GitHub (no la del sistema)
        login=$(gh api user --jq .login); id=$(gh api user --jq .id)
        git switch -q -c "$rama"
        git add data/precios_petropar.csv data/capturas/
        git -c user.name="$login" -c user.email="$id+$login@users.noreply.github.com" \
          commit -q -m "Precios Petropar: captura $(jq -r .captured_at resumen_scraper.json) (corrida local)"
        git push -q origin "$rama"
        "$PY" -m etl.avisos etiquetas
        etiquetas="precio-nuevo"
        [ "$(jq -r .revisar resumen_scraper.json)" = true ] && etiquetas="precio-nuevo,revisar"
        PR_URL=$(gh pr create --base main --head "$rama" --label "$etiquetas" \
          --title "Precios Petropar: $(jq -r '[.filas_nuevas[].product_id] | join(", ")' resumen_scraper.json)" \
          --body-file cuerpo_pr.md)
        echo "PR abierto: $PR_URL"
      fi ;;
  esac
fi

"$PY" -m etl.avisos scraper --resumen resumen_scraper.json --run-url "$RUN_URL" --pr-url "$PR_URL" $PENDIENTE
[ "$estado" = 0 ] && echo "Listo: scraper OK." || echo "El scraper falló (ver $REPO/resumen_scraper.json)." >&2
exit "$estado"
