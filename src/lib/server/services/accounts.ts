import { and, eq } from 'drizzle-orm';
import { db, user, membership, setupToken, workspace, type Role } from '$lib/server/db';
import { verifyPassword, hashPassword } from '$lib/server/auth/password';
import { generateToken, hashToken } from '$lib/server/auth/tokens';
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

/** Mémorise la préférence de thème d'un utilisateur (identité globale). */
export async function setThemePref(userId: string, pref: 'LIGHT' | 'DARK' | 'SYSTEM') {
	await db.update(user).set({ themePref: pref }).where(eq(user.id, userId));
}

/** Force (ou non) une couleur d'accent personnelle, indépendante de celle de l'espace. */
export async function setAccentPref(userId: string, mode: 'WORKSPACE' | 'CUSTOM' | 'RGB', color: string | null) {
	await db.update(user).set({ accentMode: mode, accentColor: mode === 'CUSTOM' ? color : null }).where(eq(user.id, userId));
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
