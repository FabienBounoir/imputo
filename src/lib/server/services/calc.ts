// Calculs métier purs (testés). Aucune dépendance DB.

/** Convertit une valeur numeric (Drizzle renvoie des string) en number, null → 0. */
export function num(v: string | number | null | undefined): number {
	if (v === null || v === undefined || v === '') return 0;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : 0;
}

export function sum(values: Array<string | number | null | undefined>): number {
	return round(values.reduce<number>((acc, v) => acc + num(v), 0));
}

/** Arrondi à 2 décimales (évite les artefacts de virgule flottante sur des pas de 0,25). */
export function round(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/** Estimation totale d'un ticket = Réalisation (+ Test si la phase Test est active). */
export function totalEstimation(
	estimationReal: string | null,
	estimationTest: string | null,
	testPhase = true
): number {
	return round(num(estimationReal) + (testPhase ? num(estimationTest) : 0));
}

/** RAE total = RAE Réalisation (+ RAE Test si la phase Test est active). */
export function totalRae(raeReal: string | null, raeTest: string | null, testPhase = true): number {
	return round(num(raeReal) + (testPhase ? num(raeTest) : 0));
}

/** Écart = consommé − estimation totale (positif = dépassement). */
export function ecart(consumed: number, totalEst: number): number {
	return round(consumed - totalEst);
}

/** RAE suggéré = max(0, estimation − consommé). */
export function raeSuggested(totalEst: number, consumed: number): number {
	return round(Math.max(0, totalEst - consumed));
}

/** % d'avancement = (estimation − rae) / estimation, borné 0–1. 0 si estimation nulle. */
export function avancement(totalEst: number, totalRaeValue: number): number {
	if (totalEst <= 0) return 0;
	return round(clamp((totalEst - totalRaeValue) / totalEst, 0, 1));
}
