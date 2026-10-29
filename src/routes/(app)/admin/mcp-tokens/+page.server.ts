import { redirect } from '@sveltejs/kit';
import { eq, isNull, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mcpToken, user, membership } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;

	const [tokens, members] = await Promise.all([
		db
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
			.orderBy(desc(mcpToken.createdAt)),
		db
			.select({ id: user.id, displayName: user.displayName, email: user.email })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(eq(membership.workspaceId, ws.workspaceId))
	]);

	return { tokens, members };
};
