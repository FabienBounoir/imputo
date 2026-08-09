import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';
import { createRef, setRefArchived, listRefs } from '$lib/server/services/referentials';

describe('dashboard/version +page.server load', () => {
	it('trie les versions actives par nom', async () => {
		const { userId, workspaceId } = await makeWorkspace('dashversion');
		await createRef(workspaceId, 'version', 'v2.0');
		await createRef(workspaceId, 'version', 'v1.0');
		const locals = await fakeLocals(userId);

		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard/version'),
			cookies: fakeCookies()
		} as never);

		expect(result.options.map((o: any) => o.name)).toEqual(['v1.0', 'v2.0']);
	});

	it("si toutes les versions sont archivées, retombe sur la liste complète plutôt que vide", async () => {
		const { userId, workspaceId } = await makeWorkspace('dashversion');
		await createRef(workspaceId, 'version', 'v1.0-archived');
		const v = (await listRefs(workspaceId, 'version')).find((r) => r.name === 'v1.0-archived')!;
		await setRefArchived(workspaceId, 'version', v.id, true);
		const locals = await fakeLocals(userId);

		const result = await load({
			locals,
			url: new URL('http://localhost/dashboard/version'),
			cookies: fakeCookies()
		} as never);

		expect(result.options.map((o: any) => o.id)).toContain(v.id);
	});
});
