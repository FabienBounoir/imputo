import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPerimeterConsolidation } from '$lib/server/services/perimeterConsolidation';
import { hasLeadScope, listActivePerimeters } from '$lib/server/services/perimeters';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	// Écran de pilotage : réservé à qui pilote quelque chose (DP, ou CP sur ses périmètres). Un
	// membre sans périmètre piloté n'y verrait que des lignes vides.
	if (!hasLeadScope(locals.perimeterCtx)) redirect(303, '/imputation');

	// L'URL reste la source de vérité de ce qui est affiché, comme sur Tickets & chiffrage.
	const perimeterIds = url.searchParams.get('perimeters')?.split(',').filter(Boolean) ?? [];
	const includeTransverse = url.searchParams.get('transverse') !== '0';

	const [perimeters, consolidation] = await Promise.all([
		listActivePerimeters(ws.workspaceId),
		getPerimeterConsolidation(ws.workspaceId, ws.testPhase, locals.perimeterCtx, {
			perimeterIds,
			includeTransverse
		})
	]);

	return {
		consolidation,
		perimeters,
		selectedPerimeterIds: perimeterIds,
		includeTransverse,
		testPhase: ws.testPhase
	};
};
