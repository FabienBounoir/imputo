// Easter eggs liés à une période de l'année (neige/guirlande à Noël, feu d'artifice au
// Nouvel An, etc). Activés par défaut, désactivables par l'utilisateur (persisté en
// localStorage, comme le thème). Plusieurs périodes peuvent être actives en même temps
// (ex. Noël + Nouvel An se chevauchent le 31 déc. / 1er jan.).
// Un réglage caché (débloqué par le code Konami, voir $lib/konami.svelte) permet aussi
// de forcer une période hors saison, pour la tester ou juste pour le fun.

const KEY = 'imputo-seasonal-effects';
const FORCE_KEY = 'imputo-seasonal-force';

export type SeasonalEffect = {
	id: string;
	label: string;
	active: (d: Date) => boolean;
};

export const SEASONAL_EFFECTS: SeasonalEffect[] = [
	{
		id: 'christmas',
		label: '🎄 Noël (1er déc. – 6 jan.)',
		active: (d) => d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 6)
	},
	{
		id: 'new-year',
		label: '🎆 Nouvel An (31 déc. – 1er jan.)',
		active: (d) => (d.getMonth() === 11 && d.getDate() === 31) || (d.getMonth() === 0 && d.getDate() === 1)
	},
	{
		id: 'halloween',
		label: '🎃 Halloween (20 – 31 oct.)',
		active: (d) => d.getMonth() === 9 && d.getDate() >= 20
	},
	{
		id: 'valentine',
		label: '💖 Saint-Valentin (14 fév.)',
		active: (d) => d.getMonth() === 1 && d.getDate() === 14
	},
	{
		id: 'bastille-day',
		label: '🇫🇷 14 juillet',
		active: (d) => d.getMonth() === 6 && d.getDate() === 14
	},
	{
		id: 'april-fools',
		label: '🙃 1er avril',
		active: (d) => d.getMonth() === 3 && d.getDate() === 1
	}
];

export const seasonalState = $state({ enabled: true, forced: null as string | null });

/** Toutes les périodes actives à la date donnée (ou juste celle forcée, s'il y en a une). */
export function activeSeasonalEffects(d = new Date()): SeasonalEffect[] {
	if (seasonalState.forced) {
		const f = SEASONAL_EFFECTS.find((e) => e.id === seasonalState.forced);
		return f ? [f] : [];
	}
	return SEASONAL_EFFECTS.filter((e) => e.active(d));
}

/** À appeler une fois côté client (layout) pour charger la préférence locale. */
export function initSeasonal() {
	if (typeof localStorage === 'undefined') return;
	seasonalState.enabled = localStorage.getItem(KEY) !== 'off';
	seasonalState.forced = localStorage.getItem(FORCE_KEY);
}

export function setSeasonalEnabled(v: boolean) {
	seasonalState.enabled = v;
	localStorage.setItem(KEY, v ? 'on' : 'off');
}

/** Force une période hors de sa saison réelle (null = retour à la détection automatique). */
export function setForcedEffect(id: string | null) {
	seasonalState.forced = id;
	if (id) localStorage.setItem(FORCE_KEY, id);
	else localStorage.removeItem(FORCE_KEY);
}
