import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db/connection';
import { workspace, project, ticket } from '$lib/server/db/schema';
import {
	getAzureToken,
	searchJiraIssues,
	formatJqlDateTime,
	hasOrderByClause,
	JiraAuthError,
	type JiraClientConfig,
	type JiraIssue
} from './jiraClient';
import { decryptSecret } from '../auth/secretCrypto';

// $env-libre par design (comme db/connection.ts) : ce module tourne à la fois dans SvelteKit
// (action "forcer le sync") et sous tsx brut (scripts/jira-sync.ts, CronJob) où $env ne se
// résout pas. db et cfg sont donc toujours des paramètres explicites, jamais des imports.

export type JiraSyncConfig = JiraClientConfig & { patEncryptionKey: string };

export type SyncResult =
	| { ok: true; workspaceId: string; ticketsUpserted: number }
	| { ok: false; workspaceId: string; error: string };

// Échecs d'authentification (401/403 Jira, donc attribuables au PAT) consécutifs avant coupure
// automatique du sync planifié. Fixe, pas configurable par espace — YAGNI tant que non demandé.
const MAX_CONSECUTIVE_AUTH_FAILURES = 5;

// Marge soustraite à syncStartedAt avant d'écrire le nouveau jiraUpdatedSince. Pas la même classe
// de risque que TOKEN_EXPIRY_MARGIN_MS (jiraClient.ts) : celle-ci ne couvre qu'un décalage
// d'horloge entre deux machines (secondes). Ici, la marge doit surtout absorber une mauvaise
// interprétation de fuseau du littéral JQL (voir formatJqlDateTime) — potentiellement des heures,
// pas des secondes — et le sens de l'erreur compte : une marge trop courte redemande juste un peu
// plus (sans risque), trop longue fait silencieusement sauter des tickets modifiés dans
// l'intervalle. 3h absorbe un décalage CET/CEST complet dans les deux sens, pour un coût
// négligeable vu que le CronJob tourne déjà par créneaux de 4h/12h. À resserrer une fois le
// comportement réel de l'instance confirmé (voir formatJqlDateTime).
export const WATERMARK_SAFETY_MARGIN_MS = 3 * 60 * 60 * 1000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Écrit l'échec sur workspace.jiraLastSync* et, uniquement pour un échec d'auth (PAT), incrémente
 *  le compteur du circuit breaker — jamais pour un échec réseau/Azure/JQL, qui n'est pas la faute
 *  du PAT (voir la distinction JiraAuthError/JiraApiError dans jiraClient.ts). */
async function finalizeError(
	db: Db,
	workspaceId: string,
	message: string,
	isAuthFailure: boolean
): Promise<SyncResult> {
	if (!isAuthFailure) {
		await db
			.update(workspace)
			.set({ jiraLastSyncAt: new Date(), jiraLastSyncStatus: 'ERROR', jiraLastSyncError: message })
			.where(eq(workspace.id, workspaceId));
		return { ok: false, workspaceId, error: message };
	}

	const [row] = await db
		.update(workspace)
		.set({
			jiraLastSyncAt: new Date(),
			jiraLastSyncStatus: 'ERROR',
			jiraLastSyncError: message,
			jiraConsecutiveFailures: sql`${workspace.jiraConsecutiveFailures} + 1`
		})
		.where(eq(workspace.id, workspaceId))
		.returning({ failures: workspace.jiraConsecutiveFailures });

	const failures = row?.failures ?? 0;
	if (failures < MAX_CONSECUTIVE_AUTH_FAILURES) return { ok: false, workspaceId, error: message };

	const disabledMessage = `${message} — synchronisation planifiée désactivée automatiquement après ${MAX_CONSECUTIVE_AUTH_FAILURES} échecs consécutifs.`;
	await db
		.update(workspace)
		.set({ jiraSyncEnabled: false, jiraLastSyncError: disabledMessage })
		.where(eq(workspace.id, workspaceId));
	return { ok: false, workspaceId, error: disabledMessage };
}

/**
 * Sync d'un seul espace — sans condition sur jiraSyncEnabled : un admin doit pouvoir tester un PAT
 * fraîchement saisi, ou vérifier qu'un correctif fonctionne après une coupure du circuit breaker,
 * avant de ré-activer la planification. `opts.azureToken` permet à syncAllEnabledWorkspaces de
 * réutiliser un seul token Azure pour tout un run plutôt que d'en refetch un par espace.
 */
export async function syncWorkspace(
	db: Db,
	cfg: JiraSyncConfig,
	workspaceId: string,
	opts?: { azureToken?: string; fetchImpl?: typeof fetch }
): Promise<SyncResult> {
	// Capturé avant tout le reste : la marge de sécurité doit couvrir tout ce qui suit, et ça évite
	// d'avoir à raisonner sur lequel des retours anticipés ci-dessous s'exécute en premier.
	const syncStartedAt = new Date();

	const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
	if (!ws) return { ok: false, workspaceId, error: 'Espace introuvable.' };

	const jql = ws.jiraJql?.trim() ?? '';
	if (!ws.jiraPatEncrypted || !jql) {
		return finalizeError(db, workspaceId, 'Configuration Jira incomplète (PAT ou JQL manquant).', false);
	}

	// Un ORDER BY dans le JQL admin casse une fois wrappé entre parenthèses ci-dessous (JQL
	// invalide -> 400 -> JiraApiError, qui ne déclenche jamais le circuit breaker : sans ce
	// garde-fou, un espace concerné échouerait en silence à chaque run planifié, indéfiniment).
	// saveJiraConfig (accounts.ts) rejette déjà ORDER BY à l'enregistrement ; ce contrôle protège
	// en plus les lignes enregistrées avant l'existence de cette validation.
	if (ws.jiraUpdatedSince && hasOrderByClause(jql)) {
		return finalizeError(
			db,
			workspaceId,
			"Le filtre JQL contient ORDER BY, incompatible avec la date minimum (le tri n'est pas utilisé par le sync — retirez-le).",
			false
		);
	}
	const effectiveJql = ws.jiraUpdatedSince ? `(${jql}) AND updated >= "${formatJqlDateTime(ws.jiraUpdatedSince)}"` : jql;

	let keyRegex: RegExp | null = null;
	if (ws.jiraKeyRegexPattern) {
		try {
			keyRegex = new RegExp(ws.jiraKeyRegexPattern);
		} catch {
			return finalizeError(db, workspaceId, 'Regex de mapping de clé invalide.', false);
		}
	}
	const keyReplacement = ws.jiraKeyRegexReplacement ?? '';
	const transformKey = (key: string) => (keyRegex ? key.replace(keyRegex, keyReplacement) : key);

	let pat: string;
	try {
		pat = decryptSecret(ws.jiraPatEncrypted, cfg.patEncryptionKey);
	} catch {
		return finalizeError(
			db,
			workspaceId,
			'Impossible de déchiffrer le PAT Jira (clé de chiffrement invalide ou changée ?).',
			false
		);
	}

	let issues: JiraIssue[];
	try {
		const azureToken = opts?.azureToken ?? (await getAzureToken(cfg, opts?.fetchImpl));
		issues = await searchJiraIssues(cfg, azureToken, pat, effectiveJql, opts?.fetchImpl);
	} catch (err) {
		return finalizeError(db, workspaceId, errorMessage(err), err instanceof JiraAuthError);
	}

	const keyToId = new Map<string, string>();

	await db.transaction(async (tx) => {
		async function findOrCreateProjectByName(name: string): Promise<string> {
			const trimmed = name.trim();
			const match = and(eq(project.workspaceId, workspaceId), sql`lower(${project.name}) = ${trimmed.toLowerCase()}`);
			const [existing] = await tx.select({ id: project.id }).from(project).where(match);
			if (existing) return existing.id;

			try {
				const [created] = await tx.insert(project).values({ workspaceId, name: trimmed }).returning({ id: project.id });
				return created.id;
			} catch {
				// Course avec un autre run (manuel + planifié en parallèle) créant le même projet entre
				// le select et l'insert : on retente un select plutôt que de faire planter tout le sync.
				const [raced] = await tx.select({ id: project.id }).from(project).where(match);
				if (raced) return raced.id;
				throw new Error(`Impossible de créer ou trouver le projet "${trimmed}".`);
			}
		}

		// Passe 1 : upsert de chaque ticket par (workspaceId, key transformée). Seuls title/projectId
		// sont jamais écrits ici — jamais estimationReal/raeReal/comment/sspCode/stateId/flags, qui
		// restent la propriété exclusive de la saisie humaine, quelle que soit la stratégie ci-dessous.
		for (const issue of issues) {
			const key = transformKey(issue.key);
			const projectId = issue.projectName ? await findOrCreateProjectByName(issue.projectName) : null;

			let row: { id: string } | undefined;
			if (ws.jiraConflictStrategy === 'JIRA_WINS') {
				[row] = await tx
					.insert(ticket)
					.values({ workspaceId, key, title: issue.summary, projectId })
					.onConflictDoUpdate({
						target: [ticket.workspaceId, ticket.key],
						set: { title: issue.summary, projectId, updatedAt: new Date() }
					})
					.returning({ id: ticket.id });
			} else {
				// KEEP_LOCAL (défaut) : un ticket déjà connu (créé à la main ou par un sync précédent)
				// n'est jamais modifié — seulement "reconnu" pour la résolution des parents ci-dessous.
				[row] = await tx
					.insert(ticket)
					.values({ workspaceId, key, title: issue.summary, projectId })
					.onConflictDoNothing({ target: [ticket.workspaceId, ticket.key] })
					.returning({ id: ticket.id });
				if (!row) {
					[row] = await tx
						.select({ id: ticket.id })
						.from(ticket)
						.where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.key, key)));
				}
			}
			if (row) keyToId.set(key, row.id);
		}

		// Passe 2 : résolution des liens parent (clés déjà transformées), après upsert de tous les
		// tickets du run — un parent peut apparaître après son enfant dans une réponse paginée.
		for (const issue of issues) {
			if (!issue.parentKey) continue;
			const childId = keyToId.get(transformKey(issue.key));
			if (!childId) continue;

			const parentKey = transformKey(issue.parentKey);
			let parentId = keyToId.get(parentKey);
			if (!parentId) {
				const [parentRow] = await tx
					.select({ id: ticket.id })
					.from(ticket)
					.where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.key, parentKey)));
				parentId = parentRow?.id;
			}
			if (parentId) await tx.update(ticket).set({ parentId }).where(eq(ticket.id, childId));
		}
	});

	await db
		.update(workspace)
		.set({
			jiraLastSyncAt: new Date(),
			jiraLastSyncStatus: 'SUCCESS',
			jiraLastSyncError: null,
			jiraLastSyncTicketCount: issues.length,
			jiraConsecutiveFailures: 0,
			jiraUpdatedSince: new Date(syncStartedAt.getTime() - WATERMARK_SAFETY_MARGIN_MS)
		})
		.where(eq(workspace.id, workspaceId));

	return { ok: true, workspaceId, ticketsUpserted: issues.length };
}

/**
 * Boucle séquentielle (pas parallèle, même choix que runSnapshot) sur tous les espaces avec
 * jiraSyncEnabled = true — exclut donc naturellement ceux désactivés manuellement ou par le
 * circuit breaker. Un seul token Azure fetché et partagé pour tout le run.
 */
export async function syncAllEnabledWorkspaces(
	db: Db,
	cfg: JiraSyncConfig,
	opts?: { fetchImpl?: typeof fetch }
): Promise<SyncResult[]> {
	const enabled = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.jiraSyncEnabled, true));
	if (enabled.length === 0) return [];

	let azureToken: string;
	try {
		azureToken = await getAzureToken(cfg, opts?.fetchImpl);
	} catch (err) {
		// Panne Azure globale (credentials de l'app, pas d'un espace) : ne pas la compter comme un
		// échec d'auth PAT pour autant — voir finalizeError. On reporte quand même l'échec sur chaque
		// espace qui aurait dû tourner, pour la visibilité opérationnelle.
		const message = errorMessage(err);
		const results: SyncResult[] = [];
		for (const ws of enabled) results.push(await finalizeError(db, ws.id, message, false));
		return results;
	}

	const results: SyncResult[] = [];
	for (const ws of enabled) {
		results.push(await syncWorkspace(db, cfg, ws.id, { azureToken, fetchImpl: opts?.fetchImpl }));
	}
	return results;
}
