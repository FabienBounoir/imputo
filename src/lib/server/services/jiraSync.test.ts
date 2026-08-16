import { and, desc, eq } from 'drizzle-orm';
import { describe, it, expect } from 'vitest';
import { db, workspace, project, sprint, ticket, jiraSyncRun } from '$lib/server/db';
import { makeWorkspace } from './test-helpers';
import { encryptSecret } from '../auth/secretCrypto';
import { syncWorkspace, syncAllEnabledWorkspaces, WATERMARK_SAFETY_MARGIN_MS, type JiraSyncConfig } from './jiraSync';

const encKey = Buffer.alloc(32, 7).toString('base64');
const cfg: JiraSyncConfig = {
	azureTenantId: 't',
	azureClientId: 'c',
	azureClientSecret: 's',
	jiraBaseUrl: 'https://jira.example.test',
	patEncryptionKey: encKey
};

type RawIssue = {
	key: string;
	fields: {
		summary: string;
		issuetype?: { name: string };
		parent?: { key: string };
		project?: { name: string };
		fixVersions?: Array<{ name: string }>;
		customfield_10105?: string[];
	};
};

function rawIssue(
	key: string,
	summary: string,
	opts?: { parentKey?: string; projectName?: string; versionName?: string; sprintName?: string }
): RawIssue {
	return {
		key,
		fields: {
			summary,
			issuetype: { name: 'Story' },
			...(opts?.parentKey ? { parent: { key: opts.parentKey } } : {}),
			project: { name: opts?.projectName ?? 'Projet Test' },
			...(opts?.versionName ? { fixVersions: [{ name: opts.versionName }] } : {}),
			...(opts?.sprintName
				? { customfield_10105: [`com.atlassian.greenhopper.service.sprint.Sprint@x[name=${opts.sprintName},state=ACTIVE]`] }
				: {})
		}
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

function fakeFetch(opts: {
	searchStatus?: number;
	issues?: RawIssue[];
	/** Appelé avec le paramètre `jql` de chaque requête de recherche — sert à vérifier le wrapping. */
	onSearchRequest?: (jql: string) => void;
}): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = input.toString();
		if (url.includes('login.microsoftonline.com')) {
			return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
		}
		if (url.includes('/rest/api/2/search')) {
			opts.onSearchRequest?.(new URL(url).searchParams.get('jql') ?? '');
			const status = opts.searchStatus ?? 200;
			if (status !== 200) return jsonResponse(status, { errorMessages: ['boom'] });
			const issues = opts.issues ?? [];
			return jsonResponse(200, { startAt: 0, total: issues.length, issues });
		}
		throw new Error(`unexpected url: ${url}`);
	}) as typeof fetch;
}

async function makeJiraWorkspace(opts?: {
	jql?: string;
	conflictStrategy?: 'JIRA_WINS' | 'KEEP_LOCAL';
	regexPattern?: string | null;
	regexReplacement?: string | null;
	syncTitle?: boolean;
	syncProject?: boolean;
	syncParent?: boolean;
	syncSprint?: boolean;
	syncVersion?: boolean;
}) {
	const ws = await makeWorkspace('jira');
	await db
		.update(workspace)
		.set({
			jiraPatEncrypted: encryptSecret('fake-pat', encKey),
			jiraJql: opts?.jql ?? 'project = TEST',
			jiraConflictStrategy: opts?.conflictStrategy ?? 'KEEP_LOCAL',
			jiraKeyRegexPattern: opts?.regexPattern ?? null,
			jiraKeyRegexReplacement: opts?.regexReplacement ?? null,
			jiraSyncEnabled: true,
			...(opts?.syncTitle !== undefined ? { jiraSyncTitle: opts.syncTitle } : {}),
			...(opts?.syncProject !== undefined ? { jiraSyncProject: opts.syncProject } : {}),
			...(opts?.syncParent !== undefined ? { jiraSyncParent: opts.syncParent } : {}),
			...(opts?.syncSprint !== undefined ? { jiraSyncSprint: opts.syncSprint } : {}),
			...(opts?.syncVersion !== undefined ? { jiraSyncVersion: opts.syncVersion } : {})
		})
		.where(eq(workspace.id, ws.workspaceId));
	return ws;
}

async function ticketsOf(workspaceId: string) {
	return db.select().from(ticket).where(eq(ticket.workspaceId, workspaceId));
}

async function runsOf(workspaceId: string) {
	return db.select().from(jiraSyncRun).where(eq(jiraSyncRun.workspaceId, workspaceId)).orderBy(desc(jiraSyncRun.startedAt));
}

describe('jiraSync / syncWorkspace', () => {
	it('crée un ticket, remplit le statut de sync sur workspace', async () => {
		const ws = await makeJiraWorkspace();
		const res = await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre')] }) });

		expect(res).toMatchObject({ ok: true, ticketsUpserted: 1 });
		const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
		expect(row.jiraLastSyncStatus).toBe('SUCCESS');
		expect(row.jiraLastSyncTicketCount).toBe(1);
		expect(row.jiraLastSyncAt).not.toBeNull();
	});

	it('upsert idempotent : deux runs identiques ne créent pas de doublon', async () => {
		const ws = await makeJiraWorkspace();
		const fetchImpl = fakeFetch({ issues: [rawIssue('T-1', 'Titre')] });

		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl });
		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl });

		const rows = await db.select().from(ticket).where(and(eq(ticket.workspaceId, ws.workspaceId), eq(ticket.key, 'T-1')));
		expect(rows).toHaveLength(1);
	});

	it('non-régression : les champs hors périmètre restent intacts après sync (JIRA_WINS)', async () => {
		const ws = await makeJiraWorkspace({ conflictStrategy: 'JIRA_WINS' });
		await db
			.insert(ticket)
			.values({ workspaceId: ws.workspaceId, key: 'T-1', title: 'Titre manuel', estimationReal: '5', comment: 'note manuelle' });

		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre Jira')] }) });

		const [row] = await db.select().from(ticket).where(and(eq(ticket.workspaceId, ws.workspaceId), eq(ticket.key, 'T-1')));
		expect(row.title).toBe('Titre Jira'); // écrasé (dans le périmètre)
		expect(row.estimationReal).toBe('5.00'); // jamais touché (formatage numeric Postgres)
		expect(row.comment).toBe('note manuelle'); // jamais touché
	});

	describe('stratégie de conflit', () => {
		it('JIRA_WINS écrase title/projectId d’un ticket déjà connu', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'JIRA_WINS' });
			await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'T-1', title: 'Titre manuel' });

			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre Jira')] }) });

			const [row] = await db.select().from(ticket).where(and(eq(ticket.workspaceId, ws.workspaceId), eq(ticket.key, 'T-1')));
			expect(row.title).toBe('Titre Jira');
		});

		it('KEEP_LOCAL (défaut) ne modifie jamais un ticket déjà connu', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'KEEP_LOCAL' });
			await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'T-1', title: 'Titre manuel' });

			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre Jira')] }) });

			const [row] = await db.select().from(ticket).where(and(eq(ticket.workspaceId, ws.workspaceId), eq(ticket.key, 'T-1')));
			expect(row.title).toBe('Titre manuel');
		});

		it('les deux stratégies insèrent normalement un ticket nouveau', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'KEEP_LOCAL' });
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-9', 'Nouveau')] }) });

			const [row] = await db.select().from(ticket).where(and(eq(ticket.workspaceId, ws.workspaceId), eq(ticket.key, 'T-9')));
			expect(row?.title).toBe('Nouveau');
		});
	});

	describe('mapping de clé par regex', () => {
		it('transforme la clé (cas nominal) et laisse inchangée une clé qui ne matche pas', async () => {
			const ws = await makeJiraWorkspace({ regexPattern: '^CARTEJEUNE_', regexReplacement: '' });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('CARTEJEUNE_BLM-1', 'Réconcilié'), rawIssue('AUTRE-5', 'Pas concerné')] })
			});

			const keys = (await ticketsOf(ws.workspaceId)).map((r) => r.key).sort();
			expect(keys).toEqual(['AUTRE-5', 'BLM-1']);
		});

		it('regex invalide -> erreur de config propre, pas de crash', async () => {
			const ws = await makeJiraWorkspace({ regexPattern: '(unclosed' });
			const res = await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'x')] }) });

			expect(res.ok).toBe(false);
			if (!res.ok) expect(res.error).toMatch(/regex/i);
			expect(await ticketsOf(ws.workspaceId)).toHaveLength(0);
		});
	});

	describe('résolution des parents (deux passes)', () => {
		it('résout un parent apparu dans le même run, même si l’enfant arrive avant', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-2', 'Sous-tâche', { parentKey: 'T-1' }), rawIssue('T-1', 'Parent')] })
			});

			const rows = await ticketsOf(ws.workspaceId);
			const parent = rows.find((r) => r.key === 'T-1')!;
			const child = rows.find((r) => r.key === 'T-2')!;
			expect(child.parentId).toBe(parent.id);
		});

		it('résout un parent synchronisé lors d’un run précédent', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Parent')] }) });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Parent'), rawIssue('T-2', 'Enfant', { parentKey: 'T-1' })] })
			});

			const rows = await ticketsOf(ws.workspaceId);
			const parent = rows.find((r) => r.key === 'T-1')!;
			const child = rows.find((r) => r.key === 'T-2')!;
			expect(child.parentId).toBe(parent.id);
		});
	});

	it('crée le projet s’il n’existe pas, le réutilise sinon (insensible à la casse)', async () => {
		const ws = await makeJiraWorkspace();
		await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({
				issues: [
					rawIssue('T-1', 'A', { projectName: 'Application Mobile' }),
					rawIssue('T-2', 'B', { projectName: 'application mobile' })
				]
			})
		});

		const projects = await db.select().from(project).where(eq(project.workspaceId, ws.workspaceId));
		expect(projects).toHaveLength(1);
		const rows = await ticketsOf(ws.workspaceId);
		expect(rows.every((r) => r.projectId === projects[0].id)).toBe(true);
	});

	describe('sprint / version', () => {
		it('crée le sprint et la version s’ils n’existent pas, les réutilise sinon (insensible à la casse, tables séparées par kind)', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({
					issues: [
						rawIssue('T-1', 'A', { versionName: 'V36', sprintName: 'Sprint V36' }),
						rawIssue('T-2', 'B', { versionName: 'v36', sprintName: 'sprint v36' })
					]
				})
			});

			const versions = await db.select().from(sprint).where(and(eq(sprint.workspaceId, ws.workspaceId), eq(sprint.kind, 'VERSION')));
			const sprints = await db.select().from(sprint).where(and(eq(sprint.workspaceId, ws.workspaceId), eq(sprint.kind, 'SPRINT')));
			expect(versions).toHaveLength(1); // "V36" et "v36" -> la même ligne
			expect(sprints).toHaveLength(1);

			const rows = await ticketsOf(ws.workspaceId);
			expect(rows.every((r) => r.versionId === versions[0].id)).toBe(true);
			expect(rows.every((r) => r.sprintId === sprints[0].id)).toBe(true);
		});

		it('pas de sprint/version sur l’issue -> sprintId/versionId restent null', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A')] }) });

			const [row] = await ticketsOf(ws.workspaceId);
			expect(row.sprintId).toBeNull();
			expect(row.versionId).toBeNull();
		});

		it('JIRA_WINS écrase sprintId/versionId d’un ticket déjà connu', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'JIRA_WINS' });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { versionName: 'V1', sprintName: 'Sprint 1' })] })
			});
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { versionName: 'V2', sprintName: 'Sprint 2' })] })
			});

			const [row] = await ticketsOf(ws.workspaceId);
			const [v2] = await db
				.select()
				.from(sprint)
				.where(and(eq(sprint.workspaceId, ws.workspaceId), eq(sprint.kind, 'VERSION'), eq(sprint.name, 'V2')));
			expect(row.versionId).toBe(v2.id);
		});

		it('KEEP_LOCAL ne modifie jamais sprintId/versionId d’un ticket déjà connu', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'KEEP_LOCAL' });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { versionName: 'V1', sprintName: 'Sprint 1' })] })
			});
			const [before] = await ticketsOf(ws.workspaceId);

			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { versionName: 'V2', sprintName: 'Sprint 2' })] })
			});

			const [after] = await ticketsOf(ws.workspaceId);
			expect(after.versionId).toBe(before.versionId);
			expect(after.sprintId).toBe(before.sprintId);
		});

		it('KEEP_LOCAL sur un ticket déjà connu ne crée pas de projet/sprint/version orphelin (repéré en test réel)', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'KEEP_LOCAL' });
			// Ticket déjà connu (créé à la main, jamais synced) — KEEP_LOCAL ne le touchera pas.
			await db.insert(ticket).values({ workspaceId: ws.workspaceId, key: 'T-1', title: 'Titre manuel' });

			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({
					issues: [rawIssue('T-1', 'A', { projectName: 'Projet Jamais Utilisé', versionName: 'V-jamais', sprintName: 'Sprint-jamais' })]
				})
			});

			// Le ticket n'a pas bougé...
			const [row] = await ticketsOf(ws.workspaceId);
			expect(row.title).toBe('Titre manuel');
			expect(row.projectId).toBeNull();
			expect(row.sprintId).toBeNull();
			expect(row.versionId).toBeNull();
			// ...et surtout, rien n'a été créé en base pour des valeurs qui ne servent à rien.
			expect(await db.select().from(project).where(eq(project.workspaceId, ws.workspaceId))).toHaveLength(0);
			expect(await db.select().from(sprint).where(eq(sprint.workspaceId, ws.workspaceId))).toHaveLength(0);
		});
	});

	describe('cases d’inclusion par champ (jiraSyncXxx)', () => {
		it('jiraSyncTitle=false : un nouveau ticket reçoit quand même le titre (NOT NULL), mais n’est plus mis à jour ensuite', async () => {
			const ws = await makeJiraWorkspace({ conflictStrategy: 'JIRA_WINS', syncTitle: false });
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre initial')] }) });
			const [created] = await ticketsOf(ws.workspaceId);
			expect(created.title).toBe('Titre initial'); // posé à la création malgré la case décochée

			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre modifié')] }) });
			const [after] = await ticketsOf(ws.workspaceId);
			expect(after.title).toBe('Titre initial'); // jamais mis à jour, même en JIRA_WINS
		});

		it('jiraSyncProject=false : projectId reste null même à la création', async () => {
			const ws = await makeJiraWorkspace({ syncProject: false });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { projectName: 'Devrait être ignoré' })] })
			});

			const [row] = await ticketsOf(ws.workspaceId);
			expect(row.projectId).toBeNull();
			expect(await db.select().from(project).where(eq(project.workspaceId, ws.workspaceId))).toHaveLength(0);
		});

		it('jiraSyncSprint=false et jiraSyncVersion=false : sprintId/versionId restent null même à la création', async () => {
			const ws = await makeJiraWorkspace({ syncSprint: false, syncVersion: false });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A', { versionName: 'V1', sprintName: 'Sprint 1' })] })
			});

			const [row] = await ticketsOf(ws.workspaceId);
			expect(row.sprintId).toBeNull();
			expect(row.versionId).toBeNull();
			expect(await db.select().from(sprint).where(eq(sprint.workspaceId, ws.workspaceId))).toHaveLength(0); // pas créés pour rien
		});

		it('jiraSyncParent=false : le lien parent n’est jamais résolu, même présent sur l’issue', async () => {
			const ws = await makeJiraWorkspace({ syncParent: false });
			await syncWorkspace(db, cfg, ws.workspaceId, {
				fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Parent'), rawIssue('T-2', 'Enfant', { parentKey: 'T-1' })] })
			});

			const rows = await ticketsOf(ws.workspaceId);
			expect(rows.find((r) => r.key === 'T-2')?.parentId).toBeNull();
		});
	});

	describe('circuit breaker (échecs d’authentification)', () => {
		it('5 échecs 401 consécutifs désactivent le sync planifié', async () => {
			const ws = await makeJiraWorkspace();
			const fetchImpl = fakeFetch({ searchStatus: 401 });

			let last;
			for (let i = 0; i < 5; i++) last = await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl });

			expect(last!.ok).toBe(false);
			const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
			expect(row.jiraSyncEnabled).toBe(false);
			expect(row.jiraConsecutiveFailures).toBe(5);
			expect(row.jiraLastSyncError).toMatch(/désactivée automatiquement/);
		});

		it('un succès entre deux échecs remet le compteur à 0', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ searchStatus: 401 }) });
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ searchStatus: 401 }) });
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [] }) });

			const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
			expect(row.jiraConsecutiveFailures).toBe(0);
			expect(row.jiraSyncEnabled).toBe(true);
		});

		it('une erreur non liée au PAT (500) n’incrémente pas le compteur', async () => {
			const ws = await makeJiraWorkspace();
			await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ searchStatus: 500 }) });

			const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
			expect(row.jiraConsecutiveFailures).toBe(0);
			expect(row.jiraSyncEnabled).toBe(true);
			expect(row.jiraLastSyncStatus).toBe('ERROR');
		});
	});

	it('PAT ou JQL manquant -> erreur de config, aucun appel Jira nécessaire', async () => {
		const ws = await makeWorkspace('jira-noconf');
		const res = await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [] }) });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toMatch(/PAT ou JQL/);
	});
});

describe('jiraSync / watermark incrémental (jiraUpdatedSince)', () => {
	it('n’avance pas sur échec', async () => {
		const ws = await makeJiraWorkspace();
		const before = new Date('2020-01-01T00:00:00Z');
		await db.update(workspace).set({ jiraUpdatedSince: before }).where(eq(workspace.id, ws.workspaceId));

		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ searchStatus: 500 }) });

		const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
		expect(row.jiraUpdatedSince?.getTime()).toBe(before.getTime());
	});

	it('avance sur succès, borné par WATERMARK_SAFETY_MARGIN_MS', async () => {
		const ws = await makeJiraWorkspace();
		const before = Date.now();
		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [] }) });
		const after = Date.now();

		const [row] = await db.select().from(workspace).where(eq(workspace.id, ws.workspaceId));
		expect(row.jiraUpdatedSince).not.toBeNull();
		const got = row.jiraUpdatedSince!.getTime();
		expect(got).toBeLessThanOrEqual(after - WATERMARK_SAFETY_MARGIN_MS);
		expect(got).toBeGreaterThanOrEqual(before - WATERMARK_SAFETY_MARGIN_MS - 1000); // 1s de marge d'exécution
	});

	it('le JQL envoyé à Jira inclut "updated >=" quand jiraUpdatedSince est défini', async () => {
		const ws = await makeJiraWorkspace({ jql: 'project = X' });
		await db
			.update(workspace)
			.set({ jiraUpdatedSince: new Date('2026-01-01T00:00:00Z') })
			.where(eq(workspace.id, ws.workspaceId));

		let capturedJql = '';
		await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({ issues: [], onSearchRequest: (jql) => (capturedJql = jql) })
		});

		expect(capturedJql).toBe('(project = X) AND updated >= "2026-01-01 00:00"');
	});

	it('le JQL envoyé à Jira reste inchangé quand jiraUpdatedSince est null', async () => {
		const ws = await makeJiraWorkspace({ jql: 'project = X' });

		let capturedJql = '';
		await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({ issues: [], onSearchRequest: (jql) => (capturedJql = jql) })
		});

		expect(capturedJql).toBe('project = X');
	});

	it('JQL avec ORDER BY + date définie -> échec propre, endpoint jamais appelé', async () => {
		const ws = await makeJiraWorkspace({ jql: 'project = X ORDER BY updated DESC' });
		await db
			.update(workspace)
			.set({ jiraUpdatedSince: new Date('2026-01-01T00:00:00Z') })
			.where(eq(workspace.id, ws.workspaceId));

		let searchCalled = false;
		const res = await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({ issues: [], onSearchRequest: () => (searchCalled = true) })
		});

		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toMatch(/ORDER BY/);
		expect(searchCalled).toBe(false);
	});
});

describe('jiraSync / syncAllEnabledWorkspaces', () => {
	it('ignore les espaces désactivés (manuellement ou par le circuit breaker)', async () => {
		const wsOn = await makeJiraWorkspace();
		const wsOff = await makeJiraWorkspace();
		await db.update(workspace).set({ jiraSyncEnabled: false }).where(eq(workspace.id, wsOff.workspaceId));

		await syncAllEnabledWorkspaces(db, cfg, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'x')] }) });

		const [onRow] = await db.select().from(workspace).where(eq(workspace.id, wsOn.workspaceId));
		const [offRow] = await db.select().from(workspace).where(eq(workspace.id, wsOff.workspaceId));
		expect(onRow.jiraLastSyncAt).not.toBeNull(); // a bien tourné
		expect(offRow.jiraLastSyncAt).toBeNull(); // jamais touché
	});
});

describe('jiraSync / historique des runs (jiraSyncRun)', () => {
	it('un run réussi crée une ligne d’historique (vus/créés) et tague les tickets créés', async () => {
		const ws = await makeJiraWorkspace();
		await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A'), rawIssue('T-2', 'B')] })
		});

		const runs = await runsOf(ws.workspaceId);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ status: 'SUCCESS', ticketsSeen: 2, ticketsCreated: 2, error: null });

		const rows = await ticketsOf(ws.workspaceId);
		expect(rows.every((r) => r.createdBySyncRunId === runs[0].id)).toBe(true);
	});

	it('KEEP_LOCAL : un ticket déjà connu n’est ni compté ni retagué par le run suivant', async () => {
		const ws = await makeJiraWorkspace();
		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A')] }) });
		const [firstRun] = await runsOf(ws.workspaceId);

		await syncWorkspace(db, cfg, ws.workspaceId, {
			fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'A'), rawIssue('T-2', 'B')] })
		});
		const runs = await runsOf(ws.workspaceId);
		expect(runs).toHaveLength(2);
		const secondRun = runs.find((r) => r.id !== firstRun.id)!;
		expect(secondRun).toMatchObject({ ticketsSeen: 2, ticketsCreated: 1 });

		const rows = await ticketsOf(ws.workspaceId);
		expect(rows.find((r) => r.key === 'T-1')?.createdBySyncRunId).toBe(firstRun.id); // pas retagué
		expect(rows.find((r) => r.key === 'T-2')?.createdBySyncRunId).toBe(secondRun.id);
	});

	it('JIRA_WINS : une mise à jour d’un ticket déjà connu ne retague pas createdBySyncRunId', async () => {
		const ws = await makeJiraWorkspace({ conflictStrategy: 'JIRA_WINS' });
		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre 1')] }) });
		const [firstRun] = await runsOf(ws.workspaceId);

		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ issues: [rawIssue('T-1', 'Titre 2')] }) });
		const runs = await runsOf(ws.workspaceId);
		const secondRun = runs.find((r) => r.id !== firstRun.id)!;
		expect(secondRun).toMatchObject({ ticketsSeen: 1, ticketsCreated: 0 });

		const [row] = await ticketsOf(ws.workspaceId);
		expect(row.title).toBe('Titre 2'); // bien écrasé (dans le périmètre du sync)
		expect(row.createdBySyncRunId).toBe(firstRun.id); // mais jamais retagué
	});

	it('un run en échec crée une ligne d’historique ERROR', async () => {
		const ws = await makeJiraWorkspace();
		await syncWorkspace(db, cfg, ws.workspaceId, { fetchImpl: fakeFetch({ searchStatus: 500 }) });

		const [run] = await runsOf(ws.workspaceId);
		expect(run.status).toBe('ERROR');
		expect(run.ticketsCreated).toBe(0);
		expect(run.error).toBeTruthy();
	});
});
