import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';

describe('admin/history load', () => {
	it("ADMIN charge la page d'historique", async () => {
		const { userId } = await makeWorkspace('hist1');
		const locals = await fakeLocals(userId);
		const res = await load({ locals } as never);
		expect(res.entries).toBeInstanceOf(Array);
	});

	it('un rôle USER est redirigé vers /imputation', async () => {
		const { workspaceId } = await makeWorkspace('hist2');
		const { userId } = await addMember(workspaceId, 'USER', 'hist2-user');
		const locals = await fakeLocals(userId);
		await expect(load({ locals } as never)).rejects.toMatchObject({ status: 303, location: '/imputation' });
	});
});
