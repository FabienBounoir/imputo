# Spécifications — Outil unifié de suivi de chiffrage & d'imputation

> Document de référence pour le développement. La base de données est la **source de
> vérité** ; les Excel actuels sont remplacés par l'application (avec export Excel possible).

---

## 1. Contexte (pourquoi ce projet)

Aujourd'hui, le suivi du projet « Application Mobile » repose sur **3 saisies manuelles
redondantes** que chaque membre de l'équipe doit tenir à jour :

1. **`Chiffrage_Application_Mobile.xlsx`** — suivi du chiffrage et de l'avancement
   (estimation, reste à engager, statut de chaque ticket/sous-tâche).
2. **`Fichier suivi imputation 2024.xlsx`** — feuille de temps (un onglet par personne,
   saisie jour par jour du temps passé sur chaque ticket).
3. **Jira** — création des cartes et changement de leur statut.

Cette triple saisie est chronophage, source d'erreurs et de désynchronisation (un ticket
peut avoir un statut différent dans l'Excel et dans Jira ; le temps consommé n'est pas
relié au chiffrage).

**Objectif** : une application web unique où chacun saisit **une seule fois** son
imputation et où le chiffrage/avancement vit au même endroit. La base de données devient
**la source de vérité**, et l'application peut **exporter un Excel unifié** (et plus tard
offrir un dashboard d'administration plus riche qu'un Excel). L'intégration Jira est
prévue mais **hors périmètre du MVP** (les tickets sont gérés manuellement dans l'app
pour commencer).

---

## 2. Analyse de l'existant (ce que les Excel contiennent réellement)

### A. `Chiffrage_Application_Mobile.xlsx`
- 2 feuilles : `Paramétrage` (listes de valeurs) et `Synthèse` (les données).
- **Hiérarchie à 2 niveaux** : un **Ticket parent** (épopée/feature, ex. `BLM-5319`
  « Mise en place du socle de l'application mobile ») contient des **Sous-tâches**
  (ex. `BLM-5321`, `BLM-5322`…).
- Colonnes de la `Synthèse` :
  - `Sprint` (ex. `Sprint1`, `Sprint 3`, `Multi-sprint`, `Démo`, `V35`, `V36`…)
  - `Ticket` / `Sous-tâche` (clés Jira `BLM-xxxx`) + intitulé
  - `Dev` (personne assignée : Fabien, Loïc, Pablo, Maxime, Sébastien, Edith, David, Lucas…)
  - **Réalisation (Dev / TU)** : `Estimation` + `RAE` (Reste À Engager)
  - **Test** : `Estimation` + `Prépa` + `RAE`
  - **Total** : `Estimation` + `RAE`
  - `% avancement` (calculé ≈ (Estimation − RAE) / Estimation)
  - `État` (workflow, voir ci-dessous) + `Commentaire`
- **Liste d'États** (workflow, ordonné) :
  `🔢 A macro-chiffrer / chiffrer` → `📜 DA à faire/à revoir` → `📨 A déposer` →
  `⌛ En attente de validation Région` → `▶️ Réalisation à faire` → `🚧 En cours de dev` →
  `👀 En MR` → `🦄 A mettre en qualif` → `🛠️ En qualif` → `💢 Defect` →
  `🚨 Retour recette` → `🦊 A mettre en préprod` → `🕰️ En recette métier` →
  `🐦‍🔥 A mettre en production` → `✅ En production`.
- Autres listes de paramétrage : `Cypress / Doc technique / Prépa qualif` (Oui / Non / N/A / À MAJ / MAJ / OK).

### B. `Fichier suivi imputation 2024.xlsx`
- **Un onglet par personne** : Sébastien, David, Loïc, Lucas, Françoise, Damien, Fanny,
  Pablo, Maxime, Fabien, Edith (+ `Aide`, `Feuil1`).
- Structure d'un onglet :
  - Ligne 1 : regroupement par **semaine** (`Semaine 01`…`52`), répété sur **plusieurs
    années** (2024, 2025, 2026 se suivent sur les colonnes).
  - Ligne 2 : entêtes `Tâche | Sous-tâche | Activité | Total conso | Intitulé`, puis une
    **colonne par jour ouvré** (lun→ven ; stockées en dates série Excel : 45292 = 01/01/2024).
  - Lignes suivantes : une ligne = un ticket. `Tâche` = version/lot (`MCO`, `V22`, `V23`,
    `V22.1`, `V24`…), `Sous-tâche` = clé Jira `BLM-xxxx`, `Intitulé` = libellé,
    `Total conso` = somme de la ligne, et **saisie quotidienne** en fractions de journée
    (`0.25`, `0.5`, `0.75`, `1`).
- **Liste d'Activités** : `Infra, Aide, Dev, Analyse, DA, Gatling, Support, Relecture,
  TNR, TU`.
- **Unité d'imputation** : journée, par pas de 0,25 (1 = journée pleine).

### C. Constat de recoupement
Les deux fichiers partagent la même **clé pivot : le ticket Jira `BLM-xxxx`**. Le chiffrage
donne l'estimation et le RAE ; l'imputation donne le **consommé réel**. Les relier permet
de calculer automatiquement : consommé vs estimé, dérive, RAE recalculé, avancement, et de
voir **qui** a travaillé combien sur chaque US.

---

## 3. Glossaire
- **US / Ticket** : élément de travail identifié par une clé Jira (`BLM-xxxx`). Peut être
  parent (épopée) ou sous-tâche.
- **Estimation** : charge prévue (en jours) pour réaliser le ticket.
- **RAE** (Reste À Engager) : charge restante estimée pour finir.
- **Consommé** : temps réellement imputé (somme des imputations).
- **Imputation** : déclaration de temps d'une personne, un jour donné, sur une **cible**
  (ticket OU catégorie), éventuellement une activité, en fraction de journée (0.25 → 1).
- **Cible d'imputation** : ce sur quoi on impute du temps = soit un **Ticket** (`BLM-xxxx`),
  soit une **Catégorie** (Congé, Jour férié, Formation, MCO, Hors-projet, lot/version…).
  Confirmé par les données : une grande partie de l'imputation réelle n'est PAS rattachée à
  un ticket (ex. `MCO` = 215,5 j chez une personne, `Congé`, `Jour férié`…).
- **Activité** : nature du travail (Dev, TU, DA, Analyse, Relecture…). **Optionnelle** —
  dans l'Excel elle est incohérente/souvent vide selon les personnes.
- **Sprint / Version / Lot** : regroupement de tickets, rattaché à un **Projet**.
- **Projet / Chiffrage** : périmètre de chiffrage (Appli Mobile, MCO, V35…). Multi-projets.
- **État** : position du ticket dans le workflow projet.

---

## 4. Personas & rôles
1. **Contributeur** (les 11 membres) : saisit son imputation, voit/édite les tickets qui
   le concernent, met à jour le statut et le RAE de ses tickets.
2. **Lead / chef de projet** (rôle admin) : vue globale, gestion des tickets/sprints,
   réaffectation, export Excel, dashboard, gestion des utilisateurs.

MVP : 2 rôles **par workspace** (`USER`, `ADMIN`). Tout contributeur peut créer/éditer des
tickets de son workspace ; les actions sensibles (suppression, gestion utilisateurs,
invitations, paramétrage des listes) sont réservées à `ADMIN`. Une même personne peut être
ADMIN d'un workspace et simple USER d'un autre.

---

## 5. Périmètre fonctionnel

### Module 1 — Authentification & multi-tenant (login simple)
- **Modèle multi-tenant par espace (workspace).** L'app peut héberger plusieurs équipes /
  projets (logique ESN). Chaque **workspace** a ses propres données isolées (projets,
  tickets, catégories, sprints, états, activités, imputations, membres).
- **Auto-inscription** : s'inscrire **crée un nouveau workspace** dont l'inscrit devient
  **ADMIN**. Le workspace conserve le domaine de l'email du fondateur comme simple libellé
  informatif (ex. `soprasteria.com`), sans effet restrictif.
- **Aucune restriction de domaine** : ni à l'auto-inscription, ni à l'invitation — un admin
  peut inviter n'importe quelle adresse email, quel que soit son domaine. *(Retiré : les
  anciens réglages `ALLOW_PUBLIC_EMAIL_DOMAINS`/`ALLOWED_SIGNUP_DOMAINS` et la restriction
  d'invitation au domaine du workspace n'existent plus.)*
- **Plusieurs admins par workspace** : un admin peut inviter d'autres membres et les
  promouvoir ADMIN. Un admin peut inviter **n'importe quelle adresse email**, sans
  restriction de domaine. Deux admins du même domaine qui s'inscrivent séparément = **deux
  workspaces distincts et isolés**.
- À la création d'un workspace, l'app **pré-remplit** les référentiels par défaut (états du
  workflow, activités, catégories non-productives) pour démarrer immédiatement.
- **Pas d'envoi d'email par l'app (pas de SMTP).** À la création d'un compte, l'app génère
  un **magic link à usage unique** (token signé, à expiration, ex. 7 j) et affiche un
  **modèle de message prêt à copier** (objet + corps contenant le lien). L'admin copie ce
  texte et l'envoie lui-même à la personne (Teams, mail perso, etc.).
- Le destinataire ouvre le magic link → **définit son propre mot de passe** → le token est
  invalidé. Tant que le mot de passe n'est pas défini, le compte est en attente.
- Possibilité pour l'admin de **régénérer** un magic link (si expiré/perdu) et de
  réinitialiser un mot de passe (régénère un lien).
- Login email + mot de passe (hash `argon2`/`bcrypt`), session via cookie httpOnly.
- Chaque utilisateur a : nom affiché (correspond aux onglets actuels), email, rôle, actif/inactif.

### Module 2 — Référentiel Tickets / US (remplace la hiérarchie du chiffrage)
- CRUD de tickets avec hiérarchie parent → sous-tâches, rattachés à un **Projet**.
- Champs d'un ticket : clé (`BLM-xxxx`, saisie manuelle au MVP), titre, parent (optionnel),
  projet, sprint/version, personne assignée (Dev), **estimation Réalisation**,
  **RAE Réalisation**, **estimation Test**, **Prépa**, **RAE Test**, **État** (workflow),
  commentaire, indicateurs (Cypress, Doc technique, Prépa qualif…).
  > Important : le chiffrage a bien **deux estimations et deux RAE** (Réalisation + Test),
  > pas un seul.
- Le **% d'avancement** et le **consommé** sont **calculés** (pas saisis). Le **RAE est
  suggéré** par l'app : `RAE ≈ max(0, estimation − consommé)`, pré-rempli mais **éditable**.
- Filtres : par projet, par sprint, par état, par personne, par parent, recherche texte.
- Vue type **tableau éditable** (proche de l'Excel, pour ne pas dépayser l'équipe) +
  édition inline. Optionnel : vue **kanban** par État.

### Module 3 — Imputation / Feuille de temps (remplace l'Excel imputation)
- Vue **hebdomadaire** par défaut (lun→ven) pour l'utilisateur connecté : lignes = **cibles**
  (tickets ou catégories), colonnes = jours, saisie en 0.25/0.5/0.75/1.
- Ajout d'une ligne : rechercher un **ticket** par clé/titre **ou** choisir une **catégorie**
  (Congé, Jour férié, Formation, MCO, Hors-projet, lot/version) ; activité **optionnelle**.
- Catégories spéciales **non productives** (Congé, Jour férié, Formation…) comptées dans le
  total jour mais **exclues** des indicateurs de charge projet (consommé/écart).
- Contrôles : total/jour mis en évidence si ≠ capacité (par défaut 1, **ajustable** pour les
  temps partiels) — alerte douce, **non bloquante** comme l'Excel.
- Navigation semaine précédente/suivante ; sélection d'année (multi-année 2024→…).
- `Total conso` par ligne et par semaine calculés automatiquement.
- (Admin) consultation de l'imputation de n'importe quel membre.

### Module 4 — Reporting & Export Excel unifié
- **Un seul classeur Excel, multi-feuilles, où l'on voit TOUT** (la DB est la source) :
  1. **« Synthèse US »** : une ligne par ticket — clé, titre, projet, sprint, assigné,
     `Estimation Réal`, `RAE Réal`, `Estimation Test`, `Prépa`, `RAE Test`, **Totaux**,
     **Consommé total**, **détail du consommé par personne**, **écart (Consommé − Estimation)**,
     **% avancement**, **État**, commentaire.
  2. **« Imputation détaillée »** : format proche de l'Excel actuel — par personne, lignes =
     cibles (tickets/catégories), colonnes = jours, avec totaux ligne/semaine.
  3. **« Synthèse par personne »** : jours consommés par personne, ventilés par
     projet / catégorie / activité (et totaux).
  4. **« Synthèse par projet & sprint »** : estimation vs consommé vs RAE, % avancement, par
     projet et par sprint.
  5. **« Hors-projet & absences »** : récap des catégories non-productives (Congé, Férié,
     Formation…) par personne et par mois.
  6. **« Paramétrage »** : référentiels (états, activités, projets, sprints, catégories).
- Filtres d'export possibles (période, projet) ; mise en forme (couleurs d'état, totaux).
- Génération côté serveur (lib type `exceljs`), téléchargement direct.
- **Dashboard admin** (cible, peut être post-MVP) : indicateurs visuels (avancement par
  sprint, charge consommée vs estimée, RAE global, répartition par personne/activité) —
  pensé pour être *« mieux qu'un Excel »*.

### Module 5 — Paramétrage (admin)
- Gestion des listes : Projets, États (workflow ordonné + emoji/couleur), Activités,
  Sprints/Versions, **Catégories** (création / suppression).
- **Suppression = archivage différé (soft-delete)** : supprimer une catégorie (ou un
  projet/sprint) ne détruit pas immédiatement les imputations/tickets liés ; ils sont
  **déplacés dans une zone « Archivé »** conservée un délai défini (30 j) avant purge
  réelle, pour pouvoir annuler une bêtise. Restauration possible pendant ce délai.
- Gestion des utilisateurs (création, rôle, désactivation — un user inactif conserve son
  historique).

### Hors périmètre MVP (prévu plus tard)
- **Intégration Jira** : création de cartes et synchronisation des statuts depuis l'app.
  → Le modèle de données réserve la clé Jira comme identifiant pour faciliter ce branchement
  ultérieur (one-way push puis sync bidirectionnel).
- SSO Sopra Steria (cible), notifications, historique/audit avancé.

---

## 6. Modèle de données (PostgreSQL relationnel recommandé)

**Pourquoi relationnel plutôt que NoSQL ?** Les besoins clés sont des **agrégations**
(somme du consommé par US, par personne, par sprint ; jointure chiffrage ↔ imputation ;
écarts et avancement). Ces requêtes sont naturelles et performantes en SQL, et le modèle
est intrinsèquement relationnel (un ticket ↔ N imputations ↔ N personnes). Un document store
(MongoDB) obligerait à dupliquer/recalculer ces agrégats. **Alternative acceptable** :
MongoDB si l'on privilégie la simplicité de déploiement, mais le reporting sera plus
verbeux. Recommandation : **PostgreSQL + Drizzle ORM** (léger, typé, idéal avec SvelteKit).

### Entités principales

**Multi-tenant** : toutes les entités métier portent un `workspaceId` et sont filtrées par
le workspace de l'utilisateur courant (isolation stricte). L'identité (`User`) est
**globale** (une personne peut appartenir à plusieurs workspaces) ; le rôle et la capacité
sont portés par l'appartenance (`Membership`).

- **Workspace** : `id, name, allowedDomain (ex. soprasteria.com), accentColor (hex, défaut
  vert `#16A34A`), createdByUserId, createdAt`.
- **User** (identité globale) : `id, displayName, email (unique global),
  passwordHash (nullable tant que non défini), themePref (LIGHT|DARK|SYSTEM, défaut SYSTEM),
  active, createdAt`.
- **Membership** (appartenance d'un user à un workspace) :
  `id, workspaceId, userId, role (USER|ADMIN), capacityPerDay (default 1, temps partiel),
  active`. Unicité `(workspaceId, userId)`. Le rôle est **par workspace**.
- **SetupToken** (magic link) : `id, userId, workspaceId, tokenHash,
  purpose (INVITE|RESET), expiresAt, usedAt (nullable)`. Le token brut n'est jamais stocké.
- **Project** : `id, workspaceId, name, archivedAt (nullable)` (Appli Mobile, MCO, V35…).
- **Ticket** : `id, workspaceId, key (BLM-xxxx, unique par workspace), title, projectId,
  parentId (nullable → self), sprintId, assigneeId, estimationReal, raeReal, estimationTest,
  prepa, raeTest, stateId, comment, flags (jsonb : cypress, docTech, prepaQualif…),
  archivedAt (nullable), createdAt, updatedAt`.
  - **Deux estimations + deux RAE** (Réalisation et Test), conformes au chiffrage.
- **Category** : `id, workspaceId, label, kind (PRODUCTIVE|NON_PRODUCTIVE),
  projectId (nullable), archivedAt (nullable)`. Congé/Férié/Formation = NON_PRODUCTIVE ;
  MCO/lot = PRODUCTIVE.
- **State** : `id, workspaceId, label, emoji, order, color` (workflow ordonné).
- **Activity** : `id, workspaceId, label` (Dev, TU, DA…) — référencée de façon **optionnelle**.
- **Sprint** : `id, workspaceId, name, order, projectId, archivedAt (nullable)`.
- **TimeEntry** (imputation, granularité jour, **cible polymorphe**) :
  `id, workspaceId, userId, targetType (TICKET|CATEGORY), ticketId (nullable),
  categoryId (nullable), activityId (nullable), date (DATE), amount (numeric 0.25..1),
  createdAt, updatedAt`.
  - Exactement un des deux (`ticketId` XOR `categoryId`) renseigné (contrainte CHECK).
  - Unicité conseillée : `(workspaceId, userId, ticketId, categoryId, activityId, date)`.
- (Vues/agrégats) : `consumed_by_ticket`, `consumed_by_ticket_user`, `avancement`
  (toujours scopés workspace).

> **Archivage (soft-delete)** : `archivedAt` sur Project/Ticket/Category/Sprint. Les
> requêtes courantes filtrent `archivedAt IS NULL`. Une purge planifiée supprime
> définitivement après le délai de rétention (30 j). Restauration = remettre `archivedAt`
> à NULL.

### Indicateurs dérivés (calculés, non stockés)
- `Consommé(US) = Σ TimeEntry.amount` sur le ticket (option : par activité, par personne).
- `Écart(US) = Consommé − (estimationReal + estimationTest)`.
- `% avancement(US) = estimation > 0 ? clamp((estimation − rae) / estimation, 0, 1) : 0`
  (garde-fou division par zéro ; `estimation`/`rae` = somme Réalisation + Test).
- `RAE suggéré = max(0, estimation − consommé)` (pré-rempli, éditable).
- Le **consommé projet** exclut les catégories `NON_PRODUCTIVE` (congés, fériés…).

---

## 7. Architecture technique

### Vue en couches
```
Navigateur (Svelte) ──cookie session──► SvelteKit (Node)
  hooks.server.ts  → contexte requête (user + workspace courant + rôle → locals)
  Pages (+page.server.ts: load + form actions)  +  API (+server.ts: export Excel, JSON)
  Services métier (lib/server/services)
  Couche données (lib/server/db, Drizzle) ── TOUTE requête scopée workspaceId
                                            │
                                   PostgreSQL  +  jobs planifiés
```

- **Frontend + Backend** : **SvelteKit** idiomatique — `load` + **form actions** pour la
  saisie (pas d'API REST séparée à maintenir) ; `+server.ts` réservé au **téléchargement
  Excel** et aux appels JSON utilitaires (autocomplete tickets). Pas de microservice.
- **Contexte de requête** (`hooks.server.ts`) : valide le cookie de session, charge `user`,
  le `workspace` courant et le `rôle` dans `locals`. Les pages/services le reçoivent.
- **Isolation multi-espaces (propriété n°1)** : une **couche d'accès aux données unique** où
  **chaque fonction exige et applique le `workspaceId`** — pas de requête « libre ». Garanti
  au niveau applicatif + **tests d'isolation** automatisés (voir §9). (RLS Postgres possible
  plus tard en double filet, non retenu au MVP.)
- **DB** : **PostgreSQL** via **Drizzle ORM** (migrations typées). Driver `postgres-js` avec
  `DATABASE_URL` ; **sessions stockées en base** (app **stateless**, compatible serverless).
- **Validation** : schémas **Zod** côté serveur sur toutes les form actions / endpoints.
- **Auth** : session cookie httpOnly + hash `argon2` (lib `lucia` ou implémentation maison
  légère). Sessions et `SetupToken` (magic link) en base.
- **Export Excel** : `exceljs` (génération serveur, streaming du fichier).
- **UI** : composants Svelte ; grille d'imputation/tickets maison (saisie clavier), cartes
  douces ailleurs (voir §7bis Design).

### Déploiement portable (double cible : Vercel + Docker/Kubernetes)
- **Adapter SvelteKit interchangeable** selon la cible de build (variable d'env) :
  `@sveltejs/adapter-vercel` pour Vercel, `@sveltejs/adapter-node` pour l'image Docker
  (→ Kubernetes à terme). Le code applicatif reste identique.
- **Dockerfile** produisant une image Node autonome (build `adapter-node`), prête pour K8s.
- **Base** : `DATABASE_URL` abstrait. Sur serverless (Vercel) → Postgres managé avec
  **pooler** (Neon/Supabase/PgBouncer) ; en Docker/K8s → Postgres standard. Le driver et le
  pooling sont les seuls points sensibles à valider par cible.
- **Jobs planifiés portables** : la purge des archives (30 j) et le nettoyage des magic
  links expirés sont exposés comme **endpoint(s) protégé(s) par secret** (ex.
  `/api/jobs/cleanup`), **déclenchés par le scheduler de la plateforme** : Vercel Cron en
  serverless, **CronJob Kubernetes** / cron système en conteneur. Logique idempotente, pas
  de scheduler en mémoire (incompatible serverless).
- **Variables d'environnement (config)** :
  - `DATABASE_URL` — connexion PostgreSQL.
  - `SESSION_SECRET` — secret de signature des sessions/tokens.
  - `MAGIC_LINK_TTL` (ex. `7d`) — durée de validité des liens d'invitation/reset.
  - `ARCHIVE_RETENTION` (ex. `30d`) — délai avant purge des éléments archivés.
  - `BASE_URL` — base d'URL utilisée pour construire les magic links.
  - `CRON_SECRET` — jeton protégeant l'endpoint de jobs planifiés (`/api/jobs/*`).
  - `BUILD_ADAPTER` (`node` | `vercel`, défaut `node`) — choisit l'adapter au build.
- **Structure de projet indicative** :
  ```
  src/
    hooks.server.ts       (session → locals: user, workspace, role)
    lib/server/db/        (schema Drizzle, client, migrations, requêtes scopées workspace)
    lib/server/services/  (imputation, tickets, auth, export, params — logique métier)
    lib/server/auth/      (sessions, hash argon2, magic links)
    lib/server/excel/     (génération export multi-feuilles)
    lib/server/validation/(schémas Zod)
    lib/components/        (grille imputation, table tickets, pastilles d'état, thème)
    routes/(auth)/         (login, inscription/création workspace, set-password)
    routes/imputation/     (feuille de temps hebdo)
    routes/tickets/        (référentiel + édition)
    routes/admin/          (params, users, catégories, export)
    routes/api/jobs/       (endpoints planifiés protégés par CRON_SECRET)
  Dockerfile               (image Node pour Docker/K8s)
  ```

---

## 7bis. Design & UX

### Direction artistique : « doux & accueillant », mais efficace
- Ambiance **chaleureuse** : coins arrondis, palette tendre, espacements confortables,
  ombres légères, micro-animations subtiles. Pas d'interface froide ni agressive.
- **Cartes douces** pour les écrans de consultation/synthèse (accueil, dashboard, détail
  d'un ticket, profil).
- **Mais grilles efficaces** pour la saisie répétitive : l'imputation et le tableau des
  tickets restent des **grilles compactes** (juste habillées de l'âme douce). Objectif :
  toute la semaine visible d'un coup + saisie au clavier rapide. On n'empile **pas** une
  grosse carte par ligne sur ces écrans (sinon scroll + lenteur = on recrée le problème).

### Thème
- **Clair ET sombre**, toggle utilisateur, **suit le réglage système** par défaut
  (`User.themePref = SYSTEM|LIGHT|DARK`). Le choix est mémorisé.

### Couleur & personnalisation
- **Couleur d'accent par espace** (`Workspace.accentColor`), **vert par défaut** (`#16A34A`).
- L'admin la change dans les paramètres : **palette de presets** + **saisie hex libre**.
- Personnalisation volontairement **limitée à la couleur d'accent** (pas de logo, pas de
  réglages de densité/thème par espace au MVP) pour rester simple.
- La couleur d'accent se décline en variables CSS (`--accent`, états hover/actif),
  utilisée pour boutons primaires, liens, surbrillances, et compatible clair/sombre.

### Navigation & layout
- **Sidebar gauche** : Imputation / Tickets / Admin, avec **sélecteur d'espace** en haut
  (pour les users présents dans plusieurs espaces) et menu profil/thème en bas.
- Contenu principal à droite ; barres d'actions et filtres contextuels en haut de page.

### Écran d'imputation (le plus utilisé) — grille douce hybride
- Lignes = cibles (tickets/catégories), colonnes = jours (L→V), colonne **Σ** par ligne,
  **total/jour** en bas avec alerte douce si ≠ capacité.
- **Saisie clavier** : Tab / flèches pour naviguer, raccourcis `1`/`2`/`3`/`4` → 0.25 / 0.5 /
  0.75 / 1, `0`/Suppr pour vider. Pastille d'état colorée en tête de ligne.
- Pré-remplissage / duplication de la semaine précédente pour aller vite.

### États du workflow
- Réutiliser les **emojis + couleurs** existants (🚧 En cours, 👀 En MR, 🛠️ En qualif,
  ✅ En prod…) sous forme de **pastilles colorées** cohérentes sur tous les écrans (table,
  kanban, filtres).

### Accessibilité & responsive
- Contraste suffisant en clair/sombre, focus visible, navigation clavier complète.
- Cible **desktop d'abord** (outil de bureau) ; rester lisible sur tablette. Le mobile n'est
  pas prioritaire pour la saisie de grille.

---

## 8. Parcours utilisateur clés
1. **Saisir mon imputation de la semaine** : login → page Imputation (semaine courante) →
   ajouter/retrouver mes tickets → saisir 0.25–1 par jour → total auto.
2. **Mettre à jour un ticket** : page Tickets → filtrer (mon nom / sprint) → éditer RAE,
   État, commentaire inline.
3. **Créer une US** : Tickets → « Nouveau » → clé, titre, parent, sprint, estimations.
4. **Exporter pour le management** : Admin → Export → télécharge l'Excel unifié.

---

## 9. Exigences non-fonctionnelles
- **Simplicité de saisie** avant tout (l'app doit être plus rapide que l'Excel, sinon
  l'équipe ne migrera pas) : édition inline, raccourcis, pré-remplissage.
- Multi-année (le format actuel couvre 2024→2026).
- ~11 utilisateurs, faible charge ⇒ pas de contrainte de scalabilité forte.
- Données internes Sopra Steria ⇒ hébergement maîtrisé, mots de passe hashés, HTTPS.
  **À valider** : l'hébergement interne et l'auth maison sont-ils autorisés, ou le SSO
  Sopra devient-il un prérequis ? (impacte le Lot 1).
- **Concurrence** : le tableau Tickets est partagé. Stratégie MVP = *last-write-wins* avec
  `updatedAt` + avertissement si la ligne a changé depuis le chargement. L'imputation est
  cloisonnée par utilisateur ⇒ peu de conflits.
- **Suivi interne (pas de CRA facturé au MVP)** : pas de verrouillage de période ni de
  workflow de validation imposés. Un `updatedAt`/horodatage simple suffit (audit complet =
  post-MVP si le besoin CRA apparaît).
- Sauvegarde régulière de la base (l'Excel servait aussi d'archive).
- **Tests ciblés** (pas de couverture exhaustive au MVP) : priorité absolue aux **tests
  d'isolation multi-espaces** (un workspace ne voit jamais un autre) et aux **calculs**
  (consommé, écart, RAE suggéré, % avancement, totaux). Vitest pour l'unitaire/services,
  quelques E2E Playwright sur les parcours critiques. **CI minimale** (lint + tests au push).

---

## 10. Découpage en lots (roadmap)
- **Lot 0 — Cadrage** : valider ce SPECS.md, schéma DB, maquettes des 2 écrans clés.
- **Lot 1 — Socle multi-tenant (complet)** : SvelteKit + Postgres + Drizzle, auth complète
  (auto-inscription → création workspace, magic link, invitations sans restriction de
  domaine, **sélecteur de workspace** pour les users multi-espaces), modèle complet scopé workspace
  (Workspace/User/Membership/Project/Ticket/Category/State/Activity/Sprint/TimeEntry +
  soft-delete), garde d'isolation systématique (toute requête filtrée par workspace) +
  **tests d'isolation**, seed des référentiels par défaut à la création d'un workspace.
  (Pas d'import Excel : démarrage sur base vierge.)
- **Lot 2 — Référentiel Tickets** : CRUD + tableau éditable + filtres + workflow États.
- **Lot 3 — Imputation** : feuille de temps hebdo, saisie 0.25–1, totaux, multi-semaine/année.
- **Lot 4 — Reporting** : calculs consommé/écart/avancement + **export Excel unifié**.
- **Lot 5 — Admin & dashboard** : gestion users/params + dashboard visuel.
- **Lot 6 (futur)** : intégration Jira (push puis sync), SSO.

---

## 11. Migration des données existantes — HORS PÉRIMÈTRE
- **Pas de migration automatique** des Excel. L'équipe **ressaisira / remplira l'app
  elle-même**. On démarre donc sur une **base vierge** (chaque workspace commence vide, avec
  uniquement les référentiels par défaut).
- Les Excel restent une référence d'analyse (structure des données, listes de valeurs) mais
  ne sont **pas** importés.

---

## 12. Décisions actées (challenge du 25/06/2026)
- **Nature** : suivi **interne uniquement** (pas de CRA facturé) ⇒ pas de lock/validation
  au MVP.
- **Hors-ticket** : **catégories dédiées** (`Category`), `TimeEntry` polymorphe ticket OU
  catégorie.
- **Périmètre chiffrage** : **multi-projets** (`Project`) ; admin crée/supprime catégories,
  projets, sprints.
- **Suppression** : **archivage différé** (soft-delete + rétention 30 j) avant purge, avec
  restauration possible.
- **RAE** : **suggéré** par l'app (`max(0, estimation − consommé)`), éditable.
- **Activité** : **optionnelle**.
- **Double estimation + double RAE** (Réalisation + Test) sur les tickets.
- **Auth & multi-tenant** : auto-inscription **ouverte** → crée un **workspace isolé** dont
  l'inscrit devient ADMIN. **Plusieurs admins** par workspace possibles. **Aucune
  restriction de domaine** : ni à l'inscription, ni à l'invitation (n'importe quelle adresse
  email peut être invitée). Deux admins inscrits séparément = deux workspaces distincts isolés.
- **Isolation stricte** : **aucun partage de données entre workspaces** (ni tickets, ni
  référentiels, ni imputations). Chaque workspace est totalement étanche.
- **Stratégie de livraison** : **multi-espaces complet dès la v1** (auto-inscription,
  création de workspace, sélecteur d'espace, tests d'isolation). Rappel : un espace = un
  domaine unique, mais des espaces différents peuvent avoir des domaines différents (et deux
  espaces du même domaine restent étanches).
- **Validité du magic link : 7 jours** (`MAGIC_LINK_TTL=7d`).
- **Rétention des archives avant purge : 30 jours** (`ARCHIVE_RETENTION=30d`).
- **Pas de migration des Excel** : démarrage sur base vierge, ressaisie manuelle par l'équipe.
- **Déploiement portable** : double cible **Vercel** (adapter-vercel + Postgres managé/pooler)
  **et Docker → Kubernetes** (adapter-node), via `BUILD_ADAPTER`. App **stateless** (sessions
  en base). Jobs planifiés = **endpoint protégé** déclenché par Vercel Cron / CronJob K8s.
- **Isolation** : application + **tests d'isolation** (RLS Postgres non retenu au MVP).
- **Tests** : **ciblés** (isolation + calculs en priorité), CI minimale.
- **Design** : direction « doux & accueillant » (cartes douces sur les écrans de consultation)
  mais **grilles efficaces** pour imputation/tickets. Thème **clair + sombre** (suit le
  système). **Couleur d'accent par espace, vert par défaut**, modifiable par l'admin (palette
  + hex). Personnalisation limitée à la couleur. Layout **sidebar gauche** + sélecteur
  d'espace. Cible **desktop d'abord**.
- **Invitation** : pas de SMTP ; l'app génère un **magic link** + un **modèle de message à
  copier** que l'admin envoie manuellement. L'utilisateur définit son mot de passe via le lien.
- **Export Excel** : **multi-feuilles couvrant tout** (Synthèse US, Imputation détaillée,
  Synthèse par personne, par projet/sprint, Hors-projet/absences, Paramétrage).

## 13. Points encore ouverts
- **Auth/hébergement** : auth maison + hébergement interne autorisés, ou SSO Sopra requis ?
  (peut transformer le SSO en prérequis du Lot 1).
- **Durée de rétention** avant purge des archives (90 j proposé, à confirmer).
- **Capacité par défaut / temps partiels** : confirmer qui est < 1 j/jour (Françoise, Fanny ?).
