import { and, eq, gte, inArray, lte, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	db,
	timeEntry,
	ticket,
	category,
	activity,
	sprint,
	ticketActivityRae,
	weeklyObjective
} from '$lib/server/db';
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
	/** Sprint/version du ticket (null hors ticket ou non rattaché) — affichés en puces sur la ligne. */
	sprintName: string | null;
	versionName: string | null;
	/**
	 * RAE réel de la paire (ticket, activité). null quand la ligne ne porte pas d'activité :
	 * le RAE est stocké par activité, il n'est alors ni affichable ni saisissable ici.
	 */
	raeReal: number | null;
	amounts: Record<string, number>; // day ISO → amount
	total: number;
};

export type TimesheetData = {
	days: string[];
	firstDay: string;
	lastDay: string;
	rows: ImputationRow[];
	dayTotals: Record<string, number>;
	total: number;
};

function rowKey(targetType: string, targetId: string, activityId: string | null) {
	return `${targetType}:${targetId}:${activityId ?? ''}`;
}

/**
 * Feuille de temps d'un utilisateur sur une liste de jours ouvrés ordonnée. Le découpage de la
 * période (semaine / quinzaine / mois, fixe ou glissant) est calculé par `buildPeriod` dans
 * `$lib/utils/date` — ce service ne connaît qu'une plage de jours.
 */
export async function getTimesheet(
	workspaceId: string,
	userId: string,
	days: string[]
): Promise<TimesheetData> {
	const firstDay = days[0];
	const lastDay = days[days.length - 1];

	// `version` et `sprint` vivent dans la même table, discriminés par `kind` : ticket.sprintId et
	// ticket.versionId pointent tous deux dessus, d'où l'alias pour les joindre en même temps.
	const versionSprint = alias(sprint, 'version_sprint');

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
			sprintName: sprint.name,
			versionName: versionSprint.name,
			categoryLabel: category.label,
			categoryKind: category.kind,
			objectiveLabel: weeklyObjective.label,
			activityLabel: activity.label
		})
		.from(timeEntry)
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
		.leftJoin(versionSprint, eq(ticket.versionId, versionSprint.id))
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
		// La plage couvre les week-ends (jours contigus) alors que seuls les jours ouvrés sont
		// affichés : une entrée hors colonnes ne doit pas alimenter un total invisible.
		if (!(e.day in dayTotals)) continue;
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
				sprintName: e.targetType === 'TICKET' ? e.sprintName : null,
				versionName: e.targetType === 'TICKET' ? e.versionName : null,
				raeReal: null,
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

	await attachActivityRae([...rows.values()]);

	const total = round(Object.values(dayTotals).reduce((a, b) => a + b, 0));
	return { days, firstDay, lastDay, rows: [...rows.values()], dayTotals, total };
}

/**
 * Renseigne `raeReal` sur les lignes ticket portant une activité, depuis `ticket_activity_rae`.
 * Le RAE étant stocké par (ticket, activité), une ligne sans activité n'a pas de RAE adressable.
 */
async function attachActivityRae(rows: ImputationRow[]) {
	const targets = rows.filter((r) => r.targetType === 'TICKET' && r.activityId);
	if (targets.length === 0) return;
	const ticketIds = [...new Set(targets.map((r) => r.targetId))];
	const activityIds = [...new Set(targets.map((r) => r.activityId!))];

	const raeRows = await db
		.select({
			ticketId: ticketActivityRae.ticketId,
			activityId: ticketActivityRae.activityId,
			raeReal: ticketActivityRae.raeReal
		})
		.from(ticketActivityRae)
		.where(
			and(
				inArray(ticketActivityRae.ticketId, ticketIds),
				inArray(ticketActivityRae.activityId, activityIds)
			)
		);

	const byPair = new Map(raeRows.map((r) => [`${r.ticketId}:${r.activityId}`, num(r.raeReal)]));
	for (const r of targets) r.raeReal = byPair.get(`${r.targetId}:${r.activityId}`) ?? 0;
}

/** Feuille de temps d'une semaine ouvrée (lun→ven) — raccourci autour de `getTimesheet`. */
export async function getWeek(
	workspaceId: string,
	userId: string,
	mondayISO: string
): Promise<TimesheetData> {
	return getTimesheet(workspaceId, userId, workWeek(parseISODate(mondayISO)).map(toISODate));
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

/**
 * Supprime en un coup toutes les imputations de la période pour une ligne (cible + activité).
 * Les bornes viennent d'une période reconstruite côté serveur, jamais du client directement.
 */
export async function deleteRow(
	workspaceId: string,
	userId: string,
	input: {
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		targetId: string;
		activityId: string | null;
		fromISO: string;
		toISO: string;
	}
) {
	await assertTargetInWorkspace(workspaceId, userId, input.targetType, input.targetId);

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
				gte(timeEntry.day, input.fromISO),
				lte(timeEntry.day, input.toISO),
				targetMatch,
				input.activityId ? eq(timeEntry.activityId, input.activityId) : isNull(timeEntry.activityId)
			)
		);
}
