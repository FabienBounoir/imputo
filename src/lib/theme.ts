// Gestion du thème clair / sombre / système (client). Clé localStorage partagée
// avec le layout racine ; persiste aussi le choix en base via /theme (best-effort).

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'imputo-theme';

/** Préférence stockée localement, ou null si absente/invalide. */
export function storedTheme(): ThemePref | null {
	if (typeof localStorage === 'undefined') return null;
	const v = localStorage.getItem(KEY);
	return v === 'light' || v === 'dark' || v === 'system' ? v : null;
}

/** Applique la préférence à <html data-theme> (résout « system » via la media query). */
export function applyTheme(pref: ThemePref) {
	const dark =
		pref === 'dark' ||
		(pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** Mémorise + applique + persiste en base le choix de thème. */
export async function setTheme(pref: ThemePref) {
	localStorage.setItem(KEY, pref);
	applyTheme(pref);
	try {
		await fetch('/theme', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pref: pref.toUpperCase() })
		});
	} catch {
		/* persistance best-effort : le localStorage suffit côté client */
	}
}
