import type { Cookies } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, session, user } from '$lib/server/db';
import { generateToken, hashToken } from './tokens';

export const SESSION_COOKIE = 'imputo_session';
// Session glissante : 7 jours sans visite → reconnexion. Prolongée de 7 jours dès qu'il en reste
// moins de la moitié, donc une écriture tous les ~3,5 jours par personne active, pas à chaque requête.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RENEW_BELOW_MS = SESSION_TTL_MS / 2;

export async function createSession(userId: string, workspaceId: string | null) {
	const { token, hash } = generateToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await db.insert(session).values({ id: hash, userId, workspaceId, expiresAt });
	return { token, expiresAt };
}

export async function validateSession(token: string) {
	const id = hashToken(token);
	const rows = await db
		.select({ session, user })
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(and(eq(session.id, id), eq(user.active, true)));
	const row = rows[0];
	if (!row) return { session: null, user: null, renewed: false };
	const left = row.session.expiresAt.getTime() - Date.now();
	if (left < 0) {
		await db.delete(session).where(eq(session.id, id));
		return { session: null, user: null, renewed: false };
	}
	if (left >= RENEW_BELOW_MS) return { ...row, renewed: false };
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await db.update(session).set({ expiresAt }).where(eq(session.id, id));
	// renewed : l'appelant doit réémettre le cookie, sinon le navigateur le jette à l'ancienne date.
	return { session: { ...row.session, expiresAt }, user: row.user, renewed: true };
}

export async function invalidateSession(token: string) {
	await db.delete(session).where(eq(session.id, hashToken(token)));
}

/** Change l'espace courant d'une session existante. */
export async function setSessionWorkspace(token: string, workspaceId: string) {
	await db.update(session).set({ workspaceId }).where(eq(session.id, hashToken(token)));
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
}

export function deleteSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
