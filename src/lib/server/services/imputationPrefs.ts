import type { Cookies } from '@sveltejs/kit';
import {
	parseGranularity,
	parsePeriodMode,
	type Granularity,
	type PeriodMode
} from '$lib/utils/date';

const cookieName = (workspaceId: string) => `imputo-imput-period-${workspaceId}`;

/**
 * Résout la période affichée dans Mon imputation : le paramètre d'URL prime, sinon le dernier
 * choix mémorisé (cookie, scopé par espace — pas de localStorage : la liste des jours est calculée
 * côté serveur et pilote toute la table, un aller-retour client provoquerait un flash de la
 * mauvaise période), sinon la semaine fixe (comportement historique). Même motif que
 * `dashboardPrefs.resolveSelection`. Rafraîchit le cookie sur la valeur retenue.
 */
export function resolvePeriodPrefs(
	cookies: Cookies,
	workspaceId: string,
	gParam: string | null,
	modeParam: string | null
): { granularity: Granularity; mode: PeriodMode } {
	const [savedG, savedMode] = (cookies.get(cookieName(workspaceId)) ?? '').split(':');

	const granularity = parseGranularity(gParam) ?? parseGranularity(savedG) ?? 'WEEK';
	const mode = parsePeriodMode(modeParam) ?? parsePeriodMode(savedMode) ?? 'FIXED';

	cookies.set(cookieName(workspaceId), `${granularity}:${mode}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: 60 * 60 * 24 * 180
	});
	return { granularity, mode };
}
