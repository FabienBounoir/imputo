import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sprint, timeEntry, user, activity, ticketActivityRae, ticketSnapshot } from '$lib/server/db';
import { num, round, totalEstimation, totalRae, avancement } from './calc';
import { listTickets } from './tickets';

export type SprintDashboard = {
	sprintId: string;
	sprintName: string;
	kind: 'SPRINT' | 'VERSION';
	kpis: {
		estTotal: number;
		consumedTotal: number;
		raeTotal: number;
		avancement: number;
		ecartVsEstimeTotal: number;
		/** Admin only — null pour un USER standard (dérive de enveloppeTotale, invisible pour lui). Libellé historique "TNF". */
		ecartVsBudgetTotal: number | null;
		/** Admin only — somme des enveloppeTotale des tickets du périmètre. */
		budgetTotal: number | null;
		ticketCount: number;
	};
	byActivity: { label: string; raeReal: number; raeTest: number }[];
	byPerson: { name: string; consumed: number }[];
	history: { date: string; consumed: number; rae: number }[];
	tickets: SprintDashboardTicket[];
};

/** Ligne allégée pour la liste des US sous le dashboard — lecture seule (édition sur /tickets). */
export type SprintDashboardTicket = {
	id: string;
	key: string;
	title: string;
	stateLabel: string | null;
	stateEmoji: string | null;
	stateColor: string | null;
	/** Admin only — null pour un USER standard. */
	budget: number | null;
	estTotal: number;
	raeTotal: number;
	consumed: number;
	ecartVsEstime: number;
	ecartVsBudget: number | null;
	avancement: number;
};

/**
 * Dashboard d'un sprint ou d'une version — même briques pour les deux écrans (§4.3/4.4),
 * seul le champ ticket utilisé pour scoper les tickets change selon `kind`.
 */
export async function getSprintDashboard(
	workspaceId: string,
	sprintId: string,
	testPhase = true,
	isAdmin = true
): Promise<SprintDashboard> {
	const [sprintRow] = await db
		.select({ id: sprint.id, name: sprint.name, kind: sprint.kind })
		.from(sprint)
		.where(and(eq(sprint.id, sprintId), eq(sprint.workspaceId, workspaceId)));
	if (!sprintRow) throw new Error('Sprint/version introuvable dans cet espace.');

	const allTickets = await listTickets(workspaceId, testPhase, isAdmin);
	const tickets =
		sprintRow.kind === 'VERSION'
			? allTickets.filter((t) => t.versionId === sprintId)
			: allTickets.filter((t) => t.sprintId === sprintId);
	const ticketIds = tickets.map((t) => t.id);

	let estTotal = 0;
	let raeTotal = 0;
	let consumedTotal = 0;
	let ecartEstimeTotal = 0;
	let ecartBudgetTotal = 0;
	let budgetTotal = 0;
	const ticketRows: SprintDashboardTicket[] = [];
	for (const t of tickets) {
		const tEst = totalEstimation(String(t.estimationReal), String(t.estimationTest), testPhase);
		const tRae = totalRae(String(t.raeReal), String(t.raeTest), testPhase);
		estTotal += tEst;
		raeTotal += tRae;
		consumedTotal += t.consumed;
		ecartEstimeTotal += t.ecartVsEstime;
		ecartBudgetTotal += t.ecartVsBudget ?? 0;
		budgetTotal += t.enveloppeTotale ?? 0;
		ticketRows.push({
			id: t.id,
			key: t.key,
			title: t.title,
			stateLabel: t.stateLabel,
			stateEmoji: t.stateEmoji,
			stateColor: t.stateColor,
			budget: t.enveloppeTotale,
			estTotal: round(tEst),
			raeTotal: round(tRae),
			consumed: t.consumed,
			ecartVsEstime: t.ecartVsEstime,
			ecartVsBudget: t.ecartVsBudget,
			avancement: t.avancement
		});
	}
	estTotal = round(estTotal);
	raeTotal = round(raeTotal);
	consumedTotal = round(consumedTotal);
	ecartEstimeTotal = round(ecartEstimeTotal);
	ecartBudgetTotal = round(ecartBudgetTotal);
	budgetTotal = round(budgetTotal);
	// Tri naturel/numérique par clé (SBX-2 avant SBX-10) — plus lisible qu'un tri lexicographique brut.
	ticketRows.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

	// Répartition par activité : RAE agrégé depuis ticket_activity_rae. Les tickets sans ligne
	// (fallback ticket.raeReal/raeTest) sont regroupés dans un bucket "Non ventilé".
	const activityRaeRows =
		ticketIds.length === 0
			? []
			: await db
					.select({
						ticketId: ticketActivityRae.ticketId,
						activityId: ticketActivityRae.activityId,
						label: activity.label,
						raeReal: ticketActivityRae.raeReal,
						raeTest: ticketActivityRae.raeTest
					})
					.from(ticketActivityRae)
					.innerJoin(activity, eq(ticketActivityRae.activityId, activity.id))
					.where(inArray(ticketActivityRae.ticketId, ticketIds));
	const ventiledTicketIds = new Set(activityRaeRows.map((r) => r.ticketId));
	const byActivityMap = new Map<string, { label: string; raeReal: number; raeTest: number }>();
	for (const r of activityRaeRows) {
		const cur = byActivityMap.get(r.activityId) ?? { label: r.label, raeReal: 0, raeTest: 0 };
		cur.raeReal = round(cur.raeReal + num(r.raeReal));
		cur.raeTest = round(cur.raeTest + num(r.raeTest));
		byActivityMap.set(r.activityId, cur);
	}
	let fallbackReal = 0;
	let fallbackTest = 0;
	for (const t of tickets) {
		if (ventiledTicketIds.has(t.id)) continue;
		fallbackReal = round(fallbackReal + t.raeReal);
		fallbackTest = round(fallbackTest + t.raeTest);
	}
	const byActivity = [...byActivityMap.values()].sort((a, b) => b.raeReal - a.raeReal);
	if (fallbackReal > 0 || fallbackTest > 0) byActivity.push({ label: 'Non ventilé', raeReal: fallbackReal, raeTest: fallbackTest });

	// Répartition par personne : consommé sur les tickets de la version/sprint.
	const personRows =
		ticketIds.length === 0
			? []
			: await db
					.select({ name: user.displayName, total: sql<string>`sum(${timeEntry.amount})` })
					.from(timeEntry)
					.innerJoin(user, eq(timeEntry.userId, user.id))
					.where(and(eq(timeEntry.workspaceId, workspaceId), inArray(timeEntry.ticketId, ticketIds)))
					.groupBy(user.displayName);
	const byPerson = personRows
		.map((r) => ({ name: r.name, consumed: round(num(r.total)) }))
		.sort((a, b) => b.consumed - a.consumed);

	// Courbe d'évolution conso/RAE : depuis les snapshots quotidiens (cron), pas d'historique sinon.
	const snapRows =
		ticketIds.length === 0
			? []
			: await db
					.select({
						date: ticketSnapshot.date,
						consumed: sql<string>`sum(${ticketSnapshot.consumed})`,
						raeReal: sql<string>`sum(${ticketSnapshot.raeReal})`,
						raeTest: sql<string>`sum(${ticketSnapshot.raeTest})`
					})
					.from(ticketSnapshot)
					.where(inArray(ticketSnapshot.ticketId, ticketIds))
					.groupBy(ticketSnapshot.date)
					.orderBy(ticketSnapshot.date);
	const history = snapRows.map((r) => ({
		date: r.date,
		consumed: round(num(r.consumed)),
		rae: round(num(r.raeReal) + (testPhase ? num(r.raeTest) : 0))
	}));

	return {
		sprintId,
		sprintName: sprintRow.name,
		kind: sprintRow.kind,
		kpis: {
			estTotal,
			consumedTotal,
			raeTotal,
			avancement: avancement(estTotal, raeTotal),
			ecartVsEstimeTotal: ecartEstimeTotal,
			ecartVsBudgetTotal: isAdmin ? ecartBudgetTotal : null,
			budgetTotal: isAdmin ? budgetTotal : null,
			ticketCount: tickets.length
		},
		byActivity,
		byPerson,
		history,
		tickets: ticketRows
	};
}
