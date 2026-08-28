import { describe, it, expect, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, workspace, user, membership, ticket, jiraSyncRun } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import {
	login,
	changePassword,
	regenerateInvite,
	getTokenTarget,
	setPasswordWithToken,
	inviteMember,
	cancelInvite,
	getJiraConfig,
	setJiraSyncEnabled,
	saveJiraConfig,
	resetJiraUpdatedSince,
	resetJiraCreatedSince,
	listJiraSyncRuns,
	undoJiraSyncRun
} from './accounts';

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id));
});

describe('changePassword', () => {
	it('change le mot de passe quand l’ancien est correct, et le nouveau permet la connexion', async () => {
		const email = `cp-ok-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Alice',
			email,
			password: 'password123',
			workspaceName: 'Espace CP OK'
		});
		wsIds.push(workspaceId);

		const ok = await changePassword(userId, 'password123', 'newpassword456');
		expect(ok).toBe(true);

		expect(await login(email, 'newpassword456')).toEqual({ userId });
		expect(await login(email, 'password123')).toBeNull();
	});

	it('refuse et ne change rien si l’ancien mot de passe est incorrect', async () => {
		const email = `cp-bad-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Bob',
			email,
			password: 'password123',
			workspaceName: 'Espace CP KO'
		});
		wsIds.push(workspaceId);

		const ok = await changePassword(userId, 'wrong-current-password', 'newpassword456');
		expect(ok).toBe(false);

		expect(await login(email, 'password123')).toEqual({ userId });
		expect(await login(email, 'newpassword456')).toBeNull();
	});
});

describe('login — verrou anti brute-force', () => {
	it('bloque après 5 échecs, un mot de passe correct ne débloque pas avant le délai', async () => {
		const email = `bf-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Eve',
			email,
			password: 'password123',
			workspaceName: 'Espace Brute Force'
		});
		wsIds.push(workspaceId);

		for (let i = 0; i < 5; i++) expect(await login(email, 'wrong-password')).toBeNull();

		const res = await login(email, 'password123');
		expect(res).not.toBeNull();
		expect(res).toMatchObject({ locked: true });
		if (res && 'retryAfterMs' in res) expect(res.retryAfterMs).toBeGreaterThan(0);

		// Un autre compte n'est pas affecté par le verrou de celui-ci.
		const otherEmail = `bf-other-${rnd}@acme.test`;
		const other = await createWorkspaceWithOwner({
			displayName: 'Frank',
			email: otherEmail,
			password: 'password123',
			workspaceName: 'Espace Brute Force Autre'
		});
		wsIds.push(other.workspaceId);
		expect(await login(otherEmail, 'password123')).toEqual({ userId: other.userId });
	});
});

describe('regenerateInvite pour un membre déjà actif', () => {
	it('génère un lien qui réinitialise le mot de passe d’un compte déjà activé', async () => {
		const email = `reinvite-${rnd}@acme.test`;
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Carole',
			email,
			password: 'password123',
			workspaceName: 'Espace Reinvite'
		});
		wsIds.push(workspaceId);

		const { token } = await regenerateInvite(workspaceId, userId);

		// Le token cible bien ce compte, déjà actif (pas seulement les invitations en attente).
		const target = await getTokenTarget(token);
		expect(target?.userId).toBe(userId);

		const ok = await setPasswordWithToken(token, 'resetpassword789');
		expect(ok).toBe(true);
		expect(await login(email, 'resetpassword789')).toEqual({ userId });
		expect(await login(email, 'password123')).toBeNull();
	});
});

describe('cancelInvite', () => {
	it('supprime le compte et la membership d’une invitation encore en attente', async () => {
		const { workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Denis',
			email: `cancel-owner-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Cancel OK'
		});
		wsIds.push(workspaceId);

		const email = `cancel-pending-${rnd}@acme.test`;
		await inviteMember({ workspaceId, email, displayName: 'Invité', role: 'USER' });
		const [invited] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));

		await cancelInvite(workspaceId, invited.id);

		const [remainingUser] = await db.select().from(user).where(eq(user.id, invited.id));
		expect(remainingUser).toBeUndefined();
		const remainingMembership = await db
			.select()
			.from(membership)
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, invited.id)));
		expect(remainingMembership).toHaveLength(0);
	});

	it('refuse d’annuler un membre dont le compte est déjà activé', async () => {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Émile',
			email: `cancel-active-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Cancel KO'
		});
		wsIds.push(workspaceId);

		await expect(cancelInvite(workspaceId, userId)).rejects.toThrow('déjà activé son compte');

		const [stillThere] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
		expect(stillThere?.id).toBe(userId);
	});

	it('refuse un membre introuvable dans cet espace', async () => {
		const { workspaceId } = await createWorkspaceWithOwner({
			displayName: 'Fanny',
			email: `cancel-missing-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Cancel Missing'
		});
		wsIds.push(workspaceId);

		await expect(cancelInvite(workspaceId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('introuvable');
	});
});

describe('config Jira (getJiraConfig / setJiraSyncEnabled / saveJiraConfig)', () => {
	// Clé construite ici plutôt que lue depuis $lib/server/config : indépendant de la présence de
	// JIRA_PAT_ENCRYPTION_KEY dans l'environnement qui exécute les tests (absent en CI).
	const encKey = Buffer.alloc(32, 9).toString('base64');

	async function makeWs(prefix: string) {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: prefix,
			email: `${prefix}-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: `Espace ${prefix}`
		});
		wsIds.push(workspaceId);
		return { userId, workspaceId };
	}

	it('getJiraConfig : valeurs par défaut sur un espace neuf', async () => {
		const { workspaceId } = await makeWs('jira-default');
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg).toMatchObject({
			enabled: false,
			jql: '',
			patConfigured: false,
			conflictStrategy: 'KEEP_LOCAL',
			// Tout coché par défaut : un espace neuf synchronise comme avant l'existence de ces
			// colonnes, tant que personne n'y touche.
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			// Désactivé par défaut : sans ça un espace n'utilisant pas Jira afficherait des liens cassés.
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			patUpdatedByName: null,
			updatedSince: null,
			createdSince: null,
			lastSyncAt: null,
			consecutiveFailures: 0
		});
	});

	it('setJiraSyncEnabled bascule le flag', async () => {
		const { workspaceId } = await makeWs('jira-toggle');
		await setJiraSyncEnabled(workspaceId, true);
		expect((await getJiraConfig(workspaceId)).enabled).toBe(true);
		await setJiraSyncEnabled(workspaceId, false);
		expect((await getJiraConfig(workspaceId)).enabled).toBe(false);
	});

	it('saveJiraConfig sans PAT : met à jour jql/stratégie/regex sans toucher au token', async () => {
		const { workspaceId } = await makeWs('jira-noPat');
		await saveJiraConfig(workspaceId, {
			jql: 'project = X',
			conflictStrategy: 'JIRA_WINS',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '^X_',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: '',
			updatedSinceDate: '',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg).toMatchObject({
			jql: 'project = X',
			conflictStrategy: 'JIRA_WINS',
			regexPattern: '^X_',
			patConfigured: false,
			patUpdatedByName: null
		});
	});

	it('saveJiraConfig avec un PAT : chiffre, trace qui/quand, remet le compteur d’échecs à 0', async () => {
		const { userId, workspaceId } = await makeWs('jira-withPat');
		// Simule un espace déjà en échec avant la sauvegarde d'un nouveau PAT.
		await db.update(workspace).set({ jiraConsecutiveFailures: 3 }).where(eq(workspace.id, workspaceId));

		await saveJiraConfig(workspaceId, {
			jql: 'project = Y',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: 'un-vrai-pat',
			updatedSinceDate: '',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: userId
		});

		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.patConfigured).toBe(true);
		expect(cfg.patUpdatedByName).toBe('jira-withPat');
		expect(cfg.patUpdatedAt).not.toBeNull();

		const [row] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
		expect(row.jiraPatEncrypted).not.toBe('un-vrai-pat'); // jamais en clair
		expect(row.jiraConsecutiveFailures).toBe(0); // nouveau PAT = nouvelle chance
	});

	it('saveJiraConfig : regex invalide lève une erreur claire, rien n’est écrit', async () => {
		const { workspaceId } = await makeWs('jira-badregex');
		await expect(
			saveJiraConfig(workspaceId, {
				jql: 'project = Z',
				conflictStrategy: 'KEEP_LOCAL',
				syncTitle: true,
				syncProject: true,
				syncParent: true,
				syncSprint: true,
				syncVersion: true,
				syncPriority: true,
				regexPattern: '(unclosed',
				regexReplacement: '',
				linkEnabled: false,
				linkRegexPattern: '',
				linkRegexReplacement: '',
				pat: '',
				updatedSinceDate: '',
				createdSinceDate: '',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/regex/i);
		expect((await getJiraConfig(workspaceId)).jql).toBe(''); // rien n'a été sauvegardé
	});

	it('saveJiraConfig : regex de lien invalide lève une erreur claire, rien n’est écrit', async () => {
		const { workspaceId } = await makeWs('jira-badlinkregex');
		await expect(
			saveJiraConfig(workspaceId, {
				jql: 'project = Z',
				conflictStrategy: 'KEEP_LOCAL',
				syncTitle: true,
				syncProject: true,
				syncParent: true,
				syncSprint: true,
				syncVersion: true,
				syncPriority: true,
				regexPattern: '',
				regexReplacement: '',
				linkEnabled: true,
				linkRegexPattern: '(unclosed',
				linkRegexReplacement: '',
				pat: '',
				updatedSinceDate: '',
				createdSinceDate: '',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/lien jira/i);
		expect((await getJiraConfig(workspaceId)).jql).toBe(''); // rien n'a été sauvegardé
	});

	it('saveJiraConfig : enregistre le mapping de lien Jira', async () => {
		const { workspaceId } = await makeWs('jira-link-save');
		await saveJiraConfig(workspaceId, {
			jql: 'project = Z',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: true,
			linkRegexPattern: '^',
			linkRegexReplacement: 'CARTEJEUNE_',
			pat: '',
			updatedSinceDate: '',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.linkEnabled).toBe(true);
		expect(cfg.linkRegexPattern).toBe('^');
		expect(cfg.linkRegexReplacement).toBe('CARTEJEUNE_');
	});

	it('saveJiraConfig avec une date minimum : parse en minuit UTC', async () => {
		const { workspaceId } = await makeWs('jira-since-set');
		await saveJiraConfig(workspaceId, {
			jql: 'project = X',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: '',
			updatedSinceDate: '2026-06-01',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.updatedSince?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
	});

	it('saveJiraConfig avec une date vide : laisse la date existante inchangée', async () => {
		const { workspaceId } = await makeWs('jira-since-untouched');
		await db.update(workspace).set({ jiraUpdatedSince: new Date('2026-01-01T00:00:00Z') }).where(eq(workspace.id, workspaceId));

		await saveJiraConfig(workspaceId, {
			jql: 'project = X',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: '',
			updatedSinceDate: '',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.updatedSince?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
	});

	it('saveJiraConfig avec une date invalide lève une erreur claire, rien n’est écrit', async () => {
		const { workspaceId } = await makeWs('jira-since-invalid');
		await expect(
			saveJiraConfig(workspaceId, {
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				syncTitle: true,
				syncProject: true,
				syncParent: true,
				syncSprint: true,
				syncVersion: true,
				syncPriority: true,
				regexPattern: '',
				regexReplacement: '',
				linkEnabled: false,
				linkRegexPattern: '',
				linkRegexReplacement: '',
				pat: '',
				updatedSinceDate: 'pas-une-date',
				createdSinceDate: '',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/date/i);
		expect((await getJiraConfig(workspaceId)).updatedSince).toBeNull();
	});

	it('saveJiraConfig avec un JQL contenant ORDER BY lève une erreur claire, rien n’est écrit', async () => {
		const { workspaceId } = await makeWs('jira-orderby');
		await expect(
			saveJiraConfig(workspaceId, {
				jql: 'project = X ORDER BY updated DESC',
				conflictStrategy: 'KEEP_LOCAL',
				syncTitle: true,
				syncProject: true,
				syncParent: true,
				syncSprint: true,
				syncVersion: true,
				syncPriority: true,
				regexPattern: '',
				regexReplacement: '',
				linkEnabled: false,
				linkRegexPattern: '',
				linkRegexReplacement: '',
				pat: '',
				updatedSinceDate: '',
				createdSinceDate: '',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/order by/i);
		expect((await getJiraConfig(workspaceId)).jql).toBe(''); // rien n'a été sauvegardé
	});

	it('resetJiraUpdatedSince remet la date à null', async () => {
		const { workspaceId } = await makeWs('jira-since-reset');
		await db.update(workspace).set({ jiraUpdatedSince: new Date('2026-01-01T00:00:00Z') }).where(eq(workspace.id, workspaceId));

		await resetJiraUpdatedSince(workspaceId);

		expect((await getJiraConfig(workspaceId)).updatedSince).toBeNull();
	});

	it('saveJiraConfig avec une date de création minimum : parse en minuit UTC', async () => {
		const { workspaceId } = await makeWs('jira-created-set');
		await saveJiraConfig(workspaceId, {
			jql: 'project = X',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: '',
			updatedSinceDate: '',
			createdSinceDate: '2020-01-01',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.createdSince?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
	});

	it('saveJiraConfig avec une date de création vide : laisse la date existante inchangée', async () => {
		const { workspaceId } = await makeWs('jira-created-untouched');
		await db.update(workspace).set({ jiraCreatedSince: new Date('2020-01-01T00:00:00Z') }).where(eq(workspace.id, workspaceId));

		await saveJiraConfig(workspaceId, {
			jql: 'project = X',
			conflictStrategy: 'KEEP_LOCAL',
			syncTitle: true,
			syncProject: true,
			syncParent: true,
			syncSprint: true,
			syncVersion: true,
			syncPriority: true,
			regexPattern: '',
			regexReplacement: '',
			linkEnabled: false,
			linkRegexPattern: '',
			linkRegexReplacement: '',
			pat: '',
			updatedSinceDate: '',
			createdSinceDate: '',
			patEncryptionKey: encKey,
			changedByUserId: 'unused'
		});
		const cfg = await getJiraConfig(workspaceId);
		expect(cfg.createdSince?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
	});

	it('saveJiraConfig avec une date de création invalide lève une erreur claire, rien n’est écrit', async () => {
		const { workspaceId } = await makeWs('jira-created-invalid');
		await expect(
			saveJiraConfig(workspaceId, {
				jql: 'project = X',
				conflictStrategy: 'KEEP_LOCAL',
				syncTitle: true,
				syncProject: true,
				syncParent: true,
				syncSprint: true,
				syncVersion: true,
				syncPriority: true,
				regexPattern: '',
				regexReplacement: '',
				linkEnabled: false,
				linkRegexPattern: '',
				linkRegexReplacement: '',
				pat: '',
				updatedSinceDate: '',
				createdSinceDate: 'pas-une-date',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/date/i);
		expect((await getJiraConfig(workspaceId)).createdSince).toBeNull();
	});

	it('resetJiraCreatedSince remet la date à null', async () => {
		const { workspaceId } = await makeWs('jira-created-reset');
		await db.update(workspace).set({ jiraCreatedSince: new Date('2020-01-01T00:00:00Z') }).where(eq(workspace.id, workspaceId));

		await resetJiraCreatedSince(workspaceId);

		expect((await getJiraConfig(workspaceId)).createdSince).toBeNull();
	});
});

describe('historique des runs Jira (listJiraSyncRuns / undoJiraSyncRun)', () => {
	async function makeWs(prefix: string) {
		const { userId, workspaceId } = await createWorkspaceWithOwner({
			displayName: prefix,
			email: `${prefix}-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: `Espace ${prefix}`
		});
		wsIds.push(workspaceId);
		return { userId, workspaceId };
	}

	async function makeRun(workspaceId: string, overrides?: Partial<typeof jiraSyncRun.$inferInsert>) {
		const [row] = await db
			.insert(jiraSyncRun)
			.values({ workspaceId, startedAt: new Date(), status: 'SUCCESS', ticketsCreated: 0, ...overrides })
			.returning({ id: jiraSyncRun.id });
		return row.id;
	}

	it('listJiraSyncRuns : plus récent d’abord, scopé à l’espace', async () => {
		const { workspaceId } = await makeWs('runs-list');
		const { workspaceId: otherWs } = await makeWs('runs-list-other');
		const older = await makeRun(workspaceId, { startedAt: new Date('2026-01-01T00:00:00Z') });
		const newer = await makeRun(workspaceId, { startedAt: new Date('2026-01-02T00:00:00Z') });
		await makeRun(otherWs, { startedAt: new Date('2026-01-03T00:00:00Z') });

		const runs = await listJiraSyncRuns(workspaceId);
		expect(runs.map((r) => r.id)).toEqual([newer, older]);
	});

	it('undoJiraSyncRun : supprime les tickets vierges du lot, marque le run annulé, renvoie le compte supprimé', async () => {
		const { workspaceId, userId } = await makeWs('undo-ok');
		const runId = await makeRun(workspaceId, { ticketsCreated: 2 });
		await db.insert(ticket).values([
			{ workspaceId, key: 'U-1', title: 'A', createdBySyncRunId: runId },
			{ workspaceId, key: 'U-2', title: 'B', createdBySyncRunId: runId, comment: 'touché' } // conservé
		]);

		const deleted = await undoJiraSyncRun(workspaceId, runId, userId);

		expect(deleted).toBe(1);
		const [run] = await db.select().from(jiraSyncRun).where(eq(jiraSyncRun.id, runId));
		expect(run.undoneAt).not.toBeNull();
		expect(run.undoneById).toBe(userId);
	});

	it('rejette un run déjà annulé ou en échec', async () => {
		const { workspaceId, userId } = await makeWs('undo-guard');
		const okRun = await makeRun(workspaceId);
		const failedRun = await makeRun(workspaceId, { status: 'ERROR' });

		await undoJiraSyncRun(workspaceId, okRun, userId);
		await expect(undoJiraSyncRun(workspaceId, okRun, userId)).rejects.toThrow(/déjà été annulé/);
		await expect(undoJiraSyncRun(workspaceId, failedRun, userId)).rejects.toThrow(/réussi/);
	});
});
