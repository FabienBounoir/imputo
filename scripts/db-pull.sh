#!/bin/sh
# Récupère un dump de la base OpenShift (prod ou preprod) et le restaure dans la destination :
# le conteneur Postgres local du docker-compose (imputo-db, défaut) ou un namespace OpenShift.
# Écrase la base de destination.
# Usage : npm run db:pull:prod | npm run db:pull:preprod | npm run db:copy:prod-to-preprod
set -eu

SRC="${1:?usage: db-pull.sh <prod|preprod> [local|preprod]}"
DEST="${2:-local}"

ns_of() {
  case "$1" in
    prod) echo "${OPENSHIFT_NAMESPACE_PROD:-imputo}" ;;
    preprod) echo "${OPENSHIFT_NAMESPACE_PREPROD:-imputo-preprod}" ;;
    *) echo "usage: db-pull.sh <prod|preprod> [local|preprod]" >&2; exit 1 ;;
  esac
}

db_pod() {
  pod="$(oc get pod -n "$1" -l app=imputo-db -o jsonpath='{.items[0].metadata.name}')"
  [ -n "$pod" ] || { echo "Pod imputo-db introuvable dans le namespace $1" >&2; exit 1; }
  echo "$pod"
}

# ponytail: la prod n'est jamais une destination, volontairement non paramétrable.
case "$DEST" in
  local|preprod) ;;
  *) echo "destination invalide : $DEST (local|preprod)" >&2; exit 1 ;;
esac
[ "$SRC" != "$DEST" ] || { echo "source et destination identiques" >&2; exit 1; }

command -v oc >/dev/null || { echo "oc CLI introuvable" >&2; exit 1; }
oc whoami >/dev/null 2>&1 || { echo "Pas connecté : lancer 'oc login' d'abord" >&2; exit 1; }

SRC_NS="$(ns_of "$SRC")"
if [ "$DEST" = local ]; then
  command -v docker >/dev/null || { echo "docker CLI introuvable" >&2; exit 1; }
  docker inspect imputo-db >/dev/null 2>&1 || { echo "Conteneur local imputo-db absent : lancer 'docker compose up -d db' d'abord" >&2; exit 1; }
else
  DEST_NS="$(ns_of "$DEST")"
  DEST_POD="$(db_pod "$DEST_NS")"
  echo "⚠  Écrase DÉFINITIVEMENT la base $DEST_NS/$DEST_POD ($(oc whoami --show-server)) avec les données de $SRC."
  printf '   Taper le nom du namespace pour confirmer : '
  read -r confirm
  [ "$confirm" = "$DEST_NS" ] || { echo "Annulé." >&2; exit 1; }
fi

SRC_POD="$(db_pod "$SRC_NS")"
echo "→ Dump de $SRC_NS/$SRC_POD (lecture seule, aucune écriture)..."
DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT
oc exec -n "$SRC_NS" "$SRC_POD" -- sh -c 'pg_dump -U "$POSTGRESQL_USER" --clean --if-exists "$POSTGRESQL_DATABASE"' > "$DUMP"

# Table rase avant restauration : le --clean du dump ne sait détruire que ce qui existe à la source.
# Une destination portant des migrations en avance garde des tables inconnues de la source, dont
# les contraintes bloquent le DROP des tables qu'elles référencent.
RESET='drop schema public cascade; drop schema if exists drizzle cascade; create schema public;'
if [ "$DEST" = local ]; then
  echo "→ Restauration dans le conteneur local imputo-db (écrase la base locale)..."
  docker exec -i imputo-db psql -U imputo -d imputo -v ON_ERROR_STOP=1 -c "$RESET" >/dev/null
  docker exec -i imputo-db psql -U imputo -d imputo -v ON_ERROR_STOP=1 < "$DUMP" >/dev/null
else
  PSQL='psql -U "$POSTGRESQL_USER" -d "$POSTGRESQL_DATABASE" -v ON_ERROR_STOP=1'
  echo "→ Restauration dans $DEST_NS/$DEST_POD (écrase la base $DEST)..."
  printf '%s\n' "$RESET" | oc exec -i -n "$DEST_NS" "$DEST_POD" -- sh -c "$PSQL" >/dev/null
  oc exec -i -n "$DEST_NS" "$DEST_POD" -- sh -c "$PSQL" < "$DUMP" >/dev/null
  # L'app ne migre qu'au boot (Dockerfile → migrate.js) : sans redémarrage elle tourne sur le
  # schéma de la source. Strategy Recreate, donc pas de second pod ni de pic de quota.
  echo "→ Redémarrage de l'app $DEST_NS (rejoue les migrations en attente)..."
  oc rollout restart deployment/imputo -n "$DEST_NS" >/dev/null
  oc rollout status deployment/imputo -n "$DEST_NS" --timeout=5m
fi

echo "✓ Base $DEST à jour avec les données de $SRC."
