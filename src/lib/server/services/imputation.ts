import { and, eq, gte, lte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, timeEntry, ticket, category, activity, weeklyObjective } from '$lib/server/db';
import { num, round } from './calc';
import { toISODate, workWeek, parseISODate } from '$lib/utils/date';

export type ImputationCell = { day: string; amount: number };
export type ImputationRow = {
	rowKey: string;
	targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
	targetId: string;
	activityId: string | null;
	label: string;
	sublabel: string;
	emoji: string | null;
	nonProductive: boolean;
	amounts: Record<string, number>; // day ISO → amount
	total: number;
};

export type WeekData = {
	mondayISO: string;
	days: string[];
	rows: ImputationRow[];
	dayTotals: Record<string, number>;
	weekTotal: number;
};

function rowKey(targetType: string, targetId: string, activityId: string | null) {
	return `${targetType}:${targetId}:${activityId ?? ''}`;
}

/** Feuille de temps d'un utilisateur pour une semaine. */
export async function getWeek(
	workspaceId: string,
	userId: string,
	mondayISO: string
): Promise<WeekData> {
	const monday = parseISODate(mondayISO);
	const days = workWeek(monday).map(toISODate);
	const firstDay = days[0];
	const lastDay = days[days.length - 1];

	const entries = await db
		.select({
			targetType: timeEntry.targetType,
			ticketId: timeEntry.ticketId,
			categoryId: timeEntry.categoryId,
			objectiveId: timeEntry.objectiveId,
			activityId: timeEntry.activityId,
			day: timeEntry.day,
			amount: timeEntry.amount,
			ticketKey: ticket.key,
			ticketTitle: ticket.title,
			categoryLabel: category.label,
			categoryKind: category.kind,
			objectiveLabel: weeklyObjective.label,
			activityLabel: activity.label
		})
		.from(timeEntry)
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(category, eq(timeEntry.categoryId, category.id))
		.leftJoin(weeklyObjective, eq(timeEntry.objectiveId, weeklyObjective.id))
		.leftJoin(activity, eq(timeEntry.activityId, activity.id))
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				gte(timeEntry.day, firstDay),
				lte(timeEntry.day, lastDay)
			)
		);

	const rows = new Map<string, ImputationRow>();
	const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));

	for (const e of entries) {
		const targetId =
			(e.targetType === 'TICKET' ? e.ticketId : e.targetType === 'CATEGORY' ? e.categoryId : e.objectiveId) ?? '';
		const key = rowKey(e.targetType, targetId, e.activityId);
		if (!rows.has(key)) {
			let label: string;
			let sublabel: string;
			let emoji: string;
			if (e.targetType === 'TICKET') {
				label = e.ticketTitle ?? '—';
				sublabel = `${e.ticketKey ?? ''}${e.activityLabel ? ' · ' + e.activityLabel : ''}`;
				emoji = '🎫';
			} else if (e.targetType === 'CATEGORY') {
				label = e.categoryLabel ?? '—';
				sublabel = `Catégorie${e.activityLabel ? ' · ' + e.activityLabel : ''}`;
				emoji = e.categoryKind === 'NON_PRODUCTIVE' ? '🌴' : '🛟';
			} else {
				label = e.objectiveLabel ?? '(tâche supprimée)';
				sublabel = `Tâche assignée${e.activityLabel ? ' · ' + e.activityLabel : ''}`;
				emoji = '📝';
			}
			rows.set(key, {
				rowKey: key,
				targetType: e.targetType,
				targetId,
				activityId: e.activityId,
				label,
				sublabel,
				emoji,
				nonProductive: e.targetType === 'CATEGORY' && e.categoryKind === 'NON_PRODUCTIVE',
				amounts: {},
				total: 0
			});
		}
		const r = rows.get(key)!;
		const amount = num(e.amount);
		r.amounts[e.day] = amount;
		r.total = round(r.total + amount);
		dayTotals[e.day] = round(dayTotals[e.day] + amount);
	}

	const weekTotal = round(Object.values(dayTotals).reduce((a, b) => a + b, 0));
	return { mondayISO, days, rows: [...rows.values()], dayTotals, weekTotal };
}

/**
 * Tickets les plus récemment imputés par cette personne (dédupliqués, triés par dernière
 * imputation décroissante) — sert de suggestions par défaut au sélecteur ticket/catégorie.
 */
export async function getRecentTicketIds(workspaceId: string, userId: string, limit = 4): Promise<string[]> {
	const rows = await db
		.select({ ticketId: timeEntry.ticketId, lastAt: sql<string>`max(${timeEntry.updatedAt})` })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				eq(timeEntry.targetType, 'TICKET'),
				isNotNull(timeEntry.ticketId)
			)
		)
		.groupBy(timeEntry.ticketId)
		.orderBy(sql`max(${timeEntry.updatedAt}) desc`)
		.limit(limit);
	return rows.map((r) => r.ticketId!).filter(Boolean);
}

/** Vérifie qu'une cible appartient bien à l'espace (anti-fuite inter-espaces). */
async function assertTargetInWorkspace(
	workspaceId: string,
	userId: string,
	targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE',
	targetId: string
) {
	if (targetType === 'TICKET') {
		const r = await db
			.select({ id: ticket.id })
			.from(ticket)
			.where(and(eq(ticket.id, targetId), eq(ticket.workspaceId, workspaceId)));
		if (!r[0]) throw new Error('Ticket introuvable dans cet espace.');
	} else if (targetType === 'CATEGORY') {
		const r = await db
			.select({ id: category.id })
			.from(category)
			.where(and(eq(category.id, targetId), eq(category.workspaceId, workspaceId)));
		if (!r[0]) throw new Error('Catégorie introuvable dans cet espace.');
	} else {
		// Un objectif n'est imputable que par la personne à qui il a été assigné.
		const r = await db
			.select({ id: weeklyObjective.id })
			.from(weeklyObjective)
			.where(
				and(
					eq(weeklyObjective.id, targetId),
					eq(weeklyObjective.workspaceId, workspaceId),
					eq(weeklyObjective.userId, userId)
				)
			);
		if (!r[0]) throw new Error('Objectif introuvable pour cette personne dans cet espace.');
	}
}

/** Définit (ou supprime si 0) une cellule d'imputation. */
export async function setCell(
	workspaceId: string,
	userId: string,
	input: {
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		targetId: string;
		activityId: string | null;
		day: string;
		amount: number;
	}
) {
	await assertTargetInWorkspace(workspaceId, userId, input.targetType, input.targetId);

	const ticketId = input.targetType === 'TICKET' ? input.targetId : null;
	const categoryId = input.targetType === 'CATEGORY' ? input.targetId : null;
	const objectiveId = input.targetType === 'OBJECTIVE' ? input.targetId : null;

	const targetMatch =
		input.targetType === 'TICKET'
			? eq(timeEntry.ticketId, input.targetId)
			: input.targetType === 'CATEGORY'
				? eq(timeEntry.categoryId, input.targetId)
				: eq(timeEntry.objectiveId, input.targetId);

	const match = and(
		eq(timeEntry.workspaceId, workspaceId),
		eq(timeEntry.userId, userId),
		eq(timeEntry.day, input.day),
		targetMatch,
		input.activityId ? eq(timeEntry.activityId, input.activityId) : undefined
	);

	const existing = await db.select({ id: timeEntry.id }).from(timeEntry).where(match);

	if (input.amount <= 0) {
		if (existing[0]) await db.delete(timeEntry).where(eq(timeEntry.id, existing[0].id));
		return;
	}
	const amountStr = String(input.amount);
	if (existing[0]) {
		await db
			.update(timeEntry)
			.set({ amount: amountStr, updatedAt: new Date() })
			.where(eq(timeEntry.id, existing[0].id));
	} else {
		await db.insert(timeEntry).values({
			workspaceId,
			userId,
			targetType: input.targetType,
			ticketId,
			categoryId,
			objectiveId,
			activityId: input.activityId,
			day: input.day,
			amount: amountStr
		});
	}
}

/** Supprime en un coup toutes les imputations de la semaine pour une ligne (cible + activité). */
export async function deleteRow(
	workspaceId: string,
	userId: string,
	input: { targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE'; targetId: string; activityId: string | null; mondayISO: string }
) {
	await assertTargetInWorkspace(workspaceId, userId, input.targetType, input.targetId);

	const days = workWeek(parseISODate(input.mondayISO)).map(toISODate);
	const firstDay = days[0];
	const lastDay = days[days.length - 1];

	const targetMatch =
		input.targetType === 'TICKET'
			? eq(timeEntry.ticketId, input.targetId)
			: input.targetType === 'CATEGORY'
				? eq(timeEntry.categoryId, input.targetId)
				: eq(timeEntry.objectiveId, input.targetId);

	await db
		.delete(timeEntry)
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				gte(timeEntry.day, firstDay),
				lte(timeEntry.day, lastDay),
				targetMatch,
				input.activityId ? eq(timeEntry.activityId, input.activityId) : isNull(timeEntry.activityId)
			)
		);
}
