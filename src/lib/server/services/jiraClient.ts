// Client Jira + Azure AD — sans dépendance à $env (voir jiraSync.ts pour pourquoi : ce module
// doit tourner à la fois dans SvelteKit et sous tsx brut via le CronJob). Toute la config est
// passée en paramètre.

export type JiraClientConfig = {
	azureTenantId: string;
	azureClientId: string;
	azureClientSecret: string;
	jiraBaseUrl: string;
};

/** 401/403 sur l'appel Jira lui-même — attribuable au PAT (JTOKEN), déclenche le circuit breaker
 *  par espace côté jiraSync.ts. Ne JAMAIS lever ceci pour un échec du token Azure (cf. plus bas). */
export class JiraAuthError extends Error {}
/** Tout le reste : échec réseau/timeout, échec Azure AD (credentials globales, pas la faute d'un
 *  espace en particulier), 5xx Jira, JQL invalide, réponse inattendue. */
export class JiraApiError extends Error {}

const FETCH_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;
// Marge avant l'expiration réelle du token Azure pour ne jamais en utiliser un sur le point d'expirer.
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/** Fetch + parsing JSON tolérant, réseau/timeout convertis en JiraApiError — jamais d'exception brute. */
async function fetchJson<T>(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit
): Promise<{ status: number; body: T | null; text: string }> {
	let res: Response;
	try {
		res = await fetchWithTimeout(fetchImpl, url, init);
	} catch (err) {
		throw new JiraApiError(`Appel réseau échoué : ${err instanceof Error ? err.message : String(err)}`);
	}
	const text = await res.text().catch(() => '');
	let body: T | null = null;
	try {
		body = text ? (JSON.parse(text) as T) : null;
	} catch {
		body = null;
	}
	return { status: res.status, body, text };
}

type AzureTokenResponse = { access_token: string; expires_in: number };

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

/** Token Azure AD (client_credentials), caché en mémoire — un seul fetch partagé pour tout un run
 *  multi-espaces plutôt qu'un par espace. Un échec ici est une panne d'infra globale (credentials
 *  Azure de l'app, pas d'un espace), donc toujours JiraApiError. */
export async function getAzureToken(cfg: JiraClientConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
	const cacheKey = `${cfg.azureTenantId}:${cfg.azureClientId}`;
	if (tokenCache && tokenCache.key === cacheKey && Date.now() < tokenCache.expiresAt) {
		return tokenCache.token;
	}

	const { status, body } = await fetchJson<AzureTokenResponse>(
		fetchImpl,
		`https://login.microsoftonline.com/${cfg.azureTenantId}/oauth2/v2.0/token`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: cfg.azureClientId,
				client_secret: cfg.azureClientSecret,
				scope: `${cfg.jiraBaseUrl}/.default`
			})
		}
	);

	if (status < 200 || status >= 300 || !body?.access_token) {
		throw new JiraApiError(`Échec d'authentification Azure AD (${status}).`);
	}

	tokenCache = {
		key: cacheKey,
		token: body.access_token,
		expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS
	};
	return body.access_token;
}

export type JiraIssue = {
	key: string;
	summary: string;
	issueTypeName: string;
	/** fields.parent.key — sous-tâche Jira native (cf. SPECS.md §2.A), pas un Epic Link. */
	parentKey: string | null;
	projectName: string;
	/** Toutes les entrées de fixVersions (pas "versions"/affectedVersion, un champ différent — voir
	 *  docs/SPECS-jira-sprint-version.md §3). Un ticket peut avoir plusieurs fix versions Jira. */
	versionNames: string[];
	/** Toutes les entrées du customfield Sprint, mappées via parseSprintName ci-dessous — un ticket
	 *  peut appartenir à plusieurs sprints (historique de déplacement + sprints actifs multiples). */
	sprintNames: string[];
};

// Sprint = champ custom du plugin Jira Software (Greenhopper), spécifique à cette instance —
// identifié via GET /rest/api/2/field le 2026-08-16 (voir docs/SPECS-jira-sprint-version.md §4).
// Pas de découverte dynamique : YAGNI tant qu'une seule instance Jira est visée par ce sync.
const SPRINT_CUSTOM_FIELD_ID = 'customfield_10105';

type JiraSearchResponse = {
	startAt: number;
	total: number;
	issues: Array<{
		key: string;
		fields: {
			summary: string;
			issuetype?: { name: string };
			parent?: { key: string };
			project?: { name: string };
			fixVersions?: Array<{ name: string }>;
			// Champ custom, clé dynamique (SPRINT_CUSTOM_FIELD_ID) — voir parseSprintName.
			[customFieldId: string]: unknown;
		};
	}>;
};

/**
 * Le customfield Sprint (Server/DC, plugin Greenhopper) n'est pas du JSON dans /rest/api/2/search
 * mais le toString() Java de l'objet, ex. :
 * "com.atlassian.greenhopper.service.sprint.Sprint@715e...[...,name=Sprint V36,state=ACTIVE,...]"
 * — confirmé en direct le 2026-08-16 (docs/SPECS-jira-sprint-version.md §4). Regex ciblée sur la
 * clé `name=` plutôt qu'un split sur les virgules : `goal` est un texte libre qui pourrait en
 * contenir une et décalerait un split naïf — une regex par clé reste correcte indépendamment.
 */
function parseSprintName(raw: string): string | null {
	const match = /\bname=([^,\]]+)/.exec(raw);
	return match ? match[1].trim() : null;
}

/** Littéral date JQL pour "updated >= ...", ex. "2026-08-13 10:05". JQL n'a pas de marqueur de
 *  fuseau dans ses littéraux : Jira les interprète selon un fuseau configuré côté serveur, pas
 *  forcément UTC. Formaté en UTC par défaut — séparateur ET fuseau réel à confirmer contre
 *  l'instance réelle avant de lui faire confiance (même traitement que la forme de réponse de
 *  searchJiraIssues : deux inconnues, pas une seule — voir la marge de sécurité dans jiraSync.ts). */
export function formatJqlDateTime(d: Date): string {
	return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** Détection volontairement grossière (regex, pas un parseur JQL) d'un ORDER BY terminal — sert à
 *  refuser tôt un JQL qui casserait une fois wrappé entre parenthèses pour jiraUpdatedSince (voir
 *  jiraSync.ts). Faux positif possible si "order by" apparaît dans une valeur textuelle entre
 *  guillemets : accepté, c'est une limite documentée plutôt qu'un vrai parseur. */
export function hasOrderByClause(jql: string): boolean {
	return /\border\s+by\b/i.test(jql);
}

/** GET /rest/api/2/search, pagination startAt/maxResults/total jusqu'à épuisement. Headers JTOKEN
 *  (PAT de l'espace) + Authorization (token Azure partagé) — contrat confirmé contre l'instance
 *  réelle. Forme exacte de la réponse à re-vérifier live avant de faire confiance à ce parsing. */
export async function searchJiraIssues(
	cfg: JiraClientConfig,
	azureToken: string,
	pat: string,
	jql: string,
	fetchImpl: typeof fetch = fetch
): Promise<JiraIssue[]> {
	const issues: JiraIssue[] = [];
	let startAt = 0;
	let total = Infinity;

	while (startAt < total) {
		const url = new URL(`${cfg.jiraBaseUrl}/rest/api/2/search`);
		url.searchParams.set('jql', jql);
		url.searchParams.set('startAt', String(startAt));
		url.searchParams.set('maxResults', String(PAGE_SIZE));
		url.searchParams.set('fields', `summary,issuetype,parent,project,fixVersions,${SPRINT_CUSTOM_FIELD_ID}`);

		const { status, body, text } = await fetchJson<JiraSearchResponse>(fetchImpl, url.toString(), {
			headers: { JTOKEN: `Bearer ${pat}`, Authorization: `Bearer ${azureToken}` }
		});

		if (status === 401 || status === 403) {
			throw new JiraAuthError(`PAT Jira invalide ou expiré (${status}).`);
		}
		if (status < 200 || status >= 300 || !body) {
			throw new JiraApiError(`Erreur Jira (${status}) : ${text.slice(0, 200)}`);
		}

		for (const issue of body.issues) {
			const sprintRaw = issue.fields[SPRINT_CUSTOM_FIELD_ID];
			const sprintEntries = Array.isArray(sprintRaw) ? sprintRaw.filter((s): s is string => typeof s === 'string') : [];
			issues.push({
				key: issue.key,
				summary: issue.fields.summary ?? '',
				issueTypeName: issue.fields.issuetype?.name ?? '',
				parentKey: issue.fields.parent?.key ?? null,
				projectName: issue.fields.project?.name ?? '',
				versionNames: (issue.fields.fixVersions ?? []).map((v) => v.name).filter(Boolean),
				sprintNames: sprintEntries.map(parseSprintName).filter((n): n is string => !!n)
			});
		}

		total = body.total;
		startAt += body.issues.length;
		if (body.issues.length === 0) break; // garde-fou anti-boucle si l'API renvoie moins que prévu
	}

	return issues;
}
