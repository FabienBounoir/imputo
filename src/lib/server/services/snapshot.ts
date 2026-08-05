import { eq } from 'drizzle-orm';
import { db, workspace, ticketSnapshot } from '$lib/server/db';
import { listTickets } from './tickets';
import { todayInParis } from '$lib/utils/date';

/**
 * Cron quotidien : fige l'état courant de chaque ticket (estimation/RAE réel, RAE test, consommé)
 * pour alimenter la courbe d'évolution du dashboard version/sprint, qui n'a pas d'historique sinon.
 * `workspaceId` optionnel = limite le run à un seul espace (tests, rejeu ciblé) ; par défaut, tous.
 */
export async function runSnapshot(
	dateISO = todayInParis(),
	workspaceId?: string
): Promise<{ workspaces: number; tickets: number }> {
	const workspaces = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(workspaceId ? eq(workspace.id, workspaceId) : undefined);
	let ticketCount = 0;
	for (const ws of workspaces) {
		const tickets = await listTickets(ws.id);
		for (const t of tickets) {
			await db
				.insert(ticketSnapshot)
				.values({
					workspaceId: ws.id,
					ticketId: t.id,
					date: dateISO,
					estimationReal: String(t.estimationReal),
					raeReal: String(t.raeReal),
					raeTest: String(t.raeTest),
					consumed: String(t.consumed)
				})
				.onConflictDoUpdate({
					target: [ticketSnapshot.ticketId, ticketSnapshot.date],
					set: {
						estimationReal: String(t.estimationReal),
						raeReal: String(t.raeReal),
						raeTest: String(t.raeTest),
						consumed: String(t.consumed)
					}
				});
			ticketCount++;
		}
	}
	return { workspaces: workspaces.length, tickets: ticketCount };
}
