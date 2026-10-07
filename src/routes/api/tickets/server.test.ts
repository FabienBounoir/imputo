import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { db, ticket } from '$lib/server/db';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('GET /api/tickets', () => {
	it('rejette sans authentification', async () => {
		await expect(
			GET({ locals: emptyLocals, url: new URL('http://x/api/tickets') } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('renvoie les tickets de son espace', async () => {
		const { userId, workspaceId } = await makeWorkspace('tickets-list');
		await createTicket(workspaceId, { key: 'LIST-1', title: 'Ticket' });

		const locals = await fakeLocals(userId);
		const res = await GET({ locals, url: new URL('http://x/api/tickets') } as never);
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.tickets).toHaveLength(1);
	});

	// Scroll infini = suite de la liste affichée : mêmes filtres ET même tri que la page. Le tri
	// n'était pas transmis, la page 2 revenait dans l'ordre par défaut (doublons à l'écran).
	it('applique le tri et le filtre « assigné à » de l’URL', async () => {
		const { userId, workspaceId } = await makeWorkspace('tickets-list-url');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'tickets-list-url-other');
		await db.insert(ticket).values([
			{ workspaceId, key: 'URL-0', title: 'Le plus ancien, à personne', createdAt: new Date('2025-12-01T00:00:00Z') },
			{ workspaceId, key: 'URL-1', title: 'Ancien, à moi', assigneeId: userId, createdAt: new Date('2026-01-01T00:00:00Z') },
			{ workspaceId, key: 'URL-2', title: 'À un autre', assigneeId: otherId, createdAt: new Date('2026-02-01T00:00:00Z') },
			{ workspaceId, key: 'URL-3', title: 'Récent, à moi', assigneeId: userId, createdAt: new Date('2026-03-01T00:00:00Z') }
		]);
		const locals = await fakeLocals(userId);
		const keys = async (search: string) => {
			const res = await GET({ locals, url: new URL(`http://x/api/tickets${search}`) } as never);
			return (await res.json()).tickets.map((t: { key: string }) => t.key);
		};

		expect(await keys('?sort=created_desc')).toEqual(['URL-3', 'URL-2', 'URL-1', 'URL-0']);
		expect(await keys('?assignee=me')).toEqual(['URL-1', 'URL-3']);
		expect(await keys(`?assignee=${otherId}`)).toEqual(['URL-2']);
		expect(await keys('?assignee=none')).toEqual(['URL-0']);
		// Valeur qui n'est pas un uuid : ignorée, pas d'erreur Postgres.
		expect(await keys('?assignee=nimporte')).toHaveLength(4);
	});
});
