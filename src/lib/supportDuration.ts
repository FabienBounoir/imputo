/**
 * Durée façon Jira : "1h 30m", "2d", "1w", combinable et sans espace obligatoire ("1h30m"). Un
 * nombre seul, sans unité, vaut des heures — la seule entorse à la syntaxe Jira stricte (qui exige
 * toujours une unité), demandée explicitement pour une saisie plus rapide au clavier.
 * Ratios Jira par défaut (jamais liés à la capacité/jour propre à chaque membre, cf. temps de
 * travail Jira standard) : 1 jour = 8h, 1 semaine = 5 jours = 40h.
 */
const UNIT_MINUTES: Record<string, number> = {
	w: 5 * 8 * 60,
	d: 8 * 60,
	h: 60,
	m: 1
};

/** Parse une durée saisie en minutes, ou `null` si le texte ne correspond à aucun format valide. */
export function parseDuration(raw: string): number | null {
	// Virgule décimale (clavier FR — "1,5") normalisée en point avant le parsing : les deux motifs
	// ci-dessous n'attendent que "." et rejetaient silencieusement une saisie pourtant valide.
	const s = raw.trim().toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
	if (!s) return null;
	if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);

	const re = /(\d+(?:\.\d+)?)\s*(w|d|h|m)/g;
	let total = 0;
	let consumed = '';
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		total += parseFloat(m[1]) * UNIT_MINUTES[m[2]];
		consumed += m[0];
	}
	// Rien reconnu, ou des caractères en trop non consommés (ex. "1h abc") : texte invalide.
	if (!consumed || consumed.replace(/\s+/g, '') !== s.replace(/\s+/g, '')) return null;
	return Math.round(total);
}

/**
 * Formate des minutes en chaîne façon Jira, unité la plus grosse d'abord ("1h 30m", "45m").
 * `weeks: false` s'arrête au jour ("7d 2h" plutôt que "1w 2d 2h") : pour les totaux, où une
 * semaine de 40 h à convertir de tête se lit moins bien qu'un nombre de jours.
 */
export function formatDuration(minutes: number, opts: { weeks?: boolean } = {}): string {
	if (minutes <= 0) return '0m';
	let rest = Math.round(minutes);
	const parts: string[] = [];
	const w = opts.weeks === false ? 0 : Math.floor(rest / UNIT_MINUTES.w);
	if (w) {
		parts.push(`${w}w`);
		rest -= w * UNIT_MINUTES.w;
	}
	const d = Math.floor(rest / UNIT_MINUTES.d);
	if (d) {
		parts.push(`${d}d`);
		rest -= d * UNIT_MINUTES.d;
	}
	const h = Math.floor(rest / 60);
	if (h) {
		parts.push(`${h}h`);
		rest -= h * 60;
	}
	if (rest) parts.push(`${rest}m`);
	return parts.join(' ');
}
