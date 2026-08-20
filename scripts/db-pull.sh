#!/bin/sh
# Récupère un dump de la base OpenShift (prod ou preprod) et le restaure dans le conteneur
# Postgres local du docker-compose (imputo-db). Écrase la base locale.
# Usage : npm run db:pull:prod | npm run db:pull:preprod
set -eu

ENV="${1:?usage: db-pull.sh <prod|preprod>}"
case "$ENV" in
  prod) NS="${OPENSHIFT_NAMESPACE_PROD:-imputo}" ;;
  preprod) NS="${OPENSHIFT_NAMESPACE_PREPROD:-imputo-preprod}" ;;
  *) echo "usage: db-pull.sh <prod|preprod>" >&2; exit 1 ;;
esac

command -v oc >/dev/null || { echo "oc CLI introuvable" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker CLI introuvable" >&2; exit 1; }
oc whoami >/dev/null 2>&1 || { echo "Pas connecté : lancer 'oc login' d'abord" >&2; exit 1; }
docker inspect imputo-db >/dev/null 2>&1 || { echo "Conteneur local imputo-db absent : lancer 'docker compose up -d db' d'abord" >&2; exit 1; }

POD="$(oc get pod -n "$NS" -l app=imputo-db -o jsonpath='{.items[0].metadata.name}')"
[ -n "$POD" ] || { echo "Pod imputo-db introuvable dans le namespace $NS" >&2; exit 1; }

echo "→ Dump de $NS/$POD (prod → lecture seule, aucune écriture)..."
DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT
oc exec -n "$NS" "$POD" -- sh -c 'pg_dump -U "$POSTGRESQL_USER" --clean --if-exists "$POSTGRESQL_DATABASE"' > "$DUMP"

echo "→ Restauration dans le conteneur local imputo-db (écrase la base locale)..."
# Table rase avant restauration : le --clean du dump ne sait détruire que ce qui existe en prod.
# Depuis une branche portant des migrations en avance, les tables locales inconnues de la prod
# survivent et leurs contraintes bloquent le DROP des tables qu'elles référencent.
docker exec -i imputo-db psql -U imputo -d imputo -v ON_ERROR_STOP=1 \
  -c 'drop schema public cascade; drop schema if exists drizzle cascade; create schema public;' >/dev/null
docker exec -i imputo-db psql -U imputo -d imputo -v ON_ERROR_STOP=1 < "$DUMP" >/dev/null

echo "✓ Base locale imputo-db à jour avec les données de $ENV."
