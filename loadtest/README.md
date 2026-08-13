# Tests de charge

Plan complet : voir la conversation / `Contexte` ci-dessous pour le raisonnement. Ce dossier ne
contient que l'outillage [k6](https://k6.io) — le seed à l'échelle vit dans
`src/lib/server/db/seed.ts` (pas de script séparé, cf. `getSeedScale()` dans `seed.shared.ts`).

## Prérequis

- `brew install k6` (ou voir [grafana.com/docs/k6/latest/set-up/install-k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)).
- `oc login` sur le cluster, `oc project imputo-preprod` (ou passer le namespace en argument aux scripts).

## 1. Seeder à l'échelle voulue

Sans variables d'env, `npm run db:seed` reproduit exactement le petit jeu de données habituel (1
espace "QA Sandbox", 5 comptes, ~36 tickets) — rien ne change pour l'usage courant ni pour le seed
automatique de la CI.

Pour un run de charge (~125 utilisateurs / 5 workspaces, cohérent avec "plusieurs équipes,
50-150 concurrents") :

```sh
# Contre preprod : lancer via le Job existant (openshift/seed-job.yaml) en passant les variables,
# ou en se connectant à la base preprod (cf. scripts/db-pull.sh pour le pattern de connexion) et en
# lançant le script en local avec DATABASE_URL pointé dessus.
SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 SEED_TICKETS_PER_WS=2000 SEED_WEEKS=26 npm run db:seed
```

Variables disponibles (toutes optionnelles, défauts = comportement historique) :

| Variable | Défaut | Effet |
|---|---|---|
| `SEED_WORKSPACES` | 1 | Nombre d'espaces "QA Sandbox N" générés |
| `SEED_USERS_PER_WS` | 5 | Comptes par espace (au-delà de 5, comptes synthétiques `userN@sandbox.test` / `loadtest123`) |
| `SEED_TICKETS_PER_WS` | 0 (pas de top-up) | Volume total de tickets par espace — au-delà des ~36 "curatés", des tickets bulk sans historique d'imputation, juste pour stresser liste/kanban/dashboard |
| `SEED_WEEKS` | 15 | Profondeur d'historique (sprints + imputations) |

Nettoyage complet (tous les espaces `QA Sandbox%` + tous les comptes `@sandbox.test`, quelle que
soit l'échelle utilisée) :

```sh
npm run db:unseed
```

## 2. Lancer un scénario k6

```sh
BASE_URL="https://$(oc get route imputo -n imputo-preprod -o jsonpath='{.spec.host}')" \
SEED_WORKSPACES=5 SEED_USERS_PER_WS=25 \
k6 run loadtest/k6/scenarios/imputation.js
```

`SEED_WORKSPACES`/`SEED_USERS_PER_WS` doivent matcher ce qui a été effectivement seedé — le script
reconstruit les identifiants des personas à partir de ces deux nombres (même formule que
`buildPersonas` dans `seed.ts`, pas de fichier intermédiaire à maintenir).

Variables utiles : `TARGET_VUS` (défaut = `SEED_WORKSPACES × SEED_USERS_PER_WS`), `TEAM_VUS`
(défaut 5, scénario `getTeamTimesheet`), `RAMP_UP`/`HOLD`/`RAMP_DOWN` (défauts `2m`/`10m`/`2m`).

**Toujours tester en solo d'abord** (1 VU, quelques secondes) avant de monter en charge, pour
valider login/cookies sans encore taper fort :

```sh
BASE_URL="..." TARGET_VUS=1 TEAM_VUS=1 RAMP_UP=1s HOLD=5s RAMP_DOWN=1s \
k6 run loadtest/k6/scenarios/imputation.js
```

### Tester en local d'abord (optionnel)

Contre `npm run dev` (`http://localhost:5173`) : Vite n'écoute qu'en IPv6 par défaut, or le
client HTTP de k6 résout `localhost` en IPv4 et échoue en "connection refused" — utiliser
`BASE_URL="http://[::1]:5173"` (littéral IPv6), ou démarrer `vite dev --host` pour écouter aussi en
IPv4. **Les seuils de latence ne sont pas représentatifs en mode dev** (non optimisé, une seule
machine) — ce test local sert uniquement à valider que le script est correct (auth, cookies,
requêtes), pas à juger des chiffres. Les vrais seuils ne se jugent que contre preprod.

## 3. Suivre les ressources pendant le run

Dans un terminal à part, pendant que k6 tourne :

```sh
loadtest/scripts/watch-resources.sh imputo-preprod 5
```

Poll toutes les 5s : connexions Postgres actives (`pg_stat_activity`, à comparer au pool
`max: 20` dans `src/lib/server/db/connection.ts` — suspect n°1 pour un plafond de débit) + CPU/mémoire
des pods app et db (`oc adm top pod`, à comparer aux limites dans `openshift/deployment.yaml` /
`openshift/db-statefulset.yaml`). Écrit un CSV horodaté dans `loadtest/results/` (gitignored).
Ctrl+C pour arrêter.

## 4. Lire les résultats

- Résumé k6 en fin de run : `checks` (taux de succès), `http_req_duration`/métriques custom
  (p95/p99), et la section `THRESHOLDS` (✓/✗ par seuil défini dans le scénario).
- `loadtest/results/resources-*.csv` : croiser les pics de latence k6 avec les connexions Postgres
  actives et le CPU/mémoire au même moment.

## 5. Nettoyer

```sh
npm run db:unseed
```

## Scénarios disponibles

- `k6/scenarios/imputation.js` — **le plus prioritaire** : "Mon imputation" (page la plus utilisée),
  deux profils dans le même fichier : `individual` (GET + rafale de `setCell`, l'action la plus
  fréquente de l'app) et `team` (vue "Toute l'équipe", `getTeamTimesheet` — la requête de lecture la
  plus lourde identifiée par l'exploration).
- `k6/scenarios/tickets.js` — `table` (GET paginé + édition de champ + RAE par activité) vs
  `kanban` (GET non paginé, tout le board) : mesure l'écart entre les deux vues.
- `k6/scenarios/dashboard.js` — `/dashboard`, `/dashboard/sprint`, `/dashboard/version` en lecture
  seule, VUs faibles (pages consultées, pas saisies en continu).
- `k6/scenarios/export.js` — pas un test de débit : 3 paliers à VUs fixes (1 puis 5 puis 10 exports
  concurrents, `STAGE_SECONDS`) pour repérer où la latence/mémoire décroche sur `/export`.
- `k6/scenarios/mixed-day.js` — composite pondéré (60% imputation / 20% tickets / 15% dashboard /
  5% export) réutilisant tel quel les fonctions des scénarios ci-dessus — le chiffre à retenir pour
  "l'app tient une journée de charge réelle".
- `k6/scenarios/smoke-light-pages.js` — passage léger sur absences/admin/mood/support/settings/
  historique, VUs faibles, pour confirmer qu'aucune de ces pages ne s'effondre sous charge globale.

## Garde-fous

- Les scénarios écrivent (`setCell`...) mais jamais via `api/jobs/cleanup` ni de suppression en masse.
- Collision avec les cron jobs (2h-18h Paris) sur preprod acceptée (décision actée) — pas de fenêtre
  horaire particulière à respecter.
- Toujours confirmer avant un run réel contre preprod (charge sur une instance partagée).
