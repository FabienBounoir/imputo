import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, weeklyObjective, weeklyVacation, ticket, user, activity } from '$lib/server/db';

export type ObjectiveKind = 'TICKET' | 'CUSTOM';

export type WeeklyObjectiveRow = {
	id: string;
	userId: string;
	kind: ObjectiveKind;
	ticketId: string | null;
	ticketKey: string | null;
	ticketTitle: string | null;
	label: string | null;
	activityId: string | null;
	activityLabel: string | null;
	/** Lundi de la semaine d'attribution — sert à regrouper quand la période couvre plusieurs semaines. */
	weekMonday: string;
};

export type WeeklyObjectiveWithUser = WeeklyObjectiveRow & { displayName: string };

const objectiveSelect = {
	id: weeklyObjective.id,
	userId: weeklyObjective.userId,
	kind: weeklyObjective.kind,
	ticketId: weeklyObjective.ticketId,
	ticketKey: ticket.key,
	ticketTitle: ticket.title,
	label: weeklyObjective.label,
	activityId: weeklyObjective.activityId,
	activityLabel: activity.label,
	weekMonday: weeklyObjective.weekMonday
};

/** Objectifs attribués à une personne pour une semaine — épinglés dans Mon imputation. */
export async function listObjectivesForUser(
	workspaceId: string,
	userId: string,
	weekMondayISO: string
): Promise<WeeklyObjectiveRow[]> {
	return db
		.select(objectiveSelect)
		.from(weeklyObjective)
		.leftJoin(ticket, eq(weeklyObjective.ticketId, ticket.id))
		.leftJoin(activity, eq(weeklyObjective.activityId, activity.id))
		.where(
			and(
				eq(weeklyObjective.workspaceId, workspaceId),
				eq(weeklyObjective.userId, userId),
				eq(weeklyObjective.weekMonday, weekMondayISO)
			)
		)
		.orderBy(weeklyObjective.sortOrder, weeklyObjective.createdAt);
}

/**
 * Objectifs attribués à une personne sur plusieurs semaines — la période affichée dans Mon
 * imputation peut couvrir une quinzaine ou un mois, pas seulement la semaine courante.
 */
export async function listObjectivesForUserWeeks(
	workspaceId: string,
	userId: string,
	weekMondayISOs: string[]
): Promise<WeeklyObjectiveRow[]> {
	if (weekMondayISOs.length === 0) return [];
	return db
		.select(objectiveSelect)
		.from(weeklyObjective)
		.leftJoin(ticket, eq(weeklyObjective.ticketId, ticket.id))
		.leftJoin(activity, eq(weeklyObjective.activityId, activity.id))
		.where(
			and(
				eq(weeklyObjective.workspaceId, workspaceId),
				eq(weeklyObjective.userId, userId),
				inArray(weeklyObjective.weekMonday, weekMondayISOs)
			)
		)
		.orderBy(weeklyObjective.weekMonday, weeklyObjective.sortOrder, weeklyObjective.createdAt);
}

/** Tous les objectifs de l'espace pour une semaine, avec le nom de la personne — vue globale admin. */
export async function listObjectivesForWorkspace(
	workspaceId: string,
	weekMondayISO: string
): Promise<WeeklyObjectiveWithUser[]> {
	return db
		.select({ ...objectiveSelect, displayName: user.displayName })
		.from(weeklyObjective)
		.leftJoin(ticket, eq(weeklyObjective.ticketId, ticket.id))
		.leftJoin(activity, eq(weeklyObjective.activityId, activity.id))
		.innerJoin(user, eq(weeklyObjective.userId, user.id))
		.where(and(eq(weeklyObjective.workspaceId, workspaceId), eq(weeklyObjective.weekMonday, weekMondayISO)))
		.orderBy(user.displayName, weeklyObjective.sortOrder, weeklyObjective.createdAt);
}

export async function listVacationsForWeek(workspaceId: string, weekMondayISO: string): Promise<Set<string>> {
	const rows = await db
		.select({ userId: weeklyVacation.userId })
		.from(weeklyVacation)
		.where(and(eq(weeklyVacation.workspaceId, workspaceId), eq(weeklyVacation.weekMonday, weekMondayISO)));
	return new Set(rows.map((r) => r.userId));
}

export async function isOnVacation(workspaceId: string, userId: string, weekMondayISO: string): Promise<boolean> {
	const rows = await db
		.select({ id: weeklyVacation.id })
		.from(weeklyVacation)
		.where(
			and(
				eq(weeklyVacation.workspaceId, workspaceId),
				eq(weeklyVacation.userId, userId),
				eq(weeklyVacation.weekMonday, weekMondayISO)
			)
		);
	return rows.length > 0;
}

/** Parmi les semaines données, celles où la personne est en congé (lundis ISO). */
export async function vacationWeeks(
	workspaceId: string,
	userId: string,
	weekMondayISOs: string[]
): Promise<string[]> {
	if (weekMondayISOs.length === 0) return [];
	const rows = await db
		.select({ weekMonday: weeklyVacation.weekMonday })
		.from(weeklyVacation)
		.where(
			and(
				eq(weeklyVacation.workspaceId, workspaceId),
				eq(weeklyVacation.userId, userId),
				inArray(weeklyVacation.weekMonday, weekMondayISOs)
			)
		);
	return rows.map((r) => r.weekMonday);
}

export async function addObjective(
	workspaceId: string,
	createdByUserId: string,
	input: {
		userId: string;
		weekMondayISO: string;
		kind: ObjectiveKind;
		ticketId?: string;
		label?: string;
		activityId?: string;
	}
) {
	if (await isOnVacation(workspaceId, input.userId, input.weekMondayISO))
		throw new Error('Cette personne est marquée en vacances cette semaine-là : impossible de lui attribuer un objectif.');

	if (input.kind === 'TICKET') {
		if (!input.ticketId) throw new Error('Ticket requis.');
		const r = await db
			.select({ id: ticket.id })
			.from(ticket)
			.where(and(eq(ticket.id, input.ticketId), eq(ticket.workspaceId, workspaceId)));
		if (!r[0]) throw new Error('Ticket introuvable dans cet espace.');
	} else if (!input.label?.trim()) {
		throw new Error('Libellé requis.');
	}

	const [{ max }] = await db
		.select({ max: sql<number>`coalesce(max(${weeklyObjective.sortOrder}), -1)` })
		.from(weeklyObjective)
		.where(
			and(
				eq(weeklyObjective.workspaceId, workspaceId),
				eq(weeklyObjective.userId, input.userId),
				eq(weeklyObjective.weekMonday, input.weekMondayISO)
			)
		);

	await db.insert(weeklyObjective).values({
		workspaceId,
		userId: input.userId,
		weekMonday: input.weekMondayISO,
		kind: input.kind,
		ticketId: input.kind === 'TICKET' ? (input.ticketId ?? null) : null,
		// Pour CUSTOM, label est le libellé de la tâche (obligatoire, validé plus haut). Pour TICKET,
		// c'est une note optionnelle propre à cet objectif/cette personne (distincte du commentaire
		// partagé du ticket) — ex: "ce qu'on attend réellement sur ce ticket cette semaine".
		label: input.kind === 'CUSTOM' ? input.label!.trim() : input.label?.trim() || null,
		activityId: input.activityId || null,
		sortOrder: Number(max) + 1,
		createdByUserId
	});
}

/** À qui appartient cet objectif — pour vérifier qu'un CP ne pilote que sa propre population. */
export async function getObjectiveOwner(workspaceId: string, id: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: weeklyObjective.userId })
		.from(weeklyObjective)
		.where(and(eq(weeklyObjective.id, id), eq(weeklyObjective.workspaceId, workspaceId)))
		.limit(1);
	return row?.userId ?? null;
}

export async function removeObjective(workspaceId: string, id: string) {
	await db.delete(weeklyObjective).where(and(eq(weeklyObjective.id, id), eq(weeklyObjective.workspaceId, workspaceId)));
}

/** Échange l'ordre d'un objectif avec son voisin (haut/bas), au sein de la même (personne, semaine) — même mécanique que moveState. */
export async function moveObjective(workspaceId: string, id: string, dir: 'up' | 'down') {
	const [target] = await db
		.select({ userId: weeklyObjective.userId, weekMonday: weeklyObjective.weekMonday })
		.from(weeklyObjective)
		.where(and(eq(weeklyObjective.id, id), eq(weeklyObjective.workspaceId, workspaceId)));
	if (!target) return;

	const rows = await db
		.select({ id: weeklyObjective.id, sortOrder: weeklyObjective.sortOrder })
		.from(weeklyObjective)
		.where(
			and(
				eq(weeklyObjective.workspaceId, workspaceId),
				eq(weeklyObjective.userId, target.userId),
				eq(weeklyObjective.weekMonday, target.weekMonday)
			)
		)
		.orderBy(weeklyObjective.sortOrder, weeklyObjective.createdAt);

	const idx = rows.findIndex((r) => r.id === id);
	const swap = dir === 'up' ? idx - 1 : idx + 1;
	if (idx < 0 || swap < 0 || swap >= rows.length) return;
	const a = rows[idx];
	const b = rows[swap];
	await db.transaction(async (tx) => {
		await tx.update(weeklyObjective).set({ sortOrder: b.sortOrder }).where(eq(weeklyObjective.id, a.id));
		await tx.update(weeklyObjective).set({ sortOrder: a.sortOrder }).where(eq(weeklyObjective.id, b.id));
	});
}

export async function setVacation(workspaceId: string, userId: string, weekMondayISO: string, onVacation: boolean) {
	if (onVacation) {
		await db
			.insert(weeklyVacation)
			.values({ workspaceId, userId, weekMonday: weekMondayISO })
			.onConflictDoNothing();
	} else {
		await db
			.delete(weeklyVacation)
			.where(
				and(
					eq(weeklyVacation.workspaceId, workspaceId),
					eq(weeklyVacation.userId, userId),
					eq(weeklyVacation.weekMonday, weekMondayISO)
				)
			);
	}
}
