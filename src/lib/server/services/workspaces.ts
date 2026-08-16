import { and, eq } from 'drizzle-orm';
import {
	db,
	workspace,
	user,
	membership,
	state,
	activity,
	category,
	type Role
} from '$lib/server/db';
import { emailDomain } from '$lib/server/config';
import { hashPassword } from '$lib/server/auth/password';
import { DEFAULT_STATES, DEFAULT_ACTIVITIES, DEFAULT_CATEGORIES } from './defaults';

/** Crée un espace + son utilisateur fondateur (ADMIN) + les référentiels par défaut. */
export async function createWorkspaceWithOwner(input: {
	displayName: string;
	email: string;
	password: string;
	workspaceName: string;
}) {
	const email = input.email.trim().toLowerCase();
	const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
	if (existing.length > 0) throw new Error('Un compte existe déjà avec cet email.');

	const passwordHash = await hashPassword(input.password);

	return db.transaction(async (tx) => {
		const [u] = await tx
			.insert(user)
			.values({ displayName: input.displayName.trim(), email, passwordHash })
			.returning();

		const [ws] = await tx
			.insert(workspace)
			.values({
				name: input.workspaceName.trim(),
				allowedDomain: emailDomain(email),
				createdByUserId: u.id
			})
			.returning();

		await tx.insert(membership).values({
			workspaceId: ws.id,
			userId: u.id,
			role: 'ADMIN'
		});

		await seedDefaults(tx, ws.id);
		return { userId: u.id, workspaceId: ws.id };
	});
}

/** Crée un espace supplémentaire pour un utilisateur DÉJÀ existant (devient ADMIN). */
export async function createWorkspaceForUser(userId: string, workspaceName: string) {
	const name = workspaceName.trim();
	if (!name) throw new Error("Nom de l'espace requis.");
	const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
	if (!u) throw new Error('Utilisateur introuvable.');

	return db.transaction(async (tx) => {
		const [ws] = await tx
			.insert(workspace)
			.values({ name, allowedDomain: emailDomain(u.email), createdByUserId: userId })
			.returning();
		await tx.insert(membership).values({ workspaceId: ws.id, userId, role: 'ADMIN' });
		await seedDefaults(tx, ws.id);
		return { workspaceId: ws.id };
	});
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insère les référentiels par défaut dans un espace. */
export async function seedDefaults(tx: Tx, workspaceId: string) {
	await tx.insert(state).values(
		DEFAULT_STATES.map((s, i) => ({
			workspaceId,
			label: s.label,
			emoji: s.emoji,
			color: s.color,
			sortOrder: i
		}))
	);
	await tx
		.insert(activity)
		.values(DEFAULT_ACTIVITIES.map((label, i) => ({ workspaceId, label, sortOrder: i })));
	await tx
		.insert(category)
		.values(DEFAULT_CATEGORIES.map((c) => ({ workspaceId, label: c.label, kind: c.kind })));
}

export type MembershipInfo = {
	workspaceId: string;
	workspaceName: string;
	accentColor: string;
	accentRgb: boolean;
	accentDisco: boolean;
	testPhase: boolean;
	pprRatio: string;
	imputationStep: string;
	allowedDomain: string;
	moodEnabled: boolean;
	supportEnabled: boolean;
	role: Role;
	canViewImputations: boolean;
	canViewMoodResults: boolean;
	createdByUserId: string | null;
};

/** Liste les espaces actifs d'un utilisateur. */
export async function listMembershipsForUser(userId: string): Promise<MembershipInfo[]> {
	const rows = await db
		.select({
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			accentColor: workspace.accentColor,
			accentRgb: workspace.accentRgb,
			accentDisco: workspace.accentDisco,
			testPhase: workspace.testPhase,
			pprRatio: workspace.pprRatio,
			imputationStep: workspace.imputationStep,
			allowedDomain: workspace.allowedDomain,
			moodEnabled: workspace.moodEnabled,
			supportEnabled: workspace.supportEnabled,
			role: membership.role,
			canViewImputations: membership.canViewImputations,
			canViewMoodResults: membership.canViewMoodResults,
			createdByUserId: workspace.createdByUserId
		})
		.from(membership)
		.innerJoin(workspace, eq(membership.workspaceId, workspace.id))
		.where(and(eq(membership.userId, userId), eq(membership.active, true)));
	return rows;
}

/** Si l'utilisateur a une appartenance DÉSACTIVÉE sur cet espace, renvoie ses infos. */
export async function getDeactivatedWorkspace(
	workspaceId: string,
	userId: string
): Promise<{ workspaceId: string; workspaceName: string; accentColor: string } | null> {
	const rows = await db
		.select({
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			accentColor: workspace.accentColor
		})
		.from(membership)
		.innerJoin(workspace, eq(membership.workspaceId, workspace.id))
		.where(
			and(
				eq(membership.workspaceId, workspaceId),
				eq(membership.userId, userId),
				eq(membership.active, false)
			)
		);
	return rows[0] ?? null;
}

/** Vérifie qu'un utilisateur appartient à un espace (retourne son rôle ou null). */
export async function getMembership(
	workspaceId: string,
	userId: string
): Promise<{ role: Role; capacityPerDay: string } | null> {
	const rows = await db
		.select({ role: membership.role, capacityPerDay: membership.capacityPerDay })
		.from(membership)
		.where(
			and(
				eq(membership.workspaceId, workspaceId),
				eq(membership.userId, userId),
				eq(membership.active, true)
			)
		);
	return rows[0] ?? null;
}

// Couvre aujourd'hui deux usages qui partagent la même règle (ADMIN ou MANAGER) : l'accès à
// « Objectifs de la semaine » et la visibilité/édition des champs budget ticket. À séparer en deux
// prédicats si ces deux permissions divergent un jour.
export function isManagerOrAdmin(role: Role | null): boolean {
	return role === 'ADMIN' || role === 'MANAGER';
}
