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
export const roleEnum = pgEnum('role', ['USER', 'ADMIN']);
export const themePrefEnum = pgEnum('theme_pref', ['LIGHT', 'DARK', 'SYSTEM']);
export const categoryKindEnum = pgEnum('category_kind', ['PRODUCTIVE', 'NON_PRODUCTIVE']);
export const targetTypeEnum = pgEnum('target_type', ['TICKET', 'CATEGORY']);
export const tokenPurposeEnum = pgEnum('token_purpose', ['INVITE', 'RESET']);
export const sprintKindEnum = pgEnum('sprint_kind', ['SPRINT', 'VERSION']);
export const notificationKindEnum = pgEnum('notification_kind', [
	'EVENING_MISSING',
	'MORNING_YESTERDAY',
	'RAE_STALE',
	'WEEKLY_RECAP'
]);

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
		archivedAt: archivedAt()
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
		assigneeId: uuid('assignee_id').references(() => user.id, { onDelete: 'set null' }),
		stateId: uuid('state_id').references(() => state.id, { onDelete: 'set null' }),
		estimationReal: numeric('estimation_real', { precision: 7, scale: 2 }),
		raeReal: numeric('rae_real', { precision: 7, scale: 2 }),
		estimationTest: numeric('estimation_test', { precision: 7, scale: 2 }),
		prepa: numeric('prepa', { precision: 7, scale: 2 }),
		raeTest: numeric('rae_test', { precision: 7, scale: 2 }),
		raeUpdatedAt: timestamp('rae_updated_at', { withTimezone: true }),
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
	assignee: one(user, { fields: [ticket.assigneeId], references: [user.id] }),
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
export type Category = typeof category.$inferSelect;
export type State = typeof state.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Sprint = typeof sprint.$inferSelect;
export type TimeEntry = typeof timeEntry.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
