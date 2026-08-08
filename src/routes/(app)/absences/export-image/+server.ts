import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAbsencesSvg } from '$lib/server/excel/absencesSvg';
import { monthBounds, todayInParis } from '$lib/utils/date';

const isISODate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');

	const bounds = monthBounds(todayInParis());
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	let from = isISODate(fromParam) ? fromParam : bounds.start;
	let to = isISODate(toParam) ? toParam : bounds.end;
	if (from > to) [from, to] = [to, from];

	const rowsParam = url.searchParams.get('rows');
	const rowIds = rowsParam ? rowsParam.split(',').filter(Boolean) : null;

	const { svg } = await buildAbsencesSvg(ws.workspaceId, from, to, rowIds);

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'no-store'
		}
	});
};
