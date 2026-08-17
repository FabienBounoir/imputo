#!/bin/sh
# Récupère un dump de la base OpenShift (prod ou preprod).
# Sans 3e argument : restaure dans le conteneur Postgres local du docker-compose (imputo-db), écrase la base locale.
# Avec --backup[=fichier] : écrit juste le dump sur disque, ne touche à rien.
# Avec --to=preprod (source doit être prod) : restaure directement dans le pod preprod, écrase la base preprod.
# Usage : npm run db:pull:prod | npm run db:pull:preprod
#         ./scripts/db-pull.sh prod --backup=/chemin/vers/fichier.dump
#         ./scripts/db-pull.sh prod --to=preprod
set -eu

USAGE="usage: db-pull.sh <prod|preprod> [--backup[=fichier]|--to=preprod]"
ENV="${1:?$USAGE}"
case "$ENV" in
  prod) NS="${OPENSHIFT_NAMESPACE_PROD:-imputo}" ;;
  preprod) NS="${OPENSHIFT_NAMESPACE_PREPROD:-imputo-preprod}" ;;
  *) echo "$USAGE" >&2; exit 1 ;;
esac

MODE_ARG="${2:-}"
BACKUP_FILE=""
TO_ENV=""
case "$MODE_ARG" in
  --backup=*) BACKUP_FILE="${MODE_ARG#--backup=}" ;;
  --backup) BACKUP_FILE="$HOME/backups/imputo/imputo-$ENV-$(date +%Y%m%d-%H%M%S).dump" ;;
  --to=preprod) TO_ENV="preprod" ;;
  "") ;;
  *) echo "$USAGE" >&2; exit 1 ;;
esac
[ "$TO_ENV" = "preprod" ] && [ "$ENV" != "prod" ] && { echo "--to=preprod n'est autorisé qu'en source prod" >&2; exit 1; }

command -v oc >/dev/null || { echo "oc CLI introuvable" >&2; exit 1; }
oc whoami >/dev/null 2>&1 || { echo "Pas connecté : lancer 'oc login' d'abord" >&2; exit 1; }
if [ -z "$BACKUP_FILE" ] && [ -z "$TO_ENV" ]; then
  command -v docker >/dev/null || { echo "docker CLI introuvable" >&2; exit 1; }
  docker inspect imputo-db >/dev/null 2>&1 || { echo "Conteneur local imputo-db absent : lancer 'docker compose up -d db' d'abord" >&2; exit 1; }
fi

get_pod() {
  oc get pod -n "$1" -l app=imputo-db -o jsonpath='{.items[0].metadata.name}'
}

POD="$(get_pod "$NS")"
[ -n "$POD" ] || { echo "Pod imputo-db introuvable dans le namespace $NS" >&2; exit 1; }

echo "→ Dump de $NS/$POD (prod → lecture seule, aucune écriture)..."
DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT
oc exec -n "$NS" "$POD" -- sh -c 'pg_dump -U "$POSTGRESQL_USER" --clean --if-exists "$POSTGRESQL_DATABASE"' > "$DUMP"

if [ -n "$BACKUP_FILE" ]; then
  mkdir -p "$(dirname "$BACKUP_FILE")"
  cp "$DUMP" "$BACKUP_FILE"
  echo "✓ Backup de $ENV écrit dans $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))."
elif [ "$TO_ENV" = "preprod" ]; then
  NS_PREPROD="${OPENSHIFT_NAMESPACE_PREPROD:-imputo-preprod}"
  POD_PREPROD="$(get_pod "$NS_PREPROD")"
  [ -n "$POD_PREPROD" ] || { echo "Pod imputo-db introuvable dans le namespace $NS_PREPROD" >&2; exit 1; }
  echo "→ Restauration dans $NS_PREPROD/$POD_PREPROD (écrase la base preprod)..."
  oc exec -i -n "$NS_PREPROD" "$POD_PREPROD" -- sh -c 'psql -U "$POSTGRESQL_USER" -v ON_ERROR_STOP=1 -d "$POSTGRESQL_DATABASE"' < "$DUMP" >/dev/null
  echo "✓ Preprod à jour avec les données de prod."
else
  echo "→ Restauration dans le conteneur local imputo-db (écrase la base locale)..."
  docker exec -i imputo-db psql -U imputo -d imputo -v ON_ERROR_STOP=1 < "$DUMP" >/dev/null
  echo "✓ Base locale imputo-db à jour avec les données de $ENV."
fi
