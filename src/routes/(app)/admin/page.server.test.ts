import { describe, it, expect } from 'vitest';
import { actions } from './+page.server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { getJiraConfig } from '$lib/server/services/accounts';

// Toutes ces actions (sauf transferOwnership, gardée par le statut owner et testée séparément)
// partagent la même garde `locals.role !== 'ADMIN'` -> fail(403). On le vérifie une seule fois
// pour toutes plutôt que de dupliquer le même test 25 fois.
const ROLE_GATED_ACTIONS = Object.keys(actions).filter((k) => k !== 'transferOwnership');

describe('admin actions: garde ADMIN', () => {
	it.each(ROLE_GATED_ACTIONS)("l'action '%s' refuse un rôle USER (403)", async (key) => {
		const { workspaceId } = await makeWorkspace('gate');
		const { userId } = await addMember(workspaceId, 'USER', 'gate-user');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({}) };
		const res = await (actions as Record<string, (e: unknown) => unknown>)[key](event);
		expect((res as { status?: number })?.status).toBe(403);
	});
});

describe('admin invite', () => {
	it('ADMIN invite un membre -> renvoie le message d’invitation', async () => {
		const { userId } = await makeWorkspace('inv1');
		const locals = await fakeLocals(userId);
		const event = {
			locals,
			request: formRequest({ displayName: 'Nouveau', email: 'nouveau@acme.test', role: 'USER' })
		};
		const res = await actions.invite(event as never);
		expect(res).toHaveProperty('invite');
	});

	it('email invalide -> fail 400', async () => {
		const { userId } = await makeWorkspace('inv2');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ displayName: 'X', email: 'pas-un-email', role: 'USER' }) };
		const res = await actions.invite(event as never);
		expect(res?.status).toBe(400);
	});
});

describe('admin accent', () => {
	it("ADMIN met à jour l'accent de l'espace", async () => {
		const { userId } = await makeWorkspace('accent1');
		const locals = await fakeLocals(userId);
		const event = { locals, request: formRequest({ color: '#112233', rgb: 'false' }) };
		const res = await actions.accent(event as never);
		expect(res).toEqual({ accentOk: true });
	});
});

describe('admin refCreate / refRename / refArchive', () => {
	it('crée, renomme puis archive un projet', async () => {
		const { userId } = await makeWorkspace('ref1');
		const locals = await fakeLocals(userId);

		const createRes = await actions.refCreate({
			locals,
			request: formRequest({ type: 'project', name: 'Projet Alpha' })
		} as never);
		expect(createRes).toEqual({ refOk: 'project' });

		// Retrouve l'id créé pour renommer/archiver.
		const { listRefs } = await import('$lib/server/services/referentials');
		const ws = locals.workspace!;
		const [proj] = await listRefs(ws.workspaceId, 'project');

		const renameRes = await actions.refRename({
			locals,
			request: formRequest({ type: 'project', id: proj.id, name: 'Projet Alpha Renommé' })
		} as never);
		expect(renameRes).toEqual({ refOk: 'project' });

		const archiveRes = await actions.refArchive({
			locals,
			request: formRequest({ type: 'project', id: proj.id, archived: 'true' })
		} as never);
		expect(archiveRes).toEqual({ refOk: 'project' });
	});

	it('nom vide -> fail 400', async () => {
		const { userId } = await makeWorkspace('ref2');
		const locals = await fakeLocals(userId);
		const res = await actions.refCreate({
			locals,
			request: formRequest({ type: 'project', name: '' })
		} as never);
		expect(res?.status).toBe(400);
	});
});

describe('admin catCreate / catKind / catArchive', () => {
	it('crée une catégorie, change son kind puis l’archive', async () => {
		const { userId } = await makeWorkspace('cat1');
		const locals = await fakeLocals(userId);

		const createRes = await actions.catCreate({
			locals,
			request: formRequest({ label: 'Astreinte QA', kind: 'PRODUCTIVE' })
		} as never);
		expect(createRes).toEqual({ catOk: true });

		const { listCategories } = await import('$lib/server/services/params');
		const ws = locals.workspace!;
		const cats = await listCategories(ws.workspaceId);
		const cat = cats.find((c) => c.label === 'Astreinte QA')!;

		const kindRes = await actions.catKind({
			locals,
			request: formRequest({ id: cat.id, kind: 'NON_PRODUCTIVE' })
		} as never);
		expect(kindRes).toEqual({ catOk: true });

		const archiveRes = await actions.catArchive({
			locals,
			request: formRequest({ id: cat.id, archived: 'true' })
		} as never);
		expect(archiveRes).toEqual({ catOk: true });
	});
});

describe('admin actCreate / actActive / actDelete', () => {
	it('crée une activité, la désactive puis la supprime (inutilisée)', async () => {
		const { userId } = await makeWorkspace('act1');
		const locals = await fakeLocals(userId);

		await actions.actCreate({ locals, request: formRequest({ label: 'Veille techno' }) } as never);

		const { listActivities } = await import('$lib/server/services/params');
		const ws = locals.workspace!;
		const acts = await listActivities(ws.workspaceId);
		const act = acts.find((a) => a.label === 'Veille techno')!;

		const activeRes = await actions.actActive({
			locals,
			request: formRequest({ id: act.id, active: 'false' })
		} as never);
		expect(activeRes).toEqual({ actOk: true });

		const deleteRes = await actions.actDelete({ locals, request: formRequest({ id: act.id }) } as never);
		expect(deleteRes).toEqual({ actOk: true });
	});
});

describe('admin stateCreate / stateMove / stateDelete', () => {
	it('crée un état, le déplace puis le supprime', async () => {
		const { userId } = await makeWorkspace('state1');
		const locals = await fakeLocals(userId);

		await actions.stateCreate({
			locals,
			request: formRequest({ label: 'En revue', emoji: '👀', color: '#94A3B8' })
		} as never);

		const { listStates } = await import('$lib/server/services/params');
		const ws = locals.workspace!;
		const states = await listStates(ws.workspaceId);
		const st = states.find((s) => s.label === 'En revue')!;

		const moveRes = await actions.stateMove({
			locals,
			request: formRequest({ id: st.id, dir: 'up' })
		} as never);
		expect(moveRes).toEqual({ stateOk: true });

		const deleteRes = await actions.stateDelete({ locals, request: formRequest({ id: st.id }) } as never);
		expect(deleteRes).toEqual({ stateOk: true });
	});
});

describe('admin groupCreate / groupRename / groupArchive', () => {
	it('crée un groupe de tickets, le renomme puis l’archive', async () => {
		const { userId } = await makeWorkspace('group1');
		const locals = await fakeLocals(userId);

		await actions.groupCreate({ locals, request: formRequest({ label: 'Lot 1' }) } as never);

		const { listTicketGroups } = await import('$lib/server/services/ticketGroups');
		const ws = locals.workspace!;
		const groups = await listTicketGroups(ws.workspaceId);
		const group = groups.find((g) => g.label === 'Lot 1')!;

		const renameRes = await actions.groupRename({
			locals,
			request: formRequest({ id: group.id, label: 'Lot 1 renommé' })
		} as never);
		expect(renameRes).toEqual({ groupOk: true });

		const archiveRes = await actions.groupArchive({
			locals,
			request: formRequest({ id: group.id, archived: 'true' })
		} as never);
		expect(archiveRes).toEqual({ groupOk: true });
	});
});

describe('admin memberRole / memberActive : garde-fous sur soi-même', () => {
	it('un ADMIN ne peut pas changer son propre rôle', async () => {
		const { userId } = await makeWorkspace('self1');
		const locals = await fakeLocals(userId);
		const res = await actions.memberRole({
			locals,
			request: formRequest({ userId, role: 'USER' })
		} as never);
		expect(res?.status).toBe(400);
	});

	it('un ADMIN ne peut pas se désactiver lui-même', async () => {
		const { userId } = await makeWorkspace('self2');
		const locals = await fakeLocals(userId);
		const res = await actions.memberActive({
			locals,
			request: formRequest({ userId, active: 'false' })
		} as never);
		expect(res?.status).toBe(400);
	});

	it("un ADMIN peut changer le rôle d'un autre membre", async () => {
		const { userId, workspaceId } = await makeWorkspace('other1');
		const { userId: otherId } = await addMember(workspaceId, 'USER', 'other1-member');
		const locals = await fakeLocals(userId);
		const res = await actions.memberRole({
			locals,
			request: formRequest({ userId: otherId, role: 'MANAGER' })
		} as never);
		expect(res).toEqual({ memberOk: true });
	});
});

describe('admin transferOwnership', () => {
	it("réservé au créateur de l'espace (pas juste un ADMIN)", async () => {
		const { workspaceId } = await makeWorkspace('owner1');
		const { userId: adminId } = await addMember(workspaceId, 'ADMIN', 'owner1-admin');
		const locals = await fakeLocals(adminId);
		const res = await actions.transferOwnership({
			locals,
			request: formRequest({ userId: adminId })
		} as never);
		expect(res?.status).toBe(403);
	});

	it('le créateur peut transférer la propriété', async () => {
		const { userId: ownerId, workspaceId } = await makeWorkspace('owner2');
		const { userId: newOwnerId } = await addMember(workspaceId, 'ADMIN', 'owner2-new');
		const locals = await fakeLocals(ownerId);
		const res = await actions.transferOwnership({
			locals,
			request: formRequest({ userId: newOwnerId })
		} as never);
		expect(res).toEqual({ ownerOk: true });
	});
});

describe('admin jiraToggleEnabled / jiraSave / jiraSyncNow', () => {
	it('jiraToggleEnabled bascule le flag de sync planifiée', async () => {
		const { userId } = await makeWorkspace('jira-toggle');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraToggleEnabled({ locals, request: formRequest({ enabled: 'true' }) } as never);
		expect(res).toEqual({ jiraToggleOk: true });
	});

	it('jiraSave sans PAT met à jour jql/stratégie/regex (indépendant de JIRA_PAT_ENCRYPTION_KEY)', async () => {
		const { userId } = await makeWorkspace('jira-save');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSave({
			locals,
			request: formRequest({ jql: 'project = X', conflictStrategy: 'JIRA_WINS', regexPattern: '', regexReplacement: '' })
		} as never);
		expect(res).toEqual({ jiraSaveOk: true });
	});

	it('jiraSave avec une regex invalide -> fail 400', async () => {
		const { userId } = await makeWorkspace('jira-save-badregex');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSave({
			locals,
			request: formRequest({ jql: 'project = X', conflictStrategy: 'KEEP_LOCAL', regexPattern: '(unclosed', regexReplacement: '' })
		} as never);
		expect(res?.status).toBe(400);
	});

	it('jiraSyncNow sur un espace sans PAT/JQL -> fail 400, sans appel réseau', async () => {
		const { userId } = await makeWorkspace('jira-syncnow');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSyncNow({ locals } as never);
		expect(res?.status).toBe(400);
	});

	it('jiraSave transmet updatedSinceDate au service', async () => {
		const { userId, workspaceId } = await makeWorkspace('jira-since');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSave({
			locals,
			request: formRequest({
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				regexPattern: '',
				regexReplacement: '',
				updatedSinceDate: '2026-06-01'
			})
		} as never);
		expect(res).toEqual({ jiraSaveOk: true });
		expect((await getJiraConfig(workspaceId)).updatedSince?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
	});

	it('jiraSave avec une date minimum invalide -> fail 400', async () => {
		const { userId } = await makeWorkspace('jira-since-badval');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSave({
			locals,
			request: formRequest({
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				regexPattern: '',
				regexReplacement: '',
				updatedSinceDate: 'pas-une-date'
			})
		} as never);
		expect(res?.status).toBe(400);
	});

	it('jiraResetUpdatedSince vide la date minimum', async () => {
		const { userId, workspaceId } = await makeWorkspace('jira-reset');
		const locals = await fakeLocals(userId);
		await actions.jiraSave({
			locals,
			request: formRequest({
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				regexPattern: '',
				regexReplacement: '',
				updatedSinceDate: '2026-06-01'
			})
		} as never);

		const res = await actions.jiraResetUpdatedSince({ locals } as never);

		expect(res).toEqual({ jiraResetSinceOk: true });
		expect((await getJiraConfig(workspaceId)).updatedSince).toBeNull();
	});

	// Pas de test 403 dédié pour jiraResetUpdatedSince : déjà couvert gratuitement par
	// ROLE_GATED_ACTIONS ci-dessus (Object.keys(actions)), sa garde étant la première ligne.
});
