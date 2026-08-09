import { describe, it, expect } from 'vitest';
import { load, actions } from './+page.server';
import { inviteMember } from '$lib/server/services/accounts';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeCookies, formRequest } from '$lib/server/test-helpers/http';

describe('invite/[token] load', () => {
	it('token invalide -> invalid: true', async () => {
		const res = await load({ params: { token: 'nope' } } as never);
		expect(res).toEqual({ invalid: true, email: null });
	});

	it('token valide -> email de la cible', async () => {
		const { workspaceId } = await makeWorkspace('inv');
		const { token } = await inviteMember({
			workspaceId,
			email: 'invited@acme.test',
			displayName: 'Invited',
			role: 'USER'
		});
		const res = await load({ params: { token } } as never);
		expect(res).toEqual({ invalid: false, email: 'invited@acme.test' });
	});
});

describe('invite/[token] action', () => {
	it('définit le mot de passe et ouvre une session -> redirige vers /imputation', async () => {
		const { workspaceId } = await makeWorkspace('inv2');
		const { token } = await inviteMember({
			workspaceId,
			email: 'invited2@acme.test',
			displayName: 'Invited2',
			role: 'USER'
		});

		const event = {
			params: { token },
			cookies: fakeCookies(),
			request: formRequest({ password: 'password123', confirm: 'password123' })
		};
		await expect(actions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/imputation'
		});
	});

	it('token invalide -> fail 400', async () => {
		const event = {
			params: { token: 'nope' },
			cookies: fakeCookies(),
			request: formRequest({ password: 'password123', confirm: 'password123' })
		};
		const res = await actions.default(event as never);
		expect(res?.status).toBe(400);
	});

	it('mots de passe différents -> fail 400', async () => {
		const { workspaceId } = await makeWorkspace('inv3');
		const { token } = await inviteMember({
			workspaceId,
			email: 'invited3@acme.test',
			displayName: 'Invited3',
			role: 'USER'
		});
		const event = {
			params: { token },
			cookies: fakeCookies(),
			request: formRequest({ password: 'password123', confirm: 'different' })
		};
		const res = await actions.default(event as never);
		expect(res?.status).toBe(400);
	});
});
