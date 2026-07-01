import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspace } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { listTickets, createTicket } from './tickets';
import { setCell, getWeek } from './imputation';

// Test d'isolation multi-espaces : un espace ne doit JAMAIS voir les données d'un autre.
const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id)); // cascade
});

describe('isolation multi-espaces', () => {
	it('listTickets ne renvoie que les tickets de son espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A',
			email: `a-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B',
			email: `b-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		await createTicket(a.workspaceId, { key: `A-${rnd}`, title: 'Ticket A' });
		await createTicket(b.workspaceId, { key: `B-${rnd}`, title: 'Ticket B' });

		const ticketsA = await listTickets(a.workspaceId);
		const ticketsB = await listTickets(b.workspaceId);

		expect(ticketsA.map((t) => t.key)).toContain(`A-${rnd}`);
		expect(ticketsA.map((t) => t.key)).not.toContain(`B-${rnd}`);
		expect(ticketsB.map((t) => t.key)).toContain(`B-${rnd}`);
		expect(ticketsB.map((t) => t.key)).not.toContain(`A-${rnd}`);
	});

	it('setCell refuse d’imputer sur un ticket d’un autre espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A2',
			email: `a2-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A2'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B2',
			email: `b2-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B2'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		const ticketA = await createTicket(a.workspaceId, { key: `AX-${rnd}`, title: 'Ticket A' });

		// L'utilisateur B tente d'imputer sur un ticket de l'espace A → rejet.
		await expect(
			setCell(b.workspaceId, b.userId, {
				targetType: 'TICKET',
				targetId: ticketA.id,
				activityId: null,
				day: '2026-06-22',
				amount: 1
			})
		).rejects.toThrow();

		// Sa feuille reste vide.
		const week = await getWeek(b.workspaceId, b.userId, '2026-06-22');
		expect(week.rows.length).toBe(0);
	});
});
