import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('GET /api/tickets', () => {
	it('rejette sans authentification', async () => {
		await expect(
			GET({ locals: emptyLocals, url: new URL('http://x/api/tickets') } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('renvoie les tickets de son espace', async () => {
		const { userId, workspaceId } = await makeWorkspace('tickets-list');
		await createTicket(workspaceId, { key: 'LIST-1', title: 'Ticket' });

		const locals = await fakeLocals(userId);
		const res = await GET({ locals, url: new URL('http://x/api/tickets') } as never);
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.tickets).toHaveLength(1);
	});
});
