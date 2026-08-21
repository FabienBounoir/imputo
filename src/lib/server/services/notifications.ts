import { and, eq, lt, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import {
	db,
	workspace,
	membership,
	user,
	timeEntry,
	category,
	ticket,
	ticketActivityRae,
	notificationLog,
	moodVote,
	type MoodPeriodKind
} from '$lib/server/db';
import { config } from '$lib/server/config';
import { num, resolvedRae } from './calc';
import { getCurrentDuty } from './support';
import {
	todayInParis,
	previousWorkday,
	isWorkday,
	parseISODate,
	mondayOf,
	workWeek,
	toISODate,
	addDays,
	formatDay,
	formatDayRange,
	currentMoodPeriod,
	previousMoodPeriodStart,
	lastWorkdayOnOrBefore
} from '$lib/utils/date';
import { sendToUser, hasSubscription } from './push';
import { NOTIF_SLOTS, type NotifPrefs, type SlotKey } from '$lib/push';
import { notifMessage, NOTIF_URL, type NotifKind, type NotifCtx } from './notification-messages';

type Prefs = NotifPrefs;
const DEFAULT_PREFS: Prefs = {
	enabled: true,
	eveningMissing: true,
	morningYesterday: true,
	raeStale: true,
	weeklyRecap: true,
	moodDeadline: true,
	moodRecap: true,
	absencePending: true,
	absenceValidated: true,
	supportDuty: true,
	morningSlots: {},
	eveningSlots: {}
};

/** N'accepte que les créneaux connus, et tout ce qui n'est pas explicitement `false` est actif. */
function parseSlots(raw: unknown, key: SlotKey): Record<string, boolean> {
	return Object.fromEntries(
		NOTIF_SLOTS[key].map((s) => [s, (raw as Record<string, unknown> | null)?.[s] !== false])
	);
}

export function parseNotifPrefs(raw: string | null): Prefs {
	let p: Record<string, unknown> = {};
	try {
		const parsed = raw ? JSON.parse(raw) : null;
		if (parsed && typeof parsed === 'object') p = parsed;
	} catch {
		// prefs illisibles : on retombe sur les valeurs par défaut
	}
	return {
		...DEFAULT_PREFS,
		...p,
		morningSlots: parseSlots(p.morningSlots, 'morningSlots'),
		eveningSlots: parseSlots(p.eveningSlots, 'eveningSlots')
	};
}
const PREF_KEY: Record<NotifKind, keyof Prefs> = {
	EVENING_MISSING: 'eveningMissing',
	MORNING_YESTERDAY: 'morningYesterday',
	RAE_STALE: 'raeStale',
	WEEKLY_RECAP: 'weeklyRecap',
	MOOD_DEADLINE: 'moodDeadline',
	MOOD_RECAP: 'moodRecap',
	ABSENCE_PENDING: 'absencePending',
	ABSENCE_VALIDATED: 'absenceValidated',
	SUPPORT_DUTY: 'supportDuty'
};
/** Seuls ces deux types sont relancés plusieurs fois par jour, donc réglables créneau par créneau. */
const SLOT_PREF: Partial<Record<NotifKind, SlotKey>> = {
	MORNING_YESTERDAY: 'morningSlots',
	EVENING_MISSING: 'eveningSlots'
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

type MoodMember = { userId: string; prefsRaw: string | null };

/** Membres actifs d'un espace, optionnellement filtrés par rôle (ex: ADMIN pour le récap mood). */
async function membersOf(workspaceId: string, role?: 'ADMIN'): Promise<MoodMember[]> {
	const conds = [eq(membership.workspaceId, workspaceId), eq(membership.active, true), eq(user.active, true)];
	if (role) conds.push(eq(membership.role, role));
	return db
		.select({ userId: membership.userId, prefsRaw: user.notifPrefs })
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.where(and(...conds));
}

/**
 * Une personne précise d'un espace, déjà identifiée (ex: la personne de perm du jour) — filtre en
 * SQL au lieu de charger tout l'effectif via membersOf() pour n'en garder qu'une avec .find().
 */
async function memberOf(workspaceId: string, userId: string): Promise<MoodMember | undefined> {
	const [row] = await db
		.select({ userId: membership.userId, prefsRaw: user.notifPrefs })
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.where(
			and(
				eq(membership.workspaceId, workspaceId),
				eq(membership.userId, userId),
				eq(membership.active, true),
				eq(user.active, true)
			)
		);
	return row;
}

/** Espaces où le Team mood est activé, avec leur config de plage. */
async function moodEnabledWorkspaces(): Promise<
	{ workspaceId: string; workspaceName: string; periodKind: MoodPeriodKind; startWeekday: number }[]
> {
	return db
		.select({
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			periodKind: workspace.moodPeriodKind,
			startWeekday: workspace.moodStartWeekday
		})
		.from(workspace)
		.where(eq(workspace.moodEnabled, true));
}

/**
 * Insère le verrou de dédup puis envoie (idempotent). Renvoie 1 si une notif a été tentée.
 * `slot` distingue les relances multiples le même jour (ex: 09h00/09h15/09h30) : chaque slot
 * a son propre verrou, donc la relance ne repart que si la condition est toujours vraie.
 */
async function maybeNotify<K extends NotifKind>(
	m: Member,
	kind: K,
	refDate: string,
	ctx: NotifCtx[K],
	slot = ''
): Promise<number> {
	const prefs = parseNotifPrefs(m.prefsRaw);
	if (!prefs.enabled || !prefs[PREF_KEY[kind]]) return 0;
	// Créneau désactivé par l'utilisateur (le `slot` des notifs congés est un absenceId, pas un
	// créneau : SLOT_PREF ne couvre que les deux types relancés par le cron).
	const slotKey = SLOT_PREF[kind];
	if (slotKey && prefs[slotKey][slot] === false) return 0;
	if (!(await hasSubscription(m.userId))) return 0;
	const claimed = await db
		.insert(notificationLog)
		.values({ userId: m.userId, workspaceId: m.workspaceId, kind, refDate, slot })
		.onConflictDoNothing()
		.returning({ id: notificationLog.id });
	if (claimed.length === 0) return 0; // déjà envoyé pour ce (user, espace, type, date, slot)
	// Graine sans le slot : les relances d'un même rappel gardent la formulation du premier envoi.
	const { title, body } = notifMessage(kind, ctx, `${m.userId}:${kind}:${refDate}`, m.workspaceName);
	await sendToUser(m.userId, {
		title,
		body,
		url: NOTIF_URL[kind],
		tag: slot ? `${kind}:${refDate}:${slot}` : `${kind}:${refDate}`
	});
	return 1;
}

/** Jour non (assez) saisi : EVENING_MISSING (aujourd'hui) ou MORNING_YESTERDAY (veille). */
async function dayMissing(
	kind: 'EVENING_MISSING' | 'MORNING_YESTERDAY',
	day: string,
	members: Member[],
	slot: string
): Promise<number> {
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
		const total = totalMap.get(key) ?? 0;
		if (total >= m.capacity) continue; // journée remplie
		const ctx = { missing: m.capacity - total, nothing: total === 0 };
		sent +=
			kind === 'EVENING_MISSING'
				? await maybeNotify(m, 'EVENING_MISSING', day, ctx, slot)
				: await maybeNotify(m, 'MORNING_YESTERDAY', day, { ...ctx, day }, slot);
	}
	return sent;
}

/**
 * Tickets actifs au RAE périmé, notifiés à leurs contributeurs réels (plus de colonne assigneeId
 * depuis §2.6 — tout utilisateur ayant déjà imputé au moins une fois sur le ticket, sans fenêtre
 * temporelle : cf. l'hypothèse actée dans docs/SPECS-pilotage-budget.md §2.6).
 */
async function raeStale(refDate: string, members: Member[]): Promise<number> {
	const cutoff = new Date(Date.now() - config.raeStaleDays * 86400000);
	const candidates = await db
		.select({
			id: ticket.id,
			workspaceId: ticket.workspaceId,
			raeReal: ticket.raeReal,
			raeTest: ticket.raeTest,
			testPhase: workspace.testPhase
		})
		.from(ticket)
		.innerJoin(workspace, eq(ticket.workspaceId, workspace.id))
		.where(and(isNull(ticket.archivedAt), isNotNull(ticket.raeUpdatedAt), lt(ticket.raeUpdatedAt, cutoff)));
	if (candidates.length === 0) return 0;

	// RAE résolu (activités si présentes, sinon repli ticket.raeReal/raeTest) — la colonne ticket
	// n'est plus mise à jour une fois que le RAE est suivi par activité, donc filtrer sur elle
	// directement redonnerait de faux positifs (ticket terminé via ses sous-lignes) ou de faux
	// négatifs (ticket dont le repli est resté à 0 depuis toujours).
	const activityRaeRows = await db
		.select({ ticketId: ticketActivityRae.ticketId, raeReal: ticketActivityRae.raeReal, raeTest: ticketActivityRae.raeTest })
		.from(ticketActivityRae)
		.where(inArray(ticketActivityRae.ticketId, candidates.map((c) => c.id)));
	const activityRaeByTicket = new Map<string, typeof activityRaeRows>();
	for (const r of activityRaeRows) {
		if (!activityRaeByTicket.has(r.ticketId)) activityRaeByTicket.set(r.ticketId, []);
		activityRaeByTicket.get(r.ticketId)!.push(r);
	}
	const staleTicketIds = candidates
		.filter((t) => {
			const resolved = resolvedRae(t.raeReal, t.raeTest, activityRaeByTicket.get(t.id) ?? []);
			// RAE Test ignoré si la phase Test est désactivée sur l'espace.
			return resolved.real + (t.testPhase ? resolved.test : 0) > 0;
		})
		.map((t) => t.id);
	if (staleTicketIds.length === 0) return 0;

	const rows = await db
		.select({
			workspaceId: ticket.workspaceId,
			userId: timeEntry.userId,
			cnt: sql<number>`count(distinct ${ticket.id})::int`
		})
		.from(ticket)
		.innerJoin(timeEntry, eq(timeEntry.ticketId, ticket.id))
		.where(inArray(ticket.id, staleTicketIds))
		.groupBy(ticket.workspaceId, timeEntry.userId);

	const byMember = new Map(members.map((m) => [`${m.workspaceId}:${m.userId}`, m]));
	let sent = 0;
	for (const r of rows) {
		const m = r.userId ? byMember.get(`${r.workspaceId}:${r.userId}`) : null;
		if (!m) continue;
		sent += await maybeNotify(m, 'RAE_STALE', refDate, {
			count: r.cnt,
			staleDays: config.raeStaleDays
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
		// Les jours en défaut sont listés dans la notif : « 17, 19 août » vaut mieux qu'un « il reste
		// des jours incomplets » qui oblige à ouvrir l'app pour savoir lesquels.
		const incomplete = weekDays.filter((d) => {
			const k = `${m.workspaceId}:${m.userId}:${d}`;
			return !absentSet.has(k) && (totalMap.get(k) ?? 0) < m.capacity;
		});
		if (incomplete.length === 0) continue;
		sent += await maybeNotify(m, 'WEEKLY_RECAP', refDate, { days: incomplete });
	}
	return sent;
}

/**
 * Dernier jour ouvré d'une plage Team mood : relance tous les membres n'ayant pas encore voté.
 * Pas le dernier jour calendaire : une plage lundi→dimanche relance le vendredi, sinon la notif
 * tombe un jour où personne ne travaille. Le vote reste ouvert jusqu'à la vraie fin de plage.
 */
async function moodDeadline(today: string): Promise<number> {
	let sent = 0;
	for (const w of await moodEnabledWorkspaces()) {
		const period = currentMoodPeriod(w.periodKind, w.startWeekday, today);
		if (lastWorkdayOnOrBefore(period.end) !== today) continue; // pas l'échéance utile de la plage

		const voted = new Set(
			(
				await db
					.select({ userId: moodVote.userId })
					.from(moodVote)
					.where(and(eq(moodVote.workspaceId, w.workspaceId), eq(moodVote.periodStart, period.start)))
			).map((r) => r.userId)
		);

		for (const m of await membersOf(w.workspaceId)) {
			if (voted.has(m.userId)) continue;
			sent += await maybeNotify(
				{ workspaceId: w.workspaceId, workspaceName: w.workspaceName, userId: m.userId, capacity: 0, prefsRaw: m.prefsRaw },
				'MOOD_DEADLINE',
				period.start,
				{}
			);
		}
	}
	return sent;
}

/**
 * Récap admin à la clôture d'une plage Team mood, uniquement en cas de chute nette de la
 * moyenne par rapport à la plage précédente (sinon pas de bruit inutile chaque semaine).
 */
async function moodRecap(today: string): Promise<number> {
	const yesterday = toISODate(addDays(parseISODate(today), -1));
	let sent = 0;
	for (const w of await moodEnabledWorkspaces()) {
		const justClosed = currentMoodPeriod(w.periodKind, w.startWeekday, yesterday);
		if (justClosed.end !== yesterday) continue; // aucune plage ne s'est terminée hier
		const prevStart = previousMoodPeriodStart(w.periodKind, justClosed.start);

		const [curRows, prevRows] = await Promise.all([
			db
				.select({ score: moodVote.score })
				.from(moodVote)
				.where(and(eq(moodVote.workspaceId, w.workspaceId), eq(moodVote.periodStart, justClosed.start))),
			db
				.select({ score: moodVote.score })
				.from(moodVote)
				.where(and(eq(moodVote.workspaceId, w.workspaceId), eq(moodVote.periodStart, prevStart)))
		]);
		if (curRows.length === 0 || prevRows.length === 0) continue; // pas de base de comparaison

		const avg = (rows: { score: number }[]) => rows.reduce((s, r) => s + r.score, 0) / rows.length;
		const curAvg = avg(curRows);
		const prevAvg = avg(prevRows);
		if (prevAvg - curAvg < config.moodDropThreshold) continue; // pas de chute nette

		for (const admin of await membersOf(w.workspaceId, 'ADMIN')) {
			sent += await maybeNotify(
				{ workspaceId: w.workspaceId, workspaceName: w.workspaceName, userId: admin.userId, capacity: 0, prefsRaw: admin.prefsRaw },
				'MOOD_RECAP',
				justClosed.start,
				{ avg: curAvg, prevAvg, votes: curRows.length }
			);
		}
	}
	return sent;
}

/**
 * Premier jour d'une période de support : prévient la personne dont c'est le tour. `getCurrentDuty`
 * porte déjà la rotation, l'offset et les overrides ponctuels — on ne notifie que le jour où la
 * période démarre, pas chaque matin.
 */
async function supportDuty(today: string): Promise<number> {
	let sent = 0;
	const workspaces = await db
		.select({ workspaceId: workspace.id, workspaceName: workspace.name })
		.from(workspace)
		.where(eq(workspace.supportEnabled, true));

	for (const w of workspaces) {
		const duty = await getCurrentDuty(w.workspaceId, today);
		if (!duty || duty.periodStart !== today) continue; // rotation vide, ou période déjà entamée
		const member = await memberOf(w.workspaceId, duty.userId);
		if (!member) continue; // plus membre actif de l'espace
		sent += await maybeNotify(
			{ workspaceId: w.workspaceId, workspaceName: w.workspaceName, userId: duty.userId, capacity: 0, prefsRaw: member.prefsRaw },
			'SUPPORT_DUTY',
			duty.periodStart,
			{ single: duty.periodStart === duty.periodEnd, until: formatDay(duty.periodEnd) }
		);
	}
	return sent;
}

/**
 * Notifie les admins d'un espace qu'un congé prévisionnel attend leur validation. Contrairement
 * aux autres notifs (relances planifiées via le cron), celle-ci est déclenchée en direct par
 * l'action de dépôt du congé — le dédup `notificationLog` (clé = absenceId) protège juste contre
 * un double envoi si le formulaire est soumis deux fois.
 */
export async function notifyAbsencePending(
	workspaceId: string,
	workspaceName: string,
	requesterId: string,
	requesterName: string,
	startDate: string,
	endDate: string,
	absenceId: string
): Promise<number> {
	let sent = 0;
	const range = formatDayRange(startDate, endDate);
	for (const admin of await membersOf(workspaceId, 'ADMIN')) {
		if (admin.userId === requesterId) continue; // pas de notif à soi-même
		sent += await maybeNotify(
			{ workspaceId, workspaceName, userId: admin.userId, capacity: 0, prefsRaw: admin.prefsRaw },
			'ABSENCE_PENDING',
			todayInParis(), // refDate = colonne `date` ; le dédup par congé se fait via `slot` (texte libre) ci-dessous
			{ name: requesterName, range },
			absenceId
		);
	}
	return sent;
}

/**
 * Notifie le demandeur qu'un admin/manager a validé son congé. Déclenchée en direct par l'action
 * de validation, même logique de dédup que `notifyAbsencePending` (clé = absenceId).
 */
export async function notifyAbsenceValidated(
	workspaceId: string,
	workspaceName: string,
	userId: string,
	startDate: string,
	endDate: string,
	absenceId: string
): Promise<number> {
	const [row] = await db.select({ prefsRaw: user.notifPrefs }).from(user).where(eq(user.id, userId));
	return maybeNotify(
		{ workspaceId, workspaceName, userId, capacity: 0, prefsRaw: row?.prefsRaw ?? null },
		'ABSENCE_VALIDATED',
		todayInParis(),
		{ range: formatDayRange(startDate, endDate) },
		absenceId
	);
}

/**
 * Orchestrateur appelé par le cron. `trigger` = morning | evening | weekly.
 * `slot` identifie la relance du jour (ex: "0900"/"0915"/"0930") : seuls morning/evening
 * relancent plusieurs fois par jour, chaque appel ne renotifiant que ceux encore en défaut.
 *
 * mood-deadline et le récap mood (dans morning) ignorent volontairement le garde-fou "jour
 * ouvré" ci-dessous : une plage Team mood peut se terminer n'importe quel jour de la semaine
 * (config admin libre, et les plages mensuelles finissent souvent un week-end).
 */
export async function runNotifications(
	trigger: 'morning' | 'evening' | 'weekly' | 'mood-deadline',
	slot = ''
) {
	const today = todayInParis();
	if (trigger === 'mood-deadline') return { trigger, sent: await moodDeadline(today) };

	let sent = trigger === 'morning' ? await moodRecap(today) : 0;
	if (!isWorkday(today)) return { trigger, skipped: 'non-ouvré', sent };

	const members = await activeMembers();
	if (trigger === 'evening') {
		sent += await dayMissing('EVENING_MISSING', today, members, slot);
	} else if (trigger === 'morning') {
		sent += await dayMissing('MORNING_YESTERDAY', previousWorkday(today), members, slot);
		sent += await raeStale(today, members);
		sent += await supportDuty(today);
	} else if (trigger === 'weekly') {
		sent += await weeklyRecap(today, members);
	}
	return { trigger, sent };
}
