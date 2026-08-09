import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('POST /api/push/test', () => {
	it('rejette sans authentification', async () => {
		await expect(POST({ locals: emptyLocals } as never)).rejects.toMatchObject({ status: 401 });
	});

	it("n'envoie rien (0) si l'utilisateur n'a aucun abonnement", async () => {
		const { userId } = await makeWorkspace('push-test');
		const locals = await fakeLocals(userId);
		const res = await POST({ locals } as never);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.sent).toBe(0);
	});
});
