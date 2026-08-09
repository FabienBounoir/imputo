import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createRef } from '$lib/server/services/referentials';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('GET /api/command/data', () => {
	it('rejette sans authentification', async () => {
		await expect(GET({ locals: emptyLocals } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('renvoie les référentiels de son espace, sans membres pour un non-admin', async () => {
		const { workspaceId } = await makeWorkspace('cmd-data');
		await createRef(workspaceId, 'project', 'Projet X');
		const { userId } = await addMember(workspaceId, 'USER', 'cmd-data-member');

		const locals = await fakeLocals(userId);
		const res = await GET({ locals } as never);
		const body = await res.json();
		expect(body.projects.map((p: { name: string }) => p.name)).toContain('Projet X');
		expect(body.members).toEqual([]);
	});

	it('un ADMIN reçoit aussi la liste des membres actifs', async () => {
		const { userId } = await makeWorkspace('cmd-data2');
		const locals = await fakeLocals(userId); // owner = ADMIN
		const res = await GET({ locals } as never);
		const body = await res.json();
		expect(body.members.length).toBeGreaterThanOrEqual(1);
	});
});
