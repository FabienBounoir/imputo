import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';
import { setMemberFactice } from '$lib/server/services/accounts';
import { createTicket } from '$lib/server/services/tickets';
import { setCell } from '$lib/server/services/imputation';

function currentMonthValue() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

describe('dashboard +page.server load', () => {
	it('sans param month, retombe sur le mois courant', async () => {
		const { userId } = await makeWorkspace('dash');
		const locals = await fakeLocals(userId);
		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard'),
			cookies: fakeCookies()
		} as never);
		expect(result.scope).toBe(currentMonthValue());
		expect(result.months[0].value).toBe(currentMonthValue());
	});

	it("avec ?month=all, bascule en vue 'Tout l'espace'", async () => {
		const { userId } = await makeWorkspace('dash');
		const locals = await fakeLocals(userId);
		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard?month=all'),
			cookies: fakeCookies()
		} as never);
		expect(result.scope).toBe('all');
	});

	it('avec un mois hors liste, retombe sur le mois courant plutôt que planter', async () => {
		const { userId } = await makeWorkspace('dash');
		const locals = await fakeLocals(userId);
		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard?month=1999-01'),
			cookies: fakeCookies()
		} as never);
		expect(result.scope).toBe(currentMonthValue());
	});

	it('isAdmin reflète le rôle, et un membre "factice" est exclu de byPerson/bySsp pour un non-admin', async () => {
		const { userId: adminId, workspaceId } = await makeWorkspace('dashload-factice');
		const { userId: viewerId } = await addMember(workspaceId, 'USER', 'dashload-factice-viewer');
		const { userId: facticeId } = await addMember(workspaceId, 'USER', 'dashload-factice-dummy');
		await setMemberFactice(workspaceId, facticeId, true);
		const t = await createTicket(workspaceId, { key: `DL-${workspaceId.slice(0, 8)}`, title: 'Ticket' });
		await setCell(workspaceId, facticeId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 3 });

		// byPerson/bySsp restent filtrés quel que soit le scope ("Tout l'espace" ici) — contrairement à
		// kpis.consumedTotal, qui en mode "Tout l'espace" dérive du chiffrage ticket (sans notion de
		// personne, cf. dashboard.test.ts) et n'est donc pas un bon terrain pour cette assertion.
		const url = new URL('http://localhost/dashboard?month=all');

		const asAdmin = await load({ locals: await fakeLocals(adminId), url, cookies: fakeCookies() } as never);
		expect(asAdmin.isAdmin).toBe(true);
		expect(asAdmin.dashboard.byPerson.some((p: { name: string }) => p.name === 'dashload-factice-dummy')).toBe(true);

		const asViewer = await load({ locals: await fakeLocals(viewerId), url, cookies: fakeCookies() } as never);
		expect(asViewer.isAdmin).toBe(false);
		expect(asViewer.dashboard.byPerson.some((p: { name: string }) => p.name === 'dashload-factice-dummy')).toBe(false);
	});
});
