import {
	pgTable,
	pgEnum,
	uuid,
	text,
	boolean,
	timestamp,
	date,
	integer,
	numeric,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------- Enums ----------
export const roleEnum = pgEnum('role', ['USER', 'ADMIN', 'MANAGER']);
export const themePrefEnum = pgEnum('theme_pref', ['LIGHT', 'DARK', 'SYSTEM']);
// Couleur d'accent personnelle : suit l'espace, ou forcée (fixe ou défilante) indépendamment de l'admin.
export const accentModeEnum = pgEnum('accent_mode', ['WORKSPACE', 'CUSTOM', 'RGB', 'DISCO']);
export const categoryKindEnum = pgEnum('category_kind', ['PRODUCTIVE', 'NON_PRODUCTIVE']);
export const targetTypeEnum = pgEnum('target_type', ['TICKET', 'CATEGORY', 'OBJECTIVE']);
export const objectiveKindEnum = pgEnum('objective_kind', ['TICKET', 'CUSTOM']);
export const tokenPurposeEnum = pgEnum('token_purpose', ['INVITE', 'RESET']);
export const sprintKindEnum = pgEnum('sprint_kind', ['SPRINT', 'VERSION']);
export const notificationKindEnum = pgEnum('notification_kind', [
	'EVENING_MISSING',
	'MORNING_YESTERDAY',
	'RAE_STALE',
	'WEEKLY_RECAP',
	'MOOD_DEADLINE',
	'MOOD_RECAP',
	'ABSENCE_PENDING',
	'ABSENCE_VALIDATED'
]);
export const moodPeriodKindEnum = pgEnum('mood_period_kind', ['WEEK_1', 'WEEK_2', 'WEEK_3', 'MONTH']);
export const absenceTypeEnum = pgEnum('absence_type', [
	'CONGE_VALIDE',
	'CONGE_PREVISIONNEL',
	'FORMATION',
	'HORS_PROJET'
]);
export const absencePeriodEnum = pgEnum('absence_period', ['FULL', 'AM', 'PM']);
// 'WORKSPACE' : utilisé pour tracer les changements de config Jira (ex. rotation du PAT) —
// jamais oldValue/newValue pour ce type, voir services/jiraSync.ts.
export const changeLogEntityEnum = pgEnum('change_log_entity', ['TICKET', 'ABSENCE', 'WORKSPACE']);
export const changeLogActionEnum = pgEnum('change_log_action', ['UPDATE', 'DELETE']);
export const supportCadenceEnum = pgEnum('support_cadence', ['DAY', 'WEEK', 'MONTH']);
export const jiraSyncStatusEnum = pgEnum('jira_sync_status', ['SUCCESS', 'ERROR']);
// KEEP_LOCAL (défaut) : un ticket déjà connu localement (créé à la main ou par un sync
// précédent) n'est jamais écrasé par le sync. JIRA_WINS : Jira écrase title/projectId/parentId.
export const jiraConflictStrategyEnum = pgEnum('jira_conflict_strategy', ['JIRA_WINS', 'KEEP_LOCAL']);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
const archivedAt = () => timestamp('archived_at', { withTimezone: true });

// ---------- Tenancy & identity ----------
export const workspace = pgTable('workspace', {
	id: id(),
	name: text('name').notNull(),
	allowedDomain: text('allowed_domain').notNull(),
	accentColor: text('accent_color').notNull().default('#16A34A'),
	// Accent qui défile en continu (arc-en-ciel) au lieu d'une couleur fixe.
	accentRgb: boolean('accent_rgb').notNull().default(false),
	// Accent qui saute aléatoirement de couleur (sans transition) au lieu de défiler en douceur.
	// Exclusif avec accentRgb (l'UI ne permet jamais d'activer les deux).
	accentDisco: boolean('accent_disco').notNull().default(false),
	// Phase Test activée (Est./RAE Test, Prépa, flags qualité). Désactivable par l'admin.
	testPhase: boolean('test_phase').notNull().default(true),
	// PPR = estimationReal * pprRatio, calculé à la volée (non stocké sur le ticket).
	pprRatio: numeric('ppr_ratio', { precision: 3, scale: 2 }).notNull().default('0.90'),
	// Pas du champ de saisie d'imputation (0.25 = quart de jour).
	// scale 3 (pas 2) : nécessaire pour un pas à l'heure sur une journée type (1/8 = 0.125).
	imputationStep: numeric('imputation_step', { precision: 4, scale: 3 }).notNull().default('0.25'),
	// Team mood : désactivé par défaut, activable par l'admin.
	moodEnabled: boolean('mood_enabled').notNull().default(false),
	moodPeriodKind: moodPeriodKindEnum('mood_period_kind').notNull().default('WEEK_1'),
	// 0=lundi..6=dimanche ; ignoré si moodPeriodKind = MONTH (démarre toujours le 1er du mois).
	moodStartWeekday: integer('mood_start_weekday').notNull().default(0),
	// Perm support (qui regarde les tickets) : désactivée par défaut, activable par l'admin.
	supportEnabled: boolean('support_enabled').notNull().default(false),
	supportCadence: supportCadenceEnum('support_cadence').notNull().default('WEEK'),
	// Incrémenté par "passer son tour" : décale toute la chaîne d'un cran, définitivement (contrairement
	// à supportOverride qui ne change qu'une période précise sans toucher aux suivantes).
	supportRotationOffset: integer('support_rotation_offset').notNull().default(0),
	// Le samedi compte-t-il comme un jour de perm (cadence DAY) ? Dimanche jamais inclus.
	supportIncludeSaturday: boolean('support_include_saturday').notNull().default(false),

	// ---------- Synchronisation Jira (pull planifié + forçage manuel) ----------
	jiraSyncEnabled: boolean('jira_sync_enabled').notNull().default(false),
	// Chiffré (AES-256-GCM, voir auth/secretCrypto.ts) — jamais en clair, jamais réaffiché.
	jiraPatEncrypted: text('jira_pat_encrypted'),
	// JQL libre, ex. "project = CARTEJEUNE_BLM". Ne doit jamais contenir ORDER BY (voir
	// hasOrderByClause dans jiraClient.ts) — incompatible avec le wrapping fait pour jiraUpdatedSince.
	jiraJql: text('jira_jql'),
	// Plancher + watermark incrémental : ne redemander à Jira que les tickets dont `updated` est
	// postérieur à cette date. Sert à la fois de plancher manuel (saisi par l'admin, jour près, via
	// jiraSave) ET de valeur auto-avancée après chaque sync réussi (jiraSync.ts, précision seconde +
	// marge de sécurité) — un seul champ, une seule sémantique : "ne rien redemander avant cette
	// date". Null = pas de plancher (comportement historique, JQL non modifié).
	jiraUpdatedSince: timestamp('jira_updated_since', { withTimezone: true }),
	// Plancher fixe (jamais auto-avancé, contrairement à jiraUpdatedSince ci-dessus) : n'inclure que
	// les tickets dont `created` est postérieur à cette date. Sans ça, un vieux ticket (ex. 2020)
	// juste retouché repasse indéfiniment le filtre `updated >=` à chaque run incrémental — ce champ
	// permet de l'exclure une bonne fois pour toutes. Purement manuel, saisi par l'admin (jiraSave).
	// Null = pas de plancher (comportement historique).
	jiraCreatedSince: timestamp('jira_created_since', { withTimezone: true }),
	// Traçabilité : qui a saisi le PAT actuel et quand (mis à jour uniquement quand une nouvelle
	// valeur est effectivement soumise, pas à chaque sauvegarde du formulaire).
	// Pas de FK : même choix que createdByUserId ci-dessous (user est déclaré plus loin dans ce
	// fichier), voir aussi la note sur entityId dans changeLog pour la même contrainte d'ordre.
	jiraPatUpdatedByUserId: uuid('jira_pat_updated_by_user_id'),
	jiraPatUpdatedAt: timestamp('jira_pat_updated_at', { withTimezone: true }),
	// Réconciliation de clé : ex. pattern "^CARTEJEUNE_" + remplacement "" pour faire correspondre
	// une clé Jira réelle (CARTEJEUNE_BLM-123) à une clé déjà utilisée localement (BLM-123).
	// Remplace la 1ère occurrence uniquement (pas de flag global) ; appliqué à key ET parentKey.
	jiraKeyRegexPattern: text('jira_key_regex_pattern'),
	jiraKeyRegexReplacement: text('jira_key_regex_replacement'),
	jiraConflictStrategy: jiraConflictStrategyEnum('jira_conflict_strategy').notNull().default('KEEP_LOCAL'),
	// Quels champs le sync a le droit de toucher, par espace — indépendant de jiraConflictStrategy
	// (qui ne dit que "écraser ou pas" un champ déjà inclus ici). Défaut à true partout : décoché
	// nulle part, comportement identique à avant l'existence de ces colonnes. Un champ décoché
	// n'est jamais écrit, création comprise — sauf jiraSyncTitle (titre NOT NULL sur ticket, un
	// ticket ne peut pas exister sans titre, cf. jiraSync.ts).
	jiraSyncTitle: boolean('jira_sync_title').notNull().default(true),
	jiraSyncProject: boolean('jira_sync_project').notNull().default(true),
	jiraSyncParent: boolean('jira_sync_parent').notNull().default(true),
	jiraSyncSprint: boolean('jira_sync_sprint').notNull().default(true),
	jiraSyncVersion: boolean('jira_sync_version').notNull().default(true),
	// Statut du dernier run (planifié ou forcé) — visibilité opérationnelle pour l'admin.
	jiraLastSyncAt: timestamp('jira_last_sync_at', { withTimezone: true }),
	jiraLastSyncStatus: jiraSyncStatusEnum('jira_last_sync_status'),
	jiraLastSyncError: text('jira_last_sync_error'),
	jiraLastSyncTicketCount: integer('jira_last_sync_ticket_count'),
	// Échecs d'authentification (401/403) consécutifs. Remis à 0 sur succès ou sur un nouveau PAT
	// sauvegardé. À 5, le sync planifié se désactive automatiquement (jiraSyncEnabled -> false) —
	// voir services/jiraSync.ts. N'inclut jamais les erreurs réseau/Jira non liées au PAT.
	jiraConsecutiveFailures: integer('jira_consecutive_failures').notNull().default(0),

	createdByUserId: uuid('created_by_user_id'),
	createdAt: createdAt()
});

export const user = pgTable('user', {
	id: id(),
	displayName: text('display_name').notNull(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash'), // null tant que le mot de passe n'est pas défini
	themePref: themePrefEnum('theme_pref').notNull().default('SYSTEM'),
	accentMode: accentModeEnum('accent_mode').notNull().default('WORKSPACE'),
	accentColor: text('accent_color'), // utilisé quand accentMode = CUSTOM
	notifPrefs: text('notif_prefs'), // JSON sérialisé { enabled, eveningMissing, … } ; null = tout activé
	// Répartition par activité (dashboard sprint/version) : false = ordre des référentiels (défaut), true = alphabétique.
	sortActivitiesAlpha: boolean('sort_activities_alpha').notNull().default(false),
	// Filtres tickets mémorisés (vue Tickets & chiffrage) : remember=true (défaut) réapplique le
	// dernier instantané à une arrivée "à blanc" (lien de nav, favori...) ; false = repart toujours
	// sans filtre. Snapshot nul tant qu'aucun filtre n'a jamais été touché.
	rememberTicketFilters: boolean('remember_ticket_filters').notNull().default(true),
	// Sous-option de rememberTicketFilters : la recherche est souvent ponctuelle (ex. retrouver un
	// ticket précis) contrairement aux filtres état/projet/sprint/version qui reflètent un contexte
	// de travail durable — permet de garder ces derniers sans se retaper la recherche à chaque fois.
	rememberTicketSearch: boolean('remember_ticket_search').notNull().default(true),
	ticketFiltersSnapshot: text('ticket_filters_snapshot'), // JSON { view, query, stateId, projectId, sprintId, versionId }
	// Détail par activité sous chaque ticket (vue tableau) : true = masqué par défaut (compact).
	compactTicketActivity: boolean('compact_ticket_activity').notNull().default(true),
	active: boolean('active').notNull().default(true),
	createdAt: createdAt()
});

export const membership = pgTable(
	'membership',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: roleEnum('role').notNull().default('USER'),
		capacityPerDay: numeric('capacity_per_day', { precision: 3, scale: 2 }).notNull().default('1'),
		active: boolean('active').notNull().default(true),
		// Capacités de lecture accordables indépendamment du rôle (ex : un USER qui doit voir
		// l'imputation de tous sans devenir MANAGER/ADMIN et sans aucun droit d'écriture).
		canViewImputations: boolean('can_view_imputations').notNull().default(false),
		canViewMoodResults: boolean('can_view_mood_results').notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('membership_ws_user_uq').on(t.workspaceId, t.userId),
		// listMembershipsForUser (hooks.server.ts, à chaque requête authentifiée) filtre sur userId
		// seul — l'index unique ci-dessus a workspaceId en tête, inutilisable pour ce filtre.
		index('membership_user_idx').on(t.userId)
	]
);

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(), // hash du token de session
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(t) => [index('session_user_idx').on(t.userId)]
);

export const setupToken = pgTable(
	'setup_token',
	{
		id: text('id').primaryKey(), // hash du token (le brut n'est jamais stocké)
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
		purpose: tokenPurposeEnum('purpose').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('setup_token_user_idx').on(t.userId)]
);

// ---------- Référentiels (scopés workspace) ----------
export const project = pgTable(
	'project',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		archivedAt: archivedAt(),
		createdAt: createdAt()
	},
	(t) => [
		index('project_ws_idx').on(t.workspaceId),
		uniqueIndex('project_ws_name_uq')
			.on(t.workspaceId, sql`lower(${t.name})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

export const state = pgTable(
	'state',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		emoji: text('emoji'),
		color: text('color'),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(t) => [index('state_ws_idx').on(t.workspaceId)]
);

export const activity = pgTable(
	'activity',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		archivedAt: archivedAt()
	},
	(t) => [
		index('activity_ws_idx').on(t.workspaceId),
		uniqueIndex('activity_ws_name_uq')
			.on(t.workspaceId, sql`lower(${t.label})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

export const category = pgTable(
	'category',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		kind: categoryKindEnum('kind').notNull().default('PRODUCTIVE'),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
		archivedAt: archivedAt(),
		createdAt: createdAt()
	},
	(t) => [
		index('category_ws_idx').on(t.workspaceId),
		uniqueIndex('category_ws_name_uq')
			.on(t.workspaceId, sql`lower(${t.label})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

export const sprint = pgTable(
	'sprint',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: sprintKindEnum('kind').notNull().default('SPRINT'),
		sortOrder: integer('sort_order').notNull().default(0),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
		archivedAt: archivedAt(),
		createdAt: createdAt()
	},
	(t) => [
		index('sprint_ws_idx').on(t.workspaceId),
		uniqueIndex('sprint_ws_kind_name_uq')
			.on(t.workspaceId, t.kind, sql`lower(${t.name})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

// ---------- Tickets ----------
// Un run de sync Jira (planifié ou forcé) — pendant du triplet jiraLastSync* sur workspace, mais en
// historique append-only (celui-là reste, lui, écrasé à chaque run pour l'affichage "dernier run").
// status/ticketsSeen/ticketsCreated/error ne sont écrits qu'une fois l'issue du run connue (jamais de
// ligne "en cours" à gérer) — voir jiraSync.ts (finalizeError + fin de syncWorkspace).
export const jiraSyncRun = pgTable(
	'jira_sync_run',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
		status: jiraSyncStatusEnum('status').notNull(),
		ticketsSeen: integer('tickets_seen').notNull().default(0),
		ticketsCreated: integer('tickets_created').notNull().default(0),
		error: text('error'),
		// Posés ensemble par "Annuler ce lot" (cf. accounts.ts/undoJiraSyncRun) — ne supprime que les
		// tickets de ce run encore vierges de toute trace humaine (deleteUntouchedSyncedTickets).
		undoneAt: timestamp('undone_at', { withTimezone: true }),
		undoneById: uuid('undone_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('jira_sync_run_ws_started_idx').on(t.workspaceId, t.startedAt)]
);

export const ticket = pgTable(
	'ticket',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		title: text('title').notNull(),
		projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
		parentId: uuid('parent_id'),
		sprintId: uuid('sprint_id').references(() => sprint.id, { onDelete: 'set null' }),
		versionId: uuid('version_id').references(() => sprint.id, { onDelete: 'set null' }),
		stateId: uuid('state_id').references(() => state.id, { onDelete: 'set null' }),
		estimationReal: numeric('estimation_real', { precision: 7, scale: 2 }),
		raeReal: numeric('rae_real', { precision: 7, scale: 2 }),
		estimationTest: numeric('estimation_test', { precision: 7, scale: 2 }),
		prepa: numeric('prepa', { precision: 7, scale: 2 }),
		raeTest: numeric('rae_test', { precision: 7, scale: 2 }),
		raeUpdatedAt: timestamp('rae_updated_at', { withTimezone: true }),
		// Admin only, invisible pour un USER standard.
		estimationPrev: numeric('estimation_prev', { precision: 7, scale: 2 }),
		// Admin only, invisible pour un USER standard.
		enveloppeTotale: numeric('enveloppe_totale', { precision: 7, scale: 2 }),
		sspCode: text('ssp_code'),
		comment: text('comment'),
		flags: text('flags'), // jsonb léger sérialisé (cypress, docTech…) — simple au MVP
		// Renseigné uniquement à la création par un sync Jira (jamais réécrit après) — sert de portée à
		// "Annuler ce lot" (deleteUntouchedSyncedTickets) : seuls les tickets encore vierges de toute
		// trace humaine, d'un run donné, peuvent être supprimés en masse depuis l'onglet admin Jira.
		createdBySyncRunId: uuid('created_by_sync_run_id').references(() => jiraSyncRun.id, { onDelete: 'set null' }),
		archivedAt: archivedAt(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('ticket_ws_idx').on(t.workspaceId),
		uniqueIndex('ticket_ws_key_uq').on(t.workspaceId, t.key),
		index('ticket_sync_run_idx').on(t.createdBySyncRunId)
	]
);

// RAE + Estimé + Budget par activité (sous-lignes) — le RAE et l'Estimé du ticket deviennent la
// somme de ces lignes quand il y en a (fallback sur ticket.raeReal/raeTest/estimationReal sinon,
// cf. resolvedRae()/resolvedEstimation() dans calc.ts). Le budget par activité, lui, ne remonte
// jamais sur le ticket (ticket.enveloppeTotale reste la valeur saisie à la création).
export const ticketActivityRae = pgTable(
	'ticket_activity_rae',
	{
		id: id(),
		ticketId: uuid('ticket_id')
			.notNull()
			.references(() => ticket.id, { onDelete: 'cascade' }),
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activity.id, { onDelete: 'restrict' }),
		raeReal: numeric('rae_real', { precision: 7, scale: 2 }).notNull().default('0'),
		raeTest: numeric('rae_test', { precision: 7, scale: 2 }).notNull().default('0'),
		// Estimé par activité — champ unique (pas de déclinaison Réel/Test), modifiable par tout membre.
		estimation: numeric('estimation', { precision: 7, scale: 2 }).notNull().default('0'),
		// Budget par activité — indépendant du budget ticket (enveloppeTotale), ADMIN only.
		budget: numeric('budget', { precision: 7, scale: 2 }).notNull().default('0'),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('ticket_activity_rae_uq').on(t.ticketId, t.activityId)]
);

// Regroupement libre de tickets — transverse, indépendant de la hiérarchie parent/enfant.
export const ticketGroup = pgTable(
	'ticket_group',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		archivedAt: archivedAt(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('ticket_group_ws_label_uq')
			.on(t.workspaceId, sql`lower(${t.label})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

export const ticketGroupMember = pgTable(
	'ticket_group_member',
	{
		id: id(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => ticketGroup.id, { onDelete: 'cascade' }),
		ticketId: uuid('ticket_id')
			.notNull()
			.references(() => ticket.id, { onDelete: 'cascade' })
	},
	(t) => [uniqueIndex('ticket_group_member_uq').on(t.groupId, t.ticketId)]
);

// Snapshot quotidien (cron) — alimente la courbe d'évolution conso/RAE des dashboards
// version/sprint, qui n'existe pas dans l'état courant du ticket.
export const ticketSnapshot = pgTable(
	'ticket_snapshot',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		ticketId: uuid('ticket_id')
			.notNull()
			.references(() => ticket.id, { onDelete: 'cascade' }),
		date: date('date').notNull(),
		estimationReal: numeric('estimation_real', { precision: 7, scale: 2 }).notNull().default('0'),
		raeReal: numeric('rae_real', { precision: 7, scale: 2 }).notNull().default('0'),
		raeTest: numeric('rae_test', { precision: 7, scale: 2 }).notNull().default('0'),
		consumed: numeric('consumed', { precision: 7, scale: 2 }).notNull().default('0'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('ticket_snapshot_ticket_date_uq').on(t.ticketId, t.date),
		index('ticket_snapshot_ws_date_idx').on(t.workspaceId, t.date)
	]
);

// ---------- Objectifs de la semaine ----------
// Suggestions admin (ticket existant ou tâche libre) attribuées à une personne pour une semaine
// donnée — pilote uniquement ce qui est épinglé dans Mon imputation, aucune affectation durable.
export const weeklyObjective = pgTable(
	'weekly_objective',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		weekMonday: date('week_monday').notNull(),
		kind: objectiveKindEnum('kind').notNull(),
		ticketId: uuid('ticket_id').references(() => ticket.id, { onDelete: 'cascade' }), // requis si kind=TICKET
		label: text('label'), // requis si kind=CUSTOM
		activityId: uuid('activity_id').references(() => activity.id, { onDelete: 'set null' }), // type d'activité (optionnel)
		// Ordre d'affichage au sein d'une (personne, semaine) — modifiable via Admin > Objectifs,
		// même mécanique swap-voisin que state.sortOrder (cf. moveState/moveObjective).
		sortOrder: integer('sort_order').notNull().default(0),
		createdByUserId: uuid('created_by_user_id')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt()
	},
	(t) => [index('weekly_objective_ws_user_week_idx').on(t.workspaceId, t.userId, t.weekMonday)]
);

export const weeklyVacation = pgTable(
	'weekly_vacation',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		weekMonday: date('week_monday').notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('weekly_vacation_ws_user_week_uq').on(t.workspaceId, t.userId, t.weekMonday)]
);

// ---------- Imputation ----------
export const timeEntry = pgTable(
	'time_entry',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		targetType: targetTypeEnum('target_type').notNull(),
		ticketId: uuid('ticket_id').references(() => ticket.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id').references(() => category.id, { onDelete: 'cascade' }),
		// set null (pas cascade comme ticketId/categoryId) : un objectif est une liste éditable par
		// l'admin après coup, sa suppression ne doit jamais effacer des heures déjà saisies.
		objectiveId: uuid('objective_id').references(() => weeklyObjective.id, { onDelete: 'set null' }),
		activityId: uuid('activity_id').references(() => activity.id, { onDelete: 'set null' }),
		day: date('day').notNull(),
		// scale 3 (pas 2) : suit imputationStep — un pas de 0.125 doit pouvoir être stocké tel quel.
		amount: numeric('amount', { precision: 5, scale: 3 }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('time_entry_ws_user_day_idx').on(t.workspaceId, t.userId, t.day),
		index('time_entry_ticket_idx').on(t.ticketId)
	]
);

// Ligne ajoutée à "Mon imputation" (+ Ajouter) sans encore aucune heure saisie dessus : sans cette
// table, la ligne n'a aucune trace en base et disparaît au prochain chargement/changement de
// période (aucun time_entry associé). Retirée uniquement via la poubelle (unpinRow), jamais par
// un simple retour à 0 des cases — contrairement à un time_entry, pas de notion de jour/montant.
// firstDay/lastDay bornent la période affichée au moment de l'ajout (semaine/quinzaine/mois selon
// la granularité active) : la ligne n'est visible que dans les périodes qui chevauchent cette
// plage, elle ne doit pas fuiter sur toutes les semaines (cf. listPinnedRows).
export const imputationPin = pgTable(
	'imputation_pin',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		targetType: targetTypeEnum('target_type').notNull(),
		ticketId: uuid('ticket_id').references(() => ticket.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id').references(() => category.id, { onDelete: 'cascade' }),
		objectiveId: uuid('objective_id').references(() => weeklyObjective.id, { onDelete: 'cascade' }),
		activityId: uuid('activity_id').references(() => activity.id, { onDelete: 'set null' }),
		firstDay: date('first_day').notNull(),
		lastDay: date('last_day').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('imputation_pin_ws_user_idx').on(t.workspaceId, t.userId)]
);

// ---------- Absences ----------
// Personne suivie pour ses congés sans avoir de compte sur l'espace (client, prestataire…).
// Gérée par un admin/manager — jamais de login, jamais dans les pickers de tickets/imputation.
export const externalMember = pgTable(
	'external_member',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		archivedAt: archivedAt(),
		createdAt: createdAt()
	},
	(t) => [index('external_member_ws_idx').on(t.workspaceId)]
);

// Une ligne par déclaration (plage de dates + type). `period` ne vaut AM/PM que pour une
// plage d'un seul jour (startDate = endDate) ; sinon toujours FULL.
// Sujet = soit un membre réel (userId), soit un membre externe (externalMemberId) — jamais les
// deux, appliqué en app (pas de contrainte SQL, même convention que timeEntry.ticketId/categoryId).
export const absence = pgTable(
	'absence',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
		externalMemberId: uuid('external_member_id').references(() => externalMember.id, { onDelete: 'cascade' }),
		startDate: date('start_date').notNull(),
		endDate: date('end_date').notNull(),
		type: absenceTypeEnum('type').notNull(),
		period: absencePeriodEnum('period').notNull().default('FULL'),
		// Renseignés uniquement au passage CONGE_PREVISIONNEL → CONGE_VALIDE (action `validate`) — distincts
		// de updatedAt pour ne pas perdre la trace si l'absence est modifiée après coup (dates, etc.).
		validatedById: uuid('validated_by').references(() => user.id, { onDelete: 'set null' }),
		validatedAt: timestamp('validated_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('absence_ws_user_idx').on(t.workspaceId, t.userId),
		index('absence_ws_external_idx').on(t.workspaceId, t.externalMemberId),
		index('absence_ws_range_idx').on(t.workspaceId, t.startDate, t.endDate)
	]
);

// ---------- Historique des modifications (estimations tickets, absences) ----------
// entityId reste un UUID nu (pas de FK réelle) : polymorphe entre ticket/absence, et doit survivre
// à la suppression d'une absence (on veut garder la trace même quand la ligne source a disparu).
export const changeLog = pgTable(
	'change_log',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		entityType: changeLogEntityEnum('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		// Uniquement pour une ligne de RAE par activité d'un ticket.
		activityId: uuid('activity_id').references(() => activity.id, { onDelete: 'set null' }),
		field: text('field'), // null pour une suppression
		action: changeLogActionEnum('action').notNull(),
		oldValue: text('old_value'),
		newValue: text('new_value'),
		changedById: uuid('changed_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [
		index('change_log_entity_idx').on(t.workspaceId, t.entityType, t.entityId),
		index('change_log_ws_created_idx').on(t.workspaceId, t.createdAt)
	]
);

// ---------- Team mood ----------
// Un vote par personne et par plage (upsert tant que la plage est active). userId reste en base
// pour la contrainte d'unicité et pour permettre au votant de retrouver/modifier son propre vote,
// mais aucune requête de résultats admin ne doit jamais le sélectionner (anonymat, cf. mood.ts).
export const moodVote = pgTable(
	'mood_vote',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		periodStart: date('period_start').notNull(),
		periodEnd: date('period_end').notNull(),
		score: integer('score').notNull(), // 1..5
		message: text('message'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('mood_vote_ws_user_period_uq').on(t.workspaceId, t.userId, t.periodStart),
		index('mood_vote_ws_period_idx').on(t.workspaceId, t.periodStart)
	]
);

// ---------- Perm support (rotation "qui regarde les tickets") ----------
// Ordre de passage dans la rotation ; le membre du jour/de la semaine/du mois est calculé à la
// volée (supportPeriodIndex, cf. utils/date.ts) — pas de planning pré-généré à maintenir.
export const supportRotationMember = pgTable(
	'support_rotation_member',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('support_rotation_member_ws_user_uq').on(t.workspaceId, t.userId),
		index('support_rotation_member_ws_idx').on(t.workspaceId)
	]
);

// Remplace ponctuellement la personne calculée pour une période donnée (ex : absence) sans
// décaler la rotation : la période suivante retombe automatiquement sur l'ordre normal.
export const supportOverride = pgTable(
	'support_override',
	{
		id: id(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		periodStart: date('period_start').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('support_override_ws_period_uq').on(t.workspaceId, t.periodStart)]
);

// ---------- Notifications (Web Push) ----------
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: id(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		userAgent: text('user_agent'),
		failureCount: integer('failure_count').notNull().default(0),
		createdAt: createdAt(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [index('push_sub_user_idx').on(t.userId)]
);

export const notificationLog = pgTable(
	'notification_log',
	{
		id: id(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id, { onDelete: 'cascade' }),
		kind: notificationKindEnum('kind').notNull(),
		refDate: date('ref_date').notNull(),
		// Distingue les relances multiples le même jour (ex: 09h00/09h15/09h30) ; '' = envoi unique historique.
		slot: text('slot').notNull().default(''),
		sentAt: createdAt()
	},
	(t) => [uniqueIndex('notif_log_uq').on(t.userId, t.workspaceId, t.kind, t.refDate, t.slot)]
);

// ---------- Relations ----------
export const ticketRelations = relations(ticket, ({ one, many }) => ({
	parent: one(ticket, { fields: [ticket.parentId], references: [ticket.id], relationName: 'parent' }),
	children: many(ticket, { relationName: 'parent' }),
	state: one(state, { fields: [ticket.stateId], references: [state.id] }),
	sprint: one(sprint, { fields: [ticket.sprintId], references: [sprint.id] }),
	project: one(project, { fields: [ticket.projectId], references: [project.id] })
}));

export const timeEntryRelations = relations(timeEntry, ({ one }) => ({
	ticket: one(ticket, { fields: [timeEntry.ticketId], references: [ticket.id] }),
	category: one(category, { fields: [timeEntry.categoryId], references: [category.id] }),
	activity: one(activity, { fields: [timeEntry.activityId], references: [activity.id] })
}));

// ---------- Types ----------
export type Workspace = typeof workspace.$inferSelect;
export type User = typeof user.$inferSelect;
export type Membership = typeof membership.$inferSelect;
export type Ticket = typeof ticket.$inferSelect;
export type JiraSyncRun = typeof jiraSyncRun.$inferSelect;
export type TicketActivityRae = typeof ticketActivityRae.$inferSelect;
export type TicketGroup = typeof ticketGroup.$inferSelect;
export type Category = typeof category.$inferSelect;
export type State = typeof state.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Sprint = typeof sprint.$inferSelect;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type ImputationPin = typeof imputationPin.$inferSelect;
export type WeeklyObjective = typeof weeklyObjective.$inferSelect;
export type WeeklyVacation = typeof weeklyVacation.$inferSelect;
export type Absence = typeof absence.$inferSelect;
export type ExternalMember = typeof externalMember.$inferSelect;
export type AbsenceType = (typeof absenceTypeEnum.enumValues)[number];
export type AbsencePeriod = (typeof absencePeriodEnum.enumValues)[number];
export type MoodVote = typeof moodVote.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type MoodPeriodKind = (typeof moodPeriodKindEnum.enumValues)[number];
export type SupportRotationMember = typeof supportRotationMember.$inferSelect;
export type SupportOverride = typeof supportOverride.$inferSelect;
export type SupportCadence = (typeof supportCadenceEnum.enumValues)[number];
