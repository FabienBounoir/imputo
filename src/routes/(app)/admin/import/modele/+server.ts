import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildImportTemplate } from '$lib/server/services/ticketImport';

export const GET: RequestHandler = async ({ locals }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	return new Response(await buildImportTemplate(ws.workspaceId, ws.testPhase), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': 'attachment; filename="imputo-modele-import-tickets.xlsx"',
			'Cache-Control': 'no-store'
		}
	});
};
