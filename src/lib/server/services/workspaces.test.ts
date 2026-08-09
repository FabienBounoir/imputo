import { describe, it, expect } from 'vitest';
import {
	createWorkspaceForUser,
	getMembership,
	getDeactivatedWorkspace,
	isManagerOrAdmin,
	listMembershipsForUser
} from './workspaces';
import { setMemberActive } from './accounts';
import { makeWorkspace, addMember } from './test-helpers';

describe('isManagerOrAdmin', () => {
	it('vrai pour ADMIN et MANAGER, faux pour USER et null', () => {
		expect(isManagerOrAdmin('ADMIN')).toBe(true);
		expect(isManagerOrAdmin('MANAGER')).toBe(true);
		expect(isManagerOrAdmin('USER')).toBe(false);
		expect(isManagerOrAdmin(null)).toBe(false);
	});
});

describe('createWorkspaceForUser', () => {
	it('donne un second espace (ADMIN) à un utilisateur déjà existant', async () => {
		const { userId, workspaceId: firstWs } = await makeWorkspace();
		const { workspaceId } = await createWorkspaceForUser(userId, 'Second espace');

		const memberships = await listMembershipsForUser(userId);
		const ids = memberships.map((m) => m.workspaceId);
		expect(ids).toContain(firstWs);
		expect(ids).toContain(workspaceId);
		expect(memberships.find((m) => m.workspaceId === workspaceId)?.role).toBe('ADMIN');
	});
});

describe('getMembership', () => {
	it('renvoie le rôle pour un membre actif, null sinon', async () => {
		const { userId, workspaceId } = await makeWorkspace();
		const m = await getMembership(workspaceId, userId);
		expect(m?.role).toBe('ADMIN');

		const other = await makeWorkspace('other');
		expect(await getMembership(workspaceId, other.userId)).toBeNull();
	});
});

describe('getDeactivatedWorkspace', () => {
	it("renvoie l'espace uniquement si l'appartenance y est désactivée", async () => {
		// Le créateur de l'espace (ADMIN) ne peut pas être désactivé — on teste sur un membre ajouté.
		const { workspaceId } = await makeWorkspace();
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'deact');
		expect(await getDeactivatedWorkspace(workspaceId, memberId)).toBeNull();

		await setMemberActive(workspaceId, memberId, false);
		const deactivated = await getDeactivatedWorkspace(workspaceId, memberId);
		expect(deactivated?.workspaceId).toBe(workspaceId);

		// Confirme au passage que le membre désactivé disparaît de listMembershipsForUser.
		expect(await listMembershipsForUser(memberId)).toEqual([]);
	});
});
