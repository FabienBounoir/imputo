#!/usr/bin/env bash
# Suit les ressources pendant un run de charge : connexions Postgres actives (vs pool `max: 20`
# dans connection.ts) + CPU/mémoire des pods app et db (vs les limites OpenShift, cf.
# openshift/deployment.yaml et openshift/db-statefulset.yaml) — c'est le suspect n°1 pour un
# plafond de débit à 50-150 VUs, cf. loadtest/README.md.
#
# Usage : loadtest/scripts/watch-resources.sh [namespace] [interval_seconds]
# Arrêt : Ctrl+C. Écrit loadtest/results/resources-<timestamp>.csv (gitignored).
set -euo pipefail

NAMESPACE="${1:-imputo-preprod}"
INTERVAL="${2:-5}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/results"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/resources-$(date +%Y%m%d-%H%M%S).csv"

DB_POD="imputo-db-0"

echo "timestamp,pg_active_connections,app_cpu,app_mem,db_cpu,db_mem" > "$OUT_FILE"
echo "Suivi des ressources sur '$NAMESPACE' toutes les ${INTERVAL}s -> $OUT_FILE (Ctrl+C pour arrêter)"

while true; do
	ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	pg_conn="$(oc exec -n "$NAMESPACE" "$DB_POD" -- psql -U imputo -d imputo -t -c "select count(*) from pg_stat_activity;" 2>/dev/null | tr -d ' \n')"

	# `oc adm top pod` : "NAME CPU(cores) MEMORY(bytes)", ex. "imputo-5db477b49-abcde 120m 512Mi".
	# Le nom du pod app change à chaque déploiement (suffixe de ReplicaSet) — on l'identifie en
	# excluant les pods de build/cron/seed/tools plutôt qu'en le figer. Plusieurs replicas possibles
	# (cf. test à 2 replicas) : on somme le CPU/mémoire de tous les pods app trouvés plutôt que de ne
	# garder que le premier, sinon la comparaison 1 vs N replicas serait faussée.
	app_lines="$(oc adm top pod -n "$NAMESPACE" --no-headers 2>/dev/null | grep -E '^imputo-[0-9a-f]+-' | grep -v -E 'build|cron|seed|tools')"
	db_line="$(oc adm top pod -n "$NAMESPACE" --no-headers 2>/dev/null | grep "^$DB_POD ")"

	app_cpu="$(echo "$app_lines" | awk '{gsub(/m/,"",$2); sum+=$2} END{print sum "m"}')"
	app_mem="$(echo "$app_lines" | awk '{gsub(/Mi/,"",$3); sum+=$3} END{print sum "Mi"}')"
	db_cpu="$(echo "$db_line" | awk '{print $2}')"
	db_mem="$(echo "$db_line" | awk '{print $3}')"

	echo "$ts,$pg_conn,$app_cpu,$app_mem,$db_cpu,$db_mem" >> "$OUT_FILE"
	sleep "$INTERVAL"
done
