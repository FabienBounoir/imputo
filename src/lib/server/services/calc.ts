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

/** PPR = Estimation Réelle × ratio d'espace (paramétrable, 0.90 par défaut). Calculé à la volée, non stocké. */
export function ppr(estimationReal: string | number | null, pprRatio: string | number | null): number {
	return round(num(estimationReal) * num(pprRatio));
}

/**
 * Écart d'exécution — Réel uniquement, jamais Test (même si la phase Test de l'espace est active).
 * Positif = le RAE déclaré + le consommé dépassent l'estimation réelle (dépassement projeté).
 */
export function ecartExecution(raeReal: number, consumed: number, estimationReal: number): number {
	return round(raeReal + consumed - estimationReal);
}

/**
 * TNF budget — distinct de l'écart d'exécution (ne pas fusionner dans l'UI). Aligné sur le
 * comportement de totalRae : applique la phase Test par défaut.
 */
export function tnfBudget(
	enveloppeTotale: number,
	consumed: number,
	raeReal: number,
	raeTest: number,
	testPhase = true
): number {
	return round(enveloppeTotale - consumed + raeReal + (testPhase ? raeTest : 0));
}

/**
 * RAE résolu d'un ticket : somme des lignes ticket_activity_rae si présentes, sinon fallback
 * ticket.raeReal/raeTest. Le RAE global du ticket = somme des RAE par activité (§2.3).
 */
export function resolvedRae(
	ticketRaeReal: string | null,
	ticketRaeTest: string | null,
	activityRows: Array<{ raeReal: string | null; raeTest: string | null }>
): { real: number; test: number } {
	if (activityRows.length === 0) return { real: num(ticketRaeReal), test: num(ticketRaeTest) };
	return {
		real: sum(activityRows.map((r) => r.raeReal)),
		test: sum(activityRows.map((r) => r.raeTest))
	};
}

/** Capacité attendue d'une semaine = capacité/jour × nb de jours ouvrés non fériés de la semaine. */
export function weeklyCapacity(capacityPerDay: string | number | null, workdays: number): number {
	return round(num(capacityPerDay) * workdays);
}

/** % de capacité hebdo utilisée. 0 si capacité nulle (garde-fou division par zéro). Jamais bloquant. */
export function capacityPct(totalImputed: number, weeklyCap: number): number {
	if (weeklyCap <= 0) return 0;
	return round(totalImputed / weeklyCap);
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
