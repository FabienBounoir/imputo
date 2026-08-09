import { describe, it, expect } from 'vitest';
import { actions } from './+page.server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('settings accentPref action', () => {
	it("met à jour la préférence d'accent", async () => {
		const { userId } = await makeWorkspace('set1');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ mode: 'CUSTOM', color: '#336699' }) };
		const res = await actions.accentPref(event as never);
		expect(res).toEqual({ accentPrefOk: true });
	});

	it('couleur invalide -> fail 400', async () => {
		const { userId } = await makeWorkspace('set2');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ mode: 'CUSTOM', color: 'not-a-color' }) };
		const res = await actions.accentPref(event as never);
		expect(res?.status).toBe(400);
	});

	it('non authentifié -> fail 401', async () => {
		const event = { locals: { user: null }, request: formRequest({ mode: 'CUSTOM', color: '#336699' }) };
		const res = await actions.accentPref(event as never);
		expect(res?.status).toBe(401);
	});
});

describe('settings changePassword action', () => {
	it('change le mot de passe avec le bon ancien mot de passe', async () => {
		const { userId } = await makeWorkspace('set3');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({
				currentPassword: 'password123',
				password: 'newpassword456',
				confirm: 'newpassword456'
			})
		};
		const res = await actions.changePassword(event as never);
		expect(res).toEqual({ pwOk: true });
	});

	it('mauvais ancien mot de passe -> fail 400', async () => {
		const { userId } = await makeWorkspace('set4');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({ currentPassword: 'wrong', password: 'newpassword456', confirm: 'newpassword456' })
		};
		const res = await actions.changePassword(event as never);
		expect(res?.status).toBe(400);
	});

	it('confirmation différente -> fail 400', async () => {
		const { userId } = await makeWorkspace('set5');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({ currentPassword: 'password123', password: 'newpassword456', confirm: 'autrechose' })
		};
		const res = await actions.changePassword(event as never);
		expect(res?.status).toBe(400);
	});
});
