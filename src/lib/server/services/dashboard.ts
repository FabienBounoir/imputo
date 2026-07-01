import { and, eq, sql } from 'drizzle-orm';
import { db, timeEntry, category, activity, user } from '$lib/server/db';
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
	byPerson: { name: string; productive: number; nonProductive: number; total: number }[];
	byActivity: { label: string; total: number }[];
	productiveVsNot: { productive: number; nonProductive: number };
};

/** Avancement agrégé d'un regroupement de tickets (projet ou sprint). */
export type GroupProgress = {
	name: string;
	est: number;
	consumed: number;
	rae: number;
	avancement: number;
	ticketCount: number;
};

export async function getDashboard(workspaceId: string): Promise<Dashboard> {
	const [tickets, ref, personRows, activityRows] = await Promise.all([
		listTickets(workspaceId),
		getRefData(workspaceId),
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
			.where(eq(timeEntry.workspaceId, workspaceId))
			.groupBy(user.displayName, timeEntry.targetType, category.kind),
		db
			.select({
				label: sql<string>`coalesce(${activity.label}, 'Non précisé')`,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.leftJoin(activity, eq(timeEntry.activityId, activity.id))
			.where(eq(timeEntry.workspaceId, workspaceId))
			.groupBy(sql`coalesce(${activity.label}, 'Non précisé')`)
	]);

	// KPIs + répartition par état + avancement par projet / sprint (depuis les tickets)
	let estTotal = 0;
	let raeTotalSum = 0;
	let consumedTotal = 0;
	const stateCount = new Map<string | null, number>();
	const projAgg = new Map<string, GroupProgress>();
	const sprintAgg = new Map<string, GroupProgress>();
	const versionAgg = new Map<string, GroupProgress>();
	const versionName = new Map(ref.versions.map((v) => [v.id, v.name]));
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
		const est = totalEstimation(String(t.estimationReal), String(t.estimationTest));
		const rae = totalRae(String(t.raeReal), String(t.raeTest));
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
				avancement: avancement(g.est, g.rae),
				ticketCount: g.ticketCount
			}))
			.sort((a, b) => b.est - a.est);
	const byProject = finalizeGroups(projAgg);
	const bySprint = finalizeGroups(sprintAgg);
	const byVersion = finalizeGroups(versionAgg);

	const byState = ref.states
		.map((s) => ({ label: s.label, emoji: s.emoji, color: s.color, count: stateCount.get(s.id) ?? 0 }))
		.filter((s) => s.count > 0);
	const noState = stateCount.get(null) ?? 0;
	if (noState > 0) byState.push({ label: 'Sans état', emoji: '∅', color: '#9CA3AF', count: noState });

	// Par personne (productif vs non productif)
	const persons = new Map<string, { productive: number; nonProductive: number }>();
	let prodTotal = 0;
	let nonProdTotal = 0;
	for (const r of personRows) {
		const v = num(r.total);
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

	const byActivity = activityRows
		.map((a) => ({ label: a.label, total: round(num(a.total)) }))
		.sort((a, b) => b.total - a.total);

	return {
		kpis: {
			estTotal,
			consumedTotal,
			raeTotal: raeTotalSum,
			avancement: avancement(estTotal, raeTotalSum),
			ticketCount: tickets.length
		},
		byState,
		byProject,
		bySprint,
		byVersion,
		byPerson,
		byActivity,
		productiveVsNot: { productive: prodTotal, nonProductive: nonProdTotal }
	};
}
