# Logging & alerting — projet `imputo-logs`

Loki (stockage filesystem, mode single-binary) + Grafana, dans leur propre projet OpenShift
séparé de `imputo`/`imputo-preprod` (quota indépendant — voir `networkpolicy.yaml` pour les
namespaces autorisés à pousser des logs).

## Déploiement

**Redéploiement courant** (Loki/Grafana déjà bootstrappés, juste appliquer un changement de
manifeste — ConfigMap dashboards, image Grafana, etc.) : job manuel `deploy:logging` dans
`.gitlab-ci.yml` (CI/CD > Pipelines > lancer/relancer le job sur la branche voulue). Redémarre
Grafana automatiquement pour reprendre en compte les ConfigMaps sans attendre la resync kubelet.
N'exécute jamais `grafana-secret.yaml` ni la création du secret `teams-webhook` — voir plus bas.

**Premier bootstrap complet** (namespace tout neuf, secrets à créer) :

```sh
oc apply -f openshift/logging/configmap.yaml -n imputo-logs
oc apply -f openshift/logging/pvc.yaml -n imputo-logs
oc apply -f openshift/logging/service.yaml -n imputo-logs
oc apply -f openshift/logging/networkpolicy.yaml -n imputo-logs
oc apply -f openshift/logging/deployment.yaml -n imputo-logs

oc create secret generic grafana-admin \
  --from-literal=GF_SECURITY_ADMIN_USER=admin \
  --from-literal=GF_SECURITY_ADMIN_PASSWORD="$(openssl rand -base64 24)" \
  --dry-run=client -o yaml -n imputo-logs | oc apply -f -

oc apply -f openshift/logging/grafana-provisioning-configmap.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-dashboard-preprod-configmap.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-dashboard-prod-configmap.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-pvc.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-service.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-deployment.yaml -n imputo-logs
oc apply -f openshift/logging/grafana-route.yaml -n imputo-logs   # exposition publique, geste volontaire
```

Puis côté appli (`imputo`/`imputo-preprod`) : `LOKI_URL` dans `openshift/configmap.yaml` (déjà
fait) et `POD_NAMESPACE` (Downward API, déjà dans `openshift/deployment.yaml`) — voir
`src/lib/server/logger.ts`. Sans `LOKI_URL`, l'appli reste sur stdout seul (comportement par
défaut, rien à faire pour ça).

## Dashboards : un dossier par environnement

Deux dossiers Grafana, **pas** un seul avec une variable `$env` — évite d'ouvrir la prod en
pensant regarder la preprod. `grafana-dashboard-preprod-configmap.yaml` (dossier "Imputo -
Preprod") et `grafana-dashboard-prod-configmap.yaml` (dossier "Imputo - Prod"), 5 dashboards
chacun, requêtes figées sur `env="imputo-preprod"` / `env="imputo"`.

**Ces deux fichiers sont générés, pas édités à la main** : la source de vérité est l'ancienne
version avec `$env` (voir historique git) transformée par un script one-shot qui clone chaque
dashboard, retire le bloc `templating`, fige `env=~"$env"` sur la vraie valeur, et suffixe
`uid`/`title`. Pour ajouter un panel : l'ajouter aux deux fichiers directement (les dashboards
sont assez simples pour ne pas justifier de réintroduire un générateur), ou régénérer depuis un
template si ça devient pénible.

Le dossier "Imputo - Alertes" (uid `bfwy061kpcxz4e`) est différent — il contient les **règles
d'alerte**, pas des dashboards ; ne pas y déposer de dashboards par erreur.

## Grafana : version

`grafana/grafana:12.4.9` — pas 11.x. La v11 n'a pas de champ "Custom Payload" sur l'intégration
Webhook (juste Title/Message insérés dans son enveloppe JSON fixe), indispensable pour envoyer une
Adaptive Card à Teams (voir plus bas). Vérifié en marchant sur le rake une fois : **si `payload`
est un objet (`{template: "..."}`, format 12.x) au lieu d'une simple chaîne, ça casse tout
l'Alertmanager de l'org** (`failed to unmarshal settings: ... into Go struct field .payload of
type v1.CustomPayload`) — corrigé en repassant l'API v1 provisioning avec le bon format nested.

## Alerting → Microsoft Teams

**Piège Teams** : les webhooks "Workflows" (Power Automate, ce qui remplace les anciens
"Connectors" O365 sur les tenants modernes) attendent une **Adaptive Card** en payload
(`{"type": "AdaptiveCard", "$schema": "...", "version": "1.4", "body": [...]}`) — pas le format
`MessageCard` historique, ni un JSON libre. Un payload qui n'a pas `"type": "AdaptiveCard"` fait
échouer l'action `Post_card_in_a_chat_or_channel` du flow avec une erreur de désérialisation.

**Contact point** : créé via l'API de provisioning (`/api/v1/provisioning/contact-points`), type
`webhook`, avec un `Custom Payload` (template Go côté Grafana) qui génère l'Adaptive Card. **Pas
file-provisioned** — l'URL de webhook Teams est un secret (signature incluse), et le fichier de
provisioning Grafana ne supporte pas nativement l'expansion de secrets Kubernetes. Elle est donc
stockée dans le secret `teams-webhook` (créé une fois, jamais commité) et dans la config Grafana
elle-même (persistée sur `grafana-data`, le PVC).

**Pour recréer si le PVC est perdu** (récupérer d'abord l'URL du webhook Teams — Teams > canal
"alerting" > **⋯** > **Flux de travail** > relancer/consulter celui déjà créé) :

```sh
TEAMS_URL='<url de webhook Teams>'
GRAFANA_PW=$(oc get secret grafana-admin -n imputo-logs -o jsonpath='{.data.GF_SECURITY_ADMIN_PASSWORD}' | base64 -d)
oc port-forward -n imputo-logs svc/grafana 3300:3000 &

curl -s -u "admin:$GRAFANA_PW" -H 'Content-Type: application/json' \
  -X POST 'http://localhost:3300/api/v1/provisioning/contact-points' -d '{
  "name": "teams-alerting",
  "type": "webhook",
  "settings": {
    "url": "'"$TEAMS_URL"'",
    "httpMethod": "POST",
    "payload": {
      "template": "{\n  \"type\": \"AdaptiveCard\",\n  \"$schema\": \"http://adaptivecards.io/schemas/adaptive-card.json\",\n  \"version\": \"1.4\",\n  \"body\": [\n    { \"type\": \"TextBlock\", \"text\": \"{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}\", \"weight\": \"Bolder\", \"size\": \"Medium\" },\n    { \"type\": \"TextBlock\", \"text\": \"Environnement : {{ .CommonLabels.env }}\", \"weight\": \"Bolder\", \"color\": \"Attention\" },\n    { \"type\": \"TextBlock\", \"text\": \"{{ .CommonAnnotations.summary }}\", \"wrap\": true }\n  ]\n}"
    }
  }
}'

# Route tout vers ce contact point (une seule destination pour l'instant, pas de règle de routage fine).
# group_by inclut env : une alerte prod et une alerte preprod notifient séparément, jamais mélangées
# dans un seul message Teams qui rendrait ambigu quel environnement est concerné.
curl -s -u "admin:$GRAFANA_PW" -H 'Content-Type: application/json' \
  -X PUT 'http://localhost:3300/api/v1/provisioning/policies' -d '{
  "receiver": "teams-alerting", "group_by": ["grafana_folder", "alertname", "env"],
  "group_wait": "30s", "group_interval": "5m", "repeat_interval": "4h"
}'
```

**Règles d'alerte actives** (dossier "Imputo - Alertes", groupe `imputo-alerts`, évaluées /1min) —
`by (env)` sur chaque requête : une alerte prod et une alerte preprod sont deux instances
indépendantes (l'une peut être active sans l'autre), `env` se propage automatiquement comme label
sur l'instance sans rien de plus à déclarer côté règle :

| Règle | Requête LogQL | Condition | `for` |
|---|---|---|---|
| Taux d'erreur 5xx élevé | `100 * sum by (env) (count_over_time({app="imputo"} \| json \| msg="request" \| status >= 500 [5m])) / sum by (env) (count_over_time({app="imputo"} \| json \| msg="request" [5m]))` | > 10 (%) | 5m |
| Échec d'un job cron | `sum by (env) (count_over_time({app="imputo"} \| json \| msg="cron_failed" [5m]))` | > 0 | 1m |
| Circuit breaker Jira déclenché | `sum by (env) (count_over_time({app="imputo"} \| json \| msg="jira_sync_circuit_breaker_tripped" [15m]))` | > 0 | 1m |

Recréées via `PUT /api/v1/provisioning/folder/{folderUID}/rule-groups/imputo-alerts` (voir
l'historique de session ou reconstruire à partir du tableau ci-dessus — `datasourceUid: "loki"`
pour la requête, une étape `type: reduce` (`reducer: last`) puis `datasourceUid: "__expr__"` +
`type: threshold` pour la condition — **indispensable** : une requête Loki en `instant: true` seule
ne suffit pas, Grafana refuse d'alerter dessus directement ("looks like time series data, only
reduced data can be alerted on") tant qu'elle n'a pas été réduite à un scalaire).

Testé de bout en bout le 2026-09-01 : contact point (carte reçue dans Teams, environnement
affiché), les 3 règles s'évaluent sans erreur (`health: ok`) contre les vraies données Loki de
preprod, alerte réellement déclenchée (`cron_failed` provoqué volontairement) et reçue dans Teams.
