import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspace, ticket, jiraSyncRun } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import {
	login,
	changePassword,
	regenerateInvite,
	getTokenTarget,
	setPasswordWithToken,
	getJiraConfig,
	setJiraSyncEnabled,
	saveJiraConfig,
	resetJiraUpdatedSince,
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
			patUpdatedByName: null,
			updatedSince: null,
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
			regexPattern: '^X_',
			regexReplacement: '',
			pat: '',
			updatedSinceDate: '',
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
			regexPattern: '',
			regexReplacement: '',
			pat: 'un-vrai-pat',
			updatedSinceDate: '',
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
				regexPattern: '(unclosed',
				regexReplacement: '',
				pat: '',
				updatedSinceDate: '',
				patEncryptionKey: encKey,
				changedByUserId: 'unused'
			})
		).rejects.toThrow(/regex/i);
		expect((await getJiraConfig(workspaceId)).jql).toBe(''); // rien n'a été sauvegardé
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
			regexPattern: '',
			regexReplacement: '',
			pat: '',
			updatedSinceDate: '2026-06-01',
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
			regexPattern: '',
			regexReplacement: '',
			pat: '',
			updatedSinceDate: '',
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
				regexPattern: '',
				regexReplacement: '',
				pat: '',
				updatedSinceDate: 'pas-une-date',
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
				regexPattern: '',
				regexReplacement: '',
				pat: '',
				updatedSinceDate: '',
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
