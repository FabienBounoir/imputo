import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember, defaultPerimeterId } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { createPerimeter } from '$lib/server/services/perimeters';

const call = async (locals: unknown, search: string) =>
	GET({ locals, url: new URL(`http://localhost/api/tickets/search${search}`) } as never);

describe('GET /api/tickets/search', () => {
	it('rejette un appel non authentifié', async () => {
		await expect(call({ workspace: null, user: null }, '?q=abc')).rejects.toMatchObject({ status: 401 });
	});

	it('ne renvoie rien sous 2 caractères — la liste d’amorce vient déjà du load de la page', async () => {
		const { userId, workspaceId } = await makeWorkspace('api-search-min');
		await createTicket(workspaceId, { key: 'API-1', title: 'Trouvable' });
		const locals = await fakeLocals(userId);

		for (const q of ['', 'a', ' a ']) {
			const res = await call(locals, `?q=${encodeURIComponent(q)}`);
			expect((await res.json()).tickets, `q="${q}"`).toEqual([]);
		}
	});

	it('renvoie exactement id/clé/titre/sprint/version/périmètre — la forme dont les sélecteurs ont besoin', async () => {
		const { userId, workspaceId } = await makeWorkspace('api-search-shape');
		const t = await createTicket(workspaceId, { key: 'API-2', title: 'Recherche serveur' });
		const res = await call(await fakeLocals(userId), '?q=recherche');

		const { tickets } = await res.json();
		expect(tickets).toHaveLength(1);
		expect(tickets[0]).toEqual({
			id: t.id,
			key: 'API-2',
			title: 'Recherche serveur',
			sprintId: null,
			versionId: null,
			sprintName: null,
			perimeterId: await defaultPerimeterId(workspaceId),
			perimeterName: expect.any(String),
			perimeterColor: null,
			perimeterTransverse: false,
			perimeterSortOrder: 0
		});
	});

	it('filtre par périmètre, même sans texte — le filtre de la palette « + Ajouter » montre tout le périmètre', async () => {
		const { userId, workspaceId } = await makeWorkspace('api-search-perim');
		const mobileId = await createPerimeter(workspaceId, 'Mobile', null, false);
		await createTicket(workspaceId, { key: 'PER-WEB', title: 'Web' });
		await createTicket(workspaceId, { key: 'PER-MOB', title: 'Mobile', perimeterId: mobileId });

		const res = await call(await fakeLocals(userId), `?perimeter=${mobileId}`);
		expect((await res.json()).tickets.map((t: { key: string }) => t.key)).toEqual(['PER-MOB']);
	});

	it('un simple membre y a accès : ces champs sont déjà visibles partout ailleurs', async () => {
		const { workspaceId } = await makeWorkspace('api-search-role');
		const { userId: membreId } = await addMember(workspaceId, 'USER', 'api-search-user');
		await createTicket(workspaceId, { key: 'API-3', title: 'Visible' });

		const res = await call(await fakeLocals(membreId), '?q=visible');
		expect((await res.json()).tickets).toHaveLength(1);
	});

	it('ne fuit jamais les tickets d’un autre espace', async () => {
		const a = await makeWorkspace('api-search-a');
		const b = await makeWorkspace('api-search-b');
		await createTicket(a.workspaceId, { key: 'FUITE', title: 'Chez A' });

		const res = await call(await fakeLocals(b.userId), '?q=fuite');
		expect((await res.json()).tickets).toEqual([]);
	});
});
