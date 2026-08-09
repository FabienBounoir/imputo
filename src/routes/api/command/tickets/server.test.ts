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

describe('GET /api/command/tickets', () => {
	it('rejette sans authentification', async () => {
		await expect(GET({ locals: emptyLocals, url: new URL('http://localhost/x?q=ab') } as never)).rejects.toMatchObject(
			{ status: 401 }
		);
	});

	it('renvoie [] sans requête réseau pour une recherche trop courte', async () => {
		const { userId } = await makeWorkspace('cmd-tix');
		const locals = await fakeLocals(userId);
		const res = await GET({ locals, url: new URL('http://localhost/x?q=a') } as never);
		expect(await res.json()).toEqual({ tickets: [] });
	});

	it('trouve un ticket de son espace par clé', async () => {
		const { userId, workspaceId } = await makeWorkspace('cmd-tix2');
		await createTicket(workspaceId, { key: 'FINDME-1', title: 'Un ticket' });
		const locals = await fakeLocals(userId);
		const res = await GET({ locals, url: new URL('http://localhost/x?q=FINDME') } as never);
		const body = await res.json();
		expect(body.tickets.map((t: { key: string }) => t.key)).toContain('FINDME-1');
	});
});
