import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMyWrapped, isWrappedWindowOpen, wrappedYearFor } from '$lib/server/services/wrapped';
import { todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const today = todayInParis();
	// Aperçu admin hors fenêtre (?preview=1) : pratique pour QA/démo sans attendre le 1er décembre.
	const preview = locals.role === 'ADMIN' && url.searchParams.get('preview') === '1';
	if (!isWrappedWindowOpen(today) && !preview) redirect(303, '/imputation');

	const ws = locals.workspace!;
	const year = wrappedYearFor(today);
	const wrapped = await getMyWrapped(ws.workspaceId, locals.user!.id, year);
	return { wrapped, year };
};
