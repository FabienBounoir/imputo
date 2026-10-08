/**
 * Compresse une série quotidienne (snapshot) pour la courbe conso/RAE : ne garde que le 1er jour,
 * les jours où une valeur change, et le dernier jour. Les jours figés (rien ne bouge) n'occupent
 * plus l'axe X — choix produit : l'axe n'est donc plus proportionnel au temps. `until` = dernier
 * jour où le point est resté identique, pour que le survol dise ce que l'axe ne montre plus.
 */
export function compressPlateaus<T extends { date: string; consumed: number; rae: number }>(
	history: T[]
): (T & { until: string })[] {
	const kept: (T & { until: string })[] = [];
	history.forEach((p, i) => {
		const prev = kept[kept.length - 1];
		const changed = !prev || p.consumed !== prev.consumed || p.rae !== prev.rae;
		if (changed || i === history.length - 1) kept.push({ ...p, until: p.date });
		else prev.until = p.date;
	});
	return kept;
}
