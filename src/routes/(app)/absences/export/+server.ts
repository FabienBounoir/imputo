import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAbsencesWorkbook } from '$lib/server/excel/absencesExport';
import { absenceRangeBounds, parseAbsenceSpan } from '$lib/absenceTypes';
import { monthBounds, todayInParis } from '$lib/utils/date';

export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!locals.user || !ws) error(401, 'Non authentifié.');

	const mParam = url.searchParams.get('m');
	const anchorISO = monthBounds(mParam && /^\d{4}-\d{2}-\d{2}$/.test(mParam) ? mParam : todayInParis()).start;
	const span = parseAbsenceSpan(url.searchParams.get('span'));
	const range = absenceRangeBounds(anchorISO, span);

	const buffer = await buildAbsencesWorkbook(ws.workspaceId, anchorISO, span, locals.role === 'ADMIN');
	const safeName = ws.workspaceName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
	const filename = `absences-${safeName || 'export'}-${range.start.slice(0, 7)}_${range.end.slice(0, 7)}.xlsx`;

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
