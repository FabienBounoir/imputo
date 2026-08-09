import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspace } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { login, changePassword, regenerateInvite, getTokenTarget, setPasswordWithToken } from './accounts';

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id));
});

describe('changePassword', () => {
	it('change le mot de passe quand l’ancien est correct, et le nouveau permet la connexion', async () => {
		const email = `cp-ok-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Alice',
			email,
			password: 'password123',
			workspaceName: 'Espace CP OK'
		});
		wsIds.push(workspaceId);

		const ok = await changePassword(userId, 'password123', 'newpassword456');
		expect(ok).toBe(true);

		expect(await login(email, 'newpassword456')).toEqual({ userId });
		expect(await login(email, 'password123')).toBeNull();
	});

	it('refuse et ne change rien si l’ancien mot de passe est incorrect', async () => {
		const email = `cp-bad-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Bob',
			email,
			password: 'password123',
			workspaceName: 'Espace CP KO'
		});
		wsIds.push(workspaceId);

		const ok = await changePassword(userId, 'wrong-current-password', 'newpassword456');
		expect(ok).toBe(false);

		expect(await login(email, 'password123')).toEqual({ userId });
		expect(await login(email, 'newpassword456')).toBeNull();
	});
});

describe('regenerateInvite pour un membre déjà actif', () => {
	it('génère un lien qui réinitialise le mot de passe d’un compte déjà activé', async () => {
		const email = `reinvite-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Carole',
			email,
			password: 'password123',
			workspaceName: 'Espace Reinvite'
		});
		wsIds.push(workspaceId);

		const { token } = await regenerateInvite(workspaceId, userId);

		// Le token cible bien ce compte, déjà actif (pas seulement les invitations en attente).
		const target = await getTokenTarget(token);
		expect(target?.userId).toBe(userId);

		const ok = await setPasswordWithToken(token, 'resetpassword789');
		expect(ok).toBe(true);
		expect(await login(email, 'resetpassword789')).toEqual({ userId });
		expect(await login(email, 'password123')).toBeNull();
	});
});
