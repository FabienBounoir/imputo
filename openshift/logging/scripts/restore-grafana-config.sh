#!/usr/bin/env bash
# Reconstruit tout ce qui n'est PAS file-provisioned dans Grafana (contact points, politique de
# routage, règles d'alerte, playlists, Service Account d'annotations) — à lancer après une perte du
# PVC grafana-data, ou pour vérifier/réparer un état qui aurait dérivé.
#
# Aucun secret dans ce fichier ni dans git : les URLs de webhook Teams sont lues depuis les secrets
# Kubernetes `teams-webhook`/`teams-webhook-prod` (namespace imputo-logs), jamais en dur. Prérequis :
# ces deux secrets doivent déjà exister — voir README.md "Alerting -> Microsoft Teams" pour les
# créer si ce n'est pas encore fait (ils viennent d'un webhook Teams, pas reconstructibles depuis
# le cluster seul).
#
# Usage : oc login sur le cluster, puis `./restore-grafana-config.sh`
set -euo pipefail

NS="imputo-logs"
PF_PORT=3300

echo "== Vérification des secrets requis =="
for secret in teams-webhook teams-webhook-prod grafana-admin; do
  oc get secret "$secret" -n "$NS" >/dev/null 2>&1 || {
    echo "Secret '$secret' manquant dans $NS — voir README.md pour le créer avant de continuer." >&2
    exit 1
  }
done

GRAFANA_PW=$(oc get secret grafana-admin -n "$NS" -o jsonpath='{.data.GF_SECURITY_ADMIN_PASSWORD}' | base64 -d)
TEAMS_URL=$(oc get secret teams-webhook -n "$NS" -o jsonpath='{.data.url}' | base64 -d)
TEAMS_URL_PROD=$(oc get secret teams-webhook-prod -n "$NS" -o jsonpath='{.data.url}' | base64 -d)

echo "== Port-forward vers Grafana =="
oc port-forward -n "$NS" svc/grafana "${PF_PORT}:3000" >/tmp/grafana-restore-pf.log 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 20); do
  curl -s -o /dev/null "http://localhost:${PF_PORT}/api/health" && break
  sleep 1
done

GRAFANA="http://localhost:${PF_PORT}"
AUTH=(-u "admin:${GRAFANA_PW}")

ADAPTIVE_CARD_TEMPLATE='{\n  \"type\": \"AdaptiveCard\",\n  \"$schema\": \"http://adaptivecards.io/schemas/adaptive-card.json\",\n  \"version\": \"1.4\",\n  \"body\": [\n    { \"type\": \"TextBlock\", \"text\": \"{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}\", \"weight\": \"Bolder\", \"size\": \"Medium\" },\n    { \"type\": \"TextBlock\", \"text\": \"Environnement : {{ .CommonLabels.env }}\", \"weight\": \"Bolder\", \"color\": \"Attention\" },\n    { \"type\": \"TextBlock\", \"text\": \"{{ .CommonAnnotations.summary }}\", \"wrap\": true }\n  ]\n}'

existing_contact_point() {
  curl -s "${AUTH[@]}" "${GRAFANA}/api/v1/provisioning/contact-points" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const cp = JSON.parse(d).find(x => x.name === '$1');
  console.log(cp ? cp.uid : '');
});"
}

echo "== Contact point preprod (teams-alerting) =="
if [ -z "$(existing_contact_point teams-alerting)" ]; then
  curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/v1/provisioning/contact-points" -d @- <<EOF >/dev/null
{
  "name": "teams-alerting",
  "type": "webhook",
  "settings": {
    "url": "${TEAMS_URL}",
    "httpMethod": "POST",
    "payload": { "template": "${ADAPTIVE_CARD_TEMPLATE}" }
  }
}
EOF
else
  echo "Contact point 'teams-alerting' déjà présent, rien à faire."
fi

echo "== Contact point prod (teams-alerting-prod) =="
if [ -z "$(existing_contact_point teams-alerting-prod)" ]; then
  curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/v1/provisioning/contact-points" -d @- <<EOF >/dev/null
{
  "name": "teams-alerting-prod",
  "type": "webhook",
  "settings": {
    "url": "${TEAMS_URL_PROD}",
    "httpMethod": "POST",
    "payload": { "template": "${ADAPTIVE_CARD_TEMPLATE}" }
  }
}
EOF
else
  echo "Contact point 'teams-alerting-prod' déjà présent, rien à faire."
fi

echo "== Politique de notification (routage par env) =="
curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT "${GRAFANA}/api/v1/provisioning/policies" -d '{
  "receiver": "teams-alerting",
  "group_by": ["grafana_folder", "alertname", "env"],
  "group_wait": "30s", "group_interval": "5m", "repeat_interval": "4h",
  "routes": [
    {
      "receiver": "teams-alerting-prod",
      "object_matchers": [["env", "=", "imputo"]],
      "group_by": ["grafana_folder", "alertname", "env"],
      "group_wait": "30s", "group_interval": "5m", "repeat_interval": "4h",
      "continue": false
    }
  ]
}' >/dev/null

echo "== Dossier 'Imputo - Alertes' (créé si absent) =="
FOLDER_UID=$(curl -s "${AUTH[@]}" "${GRAFANA}/api/folders" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const f = JSON.parse(d).find(x => x.title === 'Imputo - Alertes');
  console.log(f ? f.uid : '');
});")
if [ -z "$FOLDER_UID" ]; then
  FOLDER_UID=$(curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/folders" \
    -d '{"title": "Imputo - Alertes"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).uid))")
fi
echo "folder uid: ${FOLDER_UID}"

ROUTE_PREPROD=$(oc get route imputo -n imputo-preprod -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
ROUTE_PROD=$(oc get route imputo -n imputo -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [ -z "$ROUTE_PREPROD" ] || [ -z "$ROUTE_PROD" ]; then
  echo "Attention : route imputo introuvable sur imputo-preprod et/ou imputo — les règles de" >&2
  echo "health check externe ne seront pas fonctionnelles tant que ces Routes n'existent pas." >&2
fi

echo "== Groupe de règles d'alerte (imputo-alerts, 6 règles) =="
curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT "${GRAFANA}/api/v1/provisioning/folder/${FOLDER_UID}/rule-groups/imputo-alerts" -d @- <<EOF >/dev/null
{
  "title": "imputo-alerts",
  "folderUid": "${FOLDER_UID}",
  "interval": 60,
  "rules": [
    {
      "title": "Imputo - Taux d'erreur 5xx eleve",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "loki",
          "model": { "expr": "100 * sum by (env) (count_over_time({app=\"imputo\"} | json | msg=\"request\" | status >= 500 [5m])) / sum by (env) (count_over_time({app=\"imputo\"} | json | msg=\"request\" [5m]))", "queryType": "range", "instant": true, "refId": "A" } },
        { "refId": "R", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "last", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "gt", "params": [10] } }], "refId": "C" } }
      ],
      "noDataState": "OK", "execErrState": "Error", "for": "5m",
      "annotations": { "summary": "Taux d'erreur HTTP 5xx > 10% sur les 5 dernieres minutes ({{ \$labels.env }})" },
      "labels": {}
    },
    {
      "title": "Imputo - Echec d'un job cron",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "loki",
          "model": { "expr": "sum by (env) (count_over_time({app=\"imputo\"} | json | msg=\"cron_failed\" [5m]))", "queryType": "range", "instant": true, "refId": "A" } },
        { "refId": "R", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "last", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "gt", "params": [0] } }], "refId": "C" } }
      ],
      "noDataState": "OK", "execErrState": "Error", "for": "1m",
      "annotations": { "summary": "Au moins un job cron a echoue dans les 5 dernieres minutes ({{ \$labels.env }})" },
      "labels": {}
    },
    {
      "title": "Imputo - Circuit breaker Jira declenche",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 900, "to": 0 }, "datasourceUid": "loki",
          "model": { "expr": "sum by (env) (count_over_time({app=\"imputo\"} | json | msg=\"jira_sync_circuit_breaker_tripped\" [15m]))", "queryType": "range", "instant": true, "refId": "A" } },
        { "refId": "R", "relativeTimeRange": { "from": 900, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "last", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 900, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "gt", "params": [0] } }], "refId": "C" } }
      ],
      "noDataState": "OK", "execErrState": "Error", "for": "1m",
      "annotations": { "summary": "La synchronisation Jira d'un espace a ete desactivee automatiquement ({{ \$labels.env }})" },
      "labels": {}
    },
    {
      "title": "Imputo - App silencieuse (sonde interne)",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "loki",
          "model": { "expr": "sum by (env) (count_over_time({app=\"imputo\"} | json | msg=\"probe\" [5m]))", "queryType": "range", "instant": true, "refId": "A" } },
        { "refId": "R", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "last", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "lt", "params": [1] } }], "refId": "C" } }
      ],
      "noDataState": "Alerting", "execErrState": "Error", "for": "2m",
      "annotations": { "summary": "Aucune sonde de sante interne recue depuis 5 minutes : l'app ne repond plus, ou le pipeline de logs est casse ({{ \$labels.env }})" },
      "labels": {}
    },
    {
      "title": "Imputo - Health check externe (preprod)",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "infinity",
          "model": {
            "type": "json", "source": "url", "format": "table", "refId": "A",
            "url": "https://${ROUTE_PREPROD}/api/health",
            "url_options": { "method": "GET" },
            "root_selector": "", "columns": [{ "selector": "status", "text": "status", "type": "string" }]
          } },
        { "refId": "R", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "count", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "lt", "params": [0] } }], "refId": "C" } }
      ],
      "noDataState": "OK", "execErrState": "Alerting", "for": "1m",
      "annotations": { "summary": "GET /api/health via la vraie Route publique preprod ne repond pas 200 (DNS/TLS/routeur/app) depuis au moins 1 minute" },
      "labels": { "env": "imputo-preprod" }
    },
    {
      "title": "Imputo - Health check externe (prod)",
      "condition": "C",
      "data": [
        { "refId": "A", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "infinity",
          "model": {
            "type": "json", "source": "url", "format": "table", "refId": "A",
            "url": "https://${ROUTE_PROD}/api/health",
            "url_options": { "method": "GET" },
            "root_selector": "", "columns": [{ "selector": "status", "text": "status", "type": "string" }]
          } },
        { "refId": "R", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "reduce", "expression": "A", "reducer": "count", "refId": "R" } },
        { "refId": "C", "relativeTimeRange": { "from": 300, "to": 0 }, "datasourceUid": "__expr__", "model": { "type": "threshold", "expression": "R", "conditions": [{ "evaluator": { "type": "lt", "params": [0] } }], "refId": "C" } }
      ],
      "noDataState": "OK", "execErrState": "Alerting", "for": "1m",
      "annotations": { "summary": "GET /api/health via la vraie Route publique prod ne repond pas 200 (DNS/TLS/routeur/app) depuis au moins 1 minute" },
      "labels": { "env": "imputo" }
    }
  ]
}
EOF

echo "== Playlists =="
existing_playlist() {
  curl -s -G "${AUTH[@]}" --data-urlencode "query=$1" "${GRAFANA}/api/playlists" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).length>0?'yes':'')})"
}
if [ -z "$(existing_playlist 'Imputo - Preprod')" ]; then
  curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/playlists" -d '{
    "name": "Imputo - Preprod (mur)", "interval": "30s",
    "items": [
      {"type": "dashboard_by_uid", "value": "imputo-overview-preprod"},
      {"type": "dashboard_by_uid", "value": "imputo-jobs-preprod"},
      {"type": "dashboard_by_uid", "value": "imputo-jira-preprod"},
      {"type": "dashboard_by_uid", "value": "imputo-security-preprod"},
      {"type": "dashboard_by_uid", "value": "imputo-errors-preprod"}
    ]
  }' >/dev/null
else
  echo "Playlist preprod déjà présente, rien à faire."
fi
if [ -z "$(existing_playlist 'Imputo - Prod')" ]; then
  curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/playlists" -d '{
    "name": "Imputo - Prod (mur)", "interval": "30s",
    "items": [
      {"type": "dashboard_by_uid", "value": "imputo-overview-prod"},
      {"type": "dashboard_by_uid", "value": "imputo-jobs-prod"},
      {"type": "dashboard_by_uid", "value": "imputo-jira-prod"},
      {"type": "dashboard_by_uid", "value": "imputo-security-prod"},
      {"type": "dashboard_by_uid", "value": "imputo-errors-prod"}
    ]
  }' >/dev/null
else
  echo "Playlist prod déjà présente, rien à faire."
fi

echo "== Service Account d'annotations (ci-annotations) =="
SA_ID=$(curl -s "${AUTH[@]}" "${GRAFANA}/api/serviceaccounts/search?query=ci-annotations" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).serviceAccounts;console.log(r.length?r[0].id:'')})")
if [ -z "$SA_ID" ]; then
  SA_ID=$(curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/serviceaccounts" \
    -d '{"name": "ci-annotations", "role": "Editor"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
  TOKEN=$(curl -s "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/serviceaccounts/${SA_ID}/tokens" \
    -d '{"name": "gitlab-ci"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).key))")
  echo
  echo "  >>> NOUVEAU TOKEN A COLLER DANS GitLab CI/CD > Variables > GRAFANA_ANNOTATIONS_TOKEN :"
  echo "  ${TOKEN}"
  echo
else
  echo "Service Account 'ci-annotations' déjà présent (id ${SA_ID}) — token existant conservé, rien à faire."
fi

echo "== Terminé =="
