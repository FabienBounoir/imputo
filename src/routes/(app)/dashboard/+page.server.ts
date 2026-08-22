import type { PageServerLoad } from './$types';
import { getDashboard } from '$lib/server/services/dashboard';
import { getWeeklySynthesis } from '$lib/server/services/weeklySynthesis';
import { listFacticeMemberIds } from '$lib/server/services/accounts';
import { toISODate, addDays, monthOptions, monthRange } from '$lib/utils/date';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	const isAdmin = locals.role === 'ADMIN';
	const months = monthOptions(new Date());
	const param = url.searchParams.get('month');
	// Défaut = mois courant ; 'all' = tout l'espace ; sinon un mois valide de la liste.
	const scope =
		param === 'all' ? 'all' : months.some((o) => o.value === param) ? param! : months[0].value;
	const period = scope === 'all' ? undefined : monthRange(scope);
	// Synthèse hebdo : bornée à la période sélectionnée, ou aux 8 dernières semaines en vue "Tout l'espace".
	const weekRange = period ?? { from: toISODate(addDays(new Date(), -56)), to: toISODate(new Date()) };
	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes) : exclus de
	// toute la synthèse pour un rôle non-ADMIN — cf. accounts.ts listFacticeMemberIds.
	const excludeUserIds = isAdmin ? undefined : await listFacticeMemberIds(ws.workspaceId);
	const [dashboard, weeklySynthesis] = await Promise.all([
		getDashboard(ws.workspaceId, period, ws.testPhase, excludeUserIds),
		getWeeklySynthesis(ws.workspaceId, weekRange.from, weekRange.to, excludeUserIds)
	]);
	return { dashboard, weeklySynthesis, weekRange, scope, months, isAdmin };
};
