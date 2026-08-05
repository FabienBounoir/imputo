import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, timeEntry, membership, user } from '$lib/server/db';
import { num, round, weeklyCapacity, capacityPct } from './calc';
import { mondayOf, parseISODate, toISODate, addDays, isoWeek, countWorkdaysNonHoliday } from '$lib/utils/date';

export type WeeklySynthesisRow = {
	userId: string;
	name: string;
	mondayISO: string;
	isoWeek: number;
	total: number;
	capacity: number;
	pct: number;
	/** Dépassement de capacité — jamais bloquant, juste un indicateur visuel. */
	overCapacity: boolean;
	/** Imputé par jour ouvré (ISO date → jours). Vue détaillée (§ toggle jour/semaine). */
	days: Record<string, number>;
	capacityPerDay: number;
};

/**
 * Synthèse hebdo par personne (semaine × personne, % de capacité) sur une période donnée.
 * Vue admin pour faciliter la validation des imputations — pas un nouveau mode de saisie.
 */
export async function getWeeklySynthesis(
	workspaceId: string,
	from: string,
	to: string
): Promise<WeeklySynthesisRow[]> {
	const [entries, members] = await Promise.all([
		db
			.select({ userId: timeEntry.userId, day: timeEntry.day, total: sql<string>`sum(${timeEntry.amount})` })
			.from(timeEntry)
			.where(and(eq(timeEntry.workspaceId, workspaceId), gte(timeEntry.day, from), lte(timeEntry.day, to)))
			.groupBy(timeEntry.userId, timeEntry.day),
		db
			.select({ userId: membership.userId, name: user.displayName, capacityPerDay: membership.capacityPerDay })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(eq(membership.workspaceId, workspaceId))
	]);
	const memberMap = new Map(members.map((m) => [m.userId, m]));

	const weekMap = new Map<string, { userId: string; mondayISO: string; total: number; days: Map<string, number> }>();
	for (const e of entries) {
		const mondayISO = toISODate(mondayOf(parseISODate(e.day)));
		const key = `${e.userId}:${mondayISO}`;
		const w = weekMap.get(key) ?? { userId: e.userId, mondayISO, total: 0, days: new Map() };
		const v = num(e.total);
		w.total = round(w.total + v);
		w.days.set(e.day, round((w.days.get(e.day) ?? 0) + v));
		weekMap.set(key, w);
	}

	const rows: WeeklySynthesisRow[] = [];
	for (const w of weekMap.values()) {
		const member = memberMap.get(w.userId);
		if (!member) continue; // membre retiré de l'espace depuis : hors périmètre de la synthèse
		const friday = toISODate(addDays(parseISODate(w.mondayISO), 4));
		const workdays = countWorkdaysNonHoliday(w.mondayISO, friday);
		const capacity = weeklyCapacity(member.capacityPerDay, workdays);
		const pct = capacityPct(w.total, capacity);
		rows.push({
			userId: w.userId,
			name: member.name,
			mondayISO: w.mondayISO,
			isoWeek: isoWeek(parseISODate(w.mondayISO)),
			total: w.total,
			capacity,
			pct,
			overCapacity: pct > 1,
			days: Object.fromEntries(w.days),
			capacityPerDay: num(member.capacityPerDay)
		});
	}
	return rows.sort((a, b) => (a.mondayISO === b.mondayISO ? a.name.localeCompare(b.name) : a.mondayISO.localeCompare(b.mondayISO)));
}
