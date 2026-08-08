import type { Cookies } from '@sveltejs/kit';

export type SelectionKind = 'sprint' | 'version';

const cookieName = (workspaceId: string, kind: SelectionKind) => `imputo-last-${kind}-${workspaceId}`;

/**
 * Résout l'id sélectionné par défaut sur les dashboards Sprint/Version : le paramètre d'URL
 * explicite prime, sinon le dernier choix mémorisé (cookie, scopé par espace — pas de localStorage
 * ici : ça vivrait uniquement côté client et forcerait un aller-retour après le premier rendu,
 * donc un flash du mauvais sprint/version avant redirection), sinon le plus récemment créé.
 * Rafraîchit le cookie sur l'id effectivement retenu.
 */
export function resolveSelection(
	cookies: Cookies,
	workspaceId: string,
	kind: SelectionKind,
	urlParam: string | null,
	options: { id: string; createdAt: Date }[]
): string | null {
	if (options.length === 0) return null;
	const name = cookieName(workspaceId, kind);
	const remembered = cookies.get(name);
	const mostRecentId = options.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id;
	const selectedId =
		urlParam && options.some((o) => o.id === urlParam)
			? urlParam
			: remembered && options.some((o) => o.id === remembered)
				? remembered
				: mostRecentId;
	cookies.set(name, selectedId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: 60 * 60 * 24 * 180
	});
	return selectedId;
}
