import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, jsonRequest } from '$lib/server/test-helpers/http';
import { hasSubscription } from '$lib/server/services/push';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('POST /api/push/subscribe', () => {
	it('rejette sans authentification', async () => {
		await expect(POST({ locals: emptyLocals, request: jsonRequest({}) } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('rejette un abonnement invalide', async () => {
		const { userId } = await makeWorkspace('push-sub');
		const locals = await fakeLocals(userId);
		await expect(POST({ locals, request: jsonRequest({ endpoint: 'https://x' }) } as never)).rejects.toMatchObject({
			status: 400
		});
	});

	it('enregistre un abonnement valide', async () => {
		const { userId } = await makeWorkspace('push-sub2');
		const locals = await fakeLocals(userId);
		const request = jsonRequest({
			endpoint: `https://push.example/${userId}`,
			keys: { p256dh: 'p', auth: 'a' }
		});
		const res = await POST({ locals, request } as never);
		expect((await res.json()).ok).toBe(true);
		expect(await hasSubscription(userId)).toBe(true);
	});
});
