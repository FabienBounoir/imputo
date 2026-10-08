import { describe, it, expect } from 'vitest';
import { load as loadUntyped, actions } from './+page.server';
// `load` peut renvoyer `void` côté types (branches sans retour explicite) ; en pratique il
// renvoie toujours des données ici, donc on retype pour éviter un cast répété à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { db, project, sprint, ticket, activity, ticketActivityRae } from '$lib/server/db';
import {
	setTicketFiltersSnapshot,
	setRememberTicketFiltersPref,
	setRememberTicketSearchPref,
	setCompactTicketActivityPref
} from '$lib/server/services/accounts';

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
			versionId: null,
			sort: 'created'
		});

		await expect(load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining(`project=${p.id}`)
		});
	});

	it('le filtre « assigné à » est mémorisé : `me` et `none` partout, un collègue seulement dans son espace', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const { userId: colleagueId } = await addMember(workspaceId, 'USER', 'ticketsremember-colleague');
		const { userId: strangerId } = await makeWorkspace('ticketsremember-ailleurs');
		const arrive = async (assignee: string) => {
			await setTicketFiltersSnapshot(userId, { view: 'table', query: null, stateId: null, projectId: null, sprintId: null, versionId: null, assignee, sort: 'priority' });
			return load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		};

		await expect(arrive('me')).rejects.toMatchObject({ status: 303, location: expect.stringContaining('assignee=me') });
		await expect(arrive('none')).rejects.toMatchObject({ status: 303, location: expect.stringContaining('assignee=none') });
		await expect(arrive(colleagueId)).rejects.toMatchObject({ status: 303, location: expect.stringContaining(`assignee=${colleagueId}`) });
		// Hors de l'espace courant : ignoré, comme un état/projet d'un autre espace (pas de « 0 résultat » muet).
		await expect(arrive(strangerId)).rejects.toMatchObject({ status: 303, location: expect.not.stringContaining('assignee') });
	});

	it('le tri "priorité" est mémorisé et réappliqué à une arrivée à blanc', async () => {
		const { userId } = await makeWorkspace('ticketssort');
		await setTicketFiltersSnapshot(userId, {
			view: 'table',
			query: null,
			stateId: null,
			projectId: null,
			sprintId: null,
			versionId: null,
			sort: 'priority'
		});

		// Seul le tri est mémorisé : la redirection doit quand même avoir lieu, c'est un choix
		// d'affichage à part entière.
		await expect(load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('sort=priority')
		});
	});

	it('le tri par défaut (création) ne provoque aucune redirection à lui seul', async () => {
		const { userId } = await makeWorkspace('ticketssortdef');
		await setTicketFiltersSnapshot(userId, {
			view: 'table',
			query: null,
			stateId: null,
			projectId: null,
			sprintId: null,
			versionId: null,
			sort: 'created'
		});

		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		expect(result.sort).toBe('created');
	});

	it('un instantané enregistré avant l’ajout du tri reste valide (sort absent → création)', async () => {
		const { parseTicketFiltersSnapshot } = await import('$lib/server/services/tickets');
		const ancien = JSON.stringify({ view: 'table', query: null, stateId: null, projectId: null, sprintId: null, versionId: null });
		expect(parseTicketFiltersSnapshot(ancien)).toMatchObject({ sort: 'created' });
	});

	it('remember=false → aucune redirection même avec un snapshot valide', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, { view: 'table', query: null, stateId: null, projectId: p.id, sprintId: null, versionId: null, sort: 'created' });
		await setRememberTicketFiltersPref(userId, false);

		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets') } as never);
		expect(result.filters).toMatchObject({ query: undefined, stateId: undefined, projectId: undefined });
	});

	it('rememberSearch=false → la recherche du snapshot est ignorée à la redirection, mais les autres filtres restent', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketsremember');
		const [p] = await db.insert(project).values({ workspaceId, name: 'Projet A' }).returning({ id: project.id });
		await setTicketFiltersSnapshot(userId, { view: 'table', query: 'US-42', stateId: null, projectId: p.id, sprintId: null, versionId: null, sort: 'created' });
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
			versionId: null,
			sort: 'created'
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
		await setTicketFiltersSnapshot(userId, { view: 'table', query: null, stateId: null, projectId: p.id, sprintId: null, versionId: null, sort: 'created' });

		const result = await load({ locals: await fakeLocals(userId), url: new URL('http://localhost/tickets?page=2') } as never);
		expect(result.filters.projectId).toBeUndefined();
	});

	it('actions.rememberFilters mémorise le tri, et pas seulement les filtres', async () => {
		const { userId } = await makeWorkspace('ticketsortremember');
		const locals = await fakeLocals(userId);

		// Le bug d'origine : le POST du client n'envoyait pas `sort`, donc le tri repartait au défaut
		// à chaque arrivée à blanc alors que les autres filtres tenaient.
		await actions.rememberFilters({ locals, request: formRequest({ view: 'table', sort: 'priority_desc' }) } as never);

		await expect(load({ locals, url: new URL('http://localhost/tickets') } as never)).rejects.toMatchObject({
			status: 303,
			location: expect.stringContaining('sort=priority_desc')
		});
	});

	it('actions.rememberFilters ramène un tri inconnu sur le défaut (pas d’URL bricolée mémorisée)', async () => {
		const { userId } = await makeWorkspace('ticketsortbogus');
		const locals = await fakeLocals(userId);
		await actions.rememberFilters({ locals, request: formRequest({ view: 'table', sort: 'nimporte-quoi' }) } as never);

		// Rien d'autre de mémorisé et tri au défaut : aucune redirection à faire.
		const result = await load({ locals, url: new URL('http://localhost/tickets') } as never);
		expect(result.sort).toBe('created');
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
	it('load renvoie ticketFilterLabels : icônes seules par défaut, noms affichés une fois le réglage activé', async () => {
		const { userId } = await makeWorkspace('ticketslabels');
		const url = new URL('http://localhost/tickets?page=1');
		expect((await load({ locals: await fakeLocals(userId), url } as never)).ticketFilterLabels).toBe(false);

		const { actions: settingsActions } = await import('../settings/+page.server');
		await settingsActions.ticketFilterLabelsPref({ request: formRequest({ value: 'true' }), locals: await fakeLocals(userId) } as never);
		expect((await load({ locals: await fakeLocals(userId), url } as never)).ticketFilterLabels).toBe(true);
	});

	// Le board kanban se charge sans pagination : le détail par activité n'y est joint que déplié.
	it('kanban : le détail par activité n’est chargé que si la préférence est « déplié »', async () => {
		const { userId, workspaceId } = await makeWorkspace('ticketskanbandetail');
		const [sp] = await db.insert(sprint).values({ workspaceId, name: 'Sprint K' }).returning({ id: sprint.id });
		const [tk] = await db.insert(ticket).values({ workspaceId, key: 'KAN-1', title: 'Carte', sprintId: sp.id }).returning({ id: ticket.id });
		const [act] = await db.insert(activity).values({ workspaceId, label: 'Recette kanban' }).returning({ id: activity.id });
		await db.insert(ticketActivityRae).values({ ticketId: tk.id, activityId: act.id, raeReal: '1', estimation: '2' });
		const url = new URL(`http://localhost/tickets?view=kanban&sprint=${sp.id}`);
		const breakdown = async () => (await (await load({ locals: await fakeLocals(userId), url } as never)).ticketsPage).tickets[0].activityBreakdown;

		expect(await breakdown()).toEqual([]);
		await setCompactTicketActivityPref(userId, false);
		expect(await breakdown()).toMatchObject([{ label: 'Recette kanban', raeReal: 1, estimation: 2 }]);
	});

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
