import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, timeEntry, category, activity, user, ticketGroup, ticket, ssp } from '$lib/server/db';
import { listTickets, getRefData } from './tickets';
import { num, round, totalEstimation, totalRae, avancement } from './calc';

export type Dashboard = {
	kpis: {
		estTotal: number;
		consumedTotal: number;
		raeTotal: number;
		avancement: number;
		ticketCount: number;
	};
	byState: { label: string; emoji: string | null; color: string | null; count: number }[];
	byProject: GroupProgress[];
	bySprint: GroupProgress[];
	byVersion: GroupProgress[];
	byGroup: GroupProgress[];
	byPerson: { name: string; productive: number; nonProductive: number; total: number }[];
	byActivity: { label: string; productive: number; nonProductive: number; total: number }[];
	productiveVsNot: { productive: number; nonProductive: number };
	bySsp: { personName: string; ssp: string; total: number }[];
};

export type SspConsoRow = {
	userId: string;
	displayName: string;
	/** null = imputations sur des tickets sans code SSP renseigné. */
	sspId: string | null;
	sspCode: string | null;
	sspLabel: string | null;
	total: number;
};

/**
 * Consommé par (personne, code SSP) sur une période. Partagé entre la synthèse (/dashboard) et la
 * clôture mensuelle (monthlyClosing.ts) : c'est le même tableau croisé, l'Excel de suivi financier
 * demande explicitement de reprendre celui de la synthèse.
 *
 * Le code SSP vit sur le ticket, jamais sur une catégorie/objectif — l'inner join exclut donc
 * naturellement tout ce qui n'est pas une imputation TICKET, sans filtrer sur targetType à la main.
 */
export async function getConsoBySsp(
	workspaceId: string,
	period?: { from: string; to: string }
): Promise<SspConsoRow[]> {
	const inPeriod = period
		? and(gte(timeEntry.day, period.from), lte(timeEntry.day, period.to))
		: undefined;
	const rows = await db
		.select({
			userId: timeEntry.userId,
			displayName: user.displayName,
			sspId: ticket.sspId,
			sspCode: ssp.code,
			sspLabel: ssp.label,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		.innerJoin(user, eq(timeEntry.userId, user.id))
		.innerJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(ssp, eq(ticket.sspId, ssp.id))
		.where(and(eq(timeEntry.workspaceId, workspaceId), inPeriod))
		.groupBy(timeEntry.userId, user.displayName, ticket.sspId, ssp.code, ssp.label);
	return rows.map((r) => ({ ...r, total: round(num(r.total)) }));
}

/** Avancement agrégé d'un regroupement de tickets (projet ou sprint). */
export type GroupProgress = {
	name: string;
	est: number;
	consumed: number;
	rae: number;
	avancement: number;
	ticketCount: number;
};

/**
 * Synthèse d'un espace.
 * Sans `period` : vue complète (chiffrage état courant + imputations totales).
 * Avec `period` (mois) : seules les stats issues des imputations sont bornées à la
 * période ; le chiffrage (estimé/RAE/avancement/état/projet) est masqué car il n'a
 * pas de dimension temporelle — il reste consultable en « Tout l'espace ».
 */
export async function getDashboard(
	workspaceId: string,
	period?: { from: string; to: string },
	testPhase = true
): Promise<Dashboard> {
	const inPeriod = period
		? and(gte(timeEntry.day, period.from), lte(timeEntry.day, period.to))
		: undefined;

	const [personRows, activityRows, sspRows] = await Promise.all([
		db
			.select({
				name: user.displayName,
				tt: timeEntry.targetType,
				kind: category.kind,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.leftJoin(category, eq(timeEntry.categoryId, category.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), inPeriod))
			.groupBy(user.displayName, timeEntry.targetType, category.kind),
		db
			.select({
				label: sql<string>`coalesce(${activity.label}, 'Non précisé')`,
				tt: timeEntry.targetType,
				kind: category.kind,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.leftJoin(activity, eq(timeEntry.activityId, activity.id))
			.leftJoin(category, eq(timeEntry.categoryId, category.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), inPeriod))
			.groupBy(sql`coalesce(${activity.label}, 'Non précisé')`, timeEntry.targetType, category.kind),
		getConsoBySsp(workspaceId, period)
	]);

	// Par personne (productif vs non productif) + consommé ticket sur la période
	const persons = new Map<string, { productive: number; nonProductive: number }>();
	let prodTotal = 0;
	let nonProdTotal = 0;
	let ticketConsumed = 0;
	for (const r of personRows) {
		const v = num(r.total);
		if (r.tt === 'TICKET') ticketConsumed = round(ticketConsumed + v);
		const isNonProd = r.tt === 'CATEGORY' && r.kind === 'NON_PRODUCTIVE';
		if (!persons.has(r.name)) persons.set(r.name, { productive: 0, nonProductive: 0 });
		const p = persons.get(r.name)!;
		if (isNonProd) {
			p.nonProductive = round(p.nonProductive + v);
			nonProdTotal = round(nonProdTotal + v);
		} else {
			p.productive = round(p.productive + v);
			prodTotal = round(prodTotal + v);
		}
	}
	const byPerson = [...persons.entries()]
		.map(([name, p]) => ({ name, ...p, total: round(p.productive + p.nonProductive) }))
		.sort((a, b) => b.total - a.total);

	// Par activité (productif vs non productif) : même règle que byPerson ci-dessus — une catégorie
	// non productive (ex. Congé) peut être taguée avec une activité (rien ne l'en empêche à la
	// saisie), sans ça son temps se mélangerait silencieusement au travail productif du même libellé.
	const activities = new Map<string, { productive: number; nonProductive: number }>();
	for (const r of activityRows) {
		const v = num(r.total);
		const isNonProd = r.tt === 'CATEGORY' && r.kind === 'NON_PRODUCTIVE';
		if (!activities.has(r.label)) activities.set(r.label, { productive: 0, nonProductive: 0 });
		const a = activities.get(r.label)!;
		if (isNonProd) a.nonProductive = round(a.nonProductive + v);
		else a.productive = round(a.productive + v);
	}
	const byActivity = [...activities.entries()]
		.map(([label, a]) => ({ label, ...a, total: round(a.productive + a.nonProductive) }))
		.sort((a, b) => b.total - a.total);

	const productiveVsNot = { productive: prodTotal, nonProductive: nonProdTotal };

	// Contrairement à byPerson/byActivity ci-dessus, pas de distinction productif/non productif à
	// recombiner ici : le GROUP BY correspond déjà à la forme de sortie. On expose le libellé et pas
	// le code — « Site Internet » se lit, « 8364BEB5354 » non.
	const bySsp = sspRows.map((r) => ({
		personName: r.displayName,
		ssp: r.sspLabel ?? 'Sans code SSP',
		total: r.total
	}));

	// Mode mois : on ne renvoie que les stats mensuelles ; chiffrage masqué (vide).
	if (period) {
		return {
			kpis: { estTotal: 0, consumedTotal: ticketConsumed, raeTotal: 0, avancement: 0, ticketCount: 0 },
			byState: [],
			byProject: [],
			bySprint: [],
			byVersion: [],
			byGroup: [],
			byPerson,
			byActivity,
			productiveVsNot,
			bySsp
		};
	}

	// Vue complète : chiffrage depuis l'état courant des tickets.
	const [tickets, ref, groups] = await Promise.all([
		listTickets(workspaceId),
		getRefData(workspaceId),
		db.select({ id: ticketGroup.id, label: ticketGroup.label }).from(ticketGroup).where(eq(ticketGroup.workspaceId, workspaceId))
	]);

	// KPIs + répartition par état + avancement par projet / sprint (depuis les tickets)
	let estTotal = 0;
	let raeTotalSum = 0;
	let consumedTotal = 0;
	const stateCount = new Map<string | null, number>();
	const projAgg = new Map<string, GroupProgress>();
	const sprintAgg = new Map<string, GroupProgress>();
	const versionAgg = new Map<string, GroupProgress>();
	const groupAgg = new Map<string, GroupProgress>();
	const versionName = new Map(ref.versions.map((v) => [v.id, v.name]));
	const groupName = new Map(groups.map((g) => [g.id, g.label]));
	const accumulate = (
		map: Map<string, GroupProgress>,
		name: string,
		est: number,
		rae: number,
		consumed: number
	) => {
		const g = map.get(name) ?? { name, est: 0, consumed: 0, rae: 0, avancement: 0, ticketCount: 0 };
		g.est += est;
		g.rae += rae;
		g.consumed += consumed;
		g.ticketCount += 1;
		map.set(name, g);
	};
	for (const t of tickets) {
		const est = totalEstimation(String(t.estimationReal), String(t.estimationTest), testPhase);
		const rae = totalRae(String(t.raeReal), String(t.raeTest), testPhase);
		estTotal += est;
		raeTotalSum += rae;
		consumedTotal += t.consumed;
		stateCount.set(t.stateId ?? null, (stateCount.get(t.stateId ?? null) ?? 0) + 1);
		accumulate(projAgg, t.projectName ?? 'Sans projet', est, rae, t.consumed);
		accumulate(sprintAgg, t.sprintName ?? 'Sans sprint', est, rae, t.consumed);
		accumulate(
			versionAgg,
			(t.versionId && versionName.get(t.versionId)) || 'Sans version',
			est,
			rae,
			t.consumed
		);
		// Many-to-many : un ticket peut alimenter 0..N groupes (pas de fallback "Sans groupe").
		for (const gid of t.groupIds) {
			const label = groupName.get(gid);
			if (label) accumulate(groupAgg, label, est, rae, t.consumed);
		}
	}
	estTotal = round(estTotal);
	raeTotalSum = round(raeTotalSum);
	consumedTotal = round(consumedTotal);

	const finalizeGroups = (map: Map<string, GroupProgress>): GroupProgress[] =>
		[...map.values()]
			.map((g) => ({
				name: g.name,
				est: round(g.est),
				consumed: round(g.consumed),
				rae: round(g.rae),
				avancement: avancement(g.est, g.rae, g.consumed),
				ticketCount: g.ticketCount
			}))
			.sort((a, b) => b.est - a.est);
	const byProject = finalizeGroups(projAgg);
	const bySprint = finalizeGroups(sprintAgg);
	const byVersion = finalizeGroups(versionAgg);
	const byGroup = finalizeGroups(groupAgg);

	const byState = ref.states
		.map((s) => ({ label: s.label, emoji: s.emoji, color: s.color, count: stateCount.get(s.id) ?? 0 }))
		.filter((s) => s.count > 0);
	const noState = stateCount.get(null) ?? 0;
	if (noState > 0) byState.push({ label: 'Sans état', emoji: '∅', color: '#9CA3AF', count: noState });

	return {
		kpis: {
			estTotal,
			consumedTotal,
			raeTotal: raeTotalSum,
			avancement: avancement(estTotal, raeTotalSum, consumedTotal),
			ticketCount: tickets.length
		},
		byState,
		byProject,
		bySprint,
		byVersion,
		byGroup,
		byPerson,
		byActivity,
		productiveVsNot,
		bySsp
	};
}
