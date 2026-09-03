import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildSupportTimeWorkbook } from '$lib/server/excel/supportTimeExport';
import { todayInParis } from '$lib/utils/date';

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');
	if (locals.role !== 'ADMIN') error(403, 'Réservé aux admins.');
	if (!ws.supportTimeTrackingEnabled) error(404, 'Fonctionnalité désactivée.');

	// Pas de période par défaut implicite ici : la modale d'export impose toujours un choix
	// explicite (cf. SupportExportModal), "tout" y compris — seul ?from&to absents (appel direct à
	// l'URL) retombe sur l'espace complet.
	const qFrom = url.searchParams.get('from');
	const qTo = url.searchParams.get('to');
	let from = isISODate(qFrom) ? qFrom : undefined;
	let to = isISODate(qTo) ? qTo : undefined;
	if (from && to && from > to) [from, to] = [to, from];
	const userId = url.searchParams.get('userId') || undefined;

	const sheetsParam = url.searchParams.get('sheets');
	const sheets = sheetsParam ? sheetsParam.split(',').filter(Boolean) : undefined;

	const buffer = await buildSupportTimeWorkbook(ws.workspaceId, ws.workspaceName, { from, to, userId }, sheets);
	const safeName = ws.workspaceName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
	const suffix = from || to ? `-${from ?? 'origine'}_${to ?? todayInParis()}` : '';
	const filename = `temps-support-${safeName || 'export'}${suffix}.xlsx`;

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
