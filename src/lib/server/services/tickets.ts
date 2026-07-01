import { and, eq, isNull, sql } from 'drizzle-orm';
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
	timeEntry
} from '$lib/server/db';
import { num, totalEstimation, totalRae, ecart, avancement, raeSuggested } from './calc';

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
	assigneeId: string | null;
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
	assigneeName: string | null;
	estimationReal: number;
	raeReal: number;
	estimationTest: number;
	raeTest: number;
	consumed: number;
	ecart: number;
	avancement: number;
	raeSuggested: number;
};

/** Liste les tickets non archivés d'un espace, avec consommé + indicateurs calculés. */
export async function listTickets(workspaceId: string): Promise<TicketRow[]> {
	const tickets = await db
		.select({
			id: ticket.id,
			key: ticket.key,
			title: ticket.title,
			parentId: ticket.parentId,
			stateId: ticket.stateId,
			assigneeId: ticket.assigneeId,
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
			stateLabel: state.label,
			stateEmoji: state.emoji,
			stateColor: state.color,
			assigneeName: user.displayName
		})
		.from(ticket)
		.leftJoin(state, eq(ticket.stateId, state.id))
		.leftJoin(user, eq(ticket.assigneeId, user.id))
		.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
		.leftJoin(project, eq(ticket.projectId, project.id))
		.where(and(eq(ticket.workspaceId, workspaceId), isNull(ticket.archivedAt)));

	const consumedRows = await db
		.select({ ticketId: timeEntry.ticketId, total: sql<string>`sum(${timeEntry.amount})` })
		.from(timeEntry)
		.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.targetType, 'TICKET')))
		.groupBy(timeEntry.ticketId);
	const consumedMap = new Map(consumedRows.map((r) => [r.ticketId, num(r.total)]));

	return tickets.map((t) => {
		const totalEst = totalEstimation(t.estimationReal, t.estimationTest);
		const rae = totalRae(t.raeReal, t.raeTest);
		const consumed = consumedMap.get(t.id) ?? 0;
		return {
			id: t.id,
			key: t.key,
			title: t.title,
			parentId: t.parentId,
			stateId: t.stateId,
			assigneeId: t.assigneeId,
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
			assigneeName: t.assigneeName,
			estimationReal: num(t.estimationReal),
			raeReal: num(t.raeReal),
			estimationTest: num(t.estimationTest),
			raeTest: num(t.raeTest),
			consumed,
			ecart: ecart(consumed, totalEst),
			avancement: avancement(totalEst, rae),
			raeSuggested: raeSuggested(totalEst, consumed)
		};
	});
}

export type RefData = {
	states: { id: string; label: string; emoji: string | null; color: string | null }[];
	sprints: { id: string; name: string }[];
	versions: { id: string; name: string }[];
	projects: { id: string; name: string }[];
	activities: { id: string; label: string }[];
	categories: { id: string; label: string; kind: string }[];
	members: { id: string; displayName: string }[];
};

/** Référentiels d'un espace (pour les sélecteurs). */
export async function getRefData(workspaceId: string): Promise<RefData> {
	const [states, sprints, versions, projects, activities, categories, members] = await Promise.all([
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
			.orderBy(activity.label),
		db
			.select({ id: category.id, label: category.label, kind: category.kind })
			.from(category)
			.where(and(eq(category.workspaceId, workspaceId), isNull(category.archivedAt))),
		db
			.select({ id: user.id, displayName: user.displayName })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.active, true)))
	]);
	return { states, sprints, versions, projects, activities, categories, members };
}

const EDITABLE_FIELDS = new Set([
	'title',
	'comment',
	'stateId',
	'assigneeId',
	'projectId',
	'sprintId',
	'versionId',
	'estimationReal',
	'raeReal',
	'estimationTest',
	'prepa',
	'raeTest'
]);
const NUMERIC_FIELDS = new Set(['estimationReal', 'raeReal', 'estimationTest', 'prepa', 'raeTest']);

/** Met à jour un champ d'un ticket (édition inline). Scopé workspace + liste blanche. */
export async function updateTicketField(
	workspaceId: string,
	ticketId: string,
	field: string,
	rawValue: string
) {
	if (!EDITABLE_FIELDS.has(field)) throw new Error('Champ non éditable.');
	let value: string | null = rawValue === '' ? null : rawValue;
	if (NUMERIC_FIELDS.has(field) && value !== null) {
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) throw new Error('Valeur numérique invalide.');
		value = String(n);
	}
	const patch: Record<string, unknown> = { [field]: value, updatedAt: new Date() };
	// Trace la dernière mise à jour du RAE (pour les rappels « RAE périmé »).
	if (field === 'raeReal' || field === 'raeTest') patch.raeUpdatedAt = new Date();
	const res = await db
		.update(ticket)
		.set(patch)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)))
		.returning({ id: ticket.id });
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

export async function createTicket(
	workspaceId: string,
	data: {
		key: string;
		title: string;
		parentId?: string | null;
		projectId?: string | null;
		sprintId?: string | null;
		versionId?: string | null;
		assigneeId?: string | null;
		stateId?: string | null;
		estimationReal?: string | null;
		raeReal?: string | null;
		estimationTest?: string | null;
		raeTest?: string | null;
		comment?: string | null;
	}
) {
	const [row] = await db
		.insert(ticket)
		.values({ workspaceId, ...data, raeUpdatedAt: new Date() })
		.returning({ id: ticket.id });
	return row;
}
