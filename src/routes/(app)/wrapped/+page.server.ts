import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMyWrapped, isWrappedWindowOpen, wrappedYearFor } from '$lib/server/services/wrapped';
import { todayInParis } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals }) => {
	const today = todayInParis();
	if (!isWrappedWindowOpen(today)) redirect(303, '/imputation');

	const ws = locals.workspace!;
	const year = wrappedYearFor(today);
	const wrapped = await getMyWrapped(ws.workspaceId, locals.user!.id, year);
	return { wrapped, year };
};
