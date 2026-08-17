import { and, eq } from 'drizzle-orm';
import { db, ticket, sprint, ticketSprintMember } from '$lib/server/db';

export type SprintKind = 'SPRINT' | 'VERSION';

/** Sprints ou versions (id) contenant un ticket donné, tous statuts confondus. */
export async function getTicketSprintIds(workspaceId: string, ticketId: string, kind: SprintKind): Promise<string[]> {
	const rows = await db
		.select({ sprintId: ticketSprintMember.sprintId })
		.from(ticketSprintMember)
		.innerJoin(sprint, eq(ticketSprintMember.sprintId, sprint.id))
		.where(and(eq(sprint.workspaceId, workspaceId), eq(sprint.kind, kind), eq(ticketSprintMember.ticketId, ticketId)));
	return rows.map((r) => r.sprintId);
}

/** Ajoute/retire un ticket d'un sprint ou d'une version (many-to-many, 0..N par ticket). */
export async function setTicketSprintMember(
	workspaceId: string,
	ticketId: string,
	sprintId: string,
	kind: SprintKind,
	member: boolean
) {
	const [ownedSprint] = await db
		.select({ id: sprint.id })
		.from(sprint)
		.where(and(eq(sprint.id, sprintId), eq(sprint.workspaceId, workspaceId), eq(sprint.kind, kind)));
	if (!ownedSprint) throw new Error(kind === 'VERSION' ? 'Version introuvable dans cet espace.' : 'Sprint introuvable dans cet espace.');
	const [ownedTicket] = await db
		.select({ id: ticket.id })
		.from(ticket)
		.where(and(eq(ticket.id, ticketId), eq(ticket.workspaceId, workspaceId)));
	if (!ownedTicket) throw new Error('Ticket introuvable dans cet espace.');

	if (member) {
		await db.insert(ticketSprintMember).values({ ticketId, sprintId }).onConflictDoNothing();
	} else {
		await db
			.delete(ticketSprintMember)
			.where(and(eq(ticketSprintMember.ticketId, ticketId), eq(ticketSprintMember.sprintId, sprintId)));
	}
}
