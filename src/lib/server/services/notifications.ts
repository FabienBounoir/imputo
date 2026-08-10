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
import {
	todayInParis,
	previousWorkday,
	isWorkday,
	parseISODate,
	mondayOf,
	workWeek,
	toISODate,
	addDays,
	currentMoodPeriod,
	previousMoodPeriodStart
} from '$lib/utils/date';
import { sendToUser, hasSubscription, type PushPayload } from './push';

type NotifKind =
	| 'EVENING_MISSING'
	| 'MORNING_YESTERDAY'
	| 'RAE_STALE'
	| 'WEEKLY_RECAP'
	| 'MOOD_DEADLINE'
	| 'MOOD_RECAP'
	| 'ABSENCE_PENDING'
	| 'ABSENCE_VALIDATED';

type Prefs = {
	enabled: boolean;
	eveningMissing: boolean;
	morningYesterday: boolean;
	raeStale: boolean;
	weeklyRecap: boolean;
	moodDeadline: boolean;
	moodRecap: boolean;
	absencePending: boolean;
	absenceValidated: boolean;
};
const DEFAULT_PREFS: Prefs = {
	enabled: true,
	eveningMissing: true,
	morningYesterday: true,
	raeStale: true,
	weeklyRecap: true,
	moodDeadline: true,
	moodRecap: true,
	absencePending: true,
	absenceValidated: true
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
	WEEKLY_RECAP: 'weeklyRecap',
	MOOD_DEADLINE: 'moodDeadline',
	MOOD_RECAP: 'moodRecap',
	ABSENCE_PENDING: 'absencePending',
	ABSENCE_VALIDATED: 'absenceValidated'
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
async function maybeNotify(
	m: Member,
	kind: NotifKind,
	refDate: string,
	payload: PushPayload,
	slot = ''
): Promise<number> {
	const prefs = parseNotifPrefs(m.prefsRaw);
	if (!prefs.enabled || !prefs[PREF_KEY[kind]]) return 0;
	if (!(await hasSubscription(m.userId))) return 0;
	const claimed = await db
		.insert(notificationLog)
		.values({ userId: m.userId, workspaceId: m.workspaceId, kind, refDate, slot })
		.onConflictDoNothing()
		.returning({ id: notificationLog.id });
	if (claimed.length === 0) return 0; // déjà envoyé pour ce (user, espace, type, date, slot)
	await sendToUser(m.userId, payload);
	return 1;
}

/** Jour non (assez) saisi : EVENING_MISSING (aujourd'hui) ou MORNING_YESTERDAY (veille). */
async function dayMissing(
	kind: NotifKind,
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
		if ((totalMap.get(key) ?? 0) >= m.capacity) continue; // journée remplie
		const body =
			kind === 'EVENING_MISSING'
				? `${m.workspaceName} : tu n'as pas saisi ton imputation d'aujourd'hui.`
				: `${m.workspaceName} : le ${day} n'a pas été renseigné. Pense à le compléter.`;
		sent += await maybeNotify(
			m,
			kind,
			day,
			{
				title: kind === 'EVENING_MISSING' ? 'Imputation du jour' : "Imputation d'hier",
				body,
				url: '/imputation',
				tag: `${kind}:${day}:${slot}`
			},
			slot
		);
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

/**
 * Dernier jour d'une plage Team mood : relance tous les membres n'ayant pas encore voté.
 * Indépendant du jour ouvré (une plage peut se terminer un week-end selon la config admin).
 */
async function moodDeadline(today: string): Promise<number> {
	let sent = 0;
	for (const w of await moodEnabledWorkspaces()) {
		const period = currentMoodPeriod(w.periodKind, w.startWeekday, today);
		if (period.end !== today) continue; // pas le dernier jour de la plage

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
				{
					title: 'Team mood : dernier jour',
					body: `${w.workspaceName} : il reste moins d'un jour pour voter sur l'humeur de l'équipe.`,
					url: '/mood',
					tag: `MOOD_DEADLINE:${period.start}`
				}
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
				{
					title: 'Team mood en baisse',
					body: `${w.workspaceName} : moyenne à ${curAvg.toFixed(1)}/5 sur la dernière plage (${prevAvg.toFixed(1)}/5 précédemment).`,
					url: '/admin/mood',
					tag: `MOOD_RECAP:${justClosed.start}`
				}
			);
		}
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
	absenceId: string
): Promise<number> {
	let sent = 0;
	for (const admin of await membersOf(workspaceId, 'ADMIN')) {
		if (admin.userId === requesterId) continue; // pas de notif à soi-même
		sent += await maybeNotify(
			{ workspaceId, workspaceName, userId: admin.userId, capacity: 0, prefsRaw: admin.prefsRaw },
			'ABSENCE_PENDING',
			todayInParis(), // refDate = colonne `date` ; le dédup par congé se fait via `slot` (texte libre) ci-dessous
			{
				title: 'Congé à valider',
				body: `${workspaceName} : ${requesterName} a demandé un congé.`,
				url: '/absences',
				tag: `ABSENCE_PENDING:${absenceId}`
			},
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
	const range = startDate === endDate ? startDate : `${startDate} → ${endDate}`;
	return maybeNotify(
		{ workspaceId, workspaceName, userId, capacity: 0, prefsRaw: row?.prefsRaw ?? null },
		'ABSENCE_VALIDATED',
		todayInParis(),
		{
			title: 'Congé validé',
			body: `${workspaceName} : votre congé du ${range} a été validé.`,
			url: '/absences',
			tag: `ABSENCE_VALIDATED:${absenceId}`
		},
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
	} else if (trigger === 'weekly') {
		sent += await weeklyRecap(today, members);
	}
	return { trigger, sent };
}
