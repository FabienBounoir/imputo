import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, session, user } from '$lib/server/db';
import { generateToken, hashToken } from './tokens';

export const SESSION_COOKIE = 'imputo_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours

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
		.where(eq(session.id, id));
	const row = rows[0];
	if (!row) return { session: null, user: null };
	if (row.session.expiresAt.getTime() < Date.now()) {
		await db.delete(session).where(eq(session.id, id));
		return { session: null, user: null };
	}
	return row;
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
