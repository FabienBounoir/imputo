import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';

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
});
