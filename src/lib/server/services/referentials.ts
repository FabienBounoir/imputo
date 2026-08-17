import { and, eq, ne, isNull, count, countDistinct, sql } from 'drizzle-orm';
import { db, project, sprint, ticket, ticketSprintMember } from '$lib/server/db';

export type RefType = 'project' | 'sprint' | 'version';

export type RefItem = { id: string; name: string; archived: boolean; usage: number; createdAt: Date };

const sprintKind = (type: RefType) => (type === 'version' ? 'VERSION' : 'SPRINT');

/** Liste projets / sprints / versions (actifs + archivés) d'un espace, avec le nombre
 * de tickets actifs liés à chacun. */
export async function listRefs(workspaceId: string, type: RefType): Promise<RefItem[]> {
	if (type === 'project') {
		const rows = await db
			.select({
				id: project.id,
				name: project.name,
				archivedAt: project.archivedAt,
				createdAt: project.createdAt,
				usage: count(ticket.id)
			})
			.from(project)
			.leftJoin(ticket, and(eq(ticket.projectId, project.id), isNull(ticket.archivedAt)))
			.where(eq(project.workspaceId, workspaceId))
			.groupBy(project.id, project.name, project.archivedAt, project.createdAt)
			.orderBy(project.name);
		return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, usage: r.usage, createdAt: r.createdAt }));
	}
	const rows = await db
		.select({
			id: sprint.id,
			name: sprint.name,
			archivedAt: sprint.archivedAt,
			createdAt: sprint.createdAt,
			sortOrder: sprint.sortOrder,
			usage: countDistinct(ticket.id)
		})
		.from(sprint)
		.leftJoin(ticketSprintMember, eq(ticketSprintMember.sprintId, sprint.id))
		.leftJoin(ticket, and(eq(ticket.id, ticketSprintMember.ticketId), isNull(ticket.archivedAt)))
		.where(and(eq(sprint.workspaceId, workspaceId), eq(sprint.kind, sprintKind(type))))
		.groupBy(sprint.id, sprint.name, sprint.archivedAt, sprint.createdAt, sprint.sortOrder)
		.orderBy(sprint.sortOrder, sprint.name);
	return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, usage: r.usage, createdAt: r.createdAt }));
}

/** Vérifie qu'aucun élément actif de même nom (insensible à la casse) n'existe déjà. */
async function assertUniqueName(
	workspaceId: string,
	type: RefType,
	trimmed: string,
	excludeId: string | null
) {
	const table = type === 'project' ? project : sprint;
	const conds = [
		eq(table.workspaceId, workspaceId),
		isNull(table.archivedAt),
		sql`lower(${table.name}) = ${trimmed.toLowerCase()}`
	];
	if (type !== 'project') conds.push(eq(sprint.kind, sprintKind(type)));
	if (excludeId) conds.push(ne(table.id, excludeId));
	const dup = await db
		.select({ id: table.id })
		.from(table)
		.where(and(...conds))
		.limit(1);
	if (dup.length) throw new Error('Un élément actif porte déjà ce nom.');
}

export async function createRef(workspaceId: string, type: RefType, name: string) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueName(workspaceId, type, trimmed, null);
	if (type === 'project') await db.insert(project).values({ workspaceId, name: trimmed });
	else await db.insert(sprint).values({ workspaceId, name: trimmed, kind: sprintKind(type) });
}

export async function renameRef(workspaceId: string, type: RefType, id: string, name: string) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueName(workspaceId, type, trimmed, id);
	const table = type === 'project' ? project : sprint;
	const res = await db
		.update(table)
		.set({ name: trimmed })
		.where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
		.returning({ id: table.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/** Archive (soft-delete) ou restaure. */
export async function setRefArchived(
	workspaceId: string,
	type: RefType,
	id: string,
	archived: boolean
) {
	const table = type === 'project' ? project : sprint;
	const res = await db
		.update(table)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
		.returning({ id: table.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}
