// Vitesse du défilement RGB/Disco de la couleur d'accent (voir routes/+layout.svelte). Réglable
// via Ctrl/Cmd + ↑/↓ dans le nuancier (AccentPicker), persistée en local comme le thème ou les
// effets saisonniers — c'est un réglage d'appareil, pas une préférence de compte.

const KEY = 'imputo-accent-speed';
const MIN = 0.25;
const MAX = 5;

export const accentSpeedState = $state({ speed: 1 });

/** À appeler une fois côté client (layout) pour charger la préférence locale. */
export function initAccentSpeed() {
	if (typeof localStorage === 'undefined') return;
	const saved = Number(localStorage.getItem(KEY));
	if (saved >= MIN && saved <= MAX) accentSpeedState.speed = saved;
}

export function bumpAccentSpeed(delta: number) {
	const next = Math.min(MAX, Math.max(MIN, +(accentSpeedState.speed + delta).toFixed(2)));
	accentSpeedState.speed = next;
	localStorage.setItem(KEY, String(next));
}
