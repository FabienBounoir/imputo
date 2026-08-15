import { and, desc, eq } from 'drizzle-orm';
import { db, user, membership, setupToken, workspace, jiraSyncRun, type Role } from '$lib/server/db';
import { verifyPassword, hashPassword } from '$lib/server/auth/password';
import { generateToken, hashToken } from '$lib/server/auth/tokens';
import { encryptSecret } from '$lib/server/auth/secretCrypto';
import { hasOrderByClause } from './jiraClient';
import { deleteUntouchedSyncedTickets, type TicketFiltersSnapshot } from './tickets';
import { parseISODate } from '$lib/utils/date';
import { logChange } from './changeLog';
import { config } from '$lib/server/config';

/** Connexion par email + mot de passe. */
export async function login(email: string, password: string): Promise<{ userId: string } | null> {
	const rows = await db
		.select()
		.from(user)
		.where(eq(user.email, email.trim().toLowerCase()));
	const u = rows[0];
	if (!u || !u.passwordHash || !u.active) return null;
	const ok = await verifyPassword(u.passwordHash, password);
	return ok ? { userId: u.id } : null;
}

/**
 * Invite un membre dans un espace (réservé ADMIN).
 * Retourne le token brut (à insérer dans le message à copier).
 */
export async function inviteMember(input: {
	workspaceId: string;
	email: string;
	displayName: string;
	role: Role;
}): Promise<{ token: string; reused: boolean }> {
	const email = input.email.trim().toLowerCase();

	return db.transaction(async (tx) => {
		let [u] = await tx.select().from(user).where(eq(user.email, email));
		let reused = true;
		if (!u) {
			reused = false;
			[u] = await tx
				.insert(user)
				.values({ displayName: input.displayName.trim() || email, email, passwordHash: null })
				.returning();
		}

		const existingMembership = await tx
			.select({ id: membership.id })
			.from(membership)
			.where(and(eq(membership.workspaceId, input.workspaceId), eq(membership.userId, u.id)));
		if (existingMembership.length === 0) {
			await tx
				.insert(membership)
				.values({ workspaceId: input.workspaceId, userId: u.id, role: input.role });
		}

		const { token, hash } = generateToken();
		await tx.insert(setupToken).values({
			id: hash,
			userId: u.id,
			workspaceId: input.workspaceId,
			purpose: 'INVITE',
			expiresAt: new Date(Date.now() + config.magicLinkTtlMs)
		});
		return { token, reused };
	});
}

/** Construit le message d'invitation prêt à copier (l'admin l'envoie lui-même). */
export function buildInviteMessage(opts: {
	workspaceName: string;
	inviterName: string;
	email: string;
	token: string;
}): { subject: string; body: string } {
	const link = `${config.publicBaseUrl}/invite/${opts.token}`;
	return {
		subject: `Invitation à rejoindre l'espace « ${opts.workspaceName} » sur Imputo`,
		body: `Bonjour,

${opts.inviterName} t'invite à rejoindre l'espace « ${opts.workspaceName} » sur Imputo (suivi de chiffrage & d'imputation).

Pour activer ton compte (${opts.email}) et définir ton mot de passe, ouvre ce lien :
${link}

Ce lien est valable ${Math.round(config.magicLinkTtlMs / 86400000)} jours.

À bientôt !`
	};
}

/** Valide un magic link et renvoie l'utilisateur cible. */
export async function getTokenTarget(
	rawToken: string
): Promise<{ userId: string; email: string; tokenId: string } | null> {
	const id = hashToken(rawToken);
	const rows = await db
		.select({ token: setupToken, email: user.email })
		.from(setupToken)
		.innerJoin(user, eq(setupToken.userId, user.id))
		.where(eq(setupToken.id, id));
	const row = rows[0];
	if (!row) return null;
	if (row.token.usedAt || row.token.expiresAt.getTime() < Date.now()) return null;
	return { userId: row.token.userId, email: row.email, tokenId: id };
}

/** Définit le mot de passe via un magic link et invalide le token. */
export async function setPasswordWithToken(rawToken: string, password: string): Promise<boolean> {
	const target = await getTokenTarget(rawToken);
	if (!target) return false;
	const passwordHash = await hashPassword(password);
	await db.transaction(async (tx) => {
		await tx.update(user).set({ passwordHash, active: true }).where(eq(user.id, target.userId));
		await tx.update(setupToken).set({ usedAt: new Date() }).where(eq(setupToken.id, target.tokenId));
	});
	return true;
}

/** Change son propre mot de passe (nécessite l'ancien). */
export async function changePassword(
	userId: string,
	currentPassword: string,
	newPassword: string
): Promise<boolean> {
	const [u] = await db.select().from(user).where(eq(user.id, userId));
	if (!u || !u.passwordHash) return false;
	const ok = await verifyPassword(u.passwordHash, currentPassword);
	if (!ok) return false;
	const passwordHash = await hashPassword(newPassword);
	await db.update(user).set({ passwordHash }).where(eq(user.id, userId));
	return true;
}

/** Mémorise la préférence de thème d'un utilisateur (identité globale). */
export async function setThemePref(userId: string, pref: 'LIGHT' | 'DARK' | 'SYSTEM') {
	await db.update(user).set({ themePref: pref }).where(eq(user.id, userId));
}

/** Force (ou non) une couleur d'accent personnelle, indépendante de celle de l'espace. */
export async function setAccentPref(userId: string, mode: 'WORKSPACE' | 'CUSTOM' | 'RGB', color: string | null) {
	await db.update(user).set({ accentMode: mode, accentColor: mode === 'CUSTOM' ? color : null }).where(eq(user.id, userId));
}

/** Répartition par activité (dashboard sprint/version) : false = ordre des référentiels, true = alphabétique. */
export async function setSortActivitiesAlphaPref(userId: string, value: boolean) {
	await db.update(user).set({ sortActivitiesAlpha: value }).where(eq(user.id, userId));
}

/** Préférence + dernier instantané de filtres tickets (compte, pas espace — cf. réglages). */
export async function getTicketFiltersPref(userId: string): Promise<{ remember: boolean; snapshotRaw: string | null }> {
	const [row] = await db
		.select({ remember: user.rememberTicketFilters, snapshotRaw: user.ticketFiltersSnapshot })
		.from(user)
		.where(eq(user.id, userId));
	return { remember: row?.remember ?? true, snapshotRaw: row?.snapshotRaw ?? null };
}

/** Active/désactive la mémorisation des filtres tickets (le snapshot n'est pas effacé : réactiver retrouve le dernier état). */
export async function setRememberTicketFiltersPref(userId: string, value: boolean) {
	await db.update(user).set({ rememberTicketFilters: value }).where(eq(user.id, userId));
}

/** Détail par activité replié par défaut sous chaque ticket (vue tableau) — préférence de compte. */
export async function getCompactTicketActivityPref(userId: string): Promise<boolean> {
	const [row] = await db.select({ v: user.compactTicketActivity }).from(user).where(eq(user.id, userId));
	return row?.v ?? true;
}

export async function setCompactTicketActivityPref(userId: string, value: boolean) {
	await db.update(user).set({ compactTicketActivity: value }).where(eq(user.id, userId));
}

/** Remplace entièrement le dernier état de filtres tickets — un champ absent du payload = filtre
 *  désormais vide, c'est ce qui permet à "Réinitialiser" de s'y refléter sans code dédié. */
export async function setTicketFiltersSnapshot(userId: string, snapshot: TicketFiltersSnapshot) {
	await db.update(user).set({ ticketFiltersSnapshot: JSON.stringify(snapshot) }).where(eq(user.id, userId));
}

/** Met à jour la couleur d'accent d'un espace (réservé ADMIN). */
export async function setAccentColor(workspaceId: string, color: string, rgb: boolean) {
	await db.update(workspace).set({ accentColor: color, accentRgb: rgb }).where(eq(workspace.id, workspaceId));
}

export async function setTestPhase(workspaceId: string, enabled: boolean) {
	await db.update(workspace).set({ testPhase: enabled }).where(eq(workspace.id, workspaceId));
}

/** Ratio PPR = estimationReal * pprRatio (par défaut 0.90), réservé ADMIN. */
export async function setPprRatio(workspaceId: string, ratio: number) {
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error('Ratio PPR invalide (entre 0 et 1).');
	await db.update(workspace).set({ pprRatio: String(ratio) }).where(eq(workspace.id, workspaceId));
}

/** Pas de saisie de la grille d'imputation (ex. 0.25 = quart de jour), réservé ADMIN. */
export async function setImputationStep(workspaceId: string, step: number) {
	if (!Number.isFinite(step) || step <= 0 || step > 1) throw new Error('Pas d\'imputation invalide (entre 0 et 1).');
	await db.update(workspace).set({ imputationStep: String(step) }).where(eq(workspace.id, workspaceId));
}

const memberWhere = (workspaceId: string, userId: string) =>
	and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId));

/** Le créateur de l'espace (super admin) : rôle et statut protégés, seul le transfert de propriété peut les changer. */
async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
	const rows = await db.select({ id: workspace.id }).from(workspace).where(
		and(eq(workspace.id, workspaceId), eq(workspace.createdByUserId, userId))
	);
	return rows.length > 0;
}

/** Change le rôle d'un membre dans un espace (réservé ADMIN). Le créateur de l'espace ne peut être rétrogradé. */
export async function setMemberRole(workspaceId: string, userId: string, role: Role) {
	if (role !== 'ADMIN' && (await isWorkspaceOwner(workspaceId, userId)))
		throw new Error("Le créateur de l'espace ne peut pas être rétrogradé (transférez la propriété d'abord).");
	const res = await db
		.update(membership)
		.set({ role })
		.where(memberWhere(workspaceId, userId))
		.returning({ id: membership.id });
	if (!res[0]) throw new Error('Membre introuvable dans cet espace.');
}

/** Transmet la propriété de l'espace à un autre membre ADMIN actif ; l'ancien créateur redevient un admin classique. */
export async function transferOwnership(workspaceId: string, currentOwnerId: string, newOwnerId: string) {
	if (newOwnerId === currentOwnerId) throw new Error('Ce membre est déjà le créateur de l’espace.');
	const [target] = await db.select({ role: membership.role, active: membership.active }).from(membership).where(
		memberWhere(workspaceId, newOwnerId)
	);
	if (!target || !target.active) throw new Error('Membre introuvable ou inactif dans cet espace.');

	await db.transaction(async (tx) => {
		await tx.update(workspace).set({ createdByUserId: newOwnerId }).where(eq(workspace.id, workspaceId));
		if (target.role !== 'ADMIN') {
			await tx.update(membership).set({ role: 'ADMIN' }).where(memberWhere(workspaceId, newOwnerId));
		}
	});
}

/** Définit la capacité quotidienne d'un membre (temps partiel ; 1 = journée pleine). */
export async function setMemberCapacity(workspaceId: string, userId: string, capacity: number) {
	if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 1)
		throw new Error('Capacité invalide (entre 0 et 1).');
	const res = await db
		.update(membership)
		.set({ capacityPerDay: String(capacity) })
		.where(memberWhere(workspaceId, userId))
		.returning({ id: membership.id });
	if (!res[0]) throw new Error('Membre introuvable dans cet espace.');
}

/** Capacités de lecture accordables indépendamment du rôle (cf. schema.ts membership.canView*). */
export async function setMemberCapability(
	workspaceId: string,
	userId: string,
	field: 'canViewImputations' | 'canViewMoodResults',
	value: boolean
) {
	const res = await db
		.update(membership)
		.set({ [field]: value })
		.where(memberWhere(workspaceId, userId))
		.returning({ id: membership.id });
	if (!res[0]) throw new Error('Membre introuvable dans cet espace.');
}

/** Active ou désactive un membre (un membre inactif conserve son historique). Le créateur de l'espace ne peut être désactivé. */
export async function setMemberActive(workspaceId: string, userId: string, active: boolean) {
	if (!active && (await isWorkspaceOwner(workspaceId, userId)))
		throw new Error("Le créateur de l'espace ne peut pas être désactivé (transférez la propriété d'abord).");
	const res = await db
		.update(membership)
		.set({ active })
		.where(memberWhere(workspaceId, userId))
		.returning({ id: membership.id });
	if (!res[0]) throw new Error('Membre introuvable dans cet espace.');
}

/** Régénère un magic link d'invitation pour un membre (lien perdu/expiré). */
export async function regenerateInvite(
	workspaceId: string,
	userId: string
): Promise<{ token: string; email: string; displayName: string }> {
	const [m] = await db
		.select({ email: user.email, displayName: user.displayName })
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.where(memberWhere(workspaceId, userId));
	if (!m) throw new Error('Membre introuvable dans cet espace.');

	const { token, hash } = generateToken();
	await db.insert(setupToken).values({
		id: hash,
		userId,
		workspaceId,
		purpose: 'INVITE',
		expiresAt: new Date(Date.now() + config.magicLinkTtlMs)
	});
	return { token, email: m.email, displayName: m.displayName };
}

/** Config Jira de l'espace pour l'onglet admin — jamais le PAT en clair, juste "configuré ou non". */
export async function getJiraConfig(workspaceId: string) {
	const [row] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
	let patUpdatedByName: string | null = null;
	if (row.jiraPatUpdatedByUserId) {
		const [u] = await db
			.select({ displayName: user.displayName })
			.from(user)
			.where(eq(user.id, row.jiraPatUpdatedByUserId));
		patUpdatedByName = u?.displayName ?? null;
	}
	return {
		enabled: row.jiraSyncEnabled,
		jql: row.jiraJql ?? '',
		patConfigured: !!row.jiraPatEncrypted,
		conflictStrategy: row.jiraConflictStrategy,
		regexPattern: row.jiraKeyRegexPattern ?? '',
		regexReplacement: row.jiraKeyRegexReplacement ?? '',
		patUpdatedByName,
		patUpdatedAt: row.jiraPatUpdatedAt,
		updatedSince: row.jiraUpdatedSince,
		lastSyncAt: row.jiraLastSyncAt,
		lastSyncStatus: row.jiraLastSyncStatus,
		lastSyncError: row.jiraLastSyncError,
		lastSyncTicketCount: row.jiraLastSyncTicketCount,
		consecutiveFailures: row.jiraConsecutiveFailures
	};
}

export async function setJiraSyncEnabled(workspaceId: string, enabled: boolean) {
	await db.update(workspace).set({ jiraSyncEnabled: enabled }).where(eq(workspace.id, workspaceId));
}

/** Remise à zéro du plancher/watermark — force une resynchronisation complète au prochain run.
 *  Action dédiée plutôt qu'une valeur vide dans saveJiraConfig : un champ date vide y signifie déjà
 *  "ne pas toucher" (même convention que le PAT), il ne peut pas porter aussi "remettre à zéro"
 *  sans ambiguïté. */
export async function resetJiraUpdatedSince(workspaceId: string) {
	await db.update(workspace).set({ jiraUpdatedSince: null }).where(eq(workspace.id, workspaceId));
}

/** Historique des runs de sync Jira (plus récents d'abord) — pour l'onglet admin. */
export async function listJiraSyncRuns(workspaceId: string, limit = 20) {
	return db
		.select()
		.from(jiraSyncRun)
		.where(eq(jiraSyncRun.workspaceId, workspaceId))
		.orderBy(desc(jiraSyncRun.startedAt))
		.limit(limit);
}

/**
 * "Annuler ce lot" (onglet admin Jira) : supprime les tickets de ce run encore vierges de toute
 * trace humaine (cf. deleteUntouchedSyncedTickets) et marque le run comme annulé. Un run déjà
 * annulé, en échec (rien à annuler) ou d'un autre espace est rejeté.
 */
export async function undoJiraSyncRun(workspaceId: string, runId: string, actorId: string): Promise<number> {
	const [run] = await db
		.select()
		.from(jiraSyncRun)
		.where(and(eq(jiraSyncRun.id, runId), eq(jiraSyncRun.workspaceId, workspaceId)));
	if (!run) throw new Error('Run introuvable dans cet espace.');
	if (run.status !== 'SUCCESS') throw new Error('Seul un run réussi peut être annulé.');
	if (run.undoneAt) throw new Error('Ce lot a déjà été annulé.');

	const deleted = await deleteUntouchedSyncedTickets(workspaceId, runId);
	await db.update(jiraSyncRun).set({ undoneAt: new Date(), undoneById: actorId }).where(eq(jiraSyncRun.id, runId));
	return deleted;
}

/**
 * Enregistre JQL/stratégie/mapping de clé/date minimum, et remplace le PAT (chiffré) si une
 * nouvelle valeur est fournie — un PAT vide laisse l'existant intact, une date vide idem (même
 * convention, voir resetJiraUpdatedSince ci-dessus pour la remettre à zéro). Un changement de PAT
 * trace qui/quand via changeLog (jamais oldValue/newValue, voir jiraSync.ts) et remet le circuit
 * breaker à zéro.
 */
export async function saveJiraConfig(
	workspaceId: string,
	input: {
		jql: string;
		conflictStrategy: 'JIRA_WINS' | 'KEEP_LOCAL';
		regexPattern: string;
		regexReplacement: string;
		pat: string;
		updatedSinceDate: string;
		patEncryptionKey: string;
		changedByUserId: string;
	}
) {
	if (input.regexPattern) {
		try {
			new RegExp(input.regexPattern);
		} catch {
			throw new Error('Regex de mapping de clé invalide.');
		}
	}
	// ORDER BY casse une fois le JQL wrappé pour jiraUpdatedSince (jiraSync.ts) — rejeté sans
	// condition ici, pas seulement quand une date est fournie cette fois : le watermark s'auto-avance
	// après le premier sync réussi même sans intervention de l'admin (voir jiraSync.ts).
	if (input.jql && hasOrderByClause(input.jql)) {
		throw new Error('Le filtre JQL ne doit pas contenir ORDER BY (inutile ici, et incompatible avec la date minimum).');
	}

	const updates: Partial<typeof workspace.$inferInsert> = {
		jiraJql: input.jql || null,
		jiraConflictStrategy: input.conflictStrategy,
		jiraKeyRegexPattern: input.regexPattern || null,
		jiraKeyRegexReplacement: input.regexReplacement || null
	};
	if (input.pat) {
		if (!input.patEncryptionKey) throw new Error('Clé de chiffrement serveur non configurée (JIRA_PAT_ENCRYPTION_KEY).');
		updates.jiraPatEncrypted = encryptSecret(input.pat, input.patEncryptionKey);
		updates.jiraPatUpdatedByUserId = input.changedByUserId;
		updates.jiraPatUpdatedAt = new Date();
		updates.jiraConsecutiveFailures = 0; // nouveau PAT = nouvelle chance
	}
	if (input.updatedSinceDate) {
		// parseISODate ne lève jamais sur une entrée invalide (Invalid Date silencieuse) — le
		// formulaire reste postable directement (pas seulement via le type="date" du navigateur),
		// donc ce contrôle explicite est nécessaire pour un fail(400) propre plutôt qu'une erreur
		// brute du driver Postgres.
		const parsed = parseISODate(input.updatedSinceDate);
		if (Number.isNaN(parsed.getTime())) throw new Error('Date minimum invalide.');
		updates.jiraUpdatedSince = parsed;
	}

	await db.update(workspace).set(updates).where(eq(workspace.id, workspaceId));

	if (input.pat) {
		await logChange({
			workspaceId,
			entityType: 'WORKSPACE',
			entityId: workspaceId,
			field: 'jiraPat',
			action: 'UPDATE',
			oldValue: null,
			newValue: null,
			changedById: input.changedByUserId
		});
	}
}
