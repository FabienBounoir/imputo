import { describe, it, expect } from 'vitest';
import {
	getAzureToken,
	searchJiraIssues,
	formatJqlDateTime,
	hasOrderByClause,
	JiraAuthError,
	JiraApiError,
	type JiraClientConfig
} from './jiraClient';

const baseCfg: JiraClientConfig = {
	azureTenantId: 'tenant-1',
	azureClientId: 'client-1',
	azureClientSecret: 'secret-1',
	jiraBaseUrl: 'https://jira.example.test'
};

/** azureClientId unique par test pour ne jamais retomber sur le cache mémoire d'un autre test. */
function cfgWithClientId(clientId: string): JiraClientConfig {
	return { ...baseCfg, azureClientId: clientId };
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

function makeFakeFetch(handlers: { token?: (n: number) => Response; search?: (n: number, startAt: number) => Response }) {
	let tokenCalls = 0;
	let searchCalls = 0;
	const fetchImpl = (async (input: RequestInfo | URL) => {
		const url = input.toString();
		if (url.includes('login.microsoftonline.com')) {
			const res = handlers.token?.(tokenCalls);
			tokenCalls++;
			if (!res) throw new Error('no token handler configured');
			return res;
		}
		if (url.includes('/rest/api/2/search')) {
			const startAt = Number(new URL(url).searchParams.get('startAt'));
			const res = handlers.search?.(searchCalls, startAt);
			searchCalls++;
			if (!res) throw new Error('no search handler configured');
			return res;
		}
		throw new Error(`unexpected url: ${url}`);
	}) as typeof fetch;
	return { fetchImpl, calls: () => ({ token: tokenCalls, search: searchCalls }) };
}

describe('jiraClient / getAzureToken', () => {
	it('renvoie le token et le cache — un seul appel réseau pour deux résolutions successives', async () => {
		const { fetchImpl, calls } = makeFakeFetch({
			token: () => jsonResponse(200, { access_token: 'tok-abc', expires_in: 3600 })
		});
		const cfg = cfgWithClientId('cache-hit-test');

		const first = await getAzureToken(cfg, fetchImpl);
		const second = await getAzureToken(cfg, fetchImpl);

		expect(first).toBe('tok-abc');
		expect(second).toBe('tok-abc');
		expect(calls().token).toBe(1);
	});

	it('échec Azure AD (credentials globales) -> JiraApiError, jamais JiraAuthError', async () => {
		const { fetchImpl } = makeFakeFetch({
			token: () => jsonResponse(401, { error: 'invalid_client' })
		});
		const cfg = cfgWithClientId('azure-failure-test');

		await expect(getAzureToken(cfg, fetchImpl)).rejects.toBeInstanceOf(JiraApiError);
	});

	it('échec réseau (fetch qui throw) -> JiraApiError, pas l’exception brute', async () => {
		const cfg = cfgWithClientId('network-failure-test');
		const fetchImpl = (async () => {
			throw new Error('ECONNRESET');
		}) as typeof fetch;

		await expect(getAzureToken(cfg, fetchImpl)).rejects.toBeInstanceOf(JiraApiError);
	});
});

describe('jiraClient / searchJiraIssues', () => {
	it('pagine jusqu’à épuisement (startAt/maxResults/total)', async () => {
		const total = 250; // 100 + 100 + 50 à PAGE_SIZE=100
		const { fetchImpl, calls } = makeFakeFetch({
			search: (_n, startAt) => {
				const count = Math.min(100, total - startAt);
				const issues = Array.from({ length: count }, (_, i) => ({
					key: `BLM-${startAt + i}`,
					fields: { summary: `Ticket ${startAt + i}`, issuetype: { name: 'Story' }, project: { name: 'Appli' } }
				}));
				return jsonResponse(200, { startAt, total, issues });
			}
		});

		const issues = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);

		expect(issues).toHaveLength(250);
		expect(calls().search).toBe(3);
		expect(issues[0].key).toBe('BLM-0');
		expect(issues[249].key).toBe('BLM-249');
	});

	it('extrait key/summary/issuetype/parentKey/projectName', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [
						{
							key: 'BLM-42',
							fields: {
								summary: 'Corriger le bouton',
								issuetype: { name: 'Sous-tâche' },
								parent: { key: 'BLM-1' },
								project: { name: 'Application Mobile' }
							}
						}
					]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);

		expect(issue).toEqual({
			key: 'BLM-42',
			summary: 'Corriger le bouton',
			issueTypeName: 'Sous-tâche',
			parentKey: 'BLM-1',
			projectName: 'Application Mobile',
			versionName: null,
			sprintName: null,
			priorityName: null
		});
	});

	it('pas de parent -> parentKey null', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [{ key: 'BLM-1', fields: { summary: 'Épopée', issuetype: { name: 'Story' }, project: { name: 'X' } } }]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.parentKey).toBeNull();
	});

	it('fields= inclut fixVersions et le customfield Sprint', async () => {
		let requestedFields = '';
		const fetchImpl = (async (input: RequestInfo | URL) => {
			requestedFields = new URL(input.toString()).searchParams.get('fields') ?? '';
			return jsonResponse(200, { startAt: 0, total: 0, issues: [] });
		}) as typeof fetch;

		await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);

		expect(requestedFields).toContain('fixVersions');
		expect(requestedFields).toContain('customfield_10105');
	});

	it('extrait la dernière entrée de fixVersions en versionName (pas "versions"/affectedVersion)', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [
						{
							key: 'BLM-1',
							fields: {
								summary: 'x',
								project: { name: 'P' },
								fixVersions: [{ name: 'V36' }, { name: 'V37' }],
								versions: [{ name: 'PAS_CELLE_LA' }]
							}
						}
					]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.versionName).toBe('V37');
	});

	it('pas de fixVersions -> versionName null', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [{ key: 'BLM-1', fields: { summary: 'x', project: { name: 'P' } } }]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.versionName).toBeNull();
	});

	it('parse le format toString() Java du Sprint (Server/DC, plugin Greenhopper)', async () => {
		// Chaîne réelle observée en direct le 2026-08-16 contre jira.constellation.soprasteria.com.
		const raw =
			'com.atlassian.greenhopper.service.sprint.Sprint@715e3c72[activatedDate=2026-06-19T17:35:03.865+02:00,autoStartStop=false,completeDate=<null>,endDate=2026-10-26T17:35:00.000+01:00,goal=,id=59928,incompleteIssuesDestinationId=<null>,name=Sprint V36,rapidViewId=18632,sequence=59928,startDate=2026-06-19T17:35:00.000+02:00,state=ACTIVE,synced=false]';
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [{ key: 'BLM-1', fields: { summary: 'x', project: { name: 'P' }, customfield_10105: [raw] } }]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.sprintName).toBe('Sprint V36');
	});

	it('plusieurs sprints dans le tableau -> prend le dernier (le plus récent)', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [
						{
							key: 'BLM-1',
							fields: {
								summary: 'x',
								project: { name: 'P' },
								customfield_10105: [
									'com.atlassian.greenhopper.service.sprint.Sprint@a[name=Sprint 1,state=CLOSED]',
									'com.atlassian.greenhopper.service.sprint.Sprint@b[name=Sprint 2,state=ACTIVE]'
								]
							}
						}
					]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.sprintName).toBe('Sprint 2');
	});

	it('pas de customfield Sprint -> sprintName null', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () =>
				jsonResponse(200, {
					startAt: 0,
					total: 1,
					issues: [{ key: 'BLM-1', fields: { summary: 'x', project: { name: 'P' } } }]
				})
		});

		const [issue] = await searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl);
		expect(issue.sprintName).toBeNull();
	});

	it('401 -> JiraAuthError (PAT)', async () => {
		const { fetchImpl } = makeFakeFetch({ search: () => jsonResponse(401, { errorMessages: ['Unauthorized'] }) });
		await expect(searchJiraIssues(baseCfg, 'azure-tok', 'bad-pat', 'project = BLM', fetchImpl)).rejects.toBeInstanceOf(
			JiraAuthError
		);
	});

	it('403 -> JiraAuthError (PAT)', async () => {
		const { fetchImpl } = makeFakeFetch({ search: () => jsonResponse(403, { errorMessages: ['Forbidden'] }) });
		await expect(searchJiraIssues(baseCfg, 'azure-tok', 'bad-pat', 'project = BLM', fetchImpl)).rejects.toBeInstanceOf(
			JiraAuthError
		);
	});

	it('500 -> JiraApiError', async () => {
		const { fetchImpl } = makeFakeFetch({ search: () => jsonResponse(500, { errorMessages: ['boom'] }) });
		await expect(searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl)).rejects.toBeInstanceOf(
			JiraApiError
		);
	});

	it('JQL invalide (400) -> JiraApiError', async () => {
		const { fetchImpl } = makeFakeFetch({
			search: () => jsonResponse(400, { errorMessages: ["Error in the JQL Query"] })
		});
		await expect(searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'n\'importe quoi', fetchImpl)).rejects.toBeInstanceOf(
			JiraApiError
		);
	});

	it('échec réseau (fetch qui throw) -> JiraApiError', async () => {
		const fetchImpl = (async () => {
			throw new Error('timeout');
		}) as typeof fetch;
		await expect(searchJiraIssues(baseCfg, 'azure-tok', 'pat', 'project = BLM', fetchImpl)).rejects.toBeInstanceOf(
			JiraApiError
		);
	});
});

describe('jiraClient / formatJqlDateTime', () => {
	it('formate en "YYYY-MM-DD HH:mm" (UTC)', () => {
		expect(formatJqlDateTime(new Date('2026-08-13T10:05:00.000Z'))).toBe('2026-08-13 10:05');
	});

	it('tronque les secondes, n’arrondit pas', () => {
		expect(formatJqlDateTime(new Date('2026-08-13T10:05:59.900Z'))).toBe('2026-08-13 10:05');
	});
});

describe('jiraClient / hasOrderByClause', () => {
	it('détecte ORDER BY (nu, insensible à la casse)', () => {
		expect(hasOrderByClause('project = BLM ORDER BY updated DESC')).toBe(true);
		expect(hasOrderByClause('project = BLM order by updated desc')).toBe(true);
	});

	it('ne matche pas un JQL sans ORDER BY', () => {
		expect(hasOrderByClause('project = BLM AND updated >= "2026-01-01 00:00"')).toBe(false);
	});

	it('évite le faux positif évident sans espace ("orderby_field")', () => {
		expect(hasOrderByClause('project = BLM AND orderby_field = 1')).toBe(false);
	});
});
