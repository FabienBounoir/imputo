import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, activity, ticket, ticketGroupMember, timeEntry, user } from '$lib/server/db';
import { num, round } from './calc';
import { addMonths, monthBounds, toISODate } from '$lib/utils/date';

/**
 * Synthèse Conso par activité — écran de lecture transverse (pas de saisie), distinct du Suivi
 * annuel qui est au niveau SSP. Axe mois × activité, dépliable par personne. Fenêtre fixe de 12
 * mois glissants jusqu'au mois courant : pas de curseur admin ici, rien n'est figé/édité, donc pas
 * besoin du mécanisme workspace.annualTrackingMonth.
 */

const WINDOW_SIZE = 12;

export type ActivitySynthesisFilters = {
	projectId?: string;
	sprintId?: string;
	versionId?: string;
	sspId?: string;
	groupId?: string;
};

export type ActivitySynthesisCell = {
	month: string; // 'YYYY-MM-01'
	total: number;
	byUser: { userId: string; displayName: string; total: number }[];
};

export type ActivitySynthesisRow = {
	activityId: string;
	label: string;
	archived: boolean;
	cells: ActivitySynthesisCell[];
	total: number;
};

export type ActivitySynthesisView = {
	windowMonths: string[];
	rows: ActivitySynthesisRow[];
};

export async function getActivitySynthesisView(
	workspaceId: string,
	filters: ActivitySynthesisFilters
): Promise<ActivitySynthesisView> {
	const currentMonth = `${toISODate(new Date()).slice(0, 7)}-01`;
	const windowMonths: string[] = [];
	for (let i = WINDOW_SIZE - 1; i >= 0; i--) windowMonths.push(addMonths(currentMonth, -i));
	const from = windowMonths[0];
	const to = monthBounds(currentMonth).end;

	// Un filtre ticket (projet/sprint/version/SSP/groupe) exclut de fait les tâches custom (pas de
	// ticket à filtrer) : comportement attendu, pas un bug — un filtre "Projet X" n'a rien à dire
	// d'une tâche libre qui n'appartient à aucun projet.
	const ticketConds = [
		filters.projectId ? eq(ticket.projectId, filters.projectId) : undefined,
		filters.sprintId ? eq(ticket.sprintId, filters.sprintId) : undefined,
		filters.versionId ? eq(ticket.versionId, filters.versionId) : undefined,
		filters.sspId ? eq(ticket.sspId, filters.sspId) : undefined
	].filter((c) => c !== undefined);

	// Left join sur ticket : une tâche custom (sans ticket) doit rester dans la somme tant qu'aucun
	// filtre ticket n'est actif. Le groupe, lui, n'est joint QUE si filtré : sans ça un ticket membre
	// de plusieurs groupes dupliquerait sa ligne et gonflerait la somme (inner join = filtre implicite).
	let query = db
		.select({
			activityId: activity.id,
			label: activity.label,
			sortOrder: activity.sortOrder,
			archived: sql<boolean>`${activity.archivedAt} is not null`,
			month: sql<string>`date_trunc('month', ${timeEntry.day})::date`,
			userId: timeEntry.userId,
			displayName: user.displayName,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		.innerJoin(activity, eq(timeEntry.activityId, activity.id))
		.innerJoin(user, eq(timeEntry.userId, user.id))
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.$dynamic();

	if (filters.groupId) query = query.innerJoin(ticketGroupMember, eq(ticketGroupMember.ticketId, ticket.id));

	const rows = await query
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				gte(timeEntry.day, from),
				lte(timeEntry.day, to),
				...ticketConds,
				...(filters.groupId ? [eq(ticketGroupMember.groupId, filters.groupId)] : [])
			)
		)
		.groupBy(
			activity.id,
			activity.label,
			activity.sortOrder,
			activity.archivedAt,
			sql`date_trunc('month', ${timeEntry.day})`,
			timeEntry.userId,
			user.displayName
		);

	// Regroupement en mémoire : activité -> mois -> utilisateur. Volume borné (12 mois × activités ×
	// équipe), pas la peine de complexifier la requête pour éviter cette passe.
	type Acc = {
		label: string;
		sortOrder: number;
		archived: boolean;
		byMonth: Map<string, { total: number; byUser: Map<string, { displayName: string; total: number }> }>;
	};
	const byActivity = new Map<string, Acc>();
	for (const r of rows) {
		const acc = byActivity.get(r.activityId) ?? { label: r.label, sortOrder: r.sortOrder, archived: r.archived, byMonth: new Map() };
		const cell = acc.byMonth.get(r.month) ?? { total: 0, byUser: new Map() };
		const amount = round(num(r.total));
		cell.total = round(cell.total + amount);
		const u = cell.byUser.get(r.userId) ?? { displayName: r.displayName, total: 0 };
		u.total = round(u.total + amount);
		cell.byUser.set(r.userId, u);
		acc.byMonth.set(r.month, cell);
		byActivity.set(r.activityId, acc);
	}

	const activityRows: ActivitySynthesisRow[] = [...byActivity.entries()]
		.sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[1].label.localeCompare(b[1].label))
		.map(([activityId, acc]) => {
			const cells: ActivitySynthesisCell[] = windowMonths.map((month) => {
				const cell = acc.byMonth.get(month);
				return {
					month,
					total: cell?.total ?? 0,
					byUser: cell
						? [...cell.byUser.entries()]
								.map(([userId, u]) => ({ userId, displayName: u.displayName, total: u.total }))
								.sort((a, b) => b.total - a.total)
						: []
				};
			});
			return {
				activityId,
				label: acc.label,
				archived: acc.archived,
				cells,
				total: round(cells.reduce((s, c) => s + c.total, 0))
			};
		});

	return { windowMonths, rows: activityRows };
}
