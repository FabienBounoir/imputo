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

describe('POST /api/push/prefs', () => {
	it('rejette sans authentification', async () => {
		await expect(
			POST({ locals: emptyLocals, request: new Request('http://localhost/x', { method: 'POST', body: '{}' }) } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('rejette un body non-JSON', async () => {
		const { userId } = await makeWorkspace('push-prefs');
		const locals = await fakeLocals(userId);
		const request = new Request('http://localhost/x', { method: 'POST', body: 'not json' });
		await expect(POST({ locals, request } as never)).rejects.toMatchObject({ status: 400 });
	});

	it('normalise et enregistre les préférences', async () => {
		const { userId } = await makeWorkspace('push-prefs2');
		const locals = await fakeLocals(userId);
		const request = new Request('http://localhost/x', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ eveningMissing: false })
		});
		const res = await POST({ locals, request } as never);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.prefs.eveningMissing).toBe(false);
		expect(body.prefs.enabled).toBe(true); // valeur par défaut complétée
	});
});
