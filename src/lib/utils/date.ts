// Utilitaires de dates (semaine ISO, lun→ven). Sans dépendance, partageable client/serveur.

export function toISODate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export function parseISODate(s: string): Date {
	const [y, m, day] = s.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, day));
}

export function addDays(d: Date, n: number): Date {
	const r = new Date(d);
	r.setUTCDate(r.getUTCDate() + n);
	return r;
}

/** Lundi (UTC) de la semaine contenant `d`. */
export function mondayOf(d: Date): Date {
	const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dow = (r.getUTCDay() + 6) % 7; // 0 = lundi
	return addDays(r, -dow);
}

/** Les 5 jours ouvrés (lun→ven) à partir d'un lundi. */
export function workWeek(monday: Date): Date[] {
	return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** Date du jour (ISO YYYY-MM-DD) dans le fuseau Europe/Paris. */
export function todayInParis(): string {
	// en-CA donne le format YYYY-MM-DD
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/** Date + heure de dépôt, lisibles, fuseau Paris : « 06/08/2026 à 14:32 ». */
export function formatDateTime(d: Date): string {
	return new Intl.DateTimeFormat('fr-FR', {
		timeZone: 'Europe/Paris',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	})
		.format(d)
		.replace(',', ' à');
}

/** True si la date ISO est un jour ouvré (lundi→vendredi). */
export function isWorkday(dateISO: string): boolean {
	const dow = parseISODate(dateISO).getUTCDay();
	return dow !== 0 && dow !== 6;
}

/** Jour ouvré précédent (ISO) — saute le week-end. */
export function previousWorkday(dateISO: string): string {
	let d = addDays(parseISODate(dateISO), -1);
	while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, -1);
	return toISODate(d);
}

/**
 * Dernier jour ouvré à cette date ou avant. Sert d'échéance « utile » pour une plage qui se
 * termine un week-end (Team mood du lundi au dimanche → la relance doit tomber le vendredi).
 */
export function lastWorkdayOnOrBefore(dateISO: string): string {
	return isWorkday(dateISO) ? dateISO : previousWorkday(dateISO);
}

/** Nombre de jours ouvrés (lun→ven) entre deux dates ISO incluses. */
export function countWorkdays(fromISO: string, toISO: string): number {
	const from = parseISODate(fromISO);
	const to = parseISODate(toISO);
	if (from > to) return 0;
	let count = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6) count++;
	}
	return count;
}

/** Dimanche de Pâques (UTC) pour une année donnée — algorithme de Gauss/Meeus. */
function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, month - 1, day));
}

/** Jours fériés légaux français (fixes + mobiles calculés depuis Pâques) pour une année. */
function publicHolidaysFR(year: number): Set<string> {
	const fixed = [
		[0, 1], // Jour de l'an
		[4, 1], // Fête du travail
		[4, 8], // Victoire 1945
		[6, 14], // Fête nationale
		[7, 15], // Assomption
		[10, 1], // Toussaint
		[10, 11], // Armistice
		[11, 25] // Noël
	].map(([m, d]) => toISODate(new Date(Date.UTC(year, m, d))));

	const easter = easterSunday(year);
	const mobile = [addDays(easter, 1), addDays(easter, 39), addDays(easter, 50)].map(toISODate); // lundi de Pâques, Ascension, lundi de Pentecôte

	return new Set([...fixed, ...mobile]);
}

const holidayCache = new Map<number, Set<string>>();

/** True si la date ISO est un jour férié légal français. */
export function isPublicHolidayFR(dateISO: string): boolean {
	const year = parseISODate(dateISO).getUTCFullYear();
	let holidays = holidayCache.get(year);
	if (!holidays) {
		holidays = publicHolidaysFR(year);
		holidayCache.set(year, holidays);
	}
	return holidays.has(dateISO);
}

/** Nombre de jours ouvrés non fériés (lun→ven, hors jours fériés FR) entre deux dates ISO incluses. */
export function countWorkdaysNonHoliday(fromISO: string, toISO: string): number {
	const from = parseISODate(fromISO);
	const to = parseISODate(toISO);
	if (from > to) return 0;
	let count = 0;
	for (let d = from; d <= to; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6 && !isPublicHolidayFR(toISODate(d))) count++;
	}
	return count;
}

/**
 * Jours fériés FR tombant un jour ouvré entre deux dates ISO incluses — donc exactement ceux que
 * `countWorkdaysNonHoliday` a retirés du décompte. Sert à montrer d'où vient le nombre de jours
 * ouvrés d'un mois (cf. clôture mensuelle) : un férié en week-end ne change rien et n'a rien à
 * faire dans cette liste.
 */
export function workdayHolidaysBetween(fromISO: string, toISO: string): string[] {
	const from = parseISODate(fromISO);
	const to = parseISODate(toISO);
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6 && isPublicHolidayFR(toISODate(d))) out.push(toISODate(d));
	}
	return out;
}

/** Numéro de semaine ISO. */
export function isoWeek(d: Date): number {
	const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dayNum = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayNum + 3);
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
	return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** Jours ouvrés (lun→ven) entre deux dates ISO incluses, ordonnés. Fériés conservés. */
export function workdaysBetween(fromISO: string, toISO: string): string[] {
	const to = parseISODate(toISO);
	const out: string[] = [];
	for (let d = parseISODate(fromISO); d <= to; d = addDays(d, 1)) {
		const dow = d.getUTCDay();
		if (dow !== 0 && dow !== 6) out.push(toISODate(d));
	}
	return out;
}

/** Bornes calendaires de la quinzaine contenant `dateISO` : 1→15 ou 16→fin de mois. */
export function fortnightBounds(dateISO: string): { start: string; end: string } {
	const d = parseISODate(dateISO);
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	if (d.getUTCDate() <= 15)
		return { start: toISODate(new Date(Date.UTC(y, m, 1))), end: toISODate(new Date(Date.UTC(y, m, 15))) };
	// Jour 0 du mois suivant = dernier jour du mois courant.
	return { start: toISODate(new Date(Date.UTC(y, m, 16))), end: toISODate(new Date(Date.UTC(y, m + 1, 0))) };
}

/** Bornes calendaires du mois contenant `dateISO`. */
export function monthBounds(dateISO: string): { start: string; end: string } {
	const d = parseISODate(dateISO);
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	return { start: toISODate(new Date(Date.UTC(y, m, 1))), end: toISODate(new Date(Date.UTC(y, m + 1, 0))) };
}

/** Options d'un sélecteur de mois : mois courant + les `back` précédents, en 'YYYY-MM'. */
export function monthOptions(now: Date, back = 11): { value: string; label: string }[] {
	const opts: { value: string; label: string }[] = [];
	for (let i = 0; i <= back; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
		opts.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
	}
	return opts;
}

/** Bornes ISO d'un mois 'YYYY-MM'. */
export function monthRange(value: string): { from: string; to: string } {
	const [y, m] = value.split('-').map(Number);
	const last = new Date(y, m, 0).getDate();
	return { from: `${value}-01`, to: `${value}-${String(last).padStart(2, '0')}` };
}

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = [
	'janv.',
	'févr.',
	'mars',
	'avr.',
	'mai',
	'juin',
	'juil.',
	'août',
	'sept.',
	'oct.',
	'nov.',
	'déc.'
];

// Noms complets — pour un titre de mois (« Juin 2026 ») ; MONTHS est abrégé et ne convient
// que dans une plage de dates (« 29 juin → 3 juil. »).
const MONTHS_LONG = [
	'Janvier',
	'Février',
	'Mars',
	'Avril',
	'Mai',
	'Juin',
	'Juillet',
	'Août',
	'Septembre',
	'Octobre',
	'Novembre',
	'Décembre'
];

export function dayName(d: Date): string {
	return DAY_NAMES[(d.getUTCDay() + 6) % 7];
}

export function dayNum(d: Date): number {
	return d.getUTCDate();
}

const MOOD_PERIOD_DAYS = { WEEK_1: 7, WEEK_2: 14, WEEK_3: 21 } as const;

/**
 * Plage Team mood active contenant `todayISO`. Pour WEEK_1/2/3 : dernier `startWeekday`
 * (0=lundi..6=dimanche) au plus tôt égal à aujourd'hui, plage de `days` jours à partir de là.
 * Pour MONTH : toujours du 1er au dernier jour du mois courant (startWeekday ignoré).
 */
export function currentMoodPeriod(
	kind: 'WEEK_1' | 'WEEK_2' | 'WEEK_3' | 'MONTH',
	startWeekday: number,
	todayISO: string
): { start: string; end: string } {
	const today = parseISODate(todayISO);
	if (kind === 'MONTH') {
		const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
		const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
		return { start: toISODate(start), end: toISODate(end) };
	}
	const dow = (today.getUTCDay() + 6) % 7; // 0 = lundi
	const diff = (dow - startWeekday + 7) % 7;
	const start = addDays(today, -diff);
	const end = addDays(start, MOOD_PERIOD_DAYS[kind] - 1);
	return { start: toISODate(start), end: toISODate(end) };
}

/** Début de la plage Team mood précédant celle qui commence à `periodStartISO` (pour calculer un streak). */
export function previousMoodPeriodStart(kind: 'WEEK_1' | 'WEEK_2' | 'WEEK_3' | 'MONTH', periodStartISO: string): string {
	const start = parseISODate(periodStartISO);
	if (kind === 'MONTH') {
		return toISODate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
	}
	return toISODate(addDays(start, -MOOD_PERIOD_DAYS[kind]));
}

// Lundi = 0 … dimanche = 6 (contrairement à getUTCDay() où dimanche = 0).
function mondayBasedDow(d: Date): number {
	return (d.getUTCDay() + 6) % 7;
}

/** Jour "actif" pour la perm support : lun-ven toujours, samedi seulement si `includeSaturday`, jamais dimanche. */
function isActiveSupportDay(d: Date, includeSaturday: boolean): boolean {
	const dow = mondayBasedDow(d);
	if (dow === 5) return includeSaturday; // samedi
	return dow !== 6; // tout sauf dimanche
}

/**
 * Plage de la période de perm support (DAY/WEEK/MONTH) contenant `todayISO`. WEEK = lun→ven (ou
 * lun→sam si `includeSaturday`). DAY : un jour non actif (week-end) retombe sur le dernier jour
 * actif précédent — comme WEEK, où le week-end "appartient" toujours à la semaine en cours.
 */
export function currentSupportPeriod(
	cadence: 'DAY' | 'WEEK' | 'MONTH',
	todayISO: string,
	includeSaturday = false
): { start: string; end: string } {
	const today = parseISODate(todayISO);
	if (cadence === 'MONTH') {
		const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
		const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
		return { start: toISODate(start), end: toISODate(end) };
	}
	if (cadence === 'WEEK') {
		const start = mondayOf(today);
		return { start: toISODate(start), end: toISODate(addDays(start, includeSaturday ? 5 : 4)) };
	}
	let d = today;
	while (!isActiveSupportDay(d, includeSaturday)) d = addDays(d, -1);
	const activeDay = toISODate(d);
	return { start: activeDay, end: activeDay };
}

// Ancrage arbitraire (lundi) pour numéroter les périodes de façon stable, sans stocker de date de
// départ de rotation : deux workspaces avec la même cadence et le même ordre de membres tombent
// naturellement d'accord, même après ajout/suppression d'un membre.
const SUPPORT_EPOCH_MS = Date.UTC(2000, 0, 3);

/**
 * Index entier croissant de la période — sert à choisir `membres[index % nbMembres]`. En cadence
 * DAY, seuls les jours actifs comptent (jamais le dimanche, le samedi seulement si
 * `includeSaturday`) : sans ça, un week-end de 2 jours ferait sauter 2 personnes dans la rotation
 * entre vendredi et lundi alors qu'un seul jour ouvré s'est écoulé.
 */
export function supportPeriodIndex(
	cadence: 'DAY' | 'WEEK' | 'MONTH',
	periodStartISO: string,
	includeSaturday = false
): number {
	const start = parseISODate(periodStartISO);
	if (cadence === 'MONTH') return start.getUTCFullYear() * 12 + start.getUTCMonth();
	const diffDays = Math.round((start.getTime() - SUPPORT_EPOCH_MS) / 86400000);
	if (cadence === 'WEEK') return Math.floor(diffDays / 7);
	const activeDaysPerWeek = includeSaturday ? 6 : 5;
	return Math.floor(diffDays / 7) * activeDaysPerWeek + mondayBasedDow(start);
}

/** Plage de dates lisible : « 6 → 10 juil. 2026 », « 29 juin → 3 juil. 2026 », « 29 déc. 2025 → 2 janv. 2026 ». */
/**
 * Plusieurs jours d'un même mois, mois écrit une seule fois : « 1, 8, 14, 25 mai ». Dès que deux
 * mois se mélangent on retombe sur la forme longue, sinon la liste devient ambiguë.
 */
export function formatDayList(datesISO: string[]): string {
	if (datesISO.length === 0) return '';
	const parsed = datesISO.map(parseISODate);
	const sameMonth = parsed.every(
		(d) => d.getUTCMonth() === parsed[0].getUTCMonth() && d.getUTCFullYear() === parsed[0].getUTCFullYear()
	);
	if (!sameMonth) return datesISO.map(formatDay).join(', ');
	return `${parsed.map(dayNum).join(', ')} ${MONTHS[parsed[0].getUTCMonth()]}`;
}

/** Un jour seul, sans l'année : « 15 août ». formatDayRange sur deux bornes égales donne « 15 → 15 août 2026 ». */
export function formatDay(dateISO: string): string {
	const d = parseISODate(dateISO);
	return `${dayNum(d)} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatDayRange(fromISO: string, toISO: string): string {
	const from = parseISODate(fromISO);
	const to = parseISODate(toISO);
	const toPart = `${dayNum(to)} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
	// Même mois & année : on n'écrit le mois qu'une fois (ex. "29 → 3 juil. 2026" resterait ambigu,
	// donc on ajoute le mois de la borne gauche dès que le mois — ou l'année — diffère).
	if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear())
		return `${dayNum(from)} → ${toPart}`;
	const fromPart =
		from.getUTCFullYear() === to.getUTCFullYear()
			? `${dayNum(from)} ${MONTHS[from.getUTCMonth()]}`
			: `${dayNum(from)} ${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
	return `${fromPart} → ${toPart}`;
}

export function formatRange(monday: Date): string {
	return formatDayRange(toISODate(monday), toISODate(addDays(monday, 4)));
}

/** Titre de mois : « Juin 2026 ». */
export function formatMonthLabel(dateISO: string): string {
	const d = parseISODate(dateISO);
	return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Titre de mois abrégé : « Juin 2026 » avec le mois court (pour un en-tête de colonne groupée). */
export function formatMonthShortLabel(dateISO: string): string {
	const d = parseISODate(dateISO);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Décale une date ISO de `n` mois, calée sur le 1er du mois résultant. */
export function addMonths(dateISO: string, n: number): string {
	const d = parseISODate(dateISO);
	return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

// ---------- Périodes d'imputation ----------

export type Granularity = 'WEEK' | 'FORTNIGHT' | 'MONTH';
export type PeriodMode = 'FIXED' | 'ROLLING';

export const GRANULARITIES: Granularity[] = ['WEEK', 'FORTNIGHT', 'MONTH'];
export const GRANULARITY_LABELS: Record<Granularity, string> = {
	WEEK: 'Semaine',
	FORTNIGHT: 'Quinzaine',
	MONTH: 'Mois'
};

// Glissant = k semaines entières finissant sur la semaine ancre. L'alignement semaine est
// délibéré : il fait tomber juste l'en-tête « S32 », les séparateurs de semaine, et rend la
// navigation ‹ › (± 1 semaine) exactement réversible.
const ROLLING_WEEKS: Record<Granularity, number> = { WEEK: 1, FORTNIGHT: 2, MONTH: 4 };

export type PeriodWeek = { mondayISO: string; weekNumber: number; days: string[] };

export type Period = {
	granularity: Granularity;
	mode: PeriodMode;
	/** Ancre normalisée — c'est elle que porte `?w=`. */
	anchorISO: string;
	/** Jours ouvrés lun→ven ordonnés. Jamais de week-end ; les fériés restent des colonnes. */
	days: string[];
	firstDay: string;
	lastDay: string;
	prevAnchor: string;
	nextAnchor: string;
	/** « 6 → 10 juil. 2026 », « Juin 2026 », « Glissant · 8 juin → 3 juil. 2026 ». */
	label: string;
	/** Pastille compacte entre ‹ › : « S28 », « Q1 juin », « juin », « S25–S28 ». */
	shortLabel: string;
	/** Groupement par semaine (en-tête de groupe + séparateurs en vue longue). */
	weeks: PeriodWeek[];
	/** Identité de la plage — sert de garde de resynchronisation côté client. */
	rangeKey: string;
};

/** Regroupe des jours ISO par lundi de leur semaine ISO (ordre conservé). */
export function groupByWeek(days: string[]): PeriodWeek[] {
	const weeks: PeriodWeek[] = [];
	for (const day of days) {
		const mondayISO = toISODate(mondayOf(parseISODate(day)));
		const last = weeks[weeks.length - 1];
		if (last && last.mondayISO === mondayISO) last.days.push(day);
		else weeks.push({ mondayISO, weekNumber: isoWeek(parseISODate(day)), days: [day] });
	}
	return weeks;
}

export function parseGranularity(raw: string | null | undefined): Granularity | null {
	return raw === 'WEEK' || raw === 'FORTNIGHT' || raw === 'MONTH' ? raw : null;
}

export function parsePeriodMode(raw: string | null | undefined): PeriodMode | null {
	return raw === 'FIXED' || raw === 'ROLLING' ? raw : null;
}

/**
 * Construit la période affichée à partir d'une granularité, d'un mode et d'une date d'ancrage.
 *
 * Attention : en mode fixe, la quinzaine et le mois se choisissent depuis la date d'ancre **brute**,
 * jamais depuis le lundi de sa semaine — `2026-02-01` est un dimanche, `mondayOf` renverrait
 * `2026-01-26` et on afficherait janvier. Les ancres prev/next pointent sur le premier jour de
 * l'unité adjacente, ce qui rend la navigation réversible sans heuristique.
 */
export function buildPeriod(granularity: Granularity, mode: PeriodMode, anchorISO: string): Period {
	// Une semaine glissante est par construction une semaine fixe : on n'expose pas la bascule.
	const effectiveMode: PeriodMode = granularity === 'WEEK' ? 'FIXED' : mode;

	let anchor: string;
	let days: string[];
	let prevAnchor: string;
	let nextAnchor: string;
	let label: string;
	let shortLabel: string;

	if (effectiveMode === 'ROLLING' || granularity === 'WEEK') {
		const monday = mondayOf(parseISODate(anchorISO));
		const weekCount = ROLLING_WEEKS[granularity];
		const firstMonday = addDays(monday, -7 * (weekCount - 1));
		anchor = toISODate(monday);
		days = [];
		for (let i = 0; i < weekCount; i++) days.push(...workWeek(addDays(firstMonday, 7 * i)).map(toISODate));
		prevAnchor = toISODate(addDays(monday, -7));
		nextAnchor = toISODate(addDays(monday, 7));
		if (granularity === 'WEEK') {
			label = formatRange(monday);
			shortLabel = `S${isoWeek(monday)}`;
		} else {
			label = `Glissant · ${formatDayRange(days[0], days[days.length - 1])}`;
			shortLabel = `S${isoWeek(firstMonday)}–S${isoWeek(monday)}`;
		}
	} else {
		const bounds = granularity === 'FORTNIGHT' ? fortnightBounds(anchorISO) : monthBounds(anchorISO);
		anchor = bounds.start;
		days = workdaysBetween(bounds.start, bounds.end);
		const start = parseISODate(bounds.start);
		prevAnchor = (granularity === 'FORTNIGHT' ? fortnightBounds : monthBounds)(
			toISODate(addDays(start, -1))
		).start;
		// Le lendemain de la borne haute est le premier jour de l'unité suivante.
		nextAnchor = toISODate(addDays(parseISODate(bounds.end), 1));
		if (granularity === 'FORTNIGHT') {
			label = formatDayRange(bounds.start, bounds.end);
			shortLabel = `Q${start.getUTCDate() === 1 ? 1 : 2} ${MONTHS[start.getUTCMonth()]}`;
		} else {
			label = formatMonthLabel(bounds.start);
			shortLabel = MONTHS[start.getUTCMonth()];
		}
	}

	const firstDay = days[0];
	const lastDay = days[days.length - 1];
	return {
		granularity,
		mode: effectiveMode,
		anchorISO: anchor,
		days,
		firstDay,
		lastDay,
		prevAnchor,
		nextAnchor,
		label,
		shortLabel,
		weeks: groupByWeek(days),
		rangeKey: `${granularity}:${effectiveMode}:${firstDay}:${lastDay}`
	};
}
