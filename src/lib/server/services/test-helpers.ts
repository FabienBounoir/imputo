import { afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, workspace, user, membership, ticket, type Role } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { inviteMember } from './accounts';

// ticket.perimeterId est NOT NULL : tout insert brut de ticket dans un test doit le renseigner.
// makeWorkspace() passe par createWorkspaceWithOwner, donc l'espace a toujours ses périmètres.
export { resolveDefaultPerimeterId as defaultPerimeterId } from './perimeters';

// Boilerplate partagé par les tests d'intégration service (vraie DB) : chaque fichier de test
// qui importe ce module obtient son propre nettoyage en fin de run (modules vitest isolés par fichier).
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) {
		// ticket_activity_rae.activity_id est ON DELETE RESTRICT (protection contre une suppression
		// brute d'activité utilisée, cf. deleteActivity()) — sans ce pré-nettoyage, le cascade
		// workspace → activity peut s'exécuter avant workspace → ticket → ticket_activity_rae et
		// se faire bloquer par des lignes encore référencées.
		await db.delete(ticket).where(eq(ticket.workspaceId, id)); // cascade → ticket_activity_rae
		await db.delete(workspace).where(eq(workspace.id, id)); // cascade (le reste)
	}
});

let counter = 0;
function uniq() {
	counter++;
	return `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

/** Crée un espace de test + son owner (ADMIN) ; l'espace est supprimé automatiquement en afterAll. */
export async function makeWorkspace(prefix = 'ws') {
	const id = uniq();
	const email = `${prefix}-${id}@acme.test`;
	const { userId, workspaceId } = await createWorkspaceWithOwner({
		displayName: `${prefix} owner`,
		email,
		password: 'password123',
		workspaceName: `${prefix} ${id}`
	});
	wsIds.push(workspaceId);
	return { userId, workspaceId, email, id };
}

/** Ajoute un membre actif avec le rôle donné dans un espace déjà créé par makeWorkspace(). */
export async function addMember(workspaceId: string, role: Role, prefix = 'member') {
	const id = uniq();
	const email = `${prefix}-${id}@acme.test`;
	await inviteMember({ workspaceId, email, displayName: prefix, role });
	const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
	return { userId: u.id, email };
}

/** Accorde une capacité de lecture indépendante du rôle (cf. schema.ts membership.canView*). */
export async function grantCapability(
	workspaceId: string,
	userId: string,
	field: 'canViewImputations' | 'canViewMoodResults'
) {
	await db
		.update(membership)
		.set({ [field]: true })
		.where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)));
}
