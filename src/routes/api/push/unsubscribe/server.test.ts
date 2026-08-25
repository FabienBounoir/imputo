import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, jsonRequest } from '$lib/server/test-helpers/http';
import { saveSubscription, hasSubscription } from '$lib/server/services/push';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('POST /api/push/unsubscribe', () => {
	it('rejette sans authentification', async () => {
		await expect(POST({ locals: emptyLocals, request: jsonRequest({}) } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('rejette si endpoint manquant', async () => {
		const { userId } = await makeWorkspace('push-unsub');
		const locals = await fakeLocals(userId);
		await expect(POST({ locals, request: jsonRequest({}) } as never)).rejects.toMatchObject({ status: 400 });
	});

	it('supprime un abonnement existant', async () => {
		const { userId } = await makeWorkspace('push-unsub2');
		const endpoint = `https://fcm.googleapis.com/fcm/send/${userId}`;
		await saveSubscription(userId, { endpoint, keys: { p256dh: 'p', auth: 'a' } }, null);
		expect(await hasSubscription(userId)).toBe(true);

		const locals = await fakeLocals(userId);
		const res = await POST({ locals, request: jsonRequest({ endpoint }) } as never);
		expect((await res.json()).ok).toBe(true);
		expect(await hasSubscription(userId)).toBe(false);
	});
});
