import { and, desc, eq, gte, ilike, lt, or } from 'drizzle-orm';
import { db, changeLog, user, ticket } from '$lib/server/db';
import { config } from '$lib/server/config';

export type ChangeLogEntity = 'TICKET' | 'ABSENCE';
export type ChangeLogAction = 'UPDATE' | 'DELETE';

export type ChangeLogEntry = {
	id: string;
	entityType: ChangeLogEntity;
	entityId: string;
	activityId: string | null;
	field: string | null;
	action: ChangeLogAction;
	oldValue: string | null;
	newValue: string | null;
	changedByName: string | null;
	createdAt: Date;
	/** Uniquement pour entityType 'TICKET'. */
	ticketKey: string | null;
};

export type ChangeLogCursor = { createdAt: string; id: string };

export type ChangeLogPage = {
	entries: ChangeLogEntry[];
	nextCursor: ChangeLogCursor | null;
};

// Fenêtre affichée sur la page admin globale — même rétention que la purge (runCleanup, jobs.ts),
// pour ne jamais montrer une ligne qui vient d'être supprimée ou l'inverse.
const HISTORY_WINDOW_MS = config.archiveRetentionMs;

const entrySelect = {
	id: changeLog.id,
	entityType: changeLog.entityType,
	entityId: changeLog.entityId,
	activityId: changeLog.activityId,
	field: changeLog.field,
	action: changeLog.action,
	oldValue: changeLog.oldValue,
	newValue: changeLog.newValue,
	changedByName: user.displayName,
	createdAt: changeLog.createdAt
};

/** Trace une modification ou suppression — tickets (champs budget) et absences (modif/suppression). */
export async function logChange(input: {
	workspaceId: string;
	entityType: ChangeLogEntity;
	entityId: string;
	activityId?: string | null;
	field?: string | null;
	action: ChangeLogAction;
	oldValue: string | null;
	newValue: string | null;
	changedById: string | null;
}) {
	await db.insert(changeLog).values({
		workspaceId: input.workspaceId,
		entityType: input.entityType,
		entityId: input.entityId,
		activityId: input.activityId ?? null,
		field: input.field ?? null,
		action: input.action,
		oldValue: input.oldValue,
		newValue: input.newValue,
		changedById: input.changedById
	});
}

/** Historique d'un ticket ou d'une absence précis — affiché localement (modal ticket, popover absence). */
export async function listEntityHistory(
	workspaceId: string,
	entityType: ChangeLogEntity,
	entityId: string
): Promise<ChangeLogEntry[]> {
	const rows = await db
		.select(entrySelect)
		.from(changeLog)
		.leftJoin(user, eq(changeLog.changedById, user.id))
		.where(and(eq(changeLog.workspaceId, workspaceId), eq(changeLog.entityType, entityType), eq(changeLog.entityId, entityId)))
		.orderBy(desc(changeLog.createdAt));
	return rows.map((r) => ({ ...r, ticketKey: null }));
}

/**
 * Page de l'historique global de l'espace (les 30 derniers jours), les plus récents d'abord —
 * filtrable par type d'entité et recherche libre, paginée par curseur (createdAt, id) pour un
 * scroll infini côté serveur.
 */
export async function listWorkspaceHistoryPage(
	workspaceId: string,
	opts: {
		entityType?: ChangeLogEntity;
		query?: string;
		cursor?: ChangeLogCursor;
		limit?: number;
	} = {}
): Promise<ChangeLogPage> {
	const limit = opts.limit ?? 50;
	const since = new Date(Date.now() - HISTORY_WINDOW_MS);

	const conditions = [eq(changeLog.workspaceId, workspaceId), gte(changeLog.createdAt, since)];
	if (opts.entityType) conditions.push(eq(changeLog.entityType, opts.entityType));
	if (opts.cursor) {
		const cursorDate = new Date(opts.cursor.createdAt);
		conditions.push(
			or(lt(changeLog.createdAt, cursorDate), and(eq(changeLog.createdAt, cursorDate), lt(changeLog.id, opts.cursor.id)))!
		);
	}
	if (opts.query?.trim()) {
		const q = `%${opts.query.trim()}%`;
		conditions.push(or(ilike(changeLog.field, q), ilike(changeLog.oldValue, q), ilike(changeLog.newValue, q), ilike(user.displayName, q), ilike(ticket.key, q))!);
	}

	const rows = await db
		.select({ ...entrySelect, ticketKey: ticket.key })
		.from(changeLog)
		.leftJoin(user, eq(changeLog.changedById, user.id))
		.leftJoin(ticket, and(eq(changeLog.entityType, 'TICKET'), eq(changeLog.entityId, ticket.id)))
		.where(and(...conditions))
		.orderBy(desc(changeLog.createdAt), desc(changeLog.id))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const entries = hasMore ? rows.slice(0, limit) : rows;
	const last = entries[entries.length - 1];
	return {
		entries,
		nextCursor: hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null
	};
}
