import { json, error } from '@sveltejs/kit';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mcpToken, user, session as sessionTable } from '$lib/server/db/schema';
import { hashToken, generateToken } from '$lib/server/auth/tokens';
import { SESSION_COOKIE } from '$lib/server/auth/session';
import type { RequestHandler } from './$types';

// Appelé par le serveur MCP. Échange un MCP token contre un cookie de session imputo.
// Le MCP server garde ce cookie en mémoire pour tous ses appels API suivants.
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const raw = body?.token;
	if (!raw || typeof raw !== 'string') error(400, 'token manquant');

	const hash = hashToken(raw);
	const rows = await db
		.select({ userId: mcpToken.userId })
		.from(mcpToken)
		.innerJoin(user, eq(mcpToken.userId, user.id))
		.where(and(eq(mcpToken.token, hash), isNull(mcpToken.revokedAt), eq(user.active, true)));

	const row = rows[0];
	if (!row) error(401, 'Token invalide ou révoqué');

	const { token: sessionToken } = generateToken();
	const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
	const sessionHash = hashToken(sessionToken);
	await db.insert(sessionTable).values({ id: sessionHash, userId: row.userId, workspaceId: null, expiresAt });

	cookies.set(SESSION_COOKIE, sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});

	return json({ ok: true });
};
