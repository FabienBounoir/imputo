import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { workspace, project, sprint, ticket, jiraSyncRun } from '../db/schema';
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

// Mapping fixe nom Jira -> échelle locale (0 = P0/Urgent … 4 = P4/Backlog), pas de découverte
// dynamique — même choix que SPRINT_CUSTOM_FIELD_ID (jiraClient.ts), YAGNI tant qu'une seule
// instance Jira est visée. Comparaison insensible à la casse/espaces (noms saisis à la main côté
// Jira, mieux vaut tolérer une variante que perdre silencieusement le mapping).
const JIRA_PRIORITY_MAP: Record<string, number> = {
	urgent: 0,
	haute: 1,
	normal: 2,
	faible: 3,
	backlog: 4
};

/** undefined = nom absent ou non reconnu : le champ n'est alors simplement pas touché par le sync
 *  (comme project/sprint/version quand la résolution échoue), jamais une valeur devinée. */
function resolveJiraPriority(name: string | null): number | undefined {
	if (!name) return undefined;
	return JIRA_PRIORITY_MAP[name.trim().toLowerCase()];
}

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
		await db.insert(jiraSyncRun).values({ workspaceId, startedAt: new Date(), status: 'ERROR', error: message });
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
	if (failures < MAX_CONSECUTIVE_AUTH_FAILURES) {
		await db.insert(jiraSyncRun).values({ workspaceId, startedAt: new Date(), status: 'ERROR', error: message });
		return { ok: false, workspaceId, error: message };
	}

	const disabledMessage = `${message} — synchronisation planifiée désactivée automatiquement après ${MAX_CONSECUTIVE_AUTH_FAILURES} échecs consécutifs.`;
	await db
		.update(workspace)
		.set({ jiraSyncEnabled: false, jiraLastSyncError: disabledMessage })
		.where(eq(workspace.id, workspaceId));
	await db.insert(jiraSyncRun).values({ workspaceId, startedAt: new Date(), status: 'ERROR', error: disabledMessage });
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
	if ((ws.jiraUpdatedSince || ws.jiraCreatedSince) && hasOrderByClause(jql)) {
		return finalizeError(
			db,
			workspaceId,
			"Le filtre JQL contient ORDER BY, incompatible avec les dates minimum (le tri n'est pas utilisé par le sync — retirez-le).",
			false
		);
	}
	// jiraCreatedSince (plancher fixe sur `created`) se combine à jiraUpdatedSince (watermark sur
	// `updated`) sans lien entre les deux — chacun filtre indépendamment, le sync n'envoie que les
	// clauses effectivement définies.
	const dateFilters: string[] = [];
	if (ws.jiraUpdatedSince) dateFilters.push(`updated >= "${formatJqlDateTime(ws.jiraUpdatedSince)}"`);
	if (ws.jiraCreatedSince) dateFilters.push(`created >= "${formatJqlDateTime(ws.jiraCreatedSince)}"`);
	const effectiveJql = dateFilters.length > 0 ? `(${jql}) AND ${dateFilters.join(' AND ')}` : jql;

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
	// Tickets réellement insérés par ce run (pas juste "vus") — sert à taguer createdBySyncRunId après
	// coup (cf. plus bas) : plus simple que d'exiger l'id du run avant même de savoir si le run réussit.
	const createdIds: string[] = [];

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

		/** Même logique que findOrCreateProjectByName, sur la table sprint (kind SPRINT ou VERSION —
		 *  même table, discriminée par kind). Protégé côté DB par l'index unique
		 *  sprint_ws_kind_name_uq (workspaceId, kind, lower(name)) sur les lignes non archivées. */
		async function findOrCreateSprintRow(kind: 'SPRINT' | 'VERSION', name: string): Promise<string> {
			const trimmed = name.trim();
			const match = and(
				eq(sprint.workspaceId, workspaceId),
				eq(sprint.kind, kind),
				sql`lower(${sprint.name}) = ${trimmed.toLowerCase()}`
			);
			const [existing] = await tx.select({ id: sprint.id }).from(sprint).where(match);
			if (existing) return existing.id;

			try {
				const [created] = await tx.insert(sprint).values({ workspaceId, kind, name: trimmed }).returning({ id: sprint.id });
				return created.id;
			} catch {
				const [raced] = await tx.select({ id: sprint.id }).from(sprint).where(match);
				if (raced) return raced.id;
				throw new Error(`Impossible de créer ou trouver ${kind === 'VERSION' ? 'la version' : 'le sprint'} "${trimmed}".`);
			}
		}

		// Passe 1 : upsert de chaque ticket par (workspaceId, key transformée). estimationReal/raeReal/
		// comment/sspCode/stateId/flags restent la propriété exclusive de la saisie humaine, quelle que
		// soit la stratégie ci-dessous — jamais écrits ici. title/projectId/sprintId/versionId passent
		// en plus par les cases jiraSyncXxx de l'espace : décoché, un champ n'est jamais écrit, ni à la
		// création ni à la mise à jour — sauf le titre, toujours posé à la création (ticket.title est
		// NOT NULL, un ticket ne peut pas exister sans, cf. docs/SPECS-jira-sprint-version.md §6).
		for (const issue of issues) {
			const key = transformKey(issue.key);

			let row: { id: string } | undefined;
			if (ws.jiraConflictStrategy === 'JIRA_WINS') {
				// JIRA_WINS : la valeur sert toujours (création ou écrasement), on la résout dans tous
				// les cas.
				const projectId = ws.jiraSyncProject && issue.projectName ? await findOrCreateProjectByName(issue.projectName) : null;
				const versionId = ws.jiraSyncVersion && issue.versionName ? await findOrCreateSprintRow('VERSION', issue.versionName) : null;
				const sprintId = ws.jiraSyncSprint && issue.sprintName ? await findOrCreateSprintRow('SPRINT', issue.sprintName) : null;

				const priority = ws.jiraSyncPriority ? resolveJiraPriority(issue.priorityName) : undefined;

				const insertValues: typeof ticket.$inferInsert = { workspaceId, key, title: issue.summary };
				if (ws.jiraSyncProject) insertValues.projectId = projectId;
				if (ws.jiraSyncSprint) insertValues.sprintId = sprintId;
				if (ws.jiraSyncVersion) insertValues.versionId = versionId;
				if (priority !== undefined) insertValues.priority = priority;

				const updateSet: Partial<typeof ticket.$inferInsert> = { updatedAt: new Date() };
				if (ws.jiraSyncTitle) updateSet.title = issue.summary;
				if (ws.jiraSyncProject) updateSet.projectId = projectId;
				if (ws.jiraSyncSprint) updateSet.sprintId = sprintId;
				if (ws.jiraSyncVersion) updateSet.versionId = versionId;
				if (priority !== undefined) updateSet.priority = priority;

				const [r] = await tx
					.insert(ticket)
					.values(insertValues)
					.onConflictDoUpdate({
						target: [ticket.workspaceId, ticket.key],
						set: updateSet
					})
					// xmax = 0 : ligne réellement insérée par cette requête (pas juste mise à jour par ON
					// CONFLICT) — seul moyen de distinguer les deux avec un upsert qui renvoie toujours une ligne.
					.returning({ id: ticket.id, inserted: sql<boolean>`(xmax = 0)` });
				row = r;
				if (r?.inserted) createdIds.push(r.id);
			} else {
				// KEEP_LOCAL (défaut) : un ticket déjà connu (créé à la main ou par un sync précédent)
				// n'est jamais modifié. Titre d'abord, seul champ dont on a besoin avant de savoir si le
				// ticket est nouveau — surtout ne PAS résoudre project/sprint/version avant de le savoir :
				// pour un ticket déjà connu, la valeur ne sera jamais utilisée, et findOrCreate* a l'effet
				// de bord de créer la ligne project/sprint/version en base même si elle ne sert à rien
				// (repéré en test réel : ça polluait la DB de versions/sprints sans aucun ticket rattaché).
				const [inserted] = await tx
					.insert(ticket)
					.values({ workspaceId, key, title: issue.summary })
					.onConflictDoNothing({ target: [ticket.workspaceId, ticket.key] })
					.returning({ id: ticket.id });

				if (inserted) {
					// Genuinely nouveau : là seulement, résoudre et poser project/sprint/version.
					createdIds.push(inserted.id);
					const projectId = ws.jiraSyncProject && issue.projectName ? await findOrCreateProjectByName(issue.projectName) : null;
					const versionId = ws.jiraSyncVersion && issue.versionName ? await findOrCreateSprintRow('VERSION', issue.versionName) : null;
					const sprintId = ws.jiraSyncSprint && issue.sprintName ? await findOrCreateSprintRow('SPRINT', issue.sprintName) : null;
					const priority = ws.jiraSyncPriority ? resolveJiraPriority(issue.priorityName) : undefined;
					const extra: Partial<typeof ticket.$inferInsert> = {};
					if (ws.jiraSyncProject) extra.projectId = projectId;
					if (ws.jiraSyncSprint) extra.sprintId = sprintId;
					if (ws.jiraSyncVersion) extra.versionId = versionId;
					if (priority !== undefined) extra.priority = priority;
					if (Object.keys(extra).length > 0) await tx.update(ticket).set(extra).where(eq(ticket.id, inserted.id));
					row = inserted;
				} else {
					// Ticket déjà connu : jamais modifié, project/sprint/version compris — rien à résoudre.
					[row] = await tx
						.select({ id: ticket.id })
						.from(ticket)
						.where(and(eq(ticket.workspaceId, workspaceId), eq(ticket.key, key)));
				}
			}
			if (row) keyToId.set(key, row.id);
		}

		// Passe 2 : résolution des liens parent (clés déjà transformées), après upsert de tous les
		// tickets du run — un parent peut apparaître après son enfant dans une réponse paginée. Jamais
		// gouvernée par jiraConflictStrategy (comportement historique inchangé) — jiraSyncParent permet
		// juste de la sauter entièrement si décoché.
		if (ws.jiraSyncParent) {
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

	const [run] = await db
		.insert(jiraSyncRun)
		.values({
			workspaceId,
			startedAt: syncStartedAt,
			status: 'SUCCESS',
			ticketsSeen: issues.length,
			ticketsCreated: createdIds.length
		})
		.returning({ id: jiraSyncRun.id });
	if (createdIds.length > 0) {
		await db.update(ticket).set({ createdBySyncRunId: run.id }).where(inArray(ticket.id, createdIds));
	}

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
