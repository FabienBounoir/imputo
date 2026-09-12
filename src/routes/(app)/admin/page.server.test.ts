import { describe, it, expect } from 'vitest';
import { actions, load as loadUntyped } from './+page.server';
// `load` peut renvoyer `void` côté types (branche du redirect non-ADMIN) ; en pratique il renvoie
// toujours des données ici, donc on retype une fois plutôt que de caster à chaque accès.
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, formRequest } from '$lib/server/test-helpers/http';
import { getJiraConfig } from '$lib/server/services/accounts';
import { listPerimeters, loadPerimeterCtx } from '$lib/server/services/perimeters';
import { createTicket } from '$lib/server/services/tickets';

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

describe('admin memberCancelInvite', () => {
	it('annule l’invitation d’un membre encore en attente (compte supprimé)', async () => {
		const { userId, workspaceId } = await makeWorkspace('cancel1');
		const { userId: pendingId } = await addMember(workspaceId, 'USER', 'cancel1-pending');
		const locals = await fakeLocals(userId);

		const res = await actions.memberCancelInvite({
			locals,
			request: formRequest({ userId: pendingId })
		} as never);
		expect(res).toEqual({ memberOk: true });

		const { db, user } = await import('$lib/server/db');
		const { eq } = await import('drizzle-orm');
		const [remaining] = await db.select({ id: user.id }).from(user).where(eq(user.id, pendingId));
		expect(remaining).toBeUndefined();
	});

	it('refuse d’annuler un membre dont le compte est déjà activé', async () => {
		const { userId, workspaceId } = await makeWorkspace('cancel2');
		const { userId: activeId } = await addMember(workspaceId, 'USER', 'cancel2-active');
		const { setPasswordWithToken, regenerateInvite } = await import('$lib/server/services/accounts');
		const { token } = await regenerateInvite(workspaceId, activeId);
		await setPasswordWithToken(token, 'password123');
		const locals = await fakeLocals(userId);

		const res = await actions.memberCancelInvite({
			locals,
			request: formRequest({ userId: activeId })
		} as never);
		expect(res?.status).toBe(400);
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

	it('jiraSave transmet createdSinceDate au service', async () => {
		const { userId, workspaceId } = await makeWorkspace('jira-created-since');
		const locals = await fakeLocals(userId);
		const res = await actions.jiraSave({
			locals,
			request: formRequest({
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				regexPattern: '',
				regexReplacement: '',
				createdSinceDate: '2023-01-01'
			})
		} as never);
		expect(res).toEqual({ jiraSaveOk: true });
		expect((await getJiraConfig(workspaceId)).createdSince?.toISOString()).toBe('2023-01-01T00:00:00.000Z');
	});

	it('jiraResetCreatedSince vide la date de création minimum', async () => {
		const { userId, workspaceId } = await makeWorkspace('jira-created-reset');
		const locals = await fakeLocals(userId);
		await actions.jiraSave({
			locals,
			request: formRequest({
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				regexPattern: '',
				regexReplacement: '',
				createdSinceDate: '2023-01-01'
			})
		} as never);

		const res = await actions.jiraResetCreatedSince({ locals } as never);

		expect(res).toEqual({ jiraResetCreatedSinceOk: true });
		expect((await getJiraConfig(workspaceId)).createdSince).toBeNull();
	});
});

describe('admin perimètres', () => {
	it('crée un périmètre, le renomme, le bascule transverse', async () => {
		const { userId, workspaceId } = await makeWorkspace('perimact');
		const locals = await fakeLocals(userId);

		const created = await actions.perimeterCreate({
			locals,
			request: formRequest({ name: 'Paiement', color: '#123456', transverse: 'false' })
		} as never);
		expect(created).toEqual({ perimeterOk: true });

		const p = (await listPerimeters(workspaceId)).find((x) => x.name === 'Paiement')!;
		expect(p.color).toBe('#123456');
		expect(p.transverse).toBe(false);

		await actions.perimeterUpdate({
			locals,
			request: formRequest({ id: p.id, name: 'Paiement & encaissement', color: '', transverse: 'true' })
		} as never);
		const after = (await listPerimeters(workspaceId)).find((x) => x.id === p.id)!;
		expect(after.name).toBe('Paiement & encaissement');
		expect(after.transverse).toBe(true);
		// Couleur vidée dans le formulaire = pas de couleur, pas la chaîne vide.
		expect(after.color).toBeNull();
	});

	it("remonte tel quel le refus d'archivage d'un périmètre qui porte des tickets", async () => {
		const { userId, workspaceId } = await makeWorkspace('perimarch');
		const locals = await fakeLocals(userId);
		await actions.perimeterCreate({ locals, request: formRequest({ name: 'Occupé', color: '', transverse: 'false' }) } as never);
		const p = (await listPerimeters(workspaceId)).find((x) => x.name === 'Occupé')!;
		await createTicket(workspaceId, { key: `ADM-${p.id.slice(0, 8)}`, title: 'x', perimeterId: p.id });

		const res = await actions.perimeterArchive({
			locals,
			request: formRequest({ id: p.id, archived: 'true' })
		} as never);
		expect(res?.status).toBe(400);
		expect((res as { data?: { error?: string } })?.data?.error).toMatch(/ticket\(s\) y sont encore rattachés/);
	});

	it('rattache un membre puis le retire du périmètre', async () => {
		const { userId, workspaceId } = await makeWorkspace('perimmemb');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'perim-member');
		const locals = await fakeLocals(userId);
		const p = (await listPerimeters(workspaceId))[0];

		await actions.perimeterMember({
			locals,
			request: formRequest({ perimeterId: p.id, userId: memberId, role: 'CP_BACKUP' })
		} as never);
		expect((await loadPerimeterCtx(workspaceId, memberId, 'USER')).leadPerimeterIds.has(p.id)).toBe(true);

		// '' = « Non rattaché » dans le <select>.
		await actions.perimeterMember({
			locals,
			request: formRequest({ perimeterId: p.id, userId: memberId, role: '' })
		} as never);
		expect((await loadPerimeterCtx(workspaceId, memberId, 'USER')).memberPerimeterIds.size).toBe(0);
	});

	it('refuse un rôle de périmètre inconnu', async () => {
		const { userId, workspaceId } = await makeWorkspace('perimrole');
		const locals = await fakeLocals(userId);
		const p = (await listPerimeters(workspaceId))[0];

		const res = await actions.perimeterMember({
			locals,
			request: formRequest({ perimeterId: p.id, userId, role: 'DP' })
		} as never);
		expect(res?.status).toBe(400);
	});

	it('le load expose les périmètres de chaque membre pour la colonne Membres', async () => {
		const { userId, workspaceId } = await makeWorkspace('perimload');
		const locals = await fakeLocals(userId);
		const p = (await listPerimeters(workspaceId))[0];
		await actions.perimeterMember({
			locals,
			request: formRequest({ perimeterId: p.id, userId, role: 'CP' })
		} as never);

		const data = await load({ locals } as never);
		expect(data.perimeters.length).toBeGreaterThanOrEqual(2);
		const me = data.members.find((m: { id: string }) => m.id === userId);
		expect(me?.perimeters.map((x: { id: string }) => x.id)).toContain(p.id);
	});
});
