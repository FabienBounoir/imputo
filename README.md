# Imputo

Outil unifié de **suivi de chiffrage** et **d'imputation** (remplace les Excel + Jira).
Voir [`SPECS.md`](./SPECS.md) pour la spécification complète et les décisions actées.

Stack : **SvelteKit** (Svelte 5) · **PostgreSQL** + **Drizzle** · auth maison (argon2 + sessions) · multi-tenant.

## Démarrage (développement)

```bash
# 1. Lancer PostgreSQL (Docker)
docker compose up -d

# 2. Config
cp .env.example .env        # ajuster si besoin

# 3. Dépendances + base
npm install
npm run db:migrate          # applique les migrations

# 4. Lancer l'app
npm run dev                 # http://localhost:5173
```

### Tout lancer en une commande (DB + front, sans Node en local)

```bash
docker compose up -d --build   # → http://localhost:3000
```

Démarre Postgres, applique les migrations puis lance le front buildé (adapter Node), tout dans
le réseau Docker de `docker-compose.yml`. Après un changement de code : `docker compose up -d --build app`.

**Déploiement sur un serveur distant (VPS…)** : mettre à jour `ORIGIN` **et** `BASE_URL`
dans `.env` avec l'URL publique réelle, identique pour les deux (ex. `https://imputo.mondomaine.fr`
ou `http://12.34.56.78:3000`) :
- `ORIGIN` manquant → tous les formulaires échouent avec `Cross-site POST form submissions are
  forbidden` (adapter-node ne connaît par défaut que son adresse interne au container et rejette
  les `POST` dont l'en-tête `Origin` du navigateur ne correspond pas).
- `BASE_URL` manquant → les liens envoyés (invitation membre, magic link) pointent vers
  `localhost` au lieu de l'URL publique.

Puis `docker compose up -d --build`.

**Scripts ponctuels sur la base déployée (`db:seed`, `db:unseed`, `db:studio`…)** : ces scripts
utilisent `tsx`/`drizzle-kit`, absents de l'image `app` de prod (devDependencies retirées).
Utiliser le service `tools` du compose (jamais démarré par `up`, uniquement via `run`) :

```bash
docker compose run --rm tools npm run db:seed
docker compose run --rm tools npm run db:unseed
```

Première utilisation : aller sur `/register` pour **créer un espace** (vous en devenez l'admin).

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` / `npm run preview` | build de production / prévisualisation |
| `npm run check` | vérification de types (svelte-check) |
| `npm test` | tests (calculs + **isolation multi-espaces**) |
| `npm run db:generate` | génère une migration Drizzle depuis le schéma |
| `npm run db:migrate` | applique les migrations |
| `npm run db:studio` | explorateur Drizzle Studio |
| `npm run db:seed` | crée/rafraîchit l'environnement de test **QA Sandbox** (voir ci-dessous) |
| `npm run db:unseed` | supprime l'environnement de test **QA Sandbox** |

## Environnement de test (QA Sandbox)

`npm run db:seed` déploie sur la base configurée (`DATABASE_URL`) un espace de démo jetable,
prêt à explorer manuellement ou à montrer, sans toucher aux autres espaces :

- **Espace** : `QA Sandbox`
- **4 comptes** (mots de passe volontairement simples) :

  | Email | Mot de passe | Rôle |
  | --- | --- | --- |
  | `alice@sandbox.test` | `alice123` | Admin |
  | `bob@sandbox.test` | `bob123` | Membre (80 % de capacité) |
  | `chloe@sandbox.test` | `chloe123` | Membre |
  | `david@sandbox.test` | `david123` | Membre |

- **36 tickets** sur **3 projets** (Mobile/Web/Backend), **8 sprints** et **4 versions** couvrant
  **~4 mois glissants** (V1.0 déjà livrée → V1.3 en cours sur le sprint courant), avec RAE par
  activité, groupes de tickets, code SSP, estimation prévisionnelle/enveloppe totale sur certains
- **Imputations cohérentes** des 4 comptes sur toute la période (chacun porte ~1 ticket par
  sprint + coups de main occasionnels, congés/formation mélangés), toujours calculées **par
  rapport à la date d'exécution** — jamais d'imputations figées dans le passé après un déploiement
  tardif. Le RAE est renseigné **par activité** (jamais le champ global directement), qui est
  ensuite recomposé par l'appli — exactement comme dans l'usage réel
- **Historique de snapshots** sur toute la période pour une vraie courbe conso/RAE dans les
  dashboards *Par version* / *Par sprint* (RAE qui décroît, consommé qui croît, plat une fois le
  ticket terminé)

Le script est **idempotent** : il nettoie d'abord un éventuel `QA Sandbox` précédent (workspace +
les 4 comptes), donc `npm run db:seed` peut être relancé à volonté sans accumulation.

`npm run db:unseed` supprime l'espace et les 4 comptes (cascade sur tickets, imputations,
groupes…) sans toucher au reste de la base.

## Déploiement portable

L'adapter est choisi par `BUILD_ADAPTER` :

- **Docker / Kubernetes** : `BUILD_ADAPTER=node` (défaut) → `docker build -t imputo .`
- **Vercel** : `BUILD_ADAPTER=vercel` (+ PostgreSQL managé avec pooler).

Jobs planifiés, tous protégés par `CRON_SECRET` (header `Authorization: Bearer <secret>` ou
`?secret=`) — à déclencher via Vercel Cron ou un CronJob Kubernetes :

| Route | Rôle | Fréquence conseillée |
| --- | --- | --- |
| `POST /api/jobs/cleanup` | purge des archives, nettoyage des magic links | 1×/jour |
| `POST /api/jobs/notify` | rappels d'imputation (`?kind=morning\|evening\|weekly`) | plusieurs fois/jour |
| `POST /api/jobs/snapshot` | fige l'état des tickets (courbe conso/RAE des dashboards) | 1×/jour |
| `POST /api/jobs/wrapped` | fige le récap annuel par personne (no-op hors 1 déc → 5 jan) | 1×/jour |

## Variables d'environnement

Voir [`.env.example`](./.env.example). Principales : `DATABASE_URL`, `SESSION_SECRET`,
`MAGIC_LINK_TTL` (7d), `ARCHIVE_RETENTION` (30d), `BASE_URL`, `CRON_SECRET`, `BUILD_ADAPTER`,
`WRAPPED_FORCE_OPEN` (démo/QA uniquement — ouvre le wrapped toute l'année, jamais en préprod/prod).

## État (Lot 1 livré)

- ✅ Auth multi-tenant : inscription → création d'espace, login, magic link (message à copier), changement d'espace
- ✅ Modèle complet scopé par espace (soft-delete inclus) + isolation garantie & testée
- ✅ Référentiels par défaut au démarrage d'un espace
- ✅ Écran **Imputation** (grille hebdo, saisie 0.25→1)
- ✅ Écran **Tickets** (chiffrage, double estimation/RAE, consommé & avancement calculés)
- ✅ **Admin** (invitations, membres, couleur d'accent)
- ✅ **Périmètres applicatifs** : CP / backup / DP, consolidation charges & économie (voir [`docs/SPECS-perimetres.md`](./docs/SPECS-perimetres.md))
- ⏳ À venir : export Excel multi-feuilles, dashboard, intégration Jira
