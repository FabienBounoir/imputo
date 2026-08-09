import { describe, it, expect } from 'vitest';
import { actions } from './+page.server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';

describe('workspace/new action', () => {
	it('crée un nouvel espace pour un utilisateur existant -> redirige vers /imputation', async () => {
		const { userId } = await makeWorkspace('wsnew');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ workspaceName: 'Nouveau Espace' }) };
		await expect(actions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/imputation'
		});
	});

	it("nom vide -> fail 400", async () => {
		const { userId } = await makeWorkspace('wsnew2');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ workspaceName: '' }) };
		const res = await actions.default(event as never);
		expect(res?.status).toBe(400);
	});

	it('non authentifié -> redirige vers /login', async () => {
		const event = {
			locals: { user: null, sessionToken: null },
			request: formRequest({ workspaceName: 'X' })
		};
		await expect(actions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});
});
