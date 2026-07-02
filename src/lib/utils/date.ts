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

export function dayName(d: Date): string {
	return DAY_NAMES[(d.getUTCDay() + 6) % 7];
}

export function dayNum(d: Date): number {
	return d.getUTCDate();
}

export function formatRange(monday: Date): string {
	const fri = addDays(monday, 4);
	const friPart = `${dayNum(fri)} ${MONTHS[fri.getUTCMonth()]} ${fri.getUTCFullYear()}`;
	// Même mois & année : on n'écrit le mois qu'une fois (ex. "29 → 3 juil. 2026" resterait ambigu,
	// donc on ajoute le mois du lundi dès que le mois — ou l'année — diffère).
	if (monday.getUTCMonth() === fri.getUTCMonth() && monday.getUTCFullYear() === fri.getUTCFullYear())
		return `${dayNum(monday)} → ${friPart}`;
	const monPart =
		monday.getUTCFullYear() === fri.getUTCFullYear()
			? `${dayNum(monday)} ${MONTHS[monday.getUTCMonth()]}`
			: `${dayNum(monday)} ${MONTHS[monday.getUTCMonth()]} ${monday.getUTCFullYear()}`;
	return `${monPart} → ${friPart}`;
}
