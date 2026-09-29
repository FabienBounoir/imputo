import { and, eq, gte, isNotNull, isNull, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import { db, activity, category, ticket, ticketGroupMember, timeEntry, user, weeklyObjective } from '$lib/server/db';
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
	byTask: { taskId: string; label: string; ticketId: string | null; ticketKey: string | null; total: number }[];
};

/**
 * - ACTIVITY : une activité réelle.
 * - ABSENCE : saisies sans activité sur une catégorie liée à une absence (Congé, Formation,
 *   Hors-projet) — sans activité par nature, rien à corriger ; comptées pour que le total soit complet.
 * - NONE : les autres saisies sans activité (activity_id est optionnel) = oublis à corriger.
 * Ordre d'affichage : activités, puis ABSENCE, puis NONE.
 */
export type ActivitySynthesisRowKind = 'ACTIVITY' | 'ABSENCE' | 'NONE';
const KIND_ORDER: Record<ActivitySynthesisRowKind, number> = { ACTIVITY: 0, ABSENCE: 1, NONE: 2 };

export type ActivitySynthesisRow = {
	kind: ActivitySynthesisRowKind;
	activityId: string | null; // null hors ACTIVITY
	label: string;
	archived: boolean;
	cells: ActivitySynthesisCell[];
	total: number;
};

export type ActivitySynthesisView = {
	windowMonths: string[];
	rows: ActivitySynthesisRow[];
};

function windowMonthsNow() {
	const currentMonth = `${toISODate(new Date()).slice(0, 7)}-01`;
	const windowMonths: string[] = [];
	for (let i = WINDOW_SIZE - 1; i >= 0; i--) windowMonths.push(addMonths(currentMonth, -i));
	return { windowMonths, from: windowMonths[0], to: monthBounds(currentMonth).end };
}

/**
 * Lignes brutes au grain activité × mois × personne × tâche, partagées par la vue et le détail
 * (modale) : `extra` restreint à une ligne du tableau et à une personne ou une tâche.
 */
async function querySynthesisRows(
	workspaceId: string,
	filters: ActivitySynthesisFilters,
	excludeUserIds: string[] | undefined,
	extra: (SQL | undefined)[] = []
) {
	const { from, to } = windowMonthsNow();

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
			activityId: timeEntry.activityId,
			label: activity.label,
			sortOrder: sql<number>`coalesce(${activity.sortOrder}, 0)`,
			archived: sql<boolean>`${activity.archivedAt} is not null`,
			month: sql<string>`date_trunc('month', ${timeEntry.day})::date`,
			userId: timeEntry.userId,
			displayName: user.displayName,
			targetType: timeEntry.targetType,
			ticketId: timeEntry.ticketId,
			ticketKey: ticket.key,
			ticketTitle: ticket.title,
			categoryId: timeEntry.categoryId,
			categoryLabel: category.label,
			absence: sql<boolean>`${category.linkedAbsenceType} is not null`,
			objectiveId: timeEntry.objectiveId,
			objectiveLabel: weeklyObjective.label,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		// Left join : une saisie sans activité doit compter dans le total (sinon « Total équipe » sous-estime).
		.leftJoin(activity, eq(timeEntry.activityId, activity.id))
		.innerJoin(user, eq(timeEntry.userId, user.id))
		.leftJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.leftJoin(category, eq(timeEntry.categoryId, category.id))
		.leftJoin(weeklyObjective, eq(timeEntry.objectiveId, weeklyObjective.id))
		.$dynamic();

	if (filters.groupId) query = query.innerJoin(ticketGroupMember, eq(ticketGroupMember.ticketId, ticket.id));

	return query
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				gte(timeEntry.day, from),
				lte(timeEntry.day, to),
				...ticketConds,
				excludeUserIds?.length ? notInArray(timeEntry.userId, excludeUserIds) : undefined,
				...(filters.groupId ? [eq(ticketGroupMember.groupId, filters.groupId)] : []),
				...extra
			)
		)
		.groupBy(
			timeEntry.activityId,
			activity.label,
			activity.sortOrder,
			activity.archivedAt,
			sql`date_trunc('month', ${timeEntry.day})`,
			timeEntry.userId,
			user.displayName,
			timeEntry.targetType,
			timeEntry.ticketId,
			ticket.key,
			ticket.title,
			timeEntry.categoryId,
			category.label,
			category.linkedAbsenceType,
			timeEntry.objectiveId,
			weeklyObjective.label
		);
}

type SynthesisRawRow = Awaited<ReturnType<typeof querySynthesisRows>>[number];

/** Identité et libellé d'une tâche (ticket, catégorie ou tâche libre) — clé stable `TYPE:id`. */
function taskOf(r: SynthesisRawRow) {
	return {
		taskId: `${r.targetType}:${r.ticketId ?? r.categoryId ?? r.objectiveId ?? 'none'}`,
		label:
			r.ticketTitle ??
			r.categoryLabel ??
			r.objectiveLabel ??
			// objectiveId passe à null quand l'objectif est supprimé (set null) : les heures restent.
			(r.targetType === 'OBJECTIVE' ? 'Tâche libre supprimée' : 'Tâche inconnue'),
		ticketId: r.ticketId,
		ticketKey: r.ticketKey
	};
}

export async function getActivitySynthesisView(
	workspaceId: string,
	filters: ActivitySynthesisFilters,
	excludeUserIds?: string[]
): Promise<ActivitySynthesisView> {
	const { windowMonths } = windowMonthsNow();
	const rows = await querySynthesisRows(workspaceId, filters, excludeUserIds);

	// Regroupement en mémoire : activité -> mois -> utilisateur ET tâche (une seule requête grain
	// activité × mois × personne × tâche, sommée des deux côtés). Volume borné (12 mois × équipe ×
	// tâches réellement saisies), pas la peine de faire deux requêtes.
	type TaskAcc = { label: string; ticketId: string | null; ticketKey: string | null; total: number };
	type Acc = {
		kind: ActivitySynthesisRowKind;
		activityId: string | null;
		label: string;
		sortOrder: number;
		archived: boolean;
		byMonth: Map<
			string,
			{ total: number; byUser: Map<string, { displayName: string; total: number }>; byTask: Map<string, TaskAcc> }
		>;
	};
	const byActivity = new Map<string, Acc>();
	for (const r of rows) {
		const kind: ActivitySynthesisRowKind = r.activityId ? 'ACTIVITY' : r.absence ? 'ABSENCE' : 'NONE';
		const key = r.activityId ?? kind;
		const acc = byActivity.get(key) ?? {
			kind,
			activityId: r.activityId,
			label: r.label ?? (kind === 'ABSENCE' ? 'Absences' : 'Sans activité'),
			sortOrder: r.sortOrder,
			archived: r.archived,
			byMonth: new Map()
		};
		const cell = acc.byMonth.get(r.month) ?? { total: 0, byUser: new Map(), byTask: new Map() };
		const amount = round(num(r.total));
		cell.total = round(cell.total + amount);
		const u = cell.byUser.get(r.userId) ?? { displayName: r.displayName, total: 0 };
		u.total = round(u.total + amount);
		cell.byUser.set(r.userId, u);
		const { taskId, ...task } = taskOf(r);
		const t = cell.byTask.get(taskId) ?? { ...task, total: 0 };
		t.total = round(t.total + amount);
		cell.byTask.set(taskId, t);
		acc.byMonth.set(r.month, cell);
		byActivity.set(key, acc);
	}

	const activityRows: ActivitySynthesisRow[] = [...byActivity.values()]
		.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
		.map((acc) => {
			const cells: ActivitySynthesisCell[] = windowMonths.map((month) => {
				const cell = acc.byMonth.get(month);
				return {
					month,
					total: cell?.total ?? 0,
					byUser: cell
						? [...cell.byUser.entries()]
								.map(([userId, u]) => ({ userId, displayName: u.displayName, total: u.total }))
								.sort((a, b) => b.total - a.total)
						: [],
					byTask: cell ? [...cell.byTask.entries()].map(([taskId, t]) => ({ taskId, ...t })) : []
				};
			});
			return {
				kind: acc.kind,
				activityId: acc.activityId,
				label: acc.label,
				archived: acc.archived,
				cells,
				total: round(cells.reduce((s, c) => s + c.total, 0))
			};
		});

	return { windowMonths, rows: activityRows };
}

// ---------- Détail d'une ligne (modale, chargée au clic) ----------

/** Ligne du tableau : une activité, ou les regroupements Absences / Sans activité. */
export type SynthesisBucket = { kind: 'ACTIVITY'; activityId: string } | { kind: 'ABSENCE' | 'NONE' };
/** Personne → ses tâches sur la ligne ; tâche → les personnes qui y ont consommé sur la ligne. */
export type SynthesisFocus = { userId: string } | { taskId: string };

export type SynthesisDetailLine = {
	id: string;
	label: string;
	userId: string | null;
	ticketId: string | null;
	ticketKey: string | null;
	total: number;
	byMonth: Record<string, number>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);
const TASK_COLUMN = { TICKET: timeEntry.ticketId, CATEGORY: timeEntry.categoryId, OBJECTIVE: timeEntry.objectiveId } as const;

/** Condition SQL d'une clé de tâche `TYPE:id` (cf. taskOf) ; null si la clé est invalide. */
function taskCondition(taskId: string): SQL | null {
	const [type, id] = taskId.split(':');
	if (!(type in TASK_COLUMN) || !id || (id !== 'none' && !isUuid(id))) return null;
	const col = TASK_COLUMN[type as keyof typeof TASK_COLUMN];
	return and(eq(timeEntry.targetType, type as keyof typeof TASK_COLUMN), id === 'none' ? isNull(col) : eq(col, id))!;
}

function bucketCondition(bucket: SynthesisBucket): SQL {
	if (bucket.kind === 'ACTIVITY') return eq(timeEntry.activityId, bucket.activityId);
	// Même partage que la vue (kind ABSENCE/NONE) : sans activité, catégorie liée à une absence ou non.
	return and(
		isNull(timeEntry.activityId),
		bucket.kind === 'ABSENCE' ? isNotNull(category.linkedAbsenceType) : isNull(category.linkedAbsenceType)
	)!;
}

/** null = clé de tâche invalide (à traiter en 400 par l'appelant). */
export async function getActivitySynthesisDetail(
	workspaceId: string,
	filters: ActivitySynthesisFilters,
	excludeUserIds: string[] | undefined,
	bucket: SynthesisBucket,
	focus: SynthesisFocus
): Promise<{ windowMonths: string[]; lines: SynthesisDetailLine[] } | null> {
	const focusCond = 'userId' in focus ? eq(timeEntry.userId, focus.userId) : taskCondition(focus.taskId);
	if (!focusCond) return null;
	const { windowMonths } = windowMonthsNow();
	const rows = await querySynthesisRows(workspaceId, filters, excludeUserIds, [bucketCondition(bucket), focusCond]);

	const lines = new Map<string, SynthesisDetailLine>();
	for (const r of rows) {
		const amount = round(num(r.total));
		const task = taskOf(r);
		const line =
			'userId' in focus
				? { id: task.taskId, label: task.label, userId: null, ticketId: task.ticketId, ticketKey: task.ticketKey }
				: { id: r.userId, label: r.displayName, userId: r.userId, ticketId: null, ticketKey: null };
		const l = lines.get(line.id) ?? { ...line, total: 0, byMonth: {} };
		l.total = round(l.total + amount);
		l.byMonth[r.month] = round((l.byMonth[r.month] ?? 0) + amount);
		lines.set(line.id, l);
	}
	return { windowMonths, lines: [...lines.values()].sort((a, b) => b.total - a.total) };
}
