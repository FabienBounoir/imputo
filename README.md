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

## Déploiement portable

L'adapter est choisi par `BUILD_ADAPTER` :

- **Docker / Kubernetes** : `BUILD_ADAPTER=node` (défaut) → `docker build -t imputo .`
- **Vercel** : `BUILD_ADAPTER=vercel` (+ PostgreSQL managé avec pooler).

Jobs planifiés (purge des archives, nettoyage des magic links) :
`POST /api/jobs/cleanup` protégé par `CRON_SECRET` — à déclencher via Vercel Cron ou un
CronJob Kubernetes.

## Variables d'environnement

Voir [`.env.example`](./.env.example). Principales : `DATABASE_URL`, `SESSION_SECRET`,
`MAGIC_LINK_TTL` (7d), `ARCHIVE_RETENTION` (30d), `PUBLIC_BASE_URL`, `CRON_SECRET`, `BUILD_ADAPTER`.

## État (Lot 1 livré)

- ✅ Auth multi-tenant : inscription → création d'espace, login, magic link (message à copier), changement d'espace
- ✅ Modèle complet scopé par espace (soft-delete inclus) + isolation garantie & testée
- ✅ Référentiels par défaut au démarrage d'un espace
- ✅ Écran **Imputation** (grille hebdo, saisie 0.25→1)
- ✅ Écran **Tickets** (chiffrage, double estimation/RAE, consommé & avancement calculés)
- ✅ **Admin** (invitations, membres, couleur d'accent)
- ⏳ À venir : export Excel multi-feuilles, dashboard, intégration Jira
