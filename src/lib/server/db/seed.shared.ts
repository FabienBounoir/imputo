// Constantes + utilitaires communs à seed.ts et unseed.ts. Séparé de db/index.ts qui dépend de
// $env/dynamic/private (résolu par SvelteKit uniquement) — ces scripts tournent en dehors (tsx),
// donc connexion DB "env-free" via connection.ts + chargement manuel du .env.
import { readFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { createDb, type Db } from './connection';
import { workspace, user, ticket, ticketActivityRae } from './schema';

export const WORKSPACE_NAME = 'QA Sandbox';
export const SEED_DOMAIN = 'sandbox.test';

export const SEED_USERS = [
	{ displayName: 'Alice Admin', email: `alice@${SEED_DOMAIN}`, password: 'alice123', role: 'ADMIN' as const },
	{ displayName: 'Bob Dev', email: `bob@${SEED_DOMAIN}`, password: 'bob123', role: 'USER' as const },
	{ displayName: 'Chloé QA', email: `chloe@${SEED_DOMAIN}`, password: 'chloe123', role: 'USER' as const },
	{ displayName: 'David PO', email: `david@${SEED_DOMAIN}`, password: 'david123', role: 'USER' as const },
	{ displayName: 'Manon Manager', email: `manon@${SEED_DOMAIN}`, password: 'manon123', role: 'MANAGER' as const }
];

/** Connexion DB pour un script CLI (charge .env manuellement, comme drizzle.config.ts). */
export function getDb(): Db {
	if (!process.env.DATABASE_URL) {
		try {
			for (const line of readFileSync('.env', 'utf8').split('\n')) {
				const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
				if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
			}
		} catch {
			/* pas de .env, tant pis */
		}
	}
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant (.env ou variable d\'environnement).');
	return createDb(process.env.DATABASE_URL);
}

/** Supprime l'espace QA Sandbox (cascade : tickets, imputations, groupes…) + les 4 comptes de seed. */
export async function wipeSandbox(db: Db) {
	const existing = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.name, WORKSPACE_NAME));
	for (const w of existing) {
		// ticket_activity_rae.activity_id est en ON DELETE RESTRICT (on ne supprime jamais une
		// activité utilisée) : il faut purger ces lignes avant que le cascade de la suppression
		// de l'espace n'essaie de supprimer les activités qu'elles référencent.
		const tickets = await db.select({ id: ticket.id }).from(ticket).where(eq(ticket.workspaceId, w.id));
		if (tickets.length > 0) {
			await db.delete(ticketActivityRae).where(inArray(ticketActivityRae.ticketId, tickets.map((t) => t.id)));
		}
		await db.delete(workspace).where(eq(workspace.id, w.id));
	}
	for (const u of SEED_USERS) await db.delete(user).where(eq(user.email, u.email));
}
