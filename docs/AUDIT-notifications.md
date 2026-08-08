# AUDIT — Système de notifications (Web Push)

> État des lieux au 2026-07-26. Fait suite à `docs/SPECS-notifications.md` (qui est **obsolète** :
> il indique le feature comme "non développée à ce jour", alors qu'elle est en réalité implémentée
> et fonctionnelle dans son principe — voir §1). Ce fichier ne modifie rien, il sert de base pour
> décider quoi corriger / faire évoluer.

## 1. Ce qui existe déjà et fonctionne

Le chemin complet est bien implémenté, de bout en bout :

- **Schéma DB** : `push_subscription`, `notification_log` (dédup unique sur
  `userId+workspaceId+kind+refDate`), `user.notifPrefs`, `ticket.raeUpdatedAt`. ✅
- **Abonnement client** : `src/lib/push.ts` + `/api/push/{subscribe,unsubscribe,prefs,test}`,
  UI dans `/settings` (toggle principal + par type + bouton test). ✅
- **Service Worker** (`src/service-worker.ts`) : réception du push, affichage, clic → focus/ouvre
  l'URL cible. ✅
- **Envoi** (`services/push.ts`) : `web-push` + VAPID, purge automatique des subscriptions mortes
  (410/404) ou en échec répété (≥5). ✅
- **Détection** (`services/notifications.ts`) : 4 types (`EVENING_MISSING`, `MORNING_YESTERDAY`,
  `RAE_STALE`, `WEEKLY_RECAP`), dédup par verrou DB (`onConflictDoNothing`), respect des
  préférences utilisateur, jours ouvrés uniquement (fuseau Paris). ✅
- **Endpoint cron** (`/api/jobs/notify?kind=morning|evening|weekly`) protégé par `CRON_SECRET`. ✅
- **RAE_STALE mis à jour post-refonte** : suit bien la suppression de `ticket.assigneeId`
  (§2.6 de `SPECS-pilotage-budget.md`) — notifie les contributeurs réels via `time_entry`, plus
  l'ancien `assigneeId`. Le code est **en avance** sur la spec notifications (qui, elle, décrit
  encore l'ancien comportement par assigné — §7 de `SPECS-notifications.md`, à corriger ou supprimer).

**Conclusion : le système n'est pas "à construire", il est déjà quasi complet.** Les points
ci-dessous sont soit des trous d'exploitation (pas de code à écrire, juste à brancher/documenter),
soit de vrais bugs, soit des évolutions.

## 2. Pourquoi ça peut ne "pas marcher" en pratique

Rien dans le code n'est cassé, mais rien ne déclenche non plus le cron automatiquement :

- **Aucun scheduler n'est committé** dans le repo (pas de `vercel.json` avec `crons`, pas de
  manifeste `CronJob` k8s, pas de workflow GitHub Actions planifié). L'endpoint `/api/jobs/notify`
  attend un appel externe — comme prévu par la spec (§9) — mais cette pièce externe n'existe nulle
  part dans le dépôt. **Sans ça, aucune notif ne part jamais**, même si tout le reste est correct.
- **`.env.example` ne documente pas les clés VAPID** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`) ni `NOTIF_RAE_STALE_DAYS`, alors qu'elles sont bien lues par `config.ts` et
  présentes dans le `.env` local. Un nouvel environnement (autre dev, prod) démarrera donc avec
  push **silencieusement désactivé** (`ensureVapid()` renvoie `false`, aucune erreur visible côté
  serveur — juste `data.vapidConfigured = false` côté UI `/settings`).
- **Aucun test automatisé** sur `notifications.ts` / `push.ts` (contrairement à `calc.ts`,
  `date.ts`, `isolation.ts`, etc. qui ont leur `.test.ts`). La logique de détection (jour manquant,
  semaine incomplète, RAE périmé) n'est vérifiée qu'à la main.

→ Pour rendre le système réellement actif : (a) brancher un scheduler externe (Vercel Cron le plus
simple si déployé sur Vercel, sinon CronJob k8s) sur les 3 créneaux (matin/soir/vendredi), (b)
compléter `.env.example`, (c) ajouter un minimum de tests sur la détection.

## 3. Bugs trouvés (comportement incorrect, pas juste manque d'outillage)

### 3.1 Les vacances "semaine" (`weeklyVacation`) ne sont pas prises en compte

`dayMissing()` et `weeklyRecap()` (dans `notifications.ts`) ne considèrent comme "absent" que les
jours où une **catégorie NON_PRODUCTIVE a été saisie en imputation** (`timeEntry` + jointure
`category.kind`). Mais il existe une **deuxième notion d'absence**, indépendante : la table
`weekly_vacation` (posée via `setVacation()` dans `services/weeklyObjectives.ts`), qui marque un
utilisateur "en vacances" pour toute une semaine — utilisée par les objectifs hebdo / le dashboard,
mais **jamais lue par le service de notifications**.

**Conséquence concrète** : une personne déclarée en vacances toute la semaine (via
`weekly_vacation`) mais qui n'a saisi aucune ligne d'imputation "congé" ce jour-là reçoit quand
même les rappels `EVENING_MISSING` / `MORNING_YESTERDAY` / `WEEKLY_RECAP` pendant ses vacances.

**Correctif (léger)** : dans `dayMissing()` et `weeklyRecap()`, exclure aussi les membres présents
dans `listVacationsForWeek(workspaceId, mondayOf(day))` (fonction déjà existante, réutilisable telle
quelle) — même logique que le `absentSet` actuel, juste une source de plus.

### 3.2 Hypothèse non confirmée sur `RAE_STALE` (fenêtre de contributeurs)

Signalé dans le code lui-même (`notifications.ts:141-144`) et dans `SPECS-pilotage-budget.md`
§2.6 : on notifie **tous les utilisateurs ayant un jour imputé sur le ticket un jour donné, sans
limite de temps**. Un ancien contributeur qui a imputé une fois il y a 8 mois et n'y touche plus
continuera de recevoir les alertes RAE périmé sur ce ticket. C'est documenté comme une hypothèse
"à confirmer", pas un oubli — mais elle n'a jamais été tranchée. À arbitrer : soit on accepte l'état
actuel, soit on ajoute une fenêtre glissante (ex. dernier `timeEntry` du user sur ce ticket < N
jours).

### 3.3 Doc `SPECS-notifications.md` désynchronisée du code

Section 1 dit la feature n'est "pas développée à ce jour" (faux) ; section 7 décrit encore la
détection RAE par `assigneeId` (colonne supprimée depuis). À corriger ou fusionner avec cet audit
pour éviter de futures confusions dans un onboarding ou une relecture rapide.

## 4. Évolutions possibles (nouvelles fonctionnalités récentes → nouveaux types de notif)

Les 4 types actuels couvrent l'imputation et le RAE. Plusieurs fonctionnalités ajoutées depuis
n'ont **aucun rappel associé** alors qu'elles suivent le même schéma (préférence, dédup,
push) :

- **Team mood** (`workspace.moodEnabled`, `moodVote`, `moodPeriodKind`) : aucun rappel pour voter
  quand une période de mood est ouverte et que l'utilisateur n'a pas encore voté. Candidat naturel
  pour un 5ᵉ type de notif (`MOOD_PENDING`), déclenché en fin de période ou à mi-période, seulement
  sur les espaces avec `moodEnabled = true`.
- **Objectifs hebdo** (`weeklyObjective`) : pas de rappel si un membre n'a **aucun objectif défini**
  pour la semaine (côté manager) ou si un objectif assigné reste sans imputation associée en fin de
  semaine. À évaluer si c'est un besoin réel côté managers avant de l'ajouter (pas vu de demande
  explicite dans les specs existantes → **YAGNI tant que non demandé**).
- **Phase Test désactivable** (`workspace.testPhase`) : n'introduit pas de nouveau besoin de
  notif — RAE_STALE en tient déjà compte correctement (`resolved.test` ignoré si `testPhase` est
  false, `notifications.ts:178`).
- **Suppression de la restriction de domaine à l'inscription** (commit `cc896b8`) : les espaces
  restent rejoints uniquement par invitation explicite (pas d'auto-join par domaine), donc pas de
  besoin de notifier un admin de nouvelles inscriptions — à confirmer que c'est bien le
  fonctionnement voulu, mais rien dans le code n'indique un flux d'auto-inscription à surveiller.

**Recommandation** : ne pas ajouter de nouveau type de notif sans un besoin exprimé — le seul qui
saute aux yeux au vu des fonctionnalités récentes est **le mood** (fonctionnalité de suivi actif,
même mécanique de "période avec action attendue" que les rappels existants). Les objectifs hebdo
sont plus incertains (pas de retour utilisateur dessus) : à trancher avec le PO avant de coder.

## 5. Plan d'action suggéré (par ordre de coût/risque croissant)

1. **Corriger `.env.example`** (VAPID_*, NOTIF_RAE_STALE_DAYS) — 5 min, zéro risque.
2. **Corriger le bug `weeklyVacation`** (§3.1) — petit diff, comportement clairement faux à corriger.
3. **Brancher un scheduler réel** (Vercel Cron ou CronJob k8s selon l'hébergement cible) sur les 3
   créneaux — nécessaire pour que quoi que ce soit parte un jour en prod.
4. **Ajouter des tests unitaires** sur la détection (`dayMissing`, `weeklyRecap`, `raeStale`) façon
   `calc.test.ts` — pas de mock DB nécessaire si on isole les fonctions pures de calcul, sinon
   petits tests d'intégration comme `isolation.test.ts`.
5. **Trancher l'hypothèse RAE_STALE** (§3.2) avec le PO — garder tel quel ou ajouter une fenêtre.
6. **Mettre à jour / fusionner `SPECS-notifications.md`** pour qu'il reflète l'état réel.
7. **Si validé par le PO** : ajouter `MOOD_PENDING` en suivant exactement le patron des 4 types
   existants (même table `notification_log`, même dédup, même préférence utilisateur).

Rien ci-dessus ne nécessite de nouvelle dépendance ni de nouvelle abstraction — tout se branche sur
les mécanismes déjà en place (`maybeNotify`, `notification_log`, `notifPrefs`).
