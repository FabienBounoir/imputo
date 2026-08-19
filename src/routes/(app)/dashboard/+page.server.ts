import type { PageServerLoad } from './$types';
import { getDashboard } from '$lib/server/services/dashboard';
import { getWeeklySynthesis } from '$lib/server/services/weeklySynthesis';
import { toISODate, addDays, monthOptions, monthRange } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	const months = monthOptions(new Date());
	const param = url.searchParams.get('month');
	// Défaut = mois courant ; 'all' = tout l'espace ; sinon un mois valide de la liste.
	const scope =
		param === 'all' ? 'all' : months.some((o) => o.value === param) ? param! : months[0].value;
	const period = scope === 'all' ? undefined : monthRange(scope);
	// Synthèse hebdo : bornée à la période sélectionnée, ou aux 8 dernières semaines en vue "Tout l'espace".
	const weekRange = period ?? { from: toISODate(addDays(new Date(), -56)), to: toISODate(new Date()) };
	const [dashboard, weeklySynthesis] = await Promise.all([
		getDashboard(ws.workspaceId, period, ws.testPhase),
		getWeeklySynthesis(ws.workspaceId, weekRange.from, weekRange.to)
	]);
	return { dashboard, weeklySynthesis, weekRange, scope, months };
};
