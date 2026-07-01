import { and, eq, gte, lte } from 'drizzle-orm';
import { db, timeEntry, ticket, category, activity } from '$lib/server/db';
import { num, round } from './calc';
import { toISODate, workWeek, parseISODate } from '$lib/utils/date';

export type ImputationCell = { day: string; amount: number };
export type ImputationRow = {
	rowKey: string;
	targetType: 'TICKET' | 'CATEGORY';
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
			activityId: timeEntry.activityId,
			day: timeEntry.day,
			amount: timeEntry.amount,
			ticketKey: ticket.key,
			ticketTitle: ticket.title,
			categoryLabel: category.label,
			categoryKind: category.kind,
			activityLabel: activity.label
		})
		.from(timeEntry)
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(category, eq(timeEntry.categoryId, category.id))
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
		const targetId = (e.targetType === 'TICKET' ? e.ticketId : e.categoryId) ?? '';
		const key = rowKey(e.targetType, targetId, e.activityId);
		if (!rows.has(key)) {
			rows.set(key, {
				rowKey: key,
				targetType: e.targetType,
				targetId,
				activityId: e.activityId,
				label:
					e.targetType === 'TICKET'
						? (e.ticketTitle ?? '—')
						: (e.categoryLabel ?? '—'),
				sublabel:
					e.targetType === 'TICKET'
						? `${e.ticketKey ?? ''}${e.activityLabel ? ' · ' + e.activityLabel : ''}`
						: `Catégorie${e.activityLabel ? ' · ' + e.activityLabel : ''}`,
				emoji: e.targetType === 'CATEGORY' ? (e.categoryKind === 'NON_PRODUCTIVE' ? '🌴' : '🛟') : '🎫',
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

/** Vérifie qu'une cible appartient bien à l'espace (anti-fuite inter-espaces). */
async function assertTargetInWorkspace(
	workspaceId: string,
	targetType: 'TICKET' | 'CATEGORY',
	targetId: string
) {
	if (targetType === 'TICKET') {
		const r = await db
			.select({ id: ticket.id })
			.from(ticket)
			.where(and(eq(ticket.id, targetId), eq(ticket.workspaceId, workspaceId)));
		if (!r[0]) throw new Error('Ticket introuvable dans cet espace.');
	} else {
		const r = await db
			.select({ id: category.id })
			.from(category)
			.where(and(eq(category.id, targetId), eq(category.workspaceId, workspaceId)));
		if (!r[0]) throw new Error('Catégorie introuvable dans cet espace.');
	}
}

/** Définit (ou supprime si 0) une cellule d'imputation. */
export async function setCell(
	workspaceId: string,
	userId: string,
	input: {
		targetType: 'TICKET' | 'CATEGORY';
		targetId: string;
		activityId: string | null;
		day: string;
		amount: number;
	}
) {
	await assertTargetInWorkspace(workspaceId, input.targetType, input.targetId);

	const ticketId = input.targetType === 'TICKET' ? input.targetId : null;
	const categoryId = input.targetType === 'CATEGORY' ? input.targetId : null;

	const match = and(
		eq(timeEntry.workspaceId, workspaceId),
		eq(timeEntry.userId, userId),
		eq(timeEntry.day, input.day),
		input.targetType === 'TICKET'
			? eq(timeEntry.ticketId, input.targetId)
			: eq(timeEntry.categoryId, input.targetId),
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
			activityId: input.activityId,
			day: input.day,
			amount: amountStr
		});
	}
}
