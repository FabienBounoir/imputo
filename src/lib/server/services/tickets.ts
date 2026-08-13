import { and, eq, inArray, isNull, or, ilike, sql, count } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	db,
	ticket,
	state,
	user,
	sprint,
	project,
	activity,
	category,
	membership,
	timeEntry,
	ticketActivityRae,
	ticketGroup,
	ticketGroupMember,
	type Role
} from '$lib/server/db';
import { isManagerOrAdmin } from './workspaces';
import { logChange } from './changeLog';
import {
	num,
	round,
	totalEstimation,
	ecartVsEstime,
	ecartVsBudget,
	avancement,
	raeSuggested,
	resolvedRae,
	resolvedEstimation
} from './calc';

// Bucket synthétique pour les imputations d'un ticket sans activité renseignée — jamais un vrai
// id d'activité (ticket_activity_rae.activity_id est NOT NULL), donc son RAE/estimation/budget
// restent toujours à 0 côté serveur ; l'UI (tickets/+page.svelte) le rend en lecture seule.
export const NO_ACTIVITY_ID = '__no_activity__';

/** Champs budget/estimation tracés dans l'historique (changeLog) — pas le reste (titre, état, code SSP…). */
const TRACKED_FIELDS = new Set([
	'estimationReal',
	'estimationTest',
	'raeReal',
	'raeTest',
	'estimationPrev',
	'enveloppeTotale'
]);

/** Indicateurs libres d'un ticket (sérialisés en JSON dans ticket.flags). */
export const FLAG_KEYS = ['cypress', 'docTech', 'prepaQualif'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export const FLAG_VALUES = ['Oui', 'Non', 'N/A', 'À MAJ', 'MAJ', 'OK'] as const;
export type TicketFlags = Record<FlagKey, string>;

export function parseFlags(raw: string | null): TicketFlags {
	let obj: Record<string, unknown> = {};
	if (raw) {
		try {
			const p = JSON.parse(raw);
			if (p && typeof p === 'object') obj = p as Record<string, unknown>;
		} catch {
			/* champ libre potentiellement corrompu : on repart d'un objet vide */
		}
	}
	return {
		cypress: typeof obj.cypress === 'string' ? obj.cypress : '',
		docTech: typeof obj.docTech === 'string' ? obj.docTech : '',
		prepaQualif: typeof obj.prepaQualif === 'string' ? obj.prepaQualif : ''
	};
}

export type TicketRow = {
	id: string;
	key: string;
	title: string;
	parentId: string | null;
	stateId: string | null;
	sprintId: string | null;
	sprintName: string | null;
	versionId: string | null;
	projectId: string | null;
	projectName: string | null;
	prepa: number;
	comment: string | null;
	flags: TicketFlags;
	stateLabel: string | null;
	stateEmoji: string | null;
	stateColor: string | null;
	/** Estimation résolue (somme des Estimés par activité si présents, sinon fallback ticket.estimationReal). */
	estimationReal: number;
	raeReal: number;
	estimationTest: number;
	raeTest: number;
	consumed: number;
	/** RAE + Conso − Estimé résolu. Réel uniquement, jamais Test. */
	ecartVsEstime: number;
	/** RAE + Conso − Enveloppe totale. Réel uniquement. null si enveloppeTotale non renseignée/invisible. */
	ecartVsBudget: number | null;
	avancement: number;
	raeSuggested: number;
	/** true si le RAE de ce ticket vient de la somme des lignes ticket_activity_rae (sinon fallback ticket.raeReal/raeTest). */
	hasActivityRae: boolean;
	/** true si l'Estimé de ce ticket vient de la somme des lignes ticket_activity_rae.estimation (sinon fallback ticket.estimationReal). */
	hasActivityEstimation: boolean;
	/** RAE/Estimé/Budget par activité + sous-lignes (activité, personne), toujours chargé (affiché en lignes fines sous le ticket). */
	activityBreakdown: TicketActivityBreakdownRow[];
	groupIds: string[];
	/** Admin only — redacted côté route pour un USER standard. */
	estimationPrev: number | null;
	/** Admin only — redacted côté route pour un USER standard. null si enveloppeTotale non renseignée. */
	enveloppeTotale: number | null;
	sspCode: string | null;
};

/** Colonnes de base communes à listTickets/listTicketsPage (avant enrichissement). */
const TICKET_BASE_SELECT = {
	id: ticket.id,
	key: ticket.key,
	title: ticket.title,
	parentId: ticket.parentId,
	stateId: ticket.stateId,
	sprintId: ticket.sprintId,
	sprintName: sprint.name,
	versionId: ticket.versionId,
	projectId: ticket.projectId,
	projectName: project.name,
	prepa: ticket.prepa,
	comment: ticket.comment,
	flags: ticket.flags,
	estimationReal: ticket.estimationReal,
	raeReal: ticket.raeReal,
	estimationTest: ticket.estimationTest,
	raeTest: ticket.raeTest,
	estimationPrev: ticket.estimationPrev,
	enveloppeTotale: ticket.enveloppeTotale,
	sspCode: ticket.sspCode,
	stateLabel: state.label,
	stateEmoji: state.emoji,
	stateColor: state.color
};
type BaseTicketRow = Awaited<ReturnType<typeof fetchBaseTickets>>[number];

function baseTicketsQuery() {
	return db
		.select(TICKET_BASE_SELECT)
		.from(ticket)
		.leftJoin(state, eq(ticket.stateId, state.id))
		.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
		.leftJoin(project, eq(ticket.projectId, project.id));
}
async function fetchBaseTickets(where: ReturnType<typeof and>) {
	return baseTicketsQuery().where(where);
}

/**
 * Ajoute consommé + RAE résolu + activité/contributeurs + groupes à un lot de tickets déjà
 * chargés (chiffrage). Factorisé entre listTickets (tout l'espace) et listTicketsPage (paginé/filtré) —
 * mêmes requêtes annexes, seule la sélection des tickets de base change.
 *
 * `includeBreakdown` : le détail par activité (contributeurs + labels) n'est affiché nulle part en
 * vue kanban ni dans la recherche de la palette de commandes (cf. tickets/+page.svelte — seules les
 * lignes fines de la vue tableau le rendent). Deux requêtes en moins (contributeurs, labels
 * d'activité) + agrégation JS évitée pour ces appelants — mesuré comme la part la plus coûteuse de
 * l'enrichissement lors de l'audit de charge (cf. docs/AUDIT-load-testing.md), en particulier pour
 * le kanban qui charge tout le board sans pagination.
 */
async function enrichTickets(
	workspaceId: string,
	testPhase: boolean,
	isAdmin: boolean,
	tickets: BaseTicketRow[],
	includeBreakdown = true
): Promise<TicketRow[]> {
	const ticketIds = tickets.map((t) => t.id);

	const consumedRows =
		ticketIds.length === 0
			? []
			: await db
					.select({ ticketId: timeEntry.ticketId, total: sql<string>`sum(${timeEntry.amount})` })
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.workspaceId, workspaceId),
							eq(timeEntry.targetType, 'TICKET'),
							inArray(timeEntry.ticketId, ticketIds)
						)
					)
					.groupBy(timeEntry.ticketId);
	const consumedMap = new Map(consumedRows.map((r) => [r.ticketId, num(r.total)]));
	const activityRaeRows =
		ticketIds.length === 0
			? []
			: await db
					.select({
						ticketId: ticketActivityRae.ticketId,
						activityId: ticketActivityRae.activityId,
						raeReal: ticketActivityRae.raeReal,
						raeTest: ticketActivityRae.raeTest,
						estimation: ticketActivityRae.estimation,
						budget: ticketActivityRae.budget
					})
					.from(ticketActivityRae)
					.where(inArray(ticketActivityRae.ticketId, ticketIds));
	const activityRaeMap = new Map<string, typeof activityRaeRows>();
	for (const r of activityRaeRows) {
		if (!activityRaeMap.has(r.ticketId)) activityRaeMap.set(r.ticketId, []);
		activityRaeMap.get(r.ticketId)!.push(r);
	}

	// Contributeurs (activité, personne) par ticket — batché pour toute la liste, affiché en
	// lignes fines toujours visibles sous chaque ticket (plus de chargement à la demande).
	const contribRows =
		!includeBreakdown || ticketIds.length === 0
			? []
			: await db
					.select({
						ticketId: timeEntry.ticketId,
						activityId: timeEntry.activityId,
						userId: timeEntry.userId,
						displayName: user.displayName,
						total: sql<string>`sum(${timeEntry.amount})`
					})
					.from(timeEntry)
					.innerJoin(user, eq(timeEntry.userId, user.id))
					.where(
						and(
							eq(timeEntry.workspaceId, workspaceId),
							eq(timeEntry.targetType, 'TICKET'),
							inArray(timeEntry.ticketId, ticketIds)
						)
					)
					.groupBy(timeEntry.ticketId, timeEntry.activityId, timeEntry.userId, user.displayName);
	const contribMap = new Map<string, Map<string, { userId: string; displayName: string; consumed: number }[]>>();
	for (const c of contribRows) {
		if (!c.ticketId) continue;
		// Imputation sans activité renseignée : regroupée sous le bucket "Autre" plutôt que perdue —
		// sinon elle compte dans le "Consommé" du ticket sans jamais apparaître dans le détail par activité.
		const activityId = c.activityId ?? NO_ACTIVITY_ID;
		if (!contribMap.has(c.ticketId)) contribMap.set(c.ticketId, new Map());
		const byActivity = contribMap.get(c.ticketId)!;
		if (!byActivity.has(activityId)) byActivity.set(activityId, []);
		byActivity.get(activityId)!.push({ userId: c.userId, displayName: c.displayName, consumed: num(c.total) });
	}

	const involvedActivityIds = new Set<string>([
		...activityRaeRows.map((r) => r.activityId),
		...contribRows.map((r) => r.activityId).filter((id): id is string => !!id)
	]);
	const activityLabelRows =
		!includeBreakdown || involvedActivityIds.size === 0
			? []
			: await db
					.select({ id: activity.id, label: activity.label })
					.from(activity)
					.where(inArray(activity.id, [...involvedActivityIds]));
	const activityLabelMap = new Map(activityLabelRows.map((a) => [a.id, a.label]));

	function buildBreakdown(ticketId: string): TicketActivityBreakdownRow[] {
		const raeRows = activityRaeMap.get(ticketId) ?? [];
		const byActivity: Map<string, { userId: string; displayName: string; consumed: number }[]> =
			contribMap.get(ticketId) ?? new Map();
		const activityIds = new Set<string>([...raeRows.map((r) => r.activityId), ...byActivity.keys()]);
		return [...activityIds]
			.map((id) => {
				const rae = raeRows.find((r) => r.activityId === id);
				return {
					activityId: id,
					label: activityLabelMap.get(id) ?? (id === NO_ACTIVITY_ID ? 'Autre' : '?'),
					raeReal: num(rae?.raeReal ?? null),
					raeTest: num(rae?.raeTest ?? null),
					estimation: num(rae?.estimation ?? null),
					budget: num(rae?.budget ?? null),
					contributors: (byActivity.get(id) ?? []).sort((a, b) => a.displayName.localeCompare(b.displayName))
				};
			})
			.sort((a, b) => {
				// "Autre" toujours en dernier, quel que soit l'ordre alphabétique.
				if (a.activityId === NO_ACTIVITY_ID) return 1;
				if (b.activityId === NO_ACTIVITY_ID) return -1;
				return a.label.localeCompare(b.label);
			});
	}

	const groupMemberRows =
		ticketIds.length === 0
			? []
			: await db
					.select({ ticketId: ticketGroupMember.ticketId, groupId: ticketGroupMember.groupId })
					.from(ticketGroupMember)
					.where(inArray(ticketGroupMember.ticketId, ticketIds));
	const groupIdsMap = new Map<string, string[]>();
	for (const r of groupMemberRows) {
		if (!groupIdsMap.has(r.ticketId)) groupIdsMap.set(r.ticketId, []);
		groupIdsMap.get(r.ticketId)!.push(r.groupId);
	}

	return tickets.map((t) => {
		const activityRows = activityRaeMap.get(t.id) ?? [];
		const resolved = resolvedRae(t.raeReal, t.raeTest, activityRows);
		const estimationResolved = resolvedEstimation(t.estimationReal, activityRows);
		const totalEst = round(estimationResolved + (testPhase ? num(t.estimationTest) : 0));
		const rae = round(resolved.real + (testPhase ? resolved.test : 0));
		const consumed = consumedMap.get(t.id) ?? 0;
		const enveloppeTotale = !isAdmin || t.enveloppeTotale === null ? null : num(t.enveloppeTotale);
		return {
			id: t.id,
			key: t.key,
			title: t.title,
			parentId: t.parentId,
			stateId: t.stateId,
			sprintId: t.sprintId,
			sprintName: t.sprintName,
			versionId: t.versionId,
			projectId: t.projectId,
			projectName: t.projectName,
			prepa: num(t.prepa),
			comment: t.comment,
			flags: parseFlags(t.flags),
			stateLabel: t.stateLabel,
			stateEmoji: t.stateEmoji,
			stateColor: t.stateColor,
			estimationReal: estimationResolved,
			raeReal: resolved.real,
			estimationTest: num(t.estimationTest),
			raeTest: resolved.test,
			// estimationPrev/enveloppeTotale invisibles pour un USER ; ecartVsBudget en dérive
			// (déductible via consumed/rae déjà visibles) donc masqué pareil.
			estimationPrev: !isAdmin || t.estimationPrev === null ? null : num(t.estimationPrev),
			enveloppeTotale,
			sspCode: t.sspCode,
			consumed,
			ecartVsEstime: ecartVsEstime(resolved.real, consumed, estimationResolved),
			ecartVsBudget: enveloppeTotale === null ? null : ecartVsBudget(resolved.real, consumed, enveloppeTotale),
			avancement: avancement(totalEst, rae, consumed),
			raeSuggested: raeSuggested(totalEst, consumed),
			hasActivityRae: activityRows.length > 0,
			hasActivityEstimation: activityRows.length > 0,
			activityBreakdown: includeBreakdown ? buildBreakdown(t.id) : [],
			groupIds: groupIdsMap.get(t.id) ?? []
		};
	});
}

/**
 * Liste les tickets non archivés d'un espace, avec consommé + indicateurs calculés.
 * `isAdmin` : masque estimationPrev/enveloppeTotale/tnfBudget pour un USER standard (invisible,
 * pas juste lecture seule — cf. §7 du spec). Par défaut à `true` (non redacté) pour les appelants
 * système sans notion de rôle courant (cron de snapshot, jobs de notification).
 */
export async function listTickets(workspaceId: string, testPhase = true, isAdmin = true): Promise<TicketRow[]> {
	const tickets = await fetchBaseTickets(and(eq(ticket.workspaceId, workspaceId), isNull(ticket.archivedAt)));
	return enrichTickets(workspaceId, testPhase, isAdmin, tickets);
}

/** Un ticket enrichi (consommé, RAE, groupes...) — pour l'éditer depuis n'importe quelle page (ex. Mon imputation). */
export async function getTicketById(
	workspaceId: string,
	ticketId: string,
	testPhase: boolean,
	isAdmin: boolean
): Promise<TicketRow | null> {
	const tickets = await fetchBaseTickets(and(eq(ticket.workspaceId, workspaceId), eq(ticket.id, ticketId)));
	if (tickets.length === 0) return null;
	const [row] = await enrichTickets(workspaceId, testPhase, isAdmin, tickets);
	return row;
}

/** Nombre d'imputations (timeEntry) liées à ce ticket — sert à bloquer la suppression si non nul. */
export async function countTicketImputations(workspaceId: string, ticketId: string): Promise<number> {
	const [{ n }] = await db
		.select({ n: count(timeEntry.id) })
		.from(timeEntry)
		.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.ticketId, ticketId)));
	return n;
}

/** Hard delete — réservé au créateur de l'espace (super admin), et bloqué si des imputations sont liées. */
export async function deleteTicket(workspaceId: string, ticketId: string) {
	const usage = await countTicketImputations(workspaceId, ticketId);
	if (usage > 0) throw new Error('Des imputations sont liées à ce ticket : suppression impossible.');
	const res = await db
		.delete(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)))
		.returning({ id: ticket.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/**
 * Version allégée de listTickets pour les sélecteurs (ex. "Ajouter un ticket" sur Mon imputation) :
 * juste id/clé/titre/sprint/version, sans l'enrichissement consommé/RAE/contributeurs/groupes
 * (4 requêtes GROUP BY en plus, inutiles pour peupler un <select>).
 */
export async function listTicketSummaries(
	workspaceId: string
): Promise<{ id: string; key: string; title: string; sprintId: string | null; versionId: string | null; sprintName: string | null }[]> {
	return db
		.select({
			id: ticket.id,
			key: ticket.key,
			title: ticket.title,
			sprintId: ticket.sprintId,
			versionId: ticket.versionId,
			sprintName: sprint.name
		})
		.from(ticket)
		.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
		.where(and(eq(ticket.workspaceId, workspaceId), isNull(ticket.archivedAt)));
}

export type TicketFilters = {
	query?: string;
	stateId?: string;
	projectId?: string;
	sprintId?: string;
	versionId?: string;
	/** Lien direct (ex. depuis un dashboard sprint/version) : isole une clé exacte, pas de substring. */
	exactKey?: string;
};

function ticketFilterConditions(workspaceId: string, filters: TicketFilters) {
	const conditions = [eq(ticket.workspaceId, workspaceId), isNull(ticket.archivedAt)];
	if (filters.stateId) conditions.push(eq(ticket.stateId, filters.stateId));
	if (filters.projectId) conditions.push(eq(ticket.projectId, filters.projectId));
	if (filters.sprintId) conditions.push(eq(ticket.sprintId, filters.sprintId));
	if (filters.versionId) conditions.push(eq(ticket.versionId, filters.versionId));
	if (filters.exactKey) conditions.push(eq(ticket.key, filters.exactKey));
	if (filters.query?.trim()) {
		const q = `%${filters.query.trim()}%`;
		conditions.push(or(ilike(ticket.key, q), ilike(ticket.title, q))!);
	}
	return and(...conditions)!;
}

/**
 * Page filtrée de tickets (vue tableau), triée par famille (parent + ses sous-tâches restent
 * groupés, cf. self-join `parentTicket`) puis par date de création. Un ticket dont la famille est
 * coupée par la pagination (frontière de page qui ne tombe pas pile sur une frontière de famille)
 * peut afficher une sous-tâche sans son parent visible sur la même page — limite acceptée du LIMIT/OFFSET.
 */
export async function listTicketsPage(
	workspaceId: string,
	testPhase: boolean,
	isAdmin: boolean,
	filters: TicketFilters,
	/** Omis = pas de pagination (vue Kanban : toutes les tickets filtrés, board complet). */
	paging?: { pageSize: number; page: number },
	/** Le kanban et la recherche de la palette de commandes n'affichent jamais le détail par
	 *  activité (cf. commentaire sur enrichTickets) — passer `false` pour l'appelant l'économiser. */
	includeBreakdown = true
): Promise<{ rows: (TicketRow & { isChild: boolean })[]; total: number }> {
	const where = ticketFilterConditions(workspaceId, filters);
	const parentTicket = alias(ticket, 'parent_ticket');
	// Kanban (paging omis) : board complet, pas de LIMIT — ponytail: sentinelle plutôt qu'un
	// query builder conditionnel ($dynamic indisponible sur cette version de drizzle).
	const { pageSize, page } = paging ?? { pageSize: 1_000_000, page: 1 };

	const [tickets, [{ count }]] = await Promise.all([
		baseTicketsQuery()
			.leftJoin(parentTicket, eq(ticket.parentId, parentTicket.id))
			.where(where)
			.orderBy(
				sql`coalesce(${parentTicket.createdAt}, ${ticket.createdAt})`,
				sql`(${ticket.parentId} is not null)`,
				ticket.createdAt,
				// Tie-breaker : createdAt seul n'est pas unique (insertion en masse, cf. seed), donc
				// LIMIT/OFFSET devient non déterministe entre deux appels sans lui — un ticket peut
				// réapparaître sur la page suivante (visible en scroll infini : les deux pages coexistent).
				ticket.id
			)
			.limit(pageSize)
			.offset((page - 1) * pageSize),
		db.select({ count: sql<number>`count(*)::int` }).from(ticket).where(where)
	]);

	const rows = await enrichTickets(workspaceId, testPhase, isAdmin, tickets, includeBreakdown);
	return { rows: rows.map((r, i) => ({ ...r, isChild: !!tickets[i].parentId })), total: count };
}

export type RefData = {
	states: { id: string; label: string; emoji: string | null; color: string | null }[];
	sprints: { id: string; name: string }[];
	versions: { id: string; name: string }[];
	projects: { id: string; name: string }[];
	activities: { id: string; label: string }[];
	categories: { id: string; label: string; kind: string }[];
	members: { id: string; displayName: string }[];
	ticketGroups: { id: string; label: string }[];
};

/**
 * Référentiels d'un espace (pour les sélecteurs). `sortActivitiesAlpha` : ordre des activités —
 * false (défaut) = référentiels (activity.sortOrder, paramétrable), true = alphabétique — cf.
 * préférence de compte `user.sortActivitiesAlpha`, même règle que la répartition par activité du
 * dashboard sprint/version (sprintDashboard.ts).
 */
export async function getRefData(workspaceId: string, sortActivitiesAlpha = false): Promise<RefData> {
	const [states, sprints, versions, projects, activities, categories, members, ticketGroups] = await Promise.all([
		db
			.select({ id: state.id, label: state.label, emoji: state.emoji, color: state.color })
			.from(state)
			.where(eq(state.workspaceId, workspaceId))
			.orderBy(state.sortOrder),
		db
			.select({ id: sprint.id, name: sprint.name })
			.from(sprint)
			.where(and(eq(sprint.workspaceId, workspaceId), eq(sprint.kind, 'SPRINT'), isNull(sprint.archivedAt)))
			.orderBy(sprint.sortOrder, sprint.name),
		db
			.select({ id: sprint.id, name: sprint.name })
			.from(sprint)
			.where(and(eq(sprint.workspaceId, workspaceId), eq(sprint.kind, 'VERSION'), isNull(sprint.archivedAt)))
			.orderBy(sprint.sortOrder, sprint.name),
		db
			.select({ id: project.id, name: project.name })
			.from(project)
			.where(and(eq(project.workspaceId, workspaceId), isNull(project.archivedAt))),
		db
			.select({ id: activity.id, label: activity.label })
			.from(activity)
			.where(and(eq(activity.workspaceId, workspaceId), isNull(activity.archivedAt)))
			.orderBy(activity.sortOrder),
		db
			.select({ id: category.id, label: category.label, kind: category.kind })
			.from(category)
			.where(and(eq(category.workspaceId, workspaceId), isNull(category.archivedAt))),
		db
			.select({ id: user.id, displayName: user.displayName })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.active, true))),
		db
			.select({ id: ticketGroup.id, label: ticketGroup.label })
			.from(ticketGroup)
			.where(and(eq(ticketGroup.workspaceId, workspaceId), isNull(ticketGroup.archivedAt)))
			.orderBy(ticketGroup.label)
	]);
	if (sortActivitiesAlpha) activities.sort((a, b) => a.label.localeCompare(b.label));
	return { states, sprints, versions, projects, activities, categories, members, ticketGroups };
}

/** Descriptif du ticket — éditable par tout membre de l'espace. */
const EDITABLE_FIELDS = new Set([
	'title',
	'comment',
	'stateId',
	'projectId',
	'sprintId',
	'versionId',
	'sspCode'
]);
/**
 * Chiffrage global du ticket — ADMIN/MANAGER seulement (retour utilisateur : un USER ne doit
 * toucher ni l'estimation globale ni le RAE des autres). Le RAE fin se saisit par activité, via
 * `upsertTicketActivityRae` + `canEditActivityRae`.
 */
export const MANAGER_ONLY_FIELDS = new Set([
	'estimationReal',
	'raeReal',
	'estimationTest',
	'prepa',
	'raeTest'
]);
/**
 * Champs budget — même règle ADMIN/MANAGER que le chiffrage (cf. `isManagerOrAdmin`), mais aussi
 * masqués en lecture pour les autres rôles (redaction dans `listTicketsPage`).
 */
export const ADMIN_ONLY_FIELDS = new Set(['estimationPrev', 'enveloppeTotale']);
const NUMERIC_FIELDS = new Set([...MANAGER_ONLY_FIELDS, ...ADMIN_ONLY_FIELDS]);
/**
 * La clé (ex. "SBX-42") identifie le ticket partout (imputation, liens, historique) — réservée au
 * créateur de l'espace (super admin), pas juste ADMIN, comme la suppression.
 */
const OWNER_ONLY_FIELDS = new Set(['key']);

/** Met à jour un champ d'un ticket (édition inline). Scopé workspace + liste blanche par rôle. */
export async function updateTicketField(
	workspaceId: string,
	ticketId: string,
	field: string,
	rawValue: string,
	role: Role | null = null,
	actorId: string | null = null,
	isOwner = false
) {
	const allowedFields = new Set(EDITABLE_FIELDS);
	if (isManagerOrAdmin(role))
		for (const f of [...MANAGER_ONLY_FIELDS, ...ADMIN_ONLY_FIELDS]) allowedFields.add(f);
	if (isOwner) for (const f of OWNER_ONLY_FIELDS) allowedFields.add(f);
	const numericFields = NUMERIC_FIELDS;
	if (!allowedFields.has(field)) throw new Error('Champ non éditable.');
	let value: string | null = rawValue === '' ? null : rawValue;
	if (numericFields.has(field) && value !== null) {
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) throw new Error('Valeur numérique invalide.');
		value = String(n);
	}
	if (field === 'key') {
		value = value?.trim() || null;
		if (!value) throw new Error('Clé requise.');
	}

	// Valeur avant modif — uniquement pour les champs tracés dans l'historique (changeLog).
	let oldValue: unknown;
	if (TRACKED_FIELDS.has(field)) {
		const [before] = await db
			.select()
			.from(ticket)
			.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
		oldValue = before ? (before as Record<string, unknown>)[field] : undefined;
	}

	const patch: Record<string, unknown> = { [field]: value, updatedAt: new Date() };
	// Trace la dernière mise à jour du RAE (pour les rappels « RAE périmé »).
	if (field === 'raeReal' || field === 'raeTest') patch.raeUpdatedAt = new Date();
	const res = await db
		.update(ticket)
		.set(patch)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)))
		.returning({ id: ticket.id });

	if (TRACKED_FIELDS.has(field) && String(oldValue ?? '') !== String(value ?? '')) {
		await logChange({
			workspaceId,
			entityType: 'TICKET',
			entityId: ticketId,
			field,
			action: 'UPDATE',
			oldValue: oldValue == null ? null : String(oldValue),
			newValue: value,
			changedById: actorId
		});
	}
	if (res.length === 0) throw new Error('Ticket introuvable dans cet espace.');
}

/** Met à jour un indicateur (flag) d'un ticket en fusionnant le JSON existant. */
export async function setTicketFlag(
	workspaceId: string,
	ticketId: string,
	key: string,
	value: string
) {
	if (!FLAG_KEYS.includes(key as FlagKey)) throw new Error('Indicateur inconnu.');
	if (value && !FLAG_VALUES.includes(value as (typeof FLAG_VALUES)[number]))
		throw new Error('Valeur invalide.');

	const rows = await db
		.select({ flags: ticket.flags })
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
	if (rows.length === 0) throw new Error('Ticket introuvable dans cet espace.');

	const flags = parseFlags(rows[0].flags) as Record<string, string>;
	if (value) flags[key] = value;
	else delete flags[key];
	const serialized = Object.keys(flags).length > 0 ? JSON.stringify(flags) : null;

	await db
		.update(ticket)
		.set({ flags: serialized, updatedAt: new Date() })
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
}

export type TicketActivityBreakdownRow = {
	activityId: string;
	label: string;
	raeReal: number;
	raeTest: number;
	/** Estimé par activité — champ unique, modifiable par tout membre. */
	estimation: number;
	/** Budget par activité — indépendant du budget ticket, ADMIN only, 0 par défaut. */
	budget: number;
	contributors: { userId: string; displayName: string; consumed: number }[];
};

/**
 * Détail RAE par activité + sous-lignes (activité, personne) d'un ticket, pour "Tickets & chiffrage".
 * Inclut chaque activité ayant une ligne ticket_activity_rae OU au moins une imputation sur ce ticket,
 * plus un bucket "Autre" (NO_ACTIVITY_ID) pour les imputations sans activité renseignée.
 */
export async function getTicketActivityBreakdown(
	workspaceId: string,
	ticketId: string
): Promise<TicketActivityBreakdownRow[]> {
	const [ownedTicket] = await db
		.select({ id: ticket.id })
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
	if (!ownedTicket) throw new Error('Ticket introuvable dans cet espace.');

	const [raeRows, contribRows] = await Promise.all([
		db
			.select({
				activityId: ticketActivityRae.activityId,
				raeReal: ticketActivityRae.raeReal,
				raeTest: ticketActivityRae.raeTest,
				estimation: ticketActivityRae.estimation,
				budget: ticketActivityRae.budget
			})
			.from(ticketActivityRae)
			.where(eq(ticketActivityRae.ticketId, ticketId)),
		db
			.select({
				activityId: timeEntry.activityId,
				userId: timeEntry.userId,
				displayName: user.displayName,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(and(eq(timeEntry.ticketId, ticketId), eq(timeEntry.targetType, 'TICKET')))
			.groupBy(timeEntry.activityId, timeEntry.userId, user.displayName)
	]);

	const raeMap = new Map(raeRows.map((r) => [r.activityId, r]));
	const contribByActivity = new Map<string, { userId: string; displayName: string; consumed: number }[]>();
	for (const c of contribRows) {
		// Imputation sans activité renseignée : regroupée sous le bucket "Autre" plutôt que perdue.
		const activityId = c.activityId ?? NO_ACTIVITY_ID;
		if (!contribByActivity.has(activityId)) contribByActivity.set(activityId, []);
		contribByActivity.get(activityId)!.push({ userId: c.userId, displayName: c.displayName, consumed: num(c.total) });
	}

	const activityIds = new Set<string>([...raeMap.keys(), ...contribByActivity.keys()]);
	if (activityIds.size === 0) return [];
	// NO_ACTIVITY_ID n'est jamais une vraie ligne activity (colonne uuid) : hors de la requête.
	const realActivityIds = [...activityIds].filter((id) => id !== NO_ACTIVITY_ID);
	const activities =
		realActivityIds.length === 0
			? []
			: await db
					.select({ id: activity.id, label: activity.label })
					.from(activity)
					.where(and(eq(activity.workspaceId, workspaceId), inArray(activity.id, realActivityIds)));
	const labelMap = new Map(activities.map((a) => [a.id, a.label]));

	return [...activityIds]
		.map((id) => ({
			activityId: id,
			label: labelMap.get(id) ?? (id === NO_ACTIVITY_ID ? 'Autre' : '?'),
			raeReal: num(raeMap.get(id)?.raeReal ?? null),
			raeTest: num(raeMap.get(id)?.raeTest ?? null),
			estimation: num(raeMap.get(id)?.estimation ?? null),
			budget: num(raeMap.get(id)?.budget ?? null),
			contributors: (contribByActivity.get(id) ?? []).sort((a, b) => a.displayName.localeCompare(b.displayName))
		}))
		.sort((a, b) => {
			if (a.activityId === NO_ACTIVITY_ID) return 1;
			if (b.activityId === NO_ACTIVITY_ID) return -1;
			return a.label.localeCompare(b.label);
		});
}

/**
 * Un USER standard n'édite le RAE que des activités où il a lui-même imputé du temps — il ne doit
 * pas toucher au RAE des autres. ADMIN/MANAGER gardent la main sur tout le chiffrage.
 */
export async function canEditActivityRae(
	workspaceId: string,
	userId: string,
	role: Role | null,
	ticketId: string,
	activityId: string
): Promise<boolean> {
	if (isManagerOrAdmin(role)) return true;
	const rows = await db
		.select({ id: timeEntry.id })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				eq(timeEntry.targetType, 'TICKET'),
				eq(timeEntry.ticketId, ticketId),
				eq(timeEntry.activityId, activityId)
			)
		)
		.limit(1);
	return rows.length > 0;
}

export type TicketActivityField = 'raeReal' | 'raeTest' | 'estimation' | 'budget';

/**
 * Permission par champ pour une valeur d'activité sur un ticket :
 * - RAE (réel/test) : cf. canEditActivityRae (contributeur ou manager/admin).
 * - Estimé : tout membre de l'espace (déjà garanti par l'authentification de la route appelante).
 * - Budget : ADMIN strict — pas manager, contrairement au reste du chiffrage.
 */
export async function canEditActivityField(
	workspaceId: string,
	userId: string,
	role: Role | null,
	ticketId: string,
	activityId: string,
	field: TicketActivityField
): Promise<boolean> {
	if (field === 'budget') return role === 'ADMIN';
	if (field === 'estimation') return true;
	return canEditActivityRae(workspaceId, userId, role, ticketId, activityId);
}

/** Upsert d'une valeur (RAE réel/test, Estimé ou Budget) d'une activité sur un ticket. */
export async function upsertTicketActivityRae(
	workspaceId: string,
	ticketId: string,
	activityId: string,
	field: TicketActivityField,
	value: number,
	actorId: string | null = null
) {
	if (!Number.isFinite(value) || value < 0) throw new Error('Valeur numérique invalide.');
	const [ownedTicket] = await db
		.select({ id: ticket.id })
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
	if (!ownedTicket) throw new Error('Ticket introuvable dans cet espace.');
	const [ownedActivity] = await db
		.select({ id: activity.id })
		.from(activity)
		.where(and(eq(activity.id, activityId), eq(activity.workspaceId, workspaceId)));
	if (!ownedActivity) throw new Error('Activité introuvable dans cet espace.');

	const [before] = await db
		.select()
		.from(ticketActivityRae)
		.where(and(eq(ticketActivityRae.ticketId, ticketId), eq(ticketActivityRae.activityId, activityId)));
	const oldValue = before ? (before as Record<string, unknown>)[field] : undefined;

	await db
		.insert(ticketActivityRae)
		.values({ ticketId, activityId, [field]: String(value) })
		.onConflictDoUpdate({
			target: [ticketActivityRae.ticketId, ticketActivityRae.activityId],
			set: { [field]: String(value), updatedAt: new Date() }
		});
	// Trace la dernière mise à jour du RAE au niveau ticket aussi (rappels « RAE périmé »), même
	// quand le RAE est suivi par activité et non plus sur le champ ticket directement. Ne concerne
	// que le RAE — un changement d'Estimé ou de Budget ne doit pas déclencher ce rappel.
	if (field === 'raeReal' || field === 'raeTest') {
		await db.update(ticket).set({ raeUpdatedAt: new Date() }).where(eq(ticket.id, ticketId));
	}

	if (String(oldValue ?? '0') !== String(value)) {
		await logChange({
			workspaceId,
			entityType: 'TICKET',
			entityId: ticketId,
			activityId,
			field,
			action: 'UPDATE',
			oldValue: oldValue == null ? null : String(oldValue),
			newValue: String(value),
			changedById: actorId
		});
	}
}

export async function createTicket(
	workspaceId: string,
	data: {
		key: string;
		title: string;
		parentId?: string | null;
		projectId?: string | null;
		sprintId?: string | null;
		versionId?: string | null;
		stateId?: string | null;
		estimationReal?: string | null;
		raeReal?: string | null;
		estimationTest?: string | null;
		raeTest?: string | null;
		comment?: string | null;
		sspCode?: string | null;
		estimationPrev?: string | null;
		enveloppeTotale?: string | null;
	}
) {
	const [row] = await db
		.insert(ticket)
		.values({ workspaceId, ...data, raeUpdatedAt: new Date() })
		.returning({ id: ticket.id });
	return row;
}
