import { describe, it, expect } from 'vitest';
import { makeWorkspace } from './test-helpers';
import { saveSubscription, removeSubscription, hasSubscription, sendToUser } from './push';

describe('push', () => {
	it('saveSubscription puis hasSubscription/removeSubscription', async () => {
		const ws = await makeWorkspace('push');
		const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${ws.id}`, keys: { p256dh: 'p256', auth: 'auth' } };

		expect(await hasSubscription(ws.userId)).toBe(false);

		await saveSubscription(ws.userId, sub, 'vitest-agent');
		expect(await hasSubscription(ws.userId)).toBe(true);

		await removeSubscription(ws.userId, sub.endpoint);
		expect(await hasSubscription(ws.userId)).toBe(false);
	});

	it('saveSubscription est idempotent sur le même endpoint (upsert)', async () => {
		const ws = await makeWorkspace('push-upsert');
		const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${ws.id}`, keys: { p256dh: 'p1', auth: 'a1' } };
		await saveSubscription(ws.userId, sub, 'ua-1');
		await saveSubscription(ws.userId, { ...sub, keys: { p256dh: 'p2', auth: 'a2' } }, 'ua-2');

		expect(await hasSubscription(ws.userId)).toBe(true);
	});

	it("saveSubscription rejette un endpoint hors des hôtes push connus (SSRF)", async () => {
		const ws = await makeWorkspace('push-ssrf');
		const sub = { endpoint: 'https://kubernetes.default.svc/version', keys: { p256dh: 'p256', auth: 'auth' } };

		await expect(saveSubscription(ws.userId, sub, 'vitest-agent')).rejects.toThrow();
		expect(await hasSubscription(ws.userId)).toBe(false);
	});

	it("sendToUser sans abonnement n'envoie rien et ne plante pas", async () => {
		const ws = await makeWorkspace('push-none');
		const sent = await sendToUser(ws.userId, { title: 'Titre', body: 'Corps' });
		expect(sent).toBe(0);
	});
});
