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
	weeklyObjective,
	imputationPin,
	user
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
	/** Estimé de la paire (ticket, activité) — même granularité que raeReal, modifiable par tous. */
	estimation: number | null;
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

type RawEntry = {
	userId: string;
	userName: string;
	targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
	ticketId: string | null;
	categoryId: string | null;
	objectiveId: string | null;
	activityId: string | null;
	day: string;
	amount: string | number | null;
	ticketKey: string | null;
	ticketTitle: string | null;
	sprintName: string | null;
	versionName: string | null;
	categoryLabel: string | null;
	categoryKind: string | null;
	objectiveLabel: string | null;
	activityLabel: string | null;
};

/**
 * Imputations brutes d'un espace sur une plage de jours, un utilisateur en particulier ou toute
 * l'équipe si `userId` est omis. Requête et jointures communes à `getTimesheet` et
 * `getTeamTimesheet` — seule la clause `userId` change.
 */
async function queryEntries(workspaceId: string, firstDay: string, lastDay: string, userId?: string): Promise<RawEntry[]> {
	// `version` et `sprint` vivent dans la même table, discriminés par `kind` : ticket.sprintId et
	// ticket.versionId pointent tous deux dessus, d'où l'alias pour les joindre en même temps.
	const versionSprint = alias(sprint, 'version_sprint');

	const conditions = [eq(timeEntry.workspaceId, workspaceId), gte(timeEntry.day, firstDay), lte(timeEntry.day, lastDay)];
	if (userId) conditions.push(eq(timeEntry.userId, userId));

	return db
		.select({
			userId: timeEntry.userId,
			userName: user.displayName,
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
		.innerJoin(user, eq(timeEntry.userId, user.id))
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
		.leftJoin(versionSprint, eq(ticket.versionId, versionSprint.id))
		.leftJoin(category, eq(timeEntry.categoryId, category.id))
		.leftJoin(weeklyObjective, eq(timeEntry.objectiveId, weeklyObjective.id))
		.leftJoin(activity, eq(timeEntry.activityId, activity.id))
		.where(and(...conditions));
}

/** Squelette de ligne (sans montants) à partir d'une imputation brute — partagé par les deux vues. */
function rowSkeleton(e: RawEntry, targetId: string, key: string): ImputationRow {
	let label: string;
	let sublabel: string;
	let emoji: string;
	// L'activité s'affiche à part, en tag cliquable (cf. imputation/+page.svelte) — plus dans ce texte.
	if (e.targetType === 'TICKET') {
		label = e.ticketTitle ?? '—';
		sublabel = e.ticketKey ?? '';
		emoji = '🎫';
	} else if (e.targetType === 'CATEGORY') {
		label = e.categoryLabel ?? '—';
		sublabel = 'Catégorie';
		emoji = e.categoryKind === 'NON_PRODUCTIVE' ? '🌴' : '🛟';
	} else {
		label = e.objectiveLabel ?? '(tâche supprimée)';
		sublabel = 'Tâche assignée';
		emoji = '📝';
	}
	return {
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
		estimation: null,
		amounts: {},
		total: 0
	};
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
	const entries = await queryEntries(workspaceId, firstDay, lastDay, userId);

	const rows = new Map<string, ImputationRow>();
	const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));

	for (const e of entries) {
		// La plage couvre les week-ends (jours contigus) alors que seuls les jours ouvrés sont
		// affichés : une entrée hors colonnes ne doit pas alimenter un total invisible.
		if (!(e.day in dayTotals)) continue;
		const targetId =
			(e.targetType === 'TICKET' ? e.ticketId : e.targetType === 'CATEGORY' ? e.categoryId : e.objectiveId) ?? '';
		const key = rowKey(e.targetType, targetId, e.activityId);
		if (!rows.has(key)) rows.set(key, rowSkeleton(e, targetId, key));
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

export type TeamMemberSheet = {
	userId: string;
	name: string;
	rows: ImputationRow[];
	dayTotals: Record<string, number>;
	total: number;
};
export type TeamTimesheetData = {
	days: string[];
	members: TeamMemberSheet[];
	dayTotals: Record<string, number>;
	total: number;
};

/**
 * Même principe que `getTimesheet`, mais pour toute l'équipe en une seule requête : un membre par
 * ligne (`members`), chacun avec le détail de ses lignes ticket/catégorie/tâche — vue "Toute
 * l'équipe" de Mon imputation. Pas de RAE/Estimé ici (lecture seule, jamais éditée depuis cette vue).
 */
export async function getTeamTimesheet(workspaceId: string, days: string[]): Promise<TeamTimesheetData> {
	const firstDay = days[0];
	const lastDay = days[days.length - 1];
	const entries = await queryEntries(workspaceId, firstDay, lastDay);

	const members = new Map<string, { userId: string; name: string; rows: Map<string, ImputationRow>; dayTotals: Record<string, number> }>();
	const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));

	for (const e of entries) {
		if (!(e.day in dayTotals)) continue;
		let m = members.get(e.userId);
		if (!m) {
			m = { userId: e.userId, name: e.userName, rows: new Map(), dayTotals: Object.fromEntries(days.map((d) => [d, 0])) };
			members.set(e.userId, m);
		}
		const targetId =
			(e.targetType === 'TICKET' ? e.ticketId : e.targetType === 'CATEGORY' ? e.categoryId : e.objectiveId) ?? '';
		const key = rowKey(e.targetType, targetId, e.activityId);
		if (!m.rows.has(key)) m.rows.set(key, rowSkeleton(e, targetId, key));
		const r = m.rows.get(key)!;
		const amount = num(e.amount);
		r.amounts[e.day] = amount;
		r.total = round(r.total + amount);
		m.dayTotals[e.day] = round(m.dayTotals[e.day] + amount);
		dayTotals[e.day] = round(dayTotals[e.day] + amount);
	}

	const memberList = [...members.values()]
		.map((m) => ({
			userId: m.userId,
			name: m.name,
			rows: [...m.rows.values()],
			dayTotals: m.dayTotals,
			total: round(Object.values(m.dayTotals).reduce((a, b) => a + b, 0))
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const total = round(Object.values(dayTotals).reduce((a, b) => a + b, 0));
	return { days, members: memberList, dayTotals, total };
}

/**
 * Renseigne `raeReal`/`estimation` sur les lignes ticket portant une activité, depuis
 * `ticket_activity_rae`. Ces valeurs étant stockées par (ticket, activité), une ligne sans
 * activité n'a ni RAE ni Estimé adressable.
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
			raeReal: ticketActivityRae.raeReal,
			estimation: ticketActivityRae.estimation
		})
		.from(ticketActivityRae)
		.where(
			and(
				inArray(ticketActivityRae.ticketId, ticketIds),
				inArray(ticketActivityRae.activityId, activityIds)
			)
		);

	const byPair = new Map(raeRows.map((r) => [`${r.ticketId}:${r.activityId}`, r]));
	for (const r of targets) {
		const found = byPair.get(`${r.targetId}:${r.activityId}`);
		r.raeReal = num(found?.raeReal ?? null);
		r.estimation = num(found?.estimation ?? null);
	}
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
 * Change l'activité de toutes les imputations d'une ligne sur la période affichée (clic sur le
 * tag d'activité de "Mon imputation") — fusionne (amounts additionnés) avec une ligne déjà
 * existante sur l'activité de destination au lieu de l'écraser. Mêmes bornes de période que
 * deleteRow, jamais reçues brutes du client.
 */
export async function reassignActivity(
	workspaceId: string,
	userId: string,
	input: {
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		targetId: string;
		fromActivityId: string | null;
		toActivityId: string | null;
		fromISO: string;
		toISO: string;
	}
) {
	if (input.fromActivityId === input.toActivityId) return;
	await assertTargetInWorkspace(workspaceId, userId, input.targetType, input.targetId);
	if (input.toActivityId) {
		const [act] = await db
			.select({ id: activity.id })
			.from(activity)
			.where(and(eq(activity.id, input.toActivityId), eq(activity.workspaceId, workspaceId)));
		if (!act) throw new Error('Activité introuvable dans cet espace.');
	}

	const targetMatch =
		input.targetType === 'TICKET'
			? eq(timeEntry.ticketId, input.targetId)
			: input.targetType === 'CATEGORY'
				? eq(timeEntry.categoryId, input.targetId)
				: eq(timeEntry.objectiveId, input.targetId);

	// Si la ligne était épinglée (cf. pinRow) sur l'ancienne activité, chaque épingle qui touche la
	// période affichée suit vers la nouvelle activité, en conservant sa propre plage — sinon changer
	// l'activité d'une ligne vide (jamais remplie) ne ferait rien du tout.
	const pinsToMove = await db
		.select({ id: imputationPin.id, firstDay: imputationPin.firstDay, lastDay: imputationPin.lastDay })
		.from(imputationPin)
		.where(
			and(
				pinTargetMatch(workspaceId, userId, { targetType: input.targetType, targetId: input.targetId, activityId: input.fromActivityId }),
				pinOverlaps(input.fromISO, input.toISO)
			)
		);
	for (const p of pinsToMove) {
		await db.delete(imputationPin).where(eq(imputationPin.id, p.id));
		await pinRow(workspaceId, userId, {
			targetType: input.targetType,
			targetId: input.targetId,
			activityId: input.toActivityId,
			firstDay: p.firstDay,
			lastDay: p.lastDay
		});
	}

	const rows = await db
		.select({ id: timeEntry.id, day: timeEntry.day, amount: timeEntry.amount })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				gte(timeEntry.day, input.fromISO),
				lte(timeEntry.day, input.toISO),
				targetMatch,
				input.fromActivityId ? eq(timeEntry.activityId, input.fromActivityId) : isNull(timeEntry.activityId)
			)
		);
	if (rows.length === 0) return;

	await db.transaction(async (tx) => {
		for (const r of rows) {
			const [dest] = await tx
				.select({ id: timeEntry.id, amount: timeEntry.amount })
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.workspaceId, workspaceId),
						eq(timeEntry.userId, userId),
						eq(timeEntry.day, r.day),
						targetMatch,
						input.toActivityId ? eq(timeEntry.activityId, input.toActivityId) : isNull(timeEntry.activityId)
					)
				);
			if (dest) {
				await tx
					.update(timeEntry)
					.set({ amount: String(num(dest.amount) + num(r.amount)), updatedAt: new Date() })
					.where(eq(timeEntry.id, dest.id));
				await tx.delete(timeEntry).where(eq(timeEntry.id, r.id));
			} else {
				await tx
					.update(timeEntry)
					.set({ activityId: input.toActivityId, updatedAt: new Date() })
					.where(eq(timeEntry.id, r.id));
			}
		}
	});
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
	// La poubelle est le seul moyen de faire disparaître une ligne épinglée (cf. pinRow) — sans ça,
	// une ligne ajoutée mais jamais remplie reviendrait au prochain chargement malgré la suppression.
	await unpinRow(workspaceId, userId, input);
}

function pinTargetColumns(targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE', targetId: string) {
	return {
		ticketId: targetType === 'TICKET' ? targetId : null,
		categoryId: targetType === 'CATEGORY' ? targetId : null,
		objectiveId: targetType === 'OBJECTIVE' ? targetId : null
	};
}

/** Cible + activité d'une épingle, sans notion de période — matche potentiellement plusieurs lignes. */
function pinTargetMatch(
	workspaceId: string,
	userId: string,
	input: { targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE'; targetId: string; activityId: string | null }
) {
	const cols = pinTargetColumns(input.targetType, input.targetId);
	return and(
		eq(imputationPin.workspaceId, workspaceId),
		eq(imputationPin.userId, userId),
		eq(imputationPin.targetType, input.targetType),
		cols.ticketId ? eq(imputationPin.ticketId, cols.ticketId) : isNull(imputationPin.ticketId),
		cols.categoryId ? eq(imputationPin.categoryId, cols.categoryId) : isNull(imputationPin.categoryId),
		cols.objectiveId ? eq(imputationPin.objectiveId, cols.objectiveId) : isNull(imputationPin.objectiveId),
		input.activityId ? eq(imputationPin.activityId, input.activityId) : isNull(imputationPin.activityId)
	);
}

/** Une épingle touche la plage [fromISO, toISO] dès que son intervalle [firstDay, lastDay] la chevauche. */
function pinOverlaps(fromISO: string, toISO: string) {
	return and(lte(imputationPin.firstDay, toISO), gte(imputationPin.lastDay, fromISO));
}

export type PinnedRow = { targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE'; targetId: string; activityId: string | null };

/**
 * Lignes épinglées sur "Mon imputation" et visibles pour la période affichée — même sans aucune
 * heure saisie (cf. imputationPin). Une épingle créée pour une autre période (une autre semaine,
 * un autre mois) ne remonte pas ici : c'est ce qui la scope à la période où elle a été ajoutée.
 */
export async function listPinnedRows(workspaceId: string, userId: string, fromISO: string, toISO: string): Promise<PinnedRow[]> {
	const rows = await db
		.select({
			targetType: imputationPin.targetType,
			ticketId: imputationPin.ticketId,
			categoryId: imputationPin.categoryId,
			objectiveId: imputationPin.objectiveId,
			activityId: imputationPin.activityId
		})
		.from(imputationPin)
		.where(and(eq(imputationPin.workspaceId, workspaceId), eq(imputationPin.userId, userId), pinOverlaps(fromISO, toISO)));
	return rows
		.map((r) => ({
			targetType: r.targetType,
			targetId: r.ticketId ?? r.categoryId ?? r.objectiveId,
			activityId: r.activityId
		}))
		.filter((r): r is PinnedRow => !!r.targetId);
}

/**
 * Épingle une ligne (cible + activité) pour la période affichée — reste affichée tant qu'aucun
 * clic sur la poubelle, mais seulement pour les périodes qui chevauchent [firstDay, lastDay].
 * Idempotent pour une même période (ajouter deux fois la même ligne dans la même semaine ne crée
 * qu'une épingle) ; ajouter la même cible dans une autre période crée une épingle séparée.
 */
export async function pinRow(
	workspaceId: string,
	userId: string,
	input: {
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		targetId: string;
		activityId: string | null;
		firstDay: string;
		lastDay: string;
	}
) {
	await assertTargetInWorkspace(workspaceId, userId, input.targetType, input.targetId);
	const existing = await db
		.select({ id: imputationPin.id })
		.from(imputationPin)
		.where(
			and(
				pinTargetMatch(workspaceId, userId, input),
				eq(imputationPin.firstDay, input.firstDay),
				eq(imputationPin.lastDay, input.lastDay)
			)
		);
	if (existing[0]) return;
	await db.insert(imputationPin).values({
		workspaceId,
		userId,
		targetType: input.targetType,
		...pinTargetColumns(input.targetType, input.targetId),
		activityId: input.activityId,
		firstDay: input.firstDay,
		lastDay: input.lastDay
	});
}

/** Retire toutes les épingles d'une ligne qui chevauchent [fromISO, toISO] — la période affichée au clic sur la poubelle. */
export async function unpinRow(
	workspaceId: string,
	userId: string,
	input: { targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE'; targetId: string; activityId: string | null; fromISO: string; toISO: string }
) {
	await db.delete(imputationPin).where(and(pinTargetMatch(workspaceId, userId, input), pinOverlaps(input.fromISO, input.toISO)));
}
