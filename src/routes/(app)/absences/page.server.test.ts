import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { setMemberFactice } from '$lib/server/services/accounts';
import { listAbsencesForUser } from '$lib/server/services/absences';

describe('absences +page.server load', () => {
	it("redirige vers /register si l'utilisateur n'a pas d'espace courant", async () => {
		const { userId } = await makeWorkspace('absload');
		const locals = { ...(await fakeLocals(userId)), workspace: null };
		await expect(load({ locals, url: new URL('http://localhost/absences') } as never)).rejects.toMatchObject({
			status: 303,
			location: '/register'
		});
	});

	it('canManageOthers est false pour un USER, true pour un ADMIN', async () => {
		const { userId, workspaceId } = await makeWorkspace('absload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absload-member');
		const url = new URL('http://localhost/absences');

		const memberResult = await load({ locals: await fakeLocals(memberId), url } as never);
		const adminResult = await load({ locals: await fakeLocals(userId), url } as never);

		expect(memberResult.canManageOthers).toBe(false);
		expect(adminResult.canManageOthers).toBe(true);
		expect(memberResult.pendingAbsences).toEqual([]);
	});

	it('un MANAGER a canManageOthers=false (pas de validation) mais canManageExternal=true (membres externes)', async () => {
		const { workspaceId } = await makeWorkspace('absloadmgr');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'absloadmgr-manager');
		const url = new URL('http://localhost/absences');

		const result = await load({ locals: await fakeLocals(managerId), url } as never);

		expect(result.canManageOthers).toBe(false);
		expect(result.canManageExternal).toBe(true);
		// Un manager ne valide rien : la file d'attente ne lui est pas chargée, comme pour un USER.
		expect(result.pendingAbsences).toEqual([]);
	});

	it('un membre "factice" est visible pour un ADMIN mais absent de rows pour un MANAGER', async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('absfactice');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'absfactice-manager');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'absfactice-dummy');
		await setMemberFactice(workspaceId, facticeId, true);
		const url = new URL('http://localhost/absences');

		const asAdmin = await load({ locals: await fakeLocals(adminId), url } as never);
		expect(asAdmin.rows.map((r: { id: string }) => r.id)).toContain(facticeId);

		const asManager = await load({ locals: await fakeLocals(managerId), url } as never);
		expect(asManager.rows.map((r: { id: string }) => r.id)).not.toContain(facticeId);
	});

	it("place la ligne du membre courant en premier dans `rows` (retour utilisateur : plus facile à retrouver)", async () => {
		const { userId: ownerId, workspaceId } = await makeWorkspace('absself');
		await addMember(workspaceId, 'USER', 'absself-alice');
		const { userId: bobId } = await addMember(workspaceId, 'USER', 'absself-bob');
		const url = new URL('http://localhost/absences');

		const asOwner = await load({ locals: await fakeLocals(ownerId), url } as never);
		expect(asOwner.rows[0].id).toBe(ownerId);

		const asBob = await load({ locals: await fakeLocals(bobId), url } as never);
		expect(asBob.rows[0].id).toBe(bobId);
		// Le reste garde son ordre relatif (pas juste un tri qui mélange tout).
		expect(asBob.rows.slice(1).map((r: { id: string }) => r.id)).toEqual(
			asOwner.rows.filter((r: { id: string }) => r.id !== bobId).map((r: { id: string }) => r.id)
		);
	});
});

describe('absences +page.server actions.create', () => {
	it('rejette des champs invalides', async () => {
		const { userId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);
		const result = await actions.create({ locals, request: formRequest({}) } as never);
		expect(result?.status).toBe(400);
	});

	it('un USER ne peut pas déclarer un CONGE_VALIDE directement', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'abscreate-member');
		const locals = await fakeLocals(memberId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-01', type: 'CONGE_VALIDE', period: 'FULL' })
		} as never);

		expect(result?.status).toBe(403);
	});

	it('un ADMIN peut déclarer un CONGE_VALIDE', async () => {
		const { userId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-01', type: 'CONGE_VALIDE', period: 'FULL' })
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('un USER ne peut pas cibler un membre externe', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'abscreate-member');
		const locals = await fakeLocals(memberId);

		// subject=ext:... est ignoré pour un non-manager : l'absence est créée pour l'appelant lui-même.
		const result = await actions.create({
			locals,
			request: formRequest({
				startDate: '2026-06-02',
				endDate: '2026-06-02',
				type: 'FORMATION',
				period: 'FULL',
				subject: 'ext:some-id'
			})
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('un MANAGER ne peut pas déclarer un CONGE_VALIDE pour lui-même (mêmes droits qu\'un USER)', async () => {
		const { workspaceId } = await makeWorkspace('abscreatemgr');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'abscreatemgr-manager');
		const locals = await fakeLocals(managerId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-01', type: 'CONGE_VALIDE', period: 'FULL' })
		} as never);

		expect(result?.status).toBe(403);
	});

	it('un MANAGER ne peut pas cibler un autre vrai membre : retombe sur lui-même', async () => {
		const { workspaceId } = await makeWorkspace('abscreatemgr2');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'abscreatemgr2-manager');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'abscreatemgr2-other');
		const locals = await fakeLocals(managerId);

		const result = await actions.create({
			locals,
			request: formRequest({
				startDate: '2026-06-02',
				endDate: '2026-06-02',
				type: 'FORMATION',
				period: 'FULL',
				subject: `user:${otherId}`
			})
		} as never);

		expect(result).toEqual({ ok: true });
		const otherRows = await listAbsencesForUser(workspaceId, otherId);
		expect(otherRows.filter((r) => r.startDate === '2026-06-02')).toHaveLength(0);
		const managerRows = await listAbsencesForUser(workspaceId, managerId);
		expect(managerRows.filter((r) => r.startDate === '2026-06-02')).toHaveLength(1);
	});

	it('un MANAGER peut déclarer un CONGE_VALIDE direct pour un membre externe', async () => {
		const { workspaceId } = await makeWorkspace('abscreatemgr3');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'abscreatemgr3-manager');
		const locals = await fakeLocals(managerId);

		const addResult = await actions.addExternal({ locals, request: formRequest({ displayName: 'Externe Manager' }) } as never);
		expect(addResult).toEqual({ ok: true });
		const { externalMembers } = await load({ locals, url: new URL('http://localhost/absences') } as never);
		const ext = externalMembers.find((m: any) => m.displayName === 'Externe Manager');

		const result = await actions.create({
			locals,
			request: formRequest({
				startDate: '2026-06-03',
				endDate: '2026-06-03',
				type: 'CONGE_VALIDE',
				period: 'FULL',
				subject: `ext:${ext!.id}`
			})
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('une demi-journée sur plusieurs jours crée une ligne par jour, période conservée (retour utilisateur)', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-01', endDate: '2026-06-03', type: 'FORMATION', period: 'PM' })
		} as never);

		expect(result).toEqual({ ok: true });
		const rows = await listAbsencesForUser(workspaceId, userId);
		const created = rows.filter((r) => r.startDate >= '2026-06-01' && r.startDate <= '2026-06-03');
		expect(created).toHaveLength(3);
		expect(created.every((r) => r.period === 'PM' && r.startDate === r.endDate)).toBe(true);
		expect(created.map((r) => r.startDate).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
	});

	it('une journée complète sur plusieurs jours reste une seule ligne (comportement inchangé)', async () => {
		const { userId, workspaceId } = await makeWorkspace('abscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({ startDate: '2026-06-08', endDate: '2026-06-10', type: 'FORMATION', period: 'FULL' })
		} as never);

		expect(result).toEqual({ ok: true });
		const rows = await listAbsencesForUser(workspaceId, userId);
		const created = rows.filter((r) => r.startDate === '2026-06-08');
		expect(created).toHaveLength(1);
		expect(created[0].endDate).toBe('2026-06-10');
	});
});

describe('absences +page.server actions.validate / addExternal / removeExternal', () => {
	it('validate refuse un membre USER (réservé admin)', async () => {
		const { workspaceId } = await makeWorkspace('absvalidate2');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absvalidate2-member');
		const locals = await fakeLocals(memberId);
		const result = await actions.validate({ locals, request: formRequest({ id: 'whatever' }) } as never);
		expect(result?.status).toBe(403);
	});

	it('validate refuse aussi un MANAGER — un manager ne valide jamais un congé (super important)', async () => {
		const { workspaceId } = await makeWorkspace('absvalidate3');
		const { userId: managerId } = await addMember(workspaceId, 'MANAGER', 'absvalidate3-manager');
		const locals = await fakeLocals(managerId);
		const result = await actions.validate({ locals, request: formRequest({ id: 'whatever' }) } as never);
		expect(result?.status).toBe(403);
	});

	it('addExternal / removeExternal refusent un USER', async () => {
		const { workspaceId } = await makeWorkspace('absext');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'absext-member');
		const locals = await fakeLocals(memberId);

		const addResult = await actions.addExternal({ locals, request: formRequest({ displayName: 'Ext' }) } as never);
		const removeResult = await actions.removeExternal({ locals, request: formRequest({ id: 'x' }) } as never);

		expect(addResult?.status).toBe(403);
		expect(removeResult?.status).toBe(403);
	});

	it('un ADMIN peut ajouter puis archiver un membre externe', async () => {
		const { userId } = await makeWorkspace('absext2');
		const locals = await fakeLocals(userId);

		const addResult = await actions.addExternal({ locals, request: formRequest({ displayName: 'Externe Test' }) } as never);
		expect(addResult).toEqual({ ok: true });

		const { externalMembers } = await load({ locals, url: new URL('http://localhost/absences') } as never);
		const created = externalMembers.find((m: any) => m.displayName === 'Externe Test');
		expect(created).toBeTruthy();

		const removeResult = await actions.removeExternal({ locals, request: formRequest({ id: created!.id }) } as never);
		expect(removeResult).toEqual({ ok: true });
	});
});
