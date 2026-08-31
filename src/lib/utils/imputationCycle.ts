// Valeurs proposées par le .cell-picker (clic droit) et parcourues par le clic gauche
// (imputation/+page.svelte) — extraites pour être testables indépendamment du composant.

function round(n: number) {
	return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Pas de saisie (§7 admin) → cycle de valeurs, ex. 0.25 → [0, .25, .5, .75, 1]. */
export function buildCycle(step: number): number[] {
	const s = step > 0 ? step : 0.25;
	const n = Math.max(1, Math.round(1 / s));
	return Array.from({ length: n + 1 }, (_, i) => round(i * s));
}

/** Valeur suivante dans le cycle après la valeur courante (clic = avance, shift+clic = recule). */
export function cycleNext(cycle: number[], current: number, reverse = false): number {
	const delta = reverse ? -1 : 1;
	const idx = cycle.indexOf(current);
	return cycle[(idx + delta + cycle.length) % cycle.length];
}
