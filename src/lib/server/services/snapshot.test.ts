import { describe, it, expect, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, workspace, ticketSnapshot } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { createTicket, updateTicketField } from './tickets';
import { setCell } from './imputation';
import { runSnapshot } from './snapshot';

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id)); // cascade
});

describe('runSnapshot', () => {
	it('fige estimation/RAE/consommé du jour pour chaque ticket', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'Snap',
			email: `snap-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Snap'
		});
		wsIds.push(a.workspaceId);

		const t = await createTicket(a.workspaceId, { key: `SNAP-${rnd}`, title: 'Ticket snapshot' });
		await updateTicketField(a.workspaceId, t.id, 'estimationReal', '5', 'ADMIN');
		await updateTicketField(a.workspaceId, t.id, 'raeReal', '3', 'ADMIN');
		await setCell(a.workspaceId, a.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: '2026-06-22',
			amount: 2
		});

		const dateISO = '2026-06-22';
		await runSnapshot(dateISO, a.workspaceId);

		const rows = await db
			.select()
			.from(ticketSnapshot)
			.where(and(eq(ticketSnapshot.ticketId, t.id), eq(ticketSnapshot.date, dateISO)));
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].estimationReal)).toBe(5);
		expect(Number(rows[0].raeReal)).toBe(3);
		expect(Number(rows[0].consumed)).toBe(2);

		// Re-run le même jour : upsert, pas de doublon.
		await updateTicketField(a.workspaceId, t.id, 'raeReal', '1', 'ADMIN');
		await runSnapshot(dateISO, a.workspaceId);
		const rowsAfter = await db
			.select()
			.from(ticketSnapshot)
			.where(and(eq(ticketSnapshot.ticketId, t.id), eq(ticketSnapshot.date, dateISO)));
		expect(rowsAfter).toHaveLength(1);
		expect(Number(rowsAfter[0].raeReal)).toBe(1);
	});
});
