import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';
import { createRef, listRefs } from '$lib/server/services/referentials';

describe('dashboard/sprint +page.server load', () => {
	it("sans sprint dans l'espace, options vides et dashboard null", async () => {
		const { userId } = await makeWorkspace('dashsprint');
		const locals = await fakeLocals(userId);
		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard/sprint'),
			cookies: fakeCookies()
		} as never);
		expect(result.options).toEqual([]);
		expect(result.selectedId).toBeNull();
		expect(result.dashboard).toBeNull();
	});

	it('présélectionne le sprint demandé par ?id= et calcule un dashboard', async () => {
		const { userId, workspaceId } = await makeWorkspace('dashsprint');
		await createRef(workspaceId, 'sprint', 'Sprint 1');
		await createRef(workspaceId, 'sprint', 'Sprint 2');
		const s2 = (await listRefs(workspaceId, 'sprint')).find((r) => r.name === 'Sprint 2')!;
		const locals = await fakeLocals(userId);

		const result = await load({
			locals,
			url: new URL(`http://localhost/dashboard/sprint?id=${s2.id}`),
			cookies: fakeCookies()
		} as never);

		expect(result.selectedId).toBe(s2.id);
		expect(result.options.map((o: any) => o.id)).toContain(s2.id);
		expect(result.dashboard).not.toBeNull();
	});

	it('isAdmin (rôle) redige le budget TNF pour un USER, le montre pour un ADMIN', async () => {
		const { userId, workspaceId } = await makeWorkspace('dashsprint');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'dashsprint-member');
		await createRef(workspaceId, 'sprint', 'Sprint A');
		const cookies = fakeCookies();
		const url = new URL('http://localhost/dashboard/sprint');

		const memberResult = await load({ locals: await fakeLocals(memberId), url, cookies } as never);
		const adminResult = await load({ locals: await fakeLocals(userId), url, cookies } as never);

		expect(memberResult.dashboard?.kpis.ecartVsBudgetTotal).toBeNull();
		expect(adminResult.dashboard?.kpis.ecartVsBudgetTotal).not.toBeNull();
	});
});
