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
export const categoryKindEnum = pgEnum('category_kind', ['PRODUCTIVE', 'NON_PRODUCTIVE']);
export const targetTypeEnum = pgEnum('target_type', ['TICKET', 'CATEGORY', 'OBJECTIVE']);
export const objectiveKindEnum = pgEnum('objective_kind', ['TICKET', 'CUSTOM']);
export const tokenPurposeEnum = pgEnum('token_purpose', ['INVITE', 'RESET']);
export const sprintKindEnum = pgEnum('sprint_kind', ['SPRINT', 'VERSION']);
export const notificationKindEnum = pgEnum('notification_kind', [
	'EVENING_MISSING',
	'MORNING_YESTERDAY',
	'RAE_STALE',
	'WEEKLY_RECAP'
]);
export const moodPeriodKindEnum = pgEnum('mood_period_kind', ['WEEK_1', 'WEEK_2', 'WEEK_3', 'MONTH']);

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
	// Phase Test activée (Est./RAE Test, Prépa, flags qualité). Désactivable par l'admin.
	testPhase: boolean('test_phase').notNull().default(true),
	// PPR = estimationReal * pprRatio, calculé à la volée (non stocké sur le ticket).
	pprRatio: numeric('ppr_ratio', { precision: 3, scale: 2 }).notNull().default('0.90'),
	// Pas du champ de saisie d'imputation (0.25 = quart de jour).
	imputationStep: numeric('imputation_step', { precision: 3, scale: 2 }).notNull().default('0.25'),
	// Team mood : désactivé par défaut, activable par l'admin.
	moodEnabled: boolean('mood_enabled').notNull().default(false),
	moodPeriodKind: moodPeriodKindEnum('mood_period_kind').notNull().default('WEEK_1'),
	// 0=lundi..6=dimanche ; ignoré si moodPeriodKind = MONTH (démarre toujours le 1er du mois).
	moodStartWeekday: integer('mood_start_weekday').notNull().default(0),
	createdByUserId: uuid('created_by_user_id'),
	createdAt: createdAt()
});

export const user = pgTable('user', {
	id: id(),
	displayName: text('display_name').notNull(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash'), // null tant que le mot de passe n'est pas défini
	themePref: themePrefEnum('theme_pref').notNull().default('SYSTEM'),
	notifPrefs: text('notif_prefs'), // JSON sérialisé { enabled, eveningMissing, … } ; null = tout activé
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
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('membership_ws_user_uq').on(t.workspaceId, t.userId)]
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
		archivedAt: archivedAt(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('ticket_ws_idx').on(t.workspaceId),
		uniqueIndex('ticket_ws_key_uq').on(t.workspaceId, t.key)
	]
);

// RAE par activité (sous-lignes) — le RAE ticket devient la somme de ces lignes quand il y en a
// (fallback sur ticket.raeReal/raeTest sinon, cf. resolvedRae() dans calc.ts).
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
		amount: numeric('amount', { precision: 4, scale: 2 }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('time_entry_ws_user_day_idx').on(t.workspaceId, t.userId, t.day),
		index('time_entry_ticket_idx').on(t.ticketId)
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
		sentAt: createdAt()
	},
	(t) => [uniqueIndex('notif_log_uq').on(t.userId, t.workspaceId, t.kind, t.refDate)]
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
export type TicketActivityRae = typeof ticketActivityRae.$inferSelect;
export type TicketGroup = typeof ticketGroup.$inferSelect;
export type Category = typeof category.$inferSelect;
export type State = typeof state.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Sprint = typeof sprint.$inferSelect;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type WeeklyObjective = typeof weeklyObjective.$inferSelect;
export type WeeklyVacation = typeof weeklyVacation.$inferSelect;
export type MoodVote = typeof moodVote.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type MoodPeriodKind = (typeof moodPeriodKindEnum.enumValues)[number];
