import type { PageServerLoad } from './$types';
import { getDashboard } from '$lib/server/services/dashboard';
import { getWeeklySynthesis } from '$lib/server/services/weeklySynthesis';
import { toISODate, addDays } from '$lib/utils/date';

const MONTHS_BACK = 11;

/** Options du sélecteur : mois courant + 11 mois précédents. */
function monthOptions(now: Date) {
	const opts: { value: string; label: string }[] = [];
	for (let i = 0; i <= MONTHS_BACK; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
		opts.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
	}
	return opts;
}

/** Bornes ISO d'un mois 'YYYY-MM'. */
function monthRange(value: string): { from: string; to: string } {
	const [y, m] = value.split('-').map(Number);
	const last = new Date(y, m, 0).getDate();
	return { from: `${value}-01`, to: `${value}-${String(last).padStart(2, '0')}` };
}

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
