import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { logChange } from '$lib/server/services/changeLog';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('GET /api/tickets/[id]/history', () => {
	it('rejette sans authentification', async () => {
		await expect(GET({ locals: emptyLocals, params: { id: 'x' } } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it("renvoie l'historique d'un ticket de son espace", async () => {
		const { userId, workspaceId } = await makeWorkspace();
		const t = await createTicket(workspaceId, { key: 'HIST-1', title: 'Ticket' });
		await logChange({
			workspaceId,
			entityType: 'TICKET',
			entityId: t.id,
			field: 'estimationReal',
			action: 'UPDATE',
			oldValue: '1',
			newValue: '2',
			changedById: userId
		});

		const locals = await fakeLocals(userId);
		const res = await GET({ locals, params: { id: t.id } } as never);
		const body = await res.json();
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0].newValue).toBe('2');
	});

	it("un autre espace ne voit pas l'historique de ce ticket", async () => {
		const a = await makeWorkspace('hist-a');
		const b = await makeWorkspace('hist-b');
		const t = await createTicket(a.workspaceId, { key: 'HIST-2', title: 'Ticket A' });
		await logChange({
			workspaceId: a.workspaceId,
			entityType: 'TICKET',
			entityId: t.id,
			action: 'UPDATE',
			oldValue: null,
			newValue: 'x',
			changedById: a.userId
		});

		const localsB = await fakeLocals(b.userId);
		const res = await GET({ locals: localsB, params: { id: t.id } } as never);
		const body = await res.json();
		expect(body.entries).toHaveLength(0);
	});
});
