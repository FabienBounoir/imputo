import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, workspace } from '$lib/server/db';
import { getSprintDashboard } from '$lib/server/services/sprintDashboard';
import { buildSprintTicketsSvg } from '$lib/server/excel/ticketsSvg';
import { listFacticeMemberIds } from '$lib/server/services/accounts';

// Partagé par les vues Dashboard par sprint ET par version (même id de table `sprint`, cf.
// schema.ts sprintKindEnum) — pas de duplication de deux endpoints identiques.
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');

	const id = url.searchParams.get('id');
	if (!id) error(400, 'id requis.');
	const grouped = url.searchParams.get('grouped') === '1';

	const isAdmin = locals.role === 'ADMIN';
	const excludeUserIds = isAdmin ? undefined : await listFacticeMemberIds(ws.workspaceId);
	let dashboard;
	let wsRow;
	try {
		[dashboard, wsRow] = await Promise.all([
			getSprintDashboard(ws.workspaceId, id, ws.testPhase, isAdmin, locals.user.sortActivitiesAlpha, excludeUserIds),
			db.select({ accentColor: workspace.accentColor }).from(workspace).where(eq(workspace.id, ws.workspaceId)).limit(1)
		]);
	} catch {
		error(404, 'Sprint/version introuvable.');
	}

	const { svg } = buildSprintTicketsSvg(dashboard, grouped, wsRow[0]?.accentColor ?? '#16A34A');

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'no-store'
		}
	});
};
