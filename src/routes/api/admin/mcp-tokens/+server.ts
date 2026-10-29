import { json, error } from '@sveltejs/kit';
import { eq, isNull, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mcpToken, user } from '$lib/server/db/schema';
import { generateToken, hashToken } from '$lib/server/auth/tokens';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	const rows = await db
		.select({
			id: mcpToken.id,
			name: mcpToken.name,
			createdAt: mcpToken.createdAt,
			revokedAt: mcpToken.revokedAt,
			userId: mcpToken.userId,
			userEmail: user.email,
			userName: user.displayName
		})
		.from(mcpToken)
		.innerJoin(user, eq(mcpToken.userId, user.id))
		.orderBy(desc(mcpToken.createdAt));
	return json(rows);
};

const createSchema = z.object({
	userId: z.string().uuid(),
	name: z.string().min(1).max(100)
});

export const POST: RequestHandler = async ({ locals, request }) => {
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	const body = createSchema.safeParse(await request.json().catch(() => ({})));
	if (!body.success) error(400, 'userId et name requis');

	const { token: raw } = generateToken(40);
	const hash = hashToken(raw);
	await db.insert(mcpToken).values({ userId: body.data.userId, token: hash, name: body.data.name });
	// On retourne le token brut UNE SEULE FOIS — il n'est jamais stocké en clair
	return json({ token: raw, name: body.data.name }, { status: 201 });
};
