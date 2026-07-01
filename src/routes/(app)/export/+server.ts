import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildWorkbook } from '$lib/server/excel/export';
import { toISODate } from '$lib/utils/date';

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');

	// Période : défaut = 1 mois glissant (aujourd'hui − 1 mois → aujourd'hui), affinable via ?from&to.
	const today = new Date();
	const monthAgo = new Date(today);
	monthAgo.setMonth(monthAgo.getMonth() - 1);

	const qFrom = url.searchParams.get('from');
	const qTo = url.searchParams.get('to');
	let from = isISODate(qFrom) ? qFrom : toISODate(monthAgo);
	let to = isISODate(qTo) ? qTo : toISODate(today);
	if (from > to) [from, to] = [to, from];

	const sheetsParam = url.searchParams.get('sheets');
	const sheets = sheetsParam ? sheetsParam.split(',').filter(Boolean) : undefined;

	const buffer = await buildWorkbook(ws.workspaceId, ws.workspaceName, { from, to, sheets });
	const safeName = ws.workspaceName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
	const filename = `imputo-${safeName || 'export'}-${from}_${to}.xlsx`;

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
