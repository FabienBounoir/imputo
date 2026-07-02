import { and, eq, lt, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import {
	db,
	workspace,
	membership,
	user,
	timeEntry,
	category,
	ticket,
	notificationLog
} from '$lib/server/db';
import { config } from '$lib/server/config';
import { num } from './calc';
import {
	todayInParis,
	previousWorkday,
	isWorkday,
	parseISODate,
	mondayOf,
	workWeek,
	toISODate
} from '$lib/utils/date';
import { sendToUser, hasSubscription, type PushPayload } from './push';

type NotifKind = 'EVENING_MISSING' | 'MORNING_YESTERDAY' | 'RAE_STALE' | 'WEEKLY_RECAP';

type Prefs = {
	enabled: boolean;
	eveningMissing: boolean;
	morningYesterday: boolean;
	raeStale: boolean;
	weeklyRecap: boolean;
};
const DEFAULT_PREFS: Prefs = {
	enabled: true,
	eveningMissing: true,
	morningYesterday: true,
	raeStale: true,
	weeklyRecap: true
};
export function parseNotifPrefs(raw: string | null): Prefs {
	if (!raw) return DEFAULT_PREFS;
	try {
		const p = JSON.parse(raw);
		return p && typeof p === 'object' ? { ...DEFAULT_PREFS, ...p } : DEFAULT_PREFS;
	} catch {
		return DEFAULT_PREFS;
	}
}
const PREF_KEY: Record<NotifKind, keyof Prefs> = {
	EVENING_MISSING: 'eveningMissing',
	MORNING_YESTERDAY: 'morningYesterday',
	RAE_STALE: 'raeStale',
	WEEKLY_RECAP: 'weeklyRecap'
};

type Member = {
	workspaceId: string;
	workspaceName: string;
	userId: string;
	capacity: number;
	prefsRaw: string | null;
};

async function activeMembers(): Promise<Member[]> {
	const rows = await db
		.select({
			workspaceId: membership.workspaceId,
			workspaceName: workspace.name,
			userId: membership.userId,
			capacity: membership.capacityPerDay,
			prefsRaw: user.notifPrefs
		})
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.innerJoin(workspace, eq(membership.workspaceId, workspace.id))
		.where(and(eq(membership.active, true), eq(user.active, true)));
	return rows.map((r) => ({ ...r, capacity: num(r.capacity) }));
}

/** Insère le verrou de dédup puis envoie (idempotent). Renvoie 1 si une notif a été tentée. */
async function maybeNotify(
	m: Member,
	kind: NotifKind,
	refDate: string,
	payload: PushPayload
): Promise<number> {
	const prefs = parseNotifPrefs(m.prefsRaw);
	if (!prefs.enabled || !prefs[PREF_KEY[kind]]) return 0;
	if (!(await hasSubscription(m.userId))) return 0;
	const claimed = await db
		.insert(notificationLog)
		.values({ userId: m.userId, workspaceId: m.workspaceId, kind, refDate })
		.onConflictDoNothing()
		.returning({ id: notificationLog.id });
	if (claimed.length === 0) return 0; // déjà envoyé pour ce (user, espace, type, date)
	await sendToUser(m.userId, payload);
	return 1;
}

/** Jour non (assez) saisi : EVENING_MISSING (aujourd'hui) ou MORNING_YESTERDAY (veille). */
async function dayMissing(kind: NotifKind, day: string, members: Member[]): Promise<number> {
	const totals = await db
		.select({
			workspaceId: timeEntry.workspaceId,
			userId: timeEntry.userId,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		.where(eq(timeEntry.day, day))
		.groupBy(timeEntry.workspaceId, timeEntry.userId);
	const totalMap = new Map(totals.map((t) => [`${t.workspaceId}:${t.userId}`, num(t.total)]));

	const absent = await db
		.selectDistinct({ workspaceId: timeEntry.workspaceId, userId: timeEntry.userId })
		.from(timeEntry)
		.innerJoin(category, eq(timeEntry.categoryId, category.id))
		.where(and(eq(timeEntry.day, day), eq(category.kind, 'NON_PRODUCTIVE')));
	const absentSet = new Set(absent.map((a) => `${a.workspaceId}:${a.userId}`));

	let sent = 0;
	for (const m of members) {
		const key = `${m.workspaceId}:${m.userId}`;
		if (absentSet.has(key)) continue; // congé / férié ce jour-là
		if ((totalMap.get(key) ?? 0) >= m.capacity) continue; // journée remplie
		const body =
			kind === 'EVENING_MISSING'
				? `${m.workspaceName} : tu n'as pas saisi ton imputation d'aujourd'hui.`
				: `${m.workspaceName} : le ${day} n'a pas été renseigné. Pense à le compléter.`;
		sent += await maybeNotify(m, kind, day, {
			title: kind === 'EVENING_MISSING' ? 'Imputation du jour' : "Imputation d'hier",
			body,
			url: '/imputation',
			tag: `${kind}:${day}`
		});
	}
	return sent;
}

/** Tickets actifs assignés au RAE périmé. */
async function raeStale(refDate: string, members: Member[]): Promise<number> {
	const cutoff = new Date(Date.now() - config.raeStaleDays * 86400000);
	const rows = await db
		.select({
			workspaceId: ticket.workspaceId,
			userId: ticket.assigneeId,
			cnt: sql<number>`count(*)::int`
		})
		.from(ticket)
		.innerJoin(workspace, eq(ticket.workspaceId, workspace.id))
		.where(
			and(
				isNotNull(ticket.assigneeId),
				isNull(ticket.archivedAt),
				isNotNull(ticket.raeUpdatedAt),
				lt(ticket.raeUpdatedAt, cutoff),
				// RAE Test ignoré si la phase Test est désactivée sur l'espace.
				sql`coalesce(${ticket.raeReal}, 0) + case when ${workspace.testPhase} then coalesce(${ticket.raeTest}, 0) else 0 end > 0`
			)
		)
		.groupBy(ticket.workspaceId, ticket.assigneeId);

	const byMember = new Map(members.map((m) => [`${m.workspaceId}:${m.userId}`, m]));
	let sent = 0;
	for (const r of rows) {
		const m = r.userId ? byMember.get(`${r.workspaceId}:${r.userId}`) : null;
		if (!m) continue;
		sent += await maybeNotify(m, 'RAE_STALE', refDate, {
			title: 'RAE à mettre à jour',
			body: `${m.workspaceName} : ${r.cnt} ticket${r.cnt > 1 ? 's' : ''} attendent une mise à jour du RAE.`,
			url: '/tickets',
			tag: `RAE_STALE:${refDate}`
		});
	}
	return sent;
}

/** Récap hebdo : un jour ouvré de la semaine reste incomplet. */
async function weeklyRecap(refDate: string, members: Member[]): Promise<number> {
	const weekDays = workWeek(mondayOf(parseISODate(refDate))).map(toISODate);
	const totals = await db
		.select({
			workspaceId: timeEntry.workspaceId,
			userId: timeEntry.userId,
			day: timeEntry.day,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		.where(inArray(timeEntry.day, weekDays))
		.groupBy(timeEntry.workspaceId, timeEntry.userId, timeEntry.day);
	const totalMap = new Map(totals.map((t) => [`${t.workspaceId}:${t.userId}:${t.day}`, num(t.total)]));

	const absent = await db
		.selectDistinct({
			workspaceId: timeEntry.workspaceId,
			userId: timeEntry.userId,
			day: timeEntry.day
		})
		.from(timeEntry)
		.innerJoin(category, eq(timeEntry.categoryId, category.id))
		.where(and(inArray(timeEntry.day, weekDays), eq(category.kind, 'NON_PRODUCTIVE')));
	const absentSet = new Set(absent.map((a) => `${a.workspaceId}:${a.userId}:${a.day}`));

	let sent = 0;
	for (const m of members) {
		let incomplete = false;
		for (const d of weekDays) {
			const k = `${m.workspaceId}:${m.userId}:${d}`;
			if (absentSet.has(k)) continue;
			if ((totalMap.get(k) ?? 0) < m.capacity) {
				incomplete = true;
				break;
			}
		}
		if (!incomplete) continue;
		sent += await maybeNotify(m, 'WEEKLY_RECAP', refDate, {
			title: 'Semaine à boucler',
			body: `${m.workspaceName} : il reste des jours incomplets cette semaine.`,
			url: '/imputation',
			tag: `WEEKLY_RECAP:${refDate}`
		});
	}
	return sent;
}

/** Orchestrateur appelé par le cron. `trigger` = morning | evening | weekly. */
export async function runNotifications(trigger: 'morning' | 'evening' | 'weekly') {
	const today = todayInParis();
	if (!isWorkday(today)) return { trigger, skipped: 'non-ouvré', sent: 0 };

	const members = await activeMembers();
	let sent = 0;
	if (trigger === 'evening') {
		sent += await dayMissing('EVENING_MISSING', today, members);
	} else if (trigger === 'morning') {
		sent += await dayMissing('MORNING_YESTERDAY', previousWorkday(today), members);
		sent += await raeStale(today, members);
	} else if (trigger === 'weekly') {
		sent += await weeklyRecap(today, members);
	}
	return { trigger, sent };
}
