import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
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

	it('masque Estimation prév. / Enveloppe totale à un USER, pas à un MANAGER', async () => {
		const { userId, workspaceId } = await makeWorkspace('hist-budget');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'hist-budget-user');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'hist-budget-mgr');
		const t = await createTicket(workspaceId, { key: 'HIST-3', title: 'Ticket' });
		for (const field of ['enveloppeTotale', 'raeReal']) {
			await logChange({ workspaceId, entityType: 'TICKET', entityId: t.id, field, action: 'UPDATE', oldValue: '1', newValue: '2', changedById: userId });
		}

		const fieldsSeenBy = async (id: string) => {
			const res = await GET({ locals: await fakeLocals(id), params: { id: t.id } } as never);
			return (await res.json()).entries.map((e: { field: string }) => e.field).sort();
		};
		expect(await fieldsSeenBy(memberId)).toEqual(['raeReal']);
		expect(await fieldsSeenBy(managerId)).toEqual(['enveloppeTotale', 'raeReal']);
	});
});
