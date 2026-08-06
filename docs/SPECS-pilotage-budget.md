# SPEC — Pilotage budgétaire, RAE par activité & dashboards de version

> Spécification de fonctionnalité. **À implémenter sur demande explicite** (non développée à ce jour).
> Ce document est issu d'une séance de cadrage (questions/réponses) sur une liste brute d'idées.
> Les points marqués **⚠️ Hypothèse** sont des choix que j'ai pris par défaut faute de précision —
> à trancher/challenger avant implémentation.

## 0. Périmètre couvert

1. Tableau de synthèse hebdo par personne (validation d'imputation) — dashboard + Excel.
2. Jours fériés (calendrier FR auto), déduits des KPIs de capacité mais imputables quand même.
3. 3 champs budget sur le ticket (PPR, Estimation prévisionnel, Enveloppe totale) + TNF budget.
4. Regroupement libre de tickets (transverse, indépendant de la hiérarchie parent/enfant).
5. Dashboard par version (le plus important) + dashboard par sprint (écran séparé).
6. RAE par activité (sous-lignes RAE, le RAE ticket = somme).
7. Activités : suppression si aucun ticket lié, sinon actif/inactif seulement.
8. Granularité d'imputation paramétrable par espace.
9. Code SSP sur le ticket.
10. Nouvelles formules : Écart d'exécution, TNF budget (Avancement inchangé).
11. Suppression de la colonne "Dev" (assignation manuelle) au profit de sous-lignes
    (activité, personne) dérivées de l'imputation, dans "Tickets & chiffrage".
12. Capacité membre (Admin > Membres) exprimée en **% de la semaine** plutôt qu'en ratio
    "jour/jour" ; avertissement (non bloquant) sur "Mon imputation" en cas de dépassement.
13. Sélecteur "Ajouter un ticket ou une catégorie" (page imputation) : remplacer le `<select>`
    natif par un composant combobox custom (suggestions + catégories + recherche).

## 1. Décisions actées (issues du Q&A)

- **Avancement** : **inchangé**. On garde l'actuel `avancement()` de `calc.ts` :
  `(Estimation − RAE) / Estimation`. La formule alternative évoquée initialement
  (`RAE_RÉEL / (RAE_RÉEL + conso)`) était une erreur de dictée — écartée après vérification
  (elle donnait 100 % pour un ticket pas commencé et 0 % pour un ticket terminé, soit l'inverse
  de la sémantique voulue). Aucun changement à faire sur cette fonction.
- **Écart d'exécution** : `(RAE_RÉEL + conso) − Estimation Réelle`. **Réel uniquement**, toujours
  (n'inclut jamais Estimation Test / RAE Test / Prépa, même si la phase Test de l'espace est active).
- **TNF budget** ≠ **Écart d'exécution** : ce sont **deux métriques distinctes**, à ne pas fusionner
  ni confondre dans l'UI (deux libellés, deux emplacements).
- Vue « imputation par semaine en % » : **pas un nouveau mode de saisie**. La saisie reste
  **par jour** (grille actuelle inchangée). C'est une **vue de synthèse admin** (semaine × personne,
  en % de capacité) pour faciliter la validation des imputations — visible en dashboard **et**
  dans l'export Excel.
- **Jours fériés** : calendrier légal français calculé côté code (pas de saisie manuelle, pas de
  table). On peut quand même imputer sur un jour férié si besoin ; les jours fériés sont
  **déduits du temps attendu** dans les calculs de capacité/KPI (pas de faux "sous-capacité").
- **Granularité d'imputation** paramétrable **par espace** (workspace), pas par utilisateur.
- **RAE par activité** : l'« activité » est **le même référentiel** que celui utilisé dans
  l'imputation (`activity` : Analyse, Dév, Test, Recette…). Le RAE global du ticket devient la
  **somme** des RAE par activité, au lieu d'un champ saisi directement.
- **Regroupement de tickets** : une notion **nouvelle**, libre/transverse, indépendante du
  `parentId` existant (hiérarchie ticket/sous-ticket inchangée).
- **Dashboard version** et **dashboard sprint** : **deux écrans distincts** (sprint ≠ version en
  base : `sprint.kind` = `SPRINT` ou `VERSION`). Le dashboard sprint permet de **changer de sprint**
  via un sélecteur (pas figé sur "le sprint courant").
- **Code SSP** : champ texte simple sur le ticket, valeur courante éditable, **pas d'historique**
  par version.
- Les 3 champs budget (PPR, Estimation prévisionnel, Enveloppe totale) et le TNF budget vivent
  **sur le ticket**, et s'agrègent en somme au niveau version.
- **PPR** = `Estimation Réelle × ratio`, ratio par défaut `0.9`, **paramétrable au niveau espace**.
- **Estimation prévisionnel** : pour l'instant, **seul l'ADMIN** peut le voir et l'éditer ; un
  `USER` standard **ne le voit pas du tout** (pas juste "lecture seule" — invisible). Un rôle métier
  dédié pourra être introduit plus tard si besoin, hors périmètre pour l'instant.
- **TNF budget** = `Enveloppe totale − conso + RAE`, exprimé en jours. `Enveloppe totale` = le
  3ᵉ champ budget (rempli à la main). Confirmé.
- Dashboard version : KPIs (avancement, TNF ticket agrégé, TNF budget agrégé) + courbe conso/RAE
  dans le temps + répartition par activité + répartition par personne. Confirmé comme cadrage cible.
- Dashboard sprint : même esprit que le dashboard version (peut réutiliser les mêmes briques),
  avec sélecteur de sprint.
- **Colonne "Dev" (`ticket.assigneeId`)** : **supprimée partout** (schéma, notifs, export, filtres) —
  n'a plus de sens dans ce style. Remplacée dans "Tickets & chiffrage" par des **sous-lignes
  dérivées de l'imputation**, affichées juste au-dessus de la ligne du ticket concerné : une
  sous-ligne par **(activité, personne)** ayant au moins une imputation sur ce ticket (si 2
  personnes ont imputé sur l'activité "Dév" d'un ticket, 2 sous-lignes distinctes). Ces
  sous-lignes sont **read-only** (jamais éditées ici, elles reflètent juste ce qui a été saisi
  dans "Mon imputation"). Le RAE reste saisi **au niveau activité uniquement** (pas par personne),
  cf. §2.3 — les sous-lignes personne n'ont pas de champ RAE, juste un total consommé informatif.
- **Capacité membre** (Admin > Membres) : le champ actuel (`membership.capacityPerDay`, ratio
  0–1, libellé "j/j") est **réexprimé en % de la semaine** dans l'UI admin. Le total imputé par
  la personne dans **"Mon imputation"** affiche désormais un **% de cette capacité sur la
  semaine**, avec un **avertissement visuel non bloquant** en cas de dépassement — la personne
  peut quand même imputer au-delà.
- **Sélecteur "Ajouter un ticket ou une catégorie"** (page imputation) : remplace le `<select>`
  natif par un composant custom = **3-4 tickets suggérés** affichés par défaut (sans recherche) +
  la liste des **catégories** (inchangée) + une **barre de recherche** qui filtre sur la liste
  complète des tickets (pas seulement les suggérés).

## 2. Modèle de données

### 2.1 `workspace` — nouveaux réglages

```ts
pprRatio: numeric('ppr_ratio', { precision: 3, scale: 2 }).notNull().default('0.90'),
imputationStep: numeric('imputation_step', { precision: 3, scale: 2 }).notNull().default('0.25'),
```

### 2.2 `ticket` — nouveaux champs

```ts
estimationPrev: numeric('estimation_prev', { precision: 7, scale: 2 }), // admin only, invisible USER
enveloppeTotale: numeric('enveloppe_totale', { precision: 7, scale: 2 }), // saisie manuelle
sspCode: text('ssp_code'), // code budget, valeur courante, pas d'historique
```

⚠️ **Hypothèse** : `estimationPrev` et `enveloppeTotale` suivent la même restriction d'accès
(admin only, invisible pour `USER`) que celle confirmée pour `estimationPrev` — à valider
explicitement pour `enveloppeTotale` (l'utilisateur n'a confirmé que le premier champ).
`sspCode` n'a **aucune** restriction particulière évoquée — éditable par qui peut déjà éditer le ticket.

**PPR n'est pas stocké** : calculé à la volée (`round(estimationReal * workspace.pprRatio)`),
comme `totalEstimation`/`totalRae` aujourd'hui — évite un champ qui se dé-synchronise si
`estimationReal` ou `pprRatio` change après coup. ⚠️ Si le besoin est de pouvoir **surcharger**
manuellement le PPR calculé sur un ticket donné, il faudra un champ persistant nullable en plus —
à confirmer si ce cas existe en pratique.

### 2.3 RAE par activité — nouvelle table

```ts
export const ticketActivityRae = pgTable(
  'ticket_activity_rae',
  {
    id: id(),
    ticketId: uuid('ticket_id').notNull().references(() => ticket.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull().references(() => activity.id, { onDelete: 'restrict' }),
    raeReal: numeric('rae_real', { precision: 7, scale: 2 }).notNull().default('0'),
    raeTest: numeric('rae_test', { precision: 7, scale: 2 }).notNull().default('0'),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex('ticket_activity_rae_uq').on(t.ticketId, t.activityId)]
);
```

**Compatibilité** : `ticket.raeReal` / `ticket.raeTest` restent en base mais deviennent le
**fallback** : si un ticket a au moins une ligne dans `ticket_activity_rae`, le RAE ticket =
`sum(raeReal)` / `sum(raeTest)` de ses lignes ; sinon on retombe sur les colonnes historiques du
ticket. Pas de migration de données à faire — les tickets existants continuent de fonctionner
tels quels tant qu'aucune ligne d'activité n'est ajoutée. `avancement()`/`ecart()`/`totalRae()`
prennent alors le RAE "résolu" (somme des activités ou fallback) en entrée, sans changer de forme.

⚠️ **Point à clarifier** : l'`activity` référentiel sert **déjà** à catégoriser l'imputation
(`time_entry.activityId`). Le consommé par activité d'un ticket est donc déjà calculable en
sommant `time_entry` filtré par `ticketId` + `activityId` — pas besoin de nouvelle table pour la
conso par activité, seulement pour le **RAE** par activité (qui est une saisie manuelle, pas
dérivée de l'imputation).

**Sous-lignes (activité, personne)** — pas de nouvelle table, tout est dérivable de `time_entry`
qui a déjà `ticketId` + `activityId` + `userId` :

```ts
export async function getTicketContributors(workspaceId: string, ticketId: string) {
  // group by (activityId, userId), sum(amount) — une ligne = une (activité, personne)
}
```

UI dans "Tickets & chiffrage" : pour chaque activité présente sur le ticket (celles avec une ligne
`ticket_activity_rae` **ou** au moins une imputation), une "ligne d'en-tête" avec le champ RAE
éditable, puis en dessous une sous-ligne par personne distincte ayant imputé sur cette activité
(nom + total consommé, read-only).

### 2.6 Suppression de `ticket.assigneeId`

**Retiré du schéma** (colonne + relation `ticketRelations.assignee`). Impacts en cascade à traiter :

- **`notifications.ts`** (RAE périmé) : groupait aujourd'hui par `ticket.assigneeId`
  (`isNotNull(ticket.assigneeId)`, `groupBy(... ticket.assigneeId)`). À remplacer par un groupement
  sur les **contributeurs réels** du ticket (`time_entry` distinct `userId` pour ce `ticketId`).
  ⚠️ **Hypothèse** : on notifie **tous les utilisateurs ayant déjà imputé au moins une fois** sur
  le ticket (pas de fenêtre temporelle) — à confirmer, une fenêtre glissante (ex. 30 derniers
  jours) éviterait de notifier d'anciens contributeurs qui ne travaillent plus dessus.
- **`excel/export.ts`** : la colonne `"Dev (assigné)"` (jointure `ticket.assigneeId → user`)
  disparaît. ⚠️ **Hypothèse** : remplacée par une colonne `"Contributeurs"` = liste des personnes
  distinctes ayant imputé sur le ticket, séparées par virgule (dérivé de `time_entry`, pas de
  détail par activité dans cette colonne — le détail (activité, personne) reste réservé à l'UI
  "Tickets & chiffrage", pas exporté ligne par ligne sauf demande explicite).
- **`tickets.ts`** : retirer `assigneeId`/`assigneeName` du type `Ticket` retourné par
  `listTickets`, retirer `'assigneeId'` de la liste des champs éditables, retirer le join `user`
  associé.
- **UI `tickets/+page.svelte`** : retirer le `<select>` "Dev" (ligne d'édition inline + modale
  détail) et le filtre "Filtrer par dev" ; remplacer l'espace par les sous-lignes (activité,
  personne) du §2.3.
- **Migration DB** : `ALTER TABLE ticket DROP COLUMN assignee_id` — irréversible, à ne lancer
  qu'après avoir validé que plus aucun code ne lit la colonne.

### 2.4 Regroupement libre de tickets — nouvelles tables

```ts
export const ticketGroup = pgTable(
  'ticket_group',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    archivedAt: archivedAt(),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('ticket_group_ws_label_uq').on(t.workspaceId, sql`lower(${t.label})`).where(sql`${t.archivedAt} is null`)]
);

export const ticketGroupMember = pgTable(
  'ticket_group_member',
  {
    id: id(),
    groupId: uuid('group_id').notNull().references(() => ticketGroup.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').notNull().references(() => ticket.id, { onDelete: 'cascade' })
  },
  (t) => [uniqueIndex('ticket_group_member_uq').on(t.groupId, t.ticketId)]
);
```

Many-to-many volontaire : un ticket peut appartenir à 0..N groupes, un groupe est scopé au
workspace comme `project`/`activity`. Suit le même pattern d'archivage que `activity`/`project`
(cf. `referentials.ts`).

### 2.5 Jours fériés — **pas de table**

Fonction pure `isPublicHolidayFR(date: Date): boolean` dans `src/lib/utils/date.ts` (jours fixes +
calcul de Pâques pour lundi de Pâques / Ascension / Pentecôte). Utilisée pour :
- affichage (badge/couleur) sur l'en-tête de jour dans la grille d'imputation existante ;
- calcul des « jours ouvrés attendus » d'une semaine (capacité = `capacityPerDay × jours ouvrés non fériés`).

## 3. Calculs (`calc.ts`)

Nouvelles fonctions (en remplacement/complément de l'existant) :

```ts
/** RAE résolu d'un ticket : somme des ticket_activity_rae si présentes, sinon fallback ticket.raeReal/raeTest. */
export function resolvedRae(ticket: Ticket, activityRows: TicketActivityRae[]): { real: number; test: number }

// avancement() ne change pas — toujours (est - rae) / est, cf. §1.
// Le RAE passé en entrée doit juste devenir le RAE "résolu" (§2.3) au lieu de ticket.raeReal brut.

/** Écart d'exécution — réel uniquement, jamais de phase test. */
export function ecartExecution(raeReal: number, consumed: number, estimationReal: number): number {
  return round(raeReal + consumed - estimationReal);
}

/** TNF budget — au niveau ticket, agrégeable par simple somme au niveau version. */
export function tnfBudget(
  enveloppeTotale: number,
  consumed: number,
  raeReal: number,
  raeTest: number,
  testPhase = true
): number {
  return round(enveloppeTotale - consumed + raeReal + (testPhase ? raeTest : 0));
}
```

L'actuel `ecart()` (= `consumed − totalEst`) et l'actuel `avancement()` (= `(est-rae)/est`) sont
**remplacés**, pas conservés en parallèle — tout appelant (`dashboard.ts`, `tickets.ts`) doit
basculer sur les nouvelles fonctions. `totalEstimation`/`totalRae`/`raeSuggested` ne changent pas.

⚠️ **Hypothèse** : `tnfBudget` applique la phase Test (comme `totalRae`) alors que
`ecartExecution` ne l'applique jamais — ce n'était pas explicitement demandé pour le TNF budget,
je l'aligne par défaut sur le comportement des helpers existants (`totalRae`) plutôt que d'inventer
un troisième comportement. À confirmer.

## 4. Dashboards

### 4.1 Synthèse hebdo par personne (extension de `dashboard.ts`)

Nouvelle fonction `getWeeklySynthesis(workspaceId, isoWeekRange)` :
- Groupe `time_entry` par `(userId, isoWeek)`.
- Capacité attendue de la semaine = `membership.capacityPerDay × nb jours ouvrés non fériés`.
- `% = round(totalSemaine / capaciteAttendue, 2)`, `overCapacity = % > 1` (juste un flag, **jamais bloquant**).
- Réutilise `workWeek()`/`toISODate()` de `src/lib/utils/date.ts` (déjà utilisés par `imputation.ts`).
- Consommé côté grille perso existante (`WeekData.weekTotal`) : ajouter le même warning visuel
  local (pas de nouveau calcul serveur, `weekTotal` existe déjà).

### 4.1bis Capacité en % de semaine (Admin > Membres + "Mon imputation")

**Pas de migration** : `membership.capacityPerDay` (numeric 0–1) reste la colonne stockée —
seule sa **présentation** change.

- **Admin > Membres** (`admin/+page.svelte`, champ `.cap-input` actuel) : afficher/saisir en
  `%` (0–100, step 25) au lieu de "j/j" (0–1, step 0.25). Conversion pure à l'affichage/soumission
  (`capacityPerDay = pctSaisi / 100`), le ratio stocké ne change pas de sens : un membre à 0.8
  reste "80 % d'un temps plein, tous les jours" — le % hebdo est mathématiquement identique pour
  une capacité journalière constante (`0.8 j/j × 5 jours / 5 jours = 80 %`).
- **"Mon imputation"** (grille perso, `imputation.ts` / page correspondante) : sous le total de
  semaine déjà affiché (`WeekData.weekTotal`), ajouter `% = weekTotal / (capacityPerDay × jours
  ouvrés non fériés de la semaine)`. Si `% > 100`, badge/couleur d'avertissement — **jamais
  bloquant**, la saisie au-delà reste possible (cf. décision actée dès le départ : "mettre un
  warning... mais le laisser faire").
- Réutilise le même calcul que la synthèse admin (§4.1) — un seul helper de calcul de % de
  capacité hebdo, appelé des deux côtés (page perso + dashboard synthèse + export Excel), pour
  ne pas dupliquer la formule à 3 endroits.

### 4.2 Export Excel (`excel/export.ts`)

Nouvelle feuille "Synthèse hebdo" : lignes = personnes, colonnes = semaines de la période
exportée, cellule = % de capacité (mise en forme conditionnelle si > 100 %), + total par semaine
en pied de colonne (déjà demandé : "total par semaine").

### 4.3 Dashboard par version (nouvel écran, le plus important)

Route dédiée (sélecteur de version). Contenu :
- KPIs : avancement (nouvelle formule), écart d'exécution agrégé, TNF budget agrégé.
- Répartition par activité (RAE par activité agrégé sur les tickets de la version).
- Répartition par personne (conso sur les tickets de la version, join `time_entry` via `ticket.versionId`).
- Courbe d'évolution conso/RAE dans le temps.

⚠️ **Point de scope important** : la courbe d'évolution nécessite un **historique** (snapshots
dans le temps), qui **n'existe pas encore** dans le schéma actuel — tout le reste de l'app calcule
l'état **courant** uniquement. Deux options, à trancher avant de coder :
- (a) ajouter une table de snapshot (ex. `ticket_snapshot(date, ticket_id, estimation_real, rae_real, rae_test, consumed)`) alimentée par un cron quotidien — coût non négligeable, mais donne une vraie courbe historique ;
- (b) se limiter à l'état courant en V1 (pas de courbe temporelle réelle, juste les agrégats "aujourd'hui"), et ajouter l'historisation dans un second temps si le besoin est confirmé à l'usage.
Je recommande (b) pour la V1 (cf. principe YAGNI) sauf si la courbe est un besoin jour 1 non négociable.

### 4.4 Dashboard par sprint (écran séparé)

Même structure que 4.3, scopée sur `sprint.kind = 'SPRINT'`, avec un sélecteur permettant de
changer de sprint (pas de notion de "sprint actif" dans le schéma actuel → lister tous les sprints
non archivés, triés par `sortOrder`, sans présélection imposée sauf le plus récent).

### 4.5 Dashboard par groupe de tickets

`getDashboard` gagne un `byGroup` du même type que `byProject`/`bySprint`/`byVersion` (agrégation
via `ticket_group_member`), pour exploiter le regroupement libre du §2.4.

## 5. Référentiels

### 5.1 Activités — actif/inactif (pas "archivage"), suppression conditionnelle

**Correction de vocabulaire** : pour les activités, ce n'est **pas un archivage** (qui suggère
qu'on range une donnée passée) mais un **actif/inactif** — une activité désactivée n'apparaît
plus dans les sélecteurs pour de **nouvelles** saisies, mais **toutes les données existantes qui
la référencent restent intactes et affichées telles quelles** (imputations passées dans "Mon
imputation"/l'historique, RAE par activité sur les tickets, exports). Rien n'est perdu ni détaché
en désactivant. Seule la **suppression** (hard delete), réservée au cas où **aucun ticket/imputation
n'y est lié**, retire réellement l'activité.

Techniquement, la colonne `activity.archivedAt` existante suffit très bien pour porter ce statut
actif/inactif (non-null = inactif) — **aucun changement de schéma**, seulement de vocabulaire
UI/API. `referentials.ts`/`params.ts` ont déjà ce pattern pour `project`/`sprint`
(`setRefArchived`) et `category` (`setCategoryArchived`), avec compteur d'usage. Pour `activity` :

```ts
export async function setActivityActive(workspaceId: string, id: string, active: boolean) {
  // équivalent de setCategoryArchived, juste renommé côté API/UI (active = !archivedAt)
}

export async function deleteActivity(workspaceId: string, id: string) {
  const usage = await countActivityUsage(workspaceId, id); // count(time_entry) + count(ticket_activity_rae)
  if (usage > 0) throw new Error('Activité utilisée : désactivez-la plutôt que de la supprimer.');
  await db.delete(activity).where(and(eq(activity.id, id), eq(activity.workspaceId, workspaceId)));
}
```

**UI (`admin/+page.svelte`, bloc "Activités" actuel, lignes ~244-271)** — à corriger :
- Libellés : `"🗄 Archiver" / "↺ Restaurer"` → **`"Désactiver" / "Activer"`** ; le tag
  `"archivé"` → **`"inactive"`**.
- Le `confirm()` actuel dit *"X imputation(s) perdront cette activité. Archiver quand même ?"* —
  ce message est **faux** au regard de cette clarification (rien n'est perdu en désactivant) et
  doit être retiré ou reformulé en simple confirmation neutre (ex. *"Désactiver cette activité ?
  Elle restera visible sur les imputations et tickets existants, mais ne sera plus proposée pour
  de nouvelles saisies."*).
- Le bouton **Supprimer** ne doit apparaître/être actif que quand `usage === 0` ; sinon seul le
  toggle actif/inactif est disponible.

*(Le même bloc "Catégories" a un `confirm()` similaire — *"seront supprimées à terme"* — mais
celui-ci n'est pas dans le périmètre de cette demande, qui porte uniquement sur les Activités ;
à examiner séparément si besoin, `category.timeEntry` étant en cascade contrairement à `activity`.)*

### 5.2 Granularité d'imputation

`workspace.imputationStep` pilote le `step` du champ de saisie dans la grille d'imputation
(actuellement input libre ? à vérifier dans le composant UI) — validation client + serveur que
`amount % imputationStep === 0` (avec tolérance flottante via `round()`).

## 6. Sélecteur ticket/catégorie — combobox custom

Remplace le `<select>` natif de `imputation/+page.svelte` (lignes ~276-284, `pickTarget`) —
aujourd'hui un simple `<select>` avec deux `<optgroup>` (Tickets/Catégories) listant **tous** les
tickets/catégories du workspace, ce qui devient illisible à l'échelle.

Nouveau composant `src/lib/components/TargetPicker.svelte` :
- **État par défaut (pas de recherche)** : affiche **3-4 tickets suggérés** + la liste complète
  des **catégories** (peu nombreuses, pas besoin de recherche dessus).
- **Barre de recherche** : filtre en temps réel sur la **liste complète des tickets** (clé + titre),
  pas seulement les suggérés.
- Sélection → même callback que l'actuel `addRow()` (pas de changement de logique d'ajout de
  ligne, seulement du composant de sélection en amont).

⚠️ **Hypothèses à confirmer** :
- **Critère de suggestion** : je propose les tickets sur lesquels **cette personne a le plus
  récemment imputé** (`time_entry` du user, triés par `day`/`updatedAt` décroissant, dédupliqués
  par ticket) — dérivable directement de `time_entry`, aucune nouvelle donnée. Alternative
  possible : tickets du sprint/version en cours, ou tickets dans un état "en cours". À confirmer.
- **Recherche côté client ou serveur** : `data.tickets` est déjà chargé en entier côté client
  aujourd'hui (utilisé pour le `<select>` actuel) → filtrage **client-side** par défaut (aucun
  nouvel appel réseau). À revoir en recherche serveur seulement si le volume de tickets par
  workspace devient un problème de perf en pratique (pas le cas aujourd'hui).

## 7. Permissions — récapitulatif

| Champ / action | USER | ADMIN |
|---|---|---|
| PPR (calculé) | lecture | lecture |
| Estimation prévisionnel | **invisible** | lecture/écriture |
| Enveloppe totale | ⚠️ à confirmer | lecture/écriture |
| Code SSP | lecture/écriture | lecture/écriture |
| RAE par activité | lecture/écriture (comme RAE actuel) | lecture/écriture |
| Réglages `pprRatio` / `imputationStep` | — | lecture/écriture (paramètres d'espace) |

## 8. Ordre d'implémentation suggéré (le plus indépendant/à faible risque d'abord)

1. Jours fériés (pure fonction, zéro migration) + warning capacité semaine (UI seule).
2. Réglages espace `pprRatio` / `imputationStep` + PPR calculé à la volée.
3. Code SSP (champ simple).
4. Suppression conditionnelle des activités.
5. Nouvelles formules `calc.ts` (écart d'exécution/TNF budget) — `avancement()` ne bouge pas.
6. RAE par activité (table + fallback + UI sous-lignes ticket).
7. Regroupement libre de tickets (tables + UI + `byGroup`).
8. Synthèse hebdo par personne (dashboard + export Excel).
9. Dashboard par version / par sprint (le plus gros morceau UI, dépend de 5 et 6).
10. Suppression `ticket.assigneeId` + sous-lignes (activité, personne) — **dépend de 6** (les
    sous-lignes s'accrochent aux mêmes en-têtes d'activité que le RAE par activité), et touche
    3 fichiers en dehors du tableau (`notifications.ts`, `excel/export.ts`, `tickets.ts`) → à
    faire en dernier, une fois le reste stabilisé, et seulement après confirmation des hypothèses
    du §2.6 (fenêtre de notif, contenu colonne export).
11. Combobox custom "Ajouter un ticket ou une catégorie" (§6) — indépendant du reste, faible
    risque, purement front (aucune migration), à faire à n'importe quel moment.
