import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember, grantCapability } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { getTimesheet } from '$lib/server/services/imputation';
import { setMemberFactice } from '$lib/server/services/accounts';

describe('imputation +page.server load', () => {
	it("redirige vers /register si l'utilisateur n'a pas d'espace courant", async () => {
		const { userId } = await makeWorkspace('imputload');
		const locals = { ...(await fakeLocals(userId)), workspace: null };
		await expect(load({ locals, url: new URL('http://localhost/imputation'), cookies: undefined } as never)).rejects.toMatchObject(
			{ status: 303, location: '/register' }
		);
	});

	it("un ADMIN peut consulter et éditer l'imputation d'un autre membre via ?u=", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('imputload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputload-member');
		const locals = await fakeLocals(adminId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/imputation?u=${memberId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);

		expect(result.viewedId).toBe(memberId);
		expect(result.viewingOther).toBe(true);
		expect(result.readOnly).toBe(false);
	});

	it("un USER ne peut pas basculer sur ?u= (reste sur sa propre feuille)", async () => {
		const { workspaceId } = await makeWorkspace('imputload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputload-member2');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'imputload-member3');
		const locals = await fakeLocals(memberId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/imputation?u=${otherId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);

		expect(result.viewedId).toBe(memberId);
		expect(result.readOnly).toBe(false);
	});

	it("un USER avec canViewImputations peut consulter (lecture seule) l'imputation d'un autre membre via ?u=", async () => {
		const { workspaceId } = await makeWorkspace('imputview');
		const { userId: viewerId } = await addMember(workspaceId, 'USER', 'imputview-viewer');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputview-member');
		await grantCapability(workspaceId, viewerId, 'canViewImputations');
		const locals = await fakeLocals(viewerId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/imputation?u=${memberId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);

		expect(result.viewedId).toBe(memberId);
		expect(result.viewingOther).toBe(true);
		expect(result.readOnly).toBe(true);
	});

	it('un membre "factice" est visible pour un ADMIN mais absent du sélecteur pour un non-admin', async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('imputfactice');
		const { userId: viewerId } = await addMember(workspaceId, 'USER', 'imputfactice-viewer');
		await grantCapability(workspaceId, viewerId, 'canViewImputations');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'imputfactice-dummy');
		await setMemberFactice(workspaceId, facticeId, true);

		const asAdmin = await load({
			locals: await fakeLocals(adminId),
			url: new URL('http://localhost/imputation'),
			cookies: { get: () => undefined, set: () => {} }
		} as never);
		expect(asAdmin.members.map((m: { id: string }) => m.id)).toContain(facticeId);

		const asViewer = await load({
			locals: await fakeLocals(viewerId),
			url: new URL('http://localhost/imputation'),
			cookies: { get: () => undefined, set: () => {} }
		} as never);
		expect(asViewer.members.map((m: { id: string }) => m.id)).not.toContain(facticeId);

		// Contournement direct de l'URL bloqué aussi : le non-admin retombe sur sa propre feuille.
		const bypassAttempt = await load({
			locals: await fakeLocals(viewerId),
			url: new URL(`http://localhost/imputation?u=${facticeId}`),
			cookies: { get: () => undefined, set: () => {} }
		} as never);
		expect(bypassAttempt.viewedId).toBe(viewerId);
	});
});

describe('imputation +page.server actions — édition par un admin', () => {
	it("un ADMIN peut imputer sur la feuille d'un autre membre via targetUserId", async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('imputadmin');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputadmin-member');
		const ticket = await createTicket(workspaceId, { key: `IMA-${Date.now()}`, title: 'Ticket imputable' });
		const locals = await fakeLocals(adminId);

		const result = await actions.setCell({
			locals,
			request: formRequest({
				targetType: 'TICKET',
				targetId: ticket.id,
				day: '2026-06-01',
				amount: '1',
				targetUserId: memberId
			})
		} as never);
		expect(result).toEqual({ ok: true });

		const sheet = await getTimesheet(workspaceId, memberId, ['2026-06-01']);
		expect(sheet.rows.some((r) => r.targetId === ticket.id && r.amounts['2026-06-01'] === 1)).toBe(true);
	});

	it("un USER non-admin ne peut pas imputer sur la feuille d'un autre membre", async () => {
		const { workspaceId } = await makeWorkspace('imputnonadmin');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputnonadmin-member');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'imputnonadmin-other');
		const ticket = await createTicket(workspaceId, { key: `IMN-${Date.now()}`, title: 'Ticket imputable' });
		const locals = await fakeLocals(memberId);

		const result = await actions.setCell({
			locals,
			request: formRequest({
				targetType: 'TICKET',
				targetId: ticket.id,
				day: '2026-06-01',
				amount: '1',
				targetUserId: otherId
			})
		} as never);
		expect(result?.status).toBe(403);
	});

	it("canViewImputations donne la lecture mais pas le droit d'imputer sur la feuille d'un autre membre", async () => {
		const { workspaceId } = await makeWorkspace('imputviewedit');
		const { userId: viewerId } = await addMember(workspaceId, 'USER', 'imputviewedit-viewer');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'imputviewedit-member');
		await grantCapability(workspaceId, viewerId, 'canViewImputations');
		const ticket = await createTicket(workspaceId, { key: `IMV-${Date.now()}`, title: 'Ticket imputable' });
		const locals = await fakeLocals(viewerId);

		const result = await actions.setCell({
			locals,
			request: formRequest({
				targetType: 'TICKET',
				targetId: ticket.id,
				day: '2026-06-01',
				amount: '1',
				targetUserId: memberId
			})
		} as never);
		expect(result?.status).toBe(403);
	});
});

describe('imputation +page.server actions.setCell / actions.deleteRow', () => {
	it('setCell rejette un targetType invalide', async () => {
		const { userId } = await makeWorkspace('imputset');
		const locals = await fakeLocals(userId);
		const result = await actions.setCell({
			locals,
			request: formRequest({ targetType: 'BOGUS', targetId: 'x', day: '2026-06-01', amount: '1' })
		} as never);
		expect(result?.status).toBe(400);
	});

	it('setCell impute sur un ticket réel', async () => {
		const { userId, workspaceId } = await makeWorkspace('imputset');
		const ticket = await createTicket(workspaceId, { key: `IMS-${Date.now()}`, title: 'Ticket imputable' });
		const locals = await fakeLocals(userId);

		const result = await actions.setCell({
			locals,
			request: formRequest({ targetType: 'TICKET', targetId: ticket.id, day: '2026-06-01', amount: '1' })
		} as never);

		expect(result).toEqual({ ok: true });
	});

	it('deleteRow rejette des données invalides', async () => {
		const { userId } = await makeWorkspace('imputdel');
		const locals = await fakeLocals(userId);
		const result = await actions.deleteRow({
			locals,
			request: formRequest({ targetType: 'TICKET', targetId: '', anchor: '2026-06-01' })
		} as never);
		expect(result?.status).toBe(400);
	});
});
