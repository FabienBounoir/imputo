import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { db, project } from '$lib/server/db';
import { setTicketFiltersSnapshot, setRememberTicketFiltersPref, setRememberTicketSearchPref } from '$lib/server/services/accounts';

describe('tickets +page.server load', () => {
	it('isAdmin/canEditEstimation sont false pour un USER, true pour un ADMIN', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsload');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'ticketsload-member');
		const url = new URL('http://localhost/tickets');

		const memberResult = await load({ locals: await fakeLocals(memberId), url } as never);
		const adminResult = await load({ locals: await fakeLocals(userId), url } as never);

		expect(memberResult.isAdmin).toBe(false);
		expect(memberResult.canEditEstimation).toBe(false);
		expect(adminResult.isAdmin).toBe(true);
		expect(adminResult.canEditEstimation).toBe(true);
	});

	it('vue kanban par défaut sans pagination, vue table paginée', async () => {
		const { userId } = await makeWorkspace('ticketsload');
		const locals = await fakeLocals(userId);

		const kanban = await load({ locals, url: new URL('http://localhost/tickets?view=kanban') } as never);
		const table = await load({ locals, url: new URL('http://localhost/tickets') } as never);

		expect(kanban.view).toBe('kanban');
		expect((await kanban.ticketsPage).pageCount).toBe(1);
		expect(table.view).toBe('table');
		expect(table.pageSize).toBe(50);
	});
});

describe('tickets +page.server load — mémorisation des filtres (arrivée à blanc)', () => {
	it('URL vide + snapshot valide (remember=true par défaut) → redirect vers les filtres mémorisés', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, {
			view: 'kanban',
			query: null,
			stateId: null,
			projectId: p.id,
			sprintId: null,
			versionId: null
		});

		await expect(load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining(`project=${p.id}`)
		});
	});

	it('remember=false → aucune redirection même avec un snapshot valide', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, { view: 'table', query: null, stateId: null, projectId: p.id, sprintId: null, versionId: null });
		await setRememberTicketFiltersPref(userId, false);

		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		expect(result.filters).toMatchObject({ query: undefined, stateId: undefined, projectId: undefined });
	});

	it('rememberSearch=false → la recherche du snapshot est ignorée à la redirection, mais les autres filtres restent', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, { view: 'table', query: 'US-42', stateId: null, projectId: p.id, sprintId: null, versionId: null });
		await setRememberTicketSearchPref(userId, false);

		await expect(load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining(`project=${p.id}`)
		});
		try {
			await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		} catch (e: any) {
			expect(e.location).not.toContain('q=');
		}
	});

	it('projectId du snapshot appartenant à un autre espace → ignoré, jamais réinjecté dans la redirection', async () => {
		const { userId } = await makeWorkspace('ticketsremember');
		const { workspaceId: otherWorkspaceId } = await makeWorkspace('ticketsremember-other');
		const [foreignProject] = await db.insert(project).values({ workspaceId: otherWorkspaceId, name: 'Projet étranger' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, {
			view: 'table',
			query: 'US-42',
			stateId: null,
			projectId: foreignProject.id,
			sprintId: null,
			versionId: null
		});

		// query, elle, n'est pas validable contre ref (texte libre) — elle survit donc à la redirection.
		await expect(load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('q=US-42')
		});
		try {
			await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		} catch (e: any) {
			expect(e.location).not.toContain('project=');
		}
	});

	it('URL déjà paramétrée → jamais de redirection, même avec un snapshot valide', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, { view: 'table', query: null, stateId: null, projectId: p.id, sprintId: null, versionId: null });

		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets?page=2') } as never);
		expect(result.filters.projectId).toBeUndefined();
	});

	it("actions.rememberFilters puis arrivée à blanc → redirige vers ce qui vient d'être posté", async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		const locals = await fakeLocals(userId);

		await actions.rememberFilters({ locals, request: formRequest({ view: 'table', project: p.id }) } as never);

		await expect(load({ locals, url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining(`project=${p.id}`)
		});
	});

	it('un "reset" (view seule postée) efface le snapshot — plus de redirection ensuite', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		const locals = await fakeLocals(userId);

		await actions.rememberFilters({ locals, request: formRequest({ view: 'table', project: p.id }) } as never);
		await actions.rememberFilters({ locals, request: formRequest({ view: 'table' }) } as never); // ce que poste resetFilters()

		const result = await load({ locals, url: new URL('http://localhost/tickets') } as never);
		expect(result.filters.projectId).toBeUndefined();
	});
});

describe('tickets +page.server actions.create', () => {
	it('rejette une clé/titre manquants', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);
		const result = await actions.create({ locals, request: formRequest({}) } as never);
		expect(result?.status).toBe(400);
	});

	it('ignore silencieusement estimationPrev/enveloppeTotale soumis par un USER', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketscreate');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'ticketscreate-member');
		const locals = await fakeLocals(memberId);

		const result = await actions.create({
			locals,
			request: formRequest({
				key: `TCU-${Date.now()}`,
				title: 'Ticket USER',
				estimationPrev: '100',
				enveloppeTotale: '200'
			})
		} as never);

		expect(result).toEqual({ ok: true, id: expect.any(String) });

		const table = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		const { tickets } = await table.ticketsPage;
		const created = tickets.find((t: any) => t.title === 'Ticket USER');
		expect(created?.estimationPrev ?? null).toBeNull();
	});

	it('un ADMIN peut poser estimationPrev/enveloppeTotale', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);

		const result = await actions.create({
			locals,
			request: formRequest({
				key: `TCA-${Date.now()}`,
				title: 'Ticket ADMIN',
				estimationPrev: '100',
				enveloppeTotale: '200'
			})
		} as never);

		expect(result).toEqual({ ok: true, id: expect.any(String) });
	});

	it('refuse une clé dupliquée', async () => {
		const { userId } = await makeWorkspace('ticketscreate');
		const locals = await fakeLocals(userId);
		const key = `TCD-${Date.now()}`;
		await actions.create({ locals, request: formRequest({ key, title: 'Premier' }) } as never);
		const result = await actions.create({ locals, request: formRequest({ key, title: 'Doublon' }) } as never);
		expect(result?.status).toBe(400);
	});
});

describe('tickets +page.server actions.groupToggle / actions.flag', () => {
	it('groupToggle refuse sans authentification', async () => {
		const result = await actions.groupToggle({
			locals: { workspace: null },
			request: formRequest({ ticketId: 'x', groupId: 'y', member: 'true' })
		} as never);
		expect(result?.status).toBe(401);
	});

	it('flag refuse sans authentification', async () => {
		const result = await actions.flag({
			locals: { workspace: null },
			request: formRequest({ ticketId: 'x', key: 'cypress', value: 'Oui' })
		} as never);
		expect(result?.status).toBe(401);
	});
});

describe('tickets +page.server — préférence "détail par activité"', () => {
	it('load renvoie compactTicketActivity (true par défaut sur un compte neuf)', async () => {
		const { userId } = await makeWorkspace('ticketscompact');
		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets?view=table') } as never);
		expect(result.compactTicketActivity).toBe(true);
	});

	it('actions.compactActivityPref met à jour la préférence, 401 si non authentifié', async () => {
		const { userId } = await makeWorkspace('ticketscompact');
		const locals = await fakeLocals(userId);

		const res = await actions.compactActivityPref({ locals, request: formRequest({ value: 'false' }) } as never);
		expect(res).toEqual({ ok: true });

		const result = await load({ locals, url: new URL('http://localhost/tickets?view=table') } as never);
		expect(result.compactTicketActivity).toBe(false);

		const unauth = await actions.compactActivityPref({ locals: { user: null }, request: formRequest({ value: 'true' }) } as never);
		expect(unauth?.status).toBe(401);
	});
});
