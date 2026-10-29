import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { membership, user } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');

	const members = await db
		.select({ id: user.id, displayName: user.displayName, email: user.email, role: membership.role, active: membership.active })
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.where(eq(membership.workspaceId, ws.workspaceId));

	return json({
		id: ws.workspaceId,
		name: ws.workspaceName,
		role: locals.role,
		currentUser: { id: locals.user.id, displayName: locals.user.displayName, email: locals.user.email },
		members
	});
};
