import { describe, it, expect } from 'vitest';
import { actions, load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branche redirect sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { setMemberFactice } from '$lib/server/services/accounts';
import { setObjectivesEnabled, listObjectivesForUser } from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, toISODate, todayInParis } from '$lib/utils/date';

/**
 * Les objectifs sont désactivés par défaut sur un espace neuf (cf. workspace.objectivesEnabled) :
 * chaque test qui veut la feature doit l'activer AVANT fakeLocals, qui fige `locals.workspace`.
 */
async function makeWorkspaceWithObjectives(prefix: string) {
	const ws = await makeWorkspace(prefix);
	await setObjectivesEnabled(ws.workspaceId, true);
	return ws;
}

const pageUrl = (search = '') => new URL(`http://localhost/admin/objectifs${search}`);

describe('admin/objectifs addObjective action', () => {
	it('un MANAGER peut ajouter un objectif custom à un membre', async () => {
		const { workspaceId } = await makeWorkspaceWithObjectives('obj1');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'obj1-mgr');
		const { userId: targetUserId } = await addMember(workspaceId, 'USER', 'obj1-target');
		const locals = await fakeLocals(managerId);
		const event = {
			locals,
			request: formRequest({
				userId: targetUserId,
				weekMondayISO: '2026-06-22',
				kind: 'CUSTOM',
				label: 'Rédiger la doc'
			})
		};
		const res = await actions.addObjective(event as never);
		expect(res).toEqual({ objOk: true });
	});

	it('un rôle USER ne peut pas ajouter un objectif (403)', async () => {
		const { workspaceId } = await makeWorkspaceWithObjectives('obj2');
		const { userId } = await addMember(workspaceId, 'USER', 'obj2-user');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({ userId, weekMondayISO: '2026-06-22', kind: 'CUSTOM', label: 'x' })
		};
		const res = await actions.addObjective(event as never);
		expect(res?.status).toBe(403);
	});

	it('données invalides -> fail 400', async () => {
		const { userId } = await makeWorkspaceWithObjectives('obj3');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ userId: '', weekMondayISO: '' }) };
		const res = await actions.addObjective(event as never);
		expect(res?.status).toBe(400);
	});

	it("espace qui a désactivé les objectifs : même un ADMIN est refusé (403), y compris en POST direct", async () => {
		const { userId } = await makeWorkspace('obj-off-add');
		const locals = await fakeLocals(userId);
		const res = await actions.addObjective({
			locals,
			request: formRequest({ userId, weekMondayISO: '2026-06-22', kind: 'CUSTOM', label: 'x' })
		} as never);
		expect(res?.status).toBe(403);
	});
});

describe('admin/objectifs removeObjective + toggleVacation actions', () => {
	it('ADMIN peut ajouter puis retirer un objectif', async () => {
		const { userId, workspaceId } = await makeWorkspaceWithObjectives('obj4');
		const locals = await fakeLocals(userId);

		await actions.addObjective({
			locals,
			request: formRequest({
				userId,
				weekMondayISO: '2026-06-22',
				kind: 'CUSTOM',
				label: 'À supprimer'
			})
		} as never);

		const [objective] = await listObjectivesForUser(workspaceId, userId, '2026-06-22');

		const res = await actions.removeObjective({
			locals,
			request: formRequest({ id: objective.id })
		} as never);
		expect(res).toEqual({ objOk: true });
	});

	it('ADMIN peut basculer les vacances d’un membre', async () => {
		const { userId } = await makeWorkspaceWithObjectives('obj5');
		const locals = await fakeLocals(userId);
		const res = await actions.toggleVacation({
			locals,
			request: formRequest({ userId, weekMondayISO: '2026-06-22', onVacation: 'true' })
		} as never);
		expect(res).toEqual({ objOk: true });
	});
});

describe('admin/objectifs toggleDone action', () => {
	/** Crée un objectif pour `targetId` et renvoie son id. */
	async function objectiveFor(workspaceId: string, adminLocals: unknown, targetId: string, week = '2026-06-22') {
		await actions.addObjective({
			locals: adminLocals,
			request: formRequest({ userId: targetId, weekMondayISO: week, kind: 'CUSTOM', label: 'Tâche' })
		} as never);
		const [o] = await listObjectivesForUser(workspaceId, targetId, week);
		return o.id;
	}

	it('un membre coche son propre objectif', async () => {
		const { userId: adminId, workspaceId } = await makeWorkspaceWithObjectives('done1');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'done1-member');
		const adminLocals = await fakeLocals(adminId);
		const id = await objectiveFor(workspaceId, adminLocals, memberId);

		const res = await actions.toggleDone({
			locals: await fakeLocals(memberId),
			request: formRequest({ id, done: 'true' })
		} as never);
		expect(res).toEqual({ doneOk: true });

		const [o] = await listObjectivesForUser(workspaceId, memberId, '2026-06-22');
		expect(o.doneAt).toBeInstanceOf(Date);
	});

	it("un membre ne peut pas cocher l'objectif de quelqu'un d'autre (403)", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspaceWithObjectives('done2');
		const { userId: aliceId } = await addMember(workspaceId, 'USER', 'done2-alice');
		const { userId: bobId } = await addMember(workspaceId, 'USER', 'done2-bob');
		const adminLocals = await fakeLocals(adminId);
		const id = await objectiveFor(workspaceId, adminLocals, aliceId);

		const res = await actions.toggleDone({
			locals: await fakeLocals(bobId),
			request: formRequest({ id, done: 'true' })
		} as never);
		expect(res?.status).toBe(403);

		const [o] = await listObjectivesForUser(workspaceId, aliceId, '2026-06-22');
		expect(o.doneAt).toBeNull();
	});

	it("un MANAGER coche l'objectif d'un autre, et le décochage remet doneAt à null", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspaceWithObjectives('done3');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'done3-mgr');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'done3-member');
		const adminLocals = await fakeLocals(adminId);
		const id = await objectiveFor(workspaceId, adminLocals, memberId);
		const managerLocals = await fakeLocals(managerId);

		expect(await actions.toggleDone({ locals: managerLocals, request: formRequest({ id, done: 'true' }) } as never)).toEqual({
			doneOk: true
		});
		expect(await actions.toggleDone({ locals: managerLocals, request: formRequest({ id, done: 'false' }) } as never)).toEqual({
			doneOk: true
		});

		const [o] = await listObjectivesForUser(workspaceId, memberId, '2026-06-22');
		expect(o.doneAt).toBeNull();
	});

	it("un objectif d'un autre espace n'est pas cochable (403, pas de fuite entre espaces)", async () => {
		const { userId: adminA, workspaceId: wsA } = await makeWorkspaceWithObjectives('done4-a');
		const { userId: adminB } = await makeWorkspaceWithObjectives('done4-b');
		const id = await objectiveFor(wsA, await fakeLocals(adminA), adminA);

		const res = await actions.toggleDone({
			locals: await fakeLocals(adminB),
			request: formRequest({ id, done: 'true' })
		} as never);
		expect(res?.status).toBe(403);
	});
});

describe('admin/objectifs load', () => {
	it('un membre marqué factice (cf. membership.factice) est exclu de la liste des membres', async () => {
		const { userId: ownerId, workspaceId } = await makeWorkspaceWithObjectives('obj-factice');
		const { userId: normalId } = await addMember(workspaceId, 'USER', 'obj-factice-normal');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'obj-factice-dummy');
		await setMemberFactice(workspaceId, facticeId, true);

		const locals = await fakeLocals(ownerId);
		const result = await load({ locals, url: pageUrl() } as never);

		const memberIds = result.members.map((m: { id: string }) => m.id);
		expect(memberIds).toContain(normalId);
		expect(memberIds).not.toContain(facticeId);
	});

	it('par défaut la semaine courante, pas la suivante', async () => {
		const { userId } = await makeWorkspaceWithObjectives('obj-week');
		const result = await load({ locals: await fakeLocals(userId), url: pageUrl() } as never);
		expect(result.weekMondayISO).toBe(toISODate(mondayOf(parseISODate(todayInParis()))));
		expect(result.isPastWeek).toBe(false);
	});

	it('un simple membre accède à la page, en lecture seule', async () => {
		const { workspaceId } = await makeWorkspaceWithObjectives('obj-member');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'obj-member-user');
		const result = await load({ locals: await fakeLocals(memberId), url: pageUrl() } as never);
		expect(result.canManage).toBe(false);
		expect(result.selfId).toBe(memberId);
	});

	it('objectifs désactivés sur l’espace : la page redirige vers /imputation', async () => {
		const { userId } = await makeWorkspace('obj-off');
		await expect(load({ locals: await fakeLocals(userId), url: pageUrl() } as never)).rejects.toMatchObject({
			status: 303,
			location: '/imputation'
		});
	});
});
