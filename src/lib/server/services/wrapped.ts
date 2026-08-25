import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, workspace, membership, user, timeEntry, ticket, category, moodVote, supportOverride, wrappedSnapshot } from '$lib/server/db';
import { config } from '$lib/server/config';
import { num, round } from './calc';
import { getSupportConfig, listRotationMembers, pickFromChain } from './support';
import { currentSupportPeriod, supportPeriodIndex, formatMonthLabel, parseISODate, addDays, toISODate, workdaysBetween } from '$lib/utils/date';

/**
 * Fenêtre d'activation du wrapped : 1 déc → 5 jan (cf. docs/SPECS-wrapped.md), sauf
 * WRAPPED_FORCE_OPEN=1 (démo/QA — jamais posé en préprod/prod) qui l'ouvre toute l'année.
 */
export function isWrappedWindowOpen(dateISO: string): boolean {
	if (config.wrappedForceOpen) return true;
	const d = parseISODate(dateISO);
	const month = d.getUTCMonth(); // 0 = janvier, 11 = décembre
	if (month === 11) return true;
	if (month === 0) return d.getUTCDate() <= 5;
	return false;
}

/** Année couverte par le wrap actif à `dateISO` — seule la queue du 1 au 5 janvier retombe sur l'année précédente. */
export function wrappedYearFor(dateISO: string): number {
	const d = parseISODate(dateISO);
	if (d.getUTCMonth() === 0 && d.getUTCDate() <= 5) return d.getUTCFullYear() - 1;
	return d.getUTCFullYear();
}

export type WrappedPayload = {
	year: number;
	totalHours: number;
	productivePct: number;
	topTicket: { key: string; title: string; hours: number } | null;
	streakDays: number;
	moodEnabled: boolean;
	moodAvg: number | null;
	moodBestMonth: string | null;
	moodWorstMonth: string | null;
	supportEnabled: boolean;
	supportCount: number;
	duo: { displayName: string; ticketsInCommon: number } | null;
};

/** Plus longue série de jours ouvrés consécutifs avec au moins une imputation saisie. */
function longestWorkdayStreak(daysWithEntries: string[], fromISO: string, toISO: string): number {
	const set = new Set(daysWithEntries);
	let streak = 0;
	let best = 0;
	for (const day of workdaysBetween(fromISO, toISO)) {
		if (set.has(day)) {
			streak++;
			best = Math.max(best, streak);
		} else {
			streak = 0;
		}
	}
	return best;
}

async function computeSupportCount(workspaceId: string, userId: string, fromISO: string, toISO: string): Promise<number> {
	const [{ cadence, offset, includeSaturday }, members] = await Promise.all([
		getSupportConfig(workspaceId),
		listRotationMembers(workspaceId)
	]);
	if (members.length === 0) return 0;

	// Périodes distinctes de l'année : on balaie chaque jour et on retombe systématiquement sur le
	// début de la période active qui le contient (currentSupportPeriod snap déjà le week-end sur le
	// dernier jour actif) — pas besoin de ré-implémenter le calcul "jour actif" ici.
	const periodStarts: string[] = [];
	const seen = new Set<string>();
	const to = parseISODate(toISO);
	for (let d = parseISODate(fromISO); d <= to; d = addDays(d, 1)) {
		const { start } = currentSupportPeriod(cadence, toISODate(d), includeSaturday);
		if (!seen.has(start)) {
			seen.add(start);
			periodStarts.push(start);
		}
	}

	const overrides = await db
		.select({ periodStart: supportOverride.periodStart, userId: supportOverride.userId })
		.from(supportOverride)
		.where(and(eq(supportOverride.workspaceId, workspaceId), gte(supportOverride.periodStart, fromISO), lte(supportOverride.periodStart, toISO)));
	const overrideByPeriod = new Map(overrides.map((o) => [o.periodStart, o.userId]));

	let count = 0;
	for (const periodStart of periodStarts) {
		const overridden = overrideByPeriod.get(periodStart);
		const effectiveUserId = overridden ?? pickFromChain(cadence, members, offset, periodStart, includeSaturday).userId;
		if (effectiveUserId === userId) count++;
	}
	return count;
}

/**
 * Calcule le contenu du wrap d'une personne pour une année donnée, sans rien écrire en base.
 * S'arrête au 30 novembre (pas le 31 décembre) — comme Spotify Wrapped : décembre n'est pas encore
 * terminé quand la page ouvre le 1er décembre, un calcul sur l'année complète serait donc partiel
 * et devrait être refait chaque jour pour se compléter. En s'arrêtant fin novembre, la donnée est
 * définitive dès l'ouverture de la fenêtre — un seul calcul suffit (cf. runWrapped).
 */
export async function computeUserWrapped(workspaceId: string, userId: string, year: number): Promise<WrappedPayload> {
	const fromISO = `${year}-01-01`;
	const toISO = `${year}-11-30`;
	const range = and(
		eq(timeEntry.workspaceId, workspaceId),
		eq(timeEntry.userId, userId),
		gte(timeEntry.day, fromISO),
		lte(timeEntry.day, toISO)
	);

	const [ws, totals, topTicketRows, dayRows] = await Promise.all([
		db.select({ moodEnabled: workspace.moodEnabled, supportEnabled: workspace.supportEnabled }).from(workspace).where(eq(workspace.id, workspaceId)),
		db
			.select({
				total: sql<string>`coalesce(sum(${timeEntry.amount}),0)`,
				productive: sql<string>`coalesce(sum(case when ${timeEntry.targetType} != 'CATEGORY' or ${category.kind} = 'PRODUCTIVE' then ${timeEntry.amount} else 0 end),0)`
			})
			.from(timeEntry)
			.leftJoin(category, eq(category.id, timeEntry.categoryId))
			.where(range),
		db
			.select({ key: ticket.key, title: ticket.title, hours: sql<string>`sum(${timeEntry.amount})` })
			.from(timeEntry)
			.innerJoin(ticket, eq(ticket.id, timeEntry.ticketId))
			.where(and(range, eq(timeEntry.targetType, 'TICKET')))
			.groupBy(ticket.id, ticket.key, ticket.title)
			.orderBy(desc(sql`sum(${timeEntry.amount})`))
			.limit(1),
		db.selectDistinct({ day: timeEntry.day }).from(timeEntry).where(range).orderBy(asc(timeEntry.day))
	]);

	const workspaceRow = ws[0];
	const totalHours = round(num(totals[0]?.total));
	const productiveHours = num(totals[0]?.productive);
	const productivePct = totalHours > 0 ? round((productiveHours / totalHours) * 100) : 0;
	const topTicket = topTicketRows[0] ? { key: topTicketRows[0].key, title: topTicketRows[0].title, hours: round(num(topTicketRows[0].hours)) } : null;
	const streakDays = longestWorkdayStreak(dayRows.map((r) => r.day), fromISO, toISO);

	let moodAvg: number | null = null;
	let moodBestMonth: string | null = null;
	let moodWorstMonth: string | null = null;
	if (workspaceRow?.moodEnabled) {
		const moodRows = await db
			.select({ periodStart: moodVote.periodStart, score: moodVote.score })
			.from(moodVote)
			.where(and(eq(moodVote.workspaceId, workspaceId), eq(moodVote.userId, userId), gte(moodVote.periodStart, fromISO), lte(moodVote.periodStart, toISO)));
		if (moodRows.length > 0) {
			moodAvg = round(moodRows.reduce((sum, r) => sum + r.score, 0) / moodRows.length);
			const byMonth = new Map<string, number[]>();
			for (const r of moodRows) {
				const monthKey = r.periodStart.slice(0, 7);
				(byMonth.get(monthKey) ?? byMonth.set(monthKey, []).get(monthKey)!).push(r.score);
			}
			const monthAverages = [...byMonth.entries()].map(([monthKey, scores]) => ({
				monthKey,
				avg: scores.reduce((a, b) => a + b, 0) / scores.length
			}));
			monthAverages.sort((a, b) => b.avg - a.avg);
			moodBestMonth = formatMonthLabel(`${monthAverages[0].monthKey}-01`);
			moodWorstMonth = formatMonthLabel(`${monthAverages[monthAverages.length - 1].monthKey}-01`);
		}
	}

	const supportCount = workspaceRow?.supportEnabled ? await computeSupportCount(workspaceId, userId, fromISO, toISO) : 0;

	const te2 = alias(timeEntry, 'te2');
	const duoRows = await db
		.select({ displayName: user.displayName, ticketsInCommon: sql<string>`count(distinct ${timeEntry.ticketId})` })
		.from(timeEntry)
		.innerJoin(
			te2,
			and(eq(te2.ticketId, timeEntry.ticketId), sql`${te2.userId} != ${timeEntry.userId}`, eq(te2.targetType, 'TICKET'), gte(te2.day, fromISO), lte(te2.day, toISO))
		)
		.innerJoin(user, eq(user.id, te2.userId))
		.where(and(range, eq(timeEntry.targetType, 'TICKET')))
		.groupBy(te2.userId, user.displayName)
		.orderBy(desc(sql`count(distinct ${timeEntry.ticketId})`))
		.limit(1);
	const duo = duoRows[0] ? { displayName: duoRows[0].displayName, ticketsInCommon: Number(duoRows[0].ticketsInCommon) } : null;

	return {
		year,
		totalHours,
		productivePct,
		topTicket,
		streakDays,
		moodEnabled: Boolean(workspaceRow?.moodEnabled),
		moodAvg,
		moodBestMonth,
		moodWorstMonth,
		supportEnabled: Boolean(workspaceRow?.supportEnabled),
		supportCount,
		duo
	};
}

/**
 * Cron quotidien (api/jobs/wrapped) : no-op hors fenêtre (1 déc → 5 jan). La donnée (jusqu'au 30
 * novembre, cf. computeUserWrapped) ne change plus une fois la fenêtre ouverte — chaque membre
 * n'est donc calculé et figé qu'une seule fois pour la saison, jamais recalculé les jours suivants.
 * Le passage quotidien du cron sert uniquement de filet : si le run du 1er décembre échoue (déploi
 * en cours, base indisponible…), celui du 2 décembre termine le travail à sa place.
 */
export async function runWrapped(dateISO: string, workspaceId?: string): Promise<{ workspaces: number; users: number }> {
	if (!isWrappedWindowOpen(dateISO)) return { workspaces: 0, users: 0 };
	const year = wrappedYearFor(dateISO);

	const workspaces = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(workspaceId ? eq(workspace.id, workspaceId) : undefined);

	let userCount = 0;
	for (const ws of workspaces) {
		const members = await db
			.select({ userId: membership.userId })
			.from(membership)
			.where(and(eq(membership.workspaceId, ws.id), eq(membership.active, true)));
		for (const m of members) {
			const already = await db
				.select({ id: wrappedSnapshot.id })
				.from(wrappedSnapshot)
				.where(and(eq(wrappedSnapshot.workspaceId, ws.id), eq(wrappedSnapshot.userId, m.userId), eq(wrappedSnapshot.year, year)));
			if (already.length > 0) continue;

			const payload = await computeUserWrapped(ws.id, m.userId, year);
			await db
				.insert(wrappedSnapshot)
				.values({ workspaceId: ws.id, userId: m.userId, year, payload })
				.onConflictDoNothing();
			userCount++;
		}
	}
	return { workspaces: workspaces.length, users: userCount };
}

/** Lit le wrap déjà figé d'une personne — ne calcule jamais à la volée (cf. runWrapped). */
export async function getMyWrapped(workspaceId: string, userId: string, year: number): Promise<WrappedPayload | null> {
	const rows = await db
		.select({ payload: wrappedSnapshot.payload })
		.from(wrappedSnapshot)
		.where(and(eq(wrappedSnapshot.workspaceId, workspaceId), eq(wrappedSnapshot.userId, userId), eq(wrappedSnapshot.year, year)));
	return (rows[0]?.payload as WrappedPayload) ?? null;
}
