import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, ticket, ticketGroup, ticketGroupMember } from '$lib/server/db';

export type TicketGroupItem = { id: string; label: string; archived: boolean; usage: number };

/** Liste les groupes d'un espace (actifs + inactifs), avec le nombre de tickets actifs liés. */
export async function listTicketGroups(workspaceId: string): Promise<TicketGroupItem[]> {
	const rows = await db
		.select({
			id: ticketGroup.id,
			label: ticketGroup.label,
			archivedAt: ticketGroup.archivedAt,
			usage: sql<number>`count(distinct ${ticketGroupMember.ticketId})::int`
		})
		.from(ticketGroup)
		.leftJoin(
			ticketGroupMember,
			eq(ticketGroupMember.groupId, ticketGroup.id)
		)
		.leftJoin(ticket, and(eq(ticket.id, ticketGroupMember.ticketId), isNull(ticket.archivedAt)))
		.where(eq(ticketGroup.workspaceId, workspaceId))
		.groupBy(ticketGroup.id, ticketGroup.label, ticketGroup.archivedAt)
		.orderBy(ticketGroup.label);
	return rows.map((r) => ({ id: r.id, label: r.label, archived: r.archivedAt !== null, usage: r.usage }));
}

async function assertUniqueLabel(workspaceId: string, trimmed: string, excludeId: string | null) {
	const conds = [
		eq(ticketGroup.workspaceId, workspaceId),
		isNull(ticketGroup.archivedAt),
		sql`lower(${ticketGroup.label}) = ${trimmed.toLowerCase()}`
	];
	if (excludeId) conds.push(ne(ticketGroup.id, excludeId));
	const dup = await db.select({ id: ticketGroup.id }).from(ticketGroup).where(and(...conds)).limit(1);
	if (dup.length) throw new Error('Un groupe actif porte déjà ce nom.');
}

export async function createTicketGroup(workspaceId: string, label: string) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(workspaceId, trimmed, null);
	await db.insert(ticketGroup).values({ workspaceId, label: trimmed });
}

export async function renameTicketGroup(workspaceId: string, id: string, label: string) {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('Nom requis.');
	await assertUniqueLabel(workspaceId, trimmed, id);
	const res = await db
		.update(ticketGroup)
		.set({ label: trimmed })
		.where(and(eq(ticketGroup.id, id), eq(ticketGroup.workspaceId, workspaceId)))
		.returning({ id: ticketGroup.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

export async function setTicketGroupArchived(workspaceId: string, id: string, archived: boolean) {
	const res = await db
		.update(ticketGroup)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(ticketGroup.id, id), eq(ticketGroup.workspaceId, workspaceId)))
		.returning({ id: ticketGroup.id });
	if (res.length === 0) throw new Error('Introuvable dans cet espace.');
}

/** Groupes (id + label) contenant un ticket donné, tous statuts confondus. */
export async function getTicketGroupIds(workspaceId: string, ticketId: string): Promise<string[]> {
	const rows = await db
		.select({ groupId: ticketGroupMember.groupId })
		.from(ticketGroupMember)
		.innerJoin(ticketGroup, eq(ticketGroupMember.groupId, ticketGroup.id))
		.where(and(eq(ticketGroup.workspaceId, workspaceId), eq(ticketGroupMember.ticketId, ticketId)));
	return rows.map((r) => r.groupId);
}

/** Ajoute/retire un ticket d'un groupe (many-to-many, 0..N groupes par ticket). */
export async function setTicketInGroup(workspaceId: string, ticketId: string, groupId: string, member: boolean) {
	const [ownedGroup] = await db
		.select({ id: ticketGroup.id })
		.from(ticketGroup)
		.where(and(eq(ticketGroup.id, groupId), eq(ticketGroup.workspaceId, workspaceId)));
	if (!ownedGroup) throw new Error('Groupe introuvable dans cet espace.');
	const [ownedTicket] = await db
		.select({ id: ticket.id })
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
	if (!ownedTicket) throw new Error('Ticket introuvable dans cet espace.');

	if (member) {
		await db.insert(ticketGroupMember).values({ groupId, ticketId }).onConflictDoNothing();
	} else {
		await db
			.delete(ticketGroupMember)
			.where(and(eq(ticketGroupMember.groupId, groupId), eq(ticketGroupMember.ticketId, ticketId)));
	}
}
