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

**Pour recréer si le PVC est perdu** : `scripts/restore-grafana-config.sh` reconstruit tout
(contact points, politique de routage, règles d'alerte, playlists, Service Account d'annotations)
en une seule commande — **idempotent**, testé en direct plusieurs fois de suite sans créer de
doublon. Aucun secret dans le script ni dans git : les URLs de webhook Teams sont lues depuis les
secrets Kubernetes `teams-webhook`/`teams-webhook-prod` (namespace `imputo-logs`), qui doivent déjà
exister — si ce n'est pas le cas (première fois, ou secret aussi perdu), récupérer l'URL depuis
Teams (canal cible > **⋯** > **Flux de travail** > relancer/consulter celui déjà créé) et créer le
secret manuellement d'abord (`oc create secret generic teams-webhook --from-literal=url='...' -n
imputo-logs`, idem `teams-webhook-prod`) :

```sh
oc login ...   # sur le bon cluster (voir plus haut)
./openshift/logging/scripts/restore-grafana-config.sh
```

Si le Service Account `ci-annotations` n'existait pas encore, le script affiche un nouveau token à
coller dans **GitLab CI/CD > Variables > GRAFANA_ANNOTATIONS_TOKEN** (impossible à restaurer à
l'identique — un token perdu doit être régénéré).

**Piège à ne pas reproduire** : ne jamais créer la règle "Health check externe (prod)" avant que la
prod tourne réellement avec `/api/health` (ce commit doit d'abord y être déployé) — sinon la
requête Infinity reçoit un 404 (ancien code sans l'endpoint) et déclenche une fausse alerte
immédiate dans le canal prod fraîchement branché.

**Règles d'alerte actives** (dossier "Imputo - Alertes", groupe `imputo-alerts`, évaluées /1min) —
`by (env)` sur chaque requête : une alerte prod et une alerte preprod sont deux instances
indépendantes (l'une peut être active sans l'autre), `env` se propage automatiquement comme label
sur l'instance sans rien de plus à déclarer côté règle :

| Règle | Requête | Condition | `for` |
|---|---|---|---|
| Taux d'erreur 5xx élevé | LogQL : `100 * sum by (env) (count_over_time({app="imputo"} \| json \| msg="request" \| status >= 500 [5m])) / sum by (env) (count_over_time({app="imputo"} \| json \| msg="request" [5m]))` | > 10 (%) | 5m |
| Échec d'un job cron | LogQL : `sum by (env) (count_over_time({app="imputo"} \| json \| msg="cron_failed" [5m]))` | > 0 | 1m |
| Circuit breaker Jira déclenché | LogQL : `sum by (env) (count_over_time({app="imputo"} \| json \| msg="jira_sync_circuit_breaker_tripped" [15m]))` | > 0 | 1m |
| App silencieuse (sonde interne) | LogQL : `sum by (env) (count_over_time({app="imputo"} \| json \| msg="probe" [5m]))` | < 1, **et** `noDataState: Alerting` (l'absence totale de série est elle-même le signal — contrairement aux 3 précédentes où "pas de donnée" = rien de grave) | 2m |
| Health check externe (par env) | Infinity : `GET https://<route-publique>/api/health`, une règle par environnement (URL fixe, pas dérivée de Loki, donc pas de `by (env)` possible) | `execErrState: Alerting` — un code non-2xx fait échouer la requête Infinity elle-même (`"unsuccessful HTTP response code"`), c'est cet échec qui déclenche, pas un seuil sur une valeur | 1m |

Recréées par `scripts/restore-grafana-config.sh` (voir plus haut) — `datasourceUid: "loki"` pour la
requête, une étape `type: reduce` (`reducer: last`) puis `datasourceUid: "__expr__"` +
`type: threshold` pour la condition — **indispensable** : une requête Loki seule sans réduction
ne suffit pas, Grafana refuse d'alerter dessus directement ("looks like time series data, only
reduced data can be alerted on") tant qu'elle n'a pas été réduite à un scalaire).

**Health check externe — pourquoi en plus de la sonde interne** : `readinessProbe`/`livenessProbe`
(OpenShift, sur le pod) et la règle "App silencieuse" ci-dessus ne testent que "le pod répond en
interne au cluster" — pas DNS, TLS, ni le routeur OpenShift devant la Route publique. `/api/health`
(`src/routes/api/health/+server.ts`, sans auth, filtré des logs `request`/`probe` dans
`hooks.server.ts`) est tapé depuis l'extérieur par Grafana via le plugin communautaire **Infinity**
(`yesoreyeram-infinity-datasource`, installé via `GF_INSTALL_PLUGINS` sur le déploiement Grafana,
datasource provisionnée dans `grafana-provisioning-configmap.yaml`, uid `infinity`). Vérifié en
direct (app scalée à 0 replica sur preprod, deux fois) : le routeur OpenShift renvoie un vrai `503`
avec sa propre page HTML quand il n'y a plus de pod — jamais un faux 200 — donc le check déclenche
correctement dans les deux cas (pod down *et* pod up mais logique cassée). **Une règle par
environnement à dupliquer/maintenir manuellement** (URL en dur dans le rule group, pas de variable
`env` possible ici) — `imputo-preprod` et `imputo` (prod) existent toutes les deux désormais.

**Piège évité en prod** : la règle prod n'a été créée **qu'après** confirmation que `imputo`
tournait bien avec ce code (`/api/health` répond 200) — la créer avant aurait tapé un 404 (ancien
code sans l'endpoint) et déclenché une fausse alerte immédiate dans le canal Teams prod fraîchement
branché.

**Canaux Teams séparés prod/preprod** : deux contact points (`teams-alerting` pour preprod,
`teams-alerting-prod` pour prod, secrets `teams-webhook`/`teams-webhook-prod`), routés via une
politique de notification qui matche sur le label `env` — voir la section précédente pour les
commandes de recréation.

Testé de bout en bout le 2026-09-01 : contact points (cartes reçues dans les deux canaux Teams,
environnement affiché), les 6 règles s'évaluent sans erreur (`health: ok`) contre les vraies
données de prod et preprod, alertes réellement déclenchées (`cron_failed` provoqué volontairement,
l'app scalée à 0 replica deux fois sur preprod pour la sonde interne et le health check externe) et
reçues dans Teams à chaque fois.

## Annotations de déploiement

Chaque `deploy:preprod`/`deploy:production` réussi pose une ligne verticale sur tous les graphes
Grafana au moment exact du déploiement (`.gitlab-ci.yml`, appel direct à `/api/annotations` — pas
besoin de credentials OpenShift, juste un token Grafana). Sert à corréler visuellement un pic
d'erreur avec "un déploiement vient-il d'avoir lieu" sans croiser les dates à la main.

**Token** : Service Account Grafana `ci-annotations` (rôle **Editor** — le minimum qui permette
d'écrire une annotation ; pas de rôle plus fin dédié aux annotations seules). Recréer si perdu :

```sh
GRAFANA_PW=$(oc get secret grafana-admin -n imputo-logs -o jsonpath='{.data.GF_SECURITY_ADMIN_PASSWORD}' | base64 -d)
oc port-forward -n imputo-logs svc/grafana 3300:3000 &

curl -s -u "admin:$GRAFANA_PW" -H 'Content-Type: application/json' \
  -X POST 'http://localhost:3300/api/serviceaccounts' -d '{"name": "ci-annotations", "role": "Editor"}'
# noter le "id" retourné, puis :
curl -s -u "admin:$GRAFANA_PW" -H 'Content-Type: application/json' \
  -X POST 'http://localhost:3300/api/serviceaccounts/<id>/tokens' -d '{"name": "gitlab-ci"}'
```

Le token (`glsa_...`) va dans **GitLab (mirror) > Settings > CI/CD > Variables**, nom
`GRAFANA_ANNOTATIONS_TOKEN`, "Masked" coché — jamais commité. Optionnel côté pipeline : son
absence ne fait pas échouer le déploiement (`|| true`), l'annotation est juste silencieusement
sautée.

**Filtrage par environnement** : chaque dashboard a sa propre requête d'annotation
(`annotations.list` dans le JSON, filtrée par tag `env:imputo-preprod` / `env:imputo`) — sans ça,
Grafana affiche par défaut *toutes* les annotations sur *tous* les dashboards, préprod comprise sur
les graphes prod. Vérifié en direct : deux annotations postées avec des tags différents, chaque
filtre ne remonte que la sienne.

## Playlists ("mur" de monitoring)

Deux playlists (Grafana ne supporte pas leur provisioning déclaratif par fichier, contrairement aux
dashboards — créées via l'API, à recréer si le PVC est perdu) : **"Imputo - Preprod (mur)"** et
**"Imputo - Prod (mur)"**, chacune fait défiler les 5 dashboards de son dossier toutes les 30s.
Accessible depuis Grafana : **Dashboards > Playlists**.

```sh
curl -s -u "admin:$GRAFANA_PW" -H 'Content-Type: application/json' -X POST 'http://localhost:3300/api/playlists' -d '{
  "name": "Imputo - Preprod (mur)",
  "interval": "30s",
  "items": [
    {"type": "dashboard_by_uid", "value": "imputo-overview-preprod"},
    {"type": "dashboard_by_uid", "value": "imputo-jobs-preprod"},
    {"type": "dashboard_by_uid", "value": "imputo-jira-preprod"},
    {"type": "dashboard_by_uid", "value": "imputo-security-preprod"},
    {"type": "dashboard_by_uid", "value": "imputo-errors-preprod"}
  ]
}'
# Même chose pour prod avec les uid "...-prod" et le nom "Imputo - Prod (mur)".
```

## Piège LogQL : `instant: true` vs `queryType: "instant"`

**`"instant": true` sur un target de panel/règle est silencieusement ignoré** par ce datasource —
Grafana retombe sur une requête `query_range` avec un pas d'1 seconde, forçant Loki à réévaluer la
requête des milliers de fois sur la fenêtre au lieu d'une seule. Invisible sur une agrégation simple
(`sum(...)`, `topk(...)` : quelques dizaines de ms de trop, personne ne le remarque), mais une
agrégation imbriquée coûteuse (ex. `count(count by (userId) (...))` pour compter des utilisateurs
distincts) passe de **50ms à un timeout pur et simple** — découvert en construisant le panel
"Utilisateurs actifs (24h)". La bonne propriété est **`"queryType": "instant"`** sur le target — les
6 panels concernés (bargauge/piechart/stat déjà en place) ont été corrigés rétroactivement en même
temps que ce piège a été trouvé.

Symptôme complémentaire rencontré en chassant ça (pas la vraie cause, mais des filets de sécurité
gardés) : `limits_config.max_query_series` de Loki (défaut 500) peut sauter sur un `count by
(userId)` avec beaucoup de comptes distincts — monté à 5000 dans `configmap.yaml`. Idem,
`grafana-provisioning-configmap.yaml` a `jsonData.timeout: 60` (défaut 30s) et
`deployment.yaml` (Loki) a `limits.cpu: 1500m` (défaut 500m, quota du namespace quasi inutilisé) —
ceintures et bretelles pour une future requête réellement lourde, même si le vrai fix ci-dessus
suffisait déjà à résoudre ce cas précis.
