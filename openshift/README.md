# Déploiement OpenShift

Manifestes pour déployer `imputo` sur un cluster OpenShift interne, en complément du
`docker-compose.yml` (dev local) et du `Dockerfile` à la racine du projet.

Choix retenus :

- **Build de l'image** : fait par OpenShift lui-même (`BuildConfig` stratégie Docker à partir
  du `Dockerfile` du dépôt), pas de registry externe.
- **PostgreSQL** : déployé dans le cluster (`StatefulSet` + `PersistentVolumeClaim`), avec
  l'image `registry.redhat.io/rhel9/postgresql-16` (compatible SCC `restricted`, contrairement
  à `postgres:16-alpine` utilisée en local — voir commentaire dans `db-statefulset.yaml`).
- **Route** : host auto-généré par le cluster, TLS `edge` avec redirection HTTP → HTTPS.

## Avant le premier déploiement

1. Se placer dans le bon projet OpenShift : `oc project <votre-projet>` (ou `oc new-project
   imputo`).
2. Adapter `buildconfig.yaml` si l'URL du dépôt Git ou la branche (`ref`) diffère.
3. Remplacer les placeholders `CHANGEME-*` :
   - `secret.yaml` : `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, et éventuellement les
     clés VAPID (`npx web-push generate-vapid-keys`). Voir les commandes `oc create secret`
     suggérées en commentaire dans le fichier.
   - `db-secret.yaml` : mot de passe Postgres (`imputo-db-secret`) — doit correspondre à
     `DATABASE_URL` ci-dessus.
   - `deployment.yaml` : le namespace dans `spec.template.spec.containers[0].image` (valeur de
     départ seulement, réécrite ensuite automatiquement par le trigger d'image).
4. Ne jamais committer ces fichiers une fois remplis avec de vraies valeurs — préférer les
   éditer directement sur le cluster (`oc create secret ...` / `oc edit secret ...`). C'est
   aussi pour ça que la CI (voir plus bas) n'applique jamais `secret.yaml` ni `db-secret.yaml`.

## Déploiement

```sh
oc apply -k openshift/
oc start-build imputo --follow
oc get pods -w
```

Une fois le pod `imputo` prêt et la Route créée :

```sh
oc get route imputo -o jsonpath='{.spec.host}'
```

Reporter ce host dans `PUBLIC_BASE_URL` et `ORIGIN` du `ConfigMap` (`configmap.yaml`, puis
`oc apply -f openshift/configmap.yaml` et `oc rollout restart deployment/imputo`) — sans quoi
les formulaires et les liens envoyés par l'application pointeront vers une URL incorrecte (voir
le README principal, section « Déploiement portable »).

## Webhook GitHub (optionnel)

Pour déclencher un build automatiquement à chaque push, générer un secret et configurer le
webhook GitHub avec l'URL renvoyée par :

```sh
oc describe buildconfig imputo | grep -A1 webhook
```

Inutile si vous utilisez la CI GitLab ci-dessous : c'est elle qui déclenche les builds.

## CI/CD GitLab

`.gitlab-ci.yml` (racine du dépôt) gère deux environnements :

- **preprod** — à chaque push sur `main` : build, rollout, puis seed automatique (`npm run
  db:seed`, données de démo) via un Job dédié (`imputo-tools` + `seed-job.yaml`).
- **production** — à chaque tag : build de l'image à partir du commit du tag
  (`oc start-build --commit=<tag>`), rollout. Pas de seed.

### Bootstrap requis avant le premier run CI

1. Deux projets OpenShift : celui de prod (déjà en place, `imputo` dans les exemples ci-dessus)
   et un nouveau pour la preprod, ex. `oc new-project imputo-preprod`.
2. Dans chacun : les secrets `imputo-secrets` et `imputo-db-secret` créés à la main (voir
   §"Avant le premier déploiement" ci-dessus) — la CI ne les touche jamais.
3. Un ServiceAccount avec le rôle `edit` sur les deux namespaces, pour fournir un token à la CI :
   ```sh
   oc create serviceaccount gitlab-ci -n imputo-preprod
   oc policy add-role-to-user edit -z gitlab-ci -n imputo-preprod
   oc policy add-role-to-user edit -z gitlab-ci -n imputo
   oc create token gitlab-ci -n imputo-preprod --duration=8760h
   ```
4. Variables CI/CD GitLab (Settings > CI/CD > Variables, masquées/protégées) :
   - `OPENSHIFT_SERVER` : URL de l'API du cluster (`oc whoami --show-server`).
   - `OPENSHIFT_TOKEN` : le token généré ci-dessus.
   - `OPENSHIFT_NAMESPACE_PREPROD` / `OPENSHIFT_NAMESPACE_PROD` : optionnelles, défauts
     `imputo-preprod` / `imputo`.

La preprod n'a pas de host de Route connu à l'avance : le job `deploy:preprod` lit
`oc get route imputo` après le premier `apply` et corrige lui-même `PUBLIC_BASE_URL`/`ORIGIN`
dans le ConfigMap avant de builder — pas de manip manuelle à refaire à chaque fois, contrairement
à la prod (§ précédente, host déjà figé dans `configmap.yaml`).

## Jobs planifiés

`cronjobs.yaml` couvre les 3 routes `/api/jobs/*` décrites dans le README principal
(`cleanup`, `snapshot`, `notify`), appelées via le Service interne `imputo` et authentifiées
par `CRON_SECRET`. La variante `notify?kind=weekly` est laissée en commentaire à dupliquer si
besoin.

## Limite connue : une seule réplique

Les migrations Drizzle s'exécutent au démarrage du container applicatif (`scripts/migrate.js`
dans le `CMD` du `Dockerfile`), comme en local. `deployment.yaml` reste donc à `replicas: 1`
avec une stratégie `Recreate`. Passer à plusieurs répliques nécessiterait de sortir l'exécution
des migrations du démarrage de l'app (Job dédié ou initContainer avec verrou) pour éviter que
plusieurs pods ne migrent en même temps.
