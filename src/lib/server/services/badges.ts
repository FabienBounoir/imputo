import { and, count, countDistinct, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	db,
	absence,
	badgeProgress,
	changeLog,
	monthlyClosing,
	moodVote,
	supportDutyLog,
	supportTimeEntry,
	ticket,
	ticketActivityRae,
	timeEntry,
	weeklyObjective
} from '$lib/server/db';
import { BADGES, BADGE_BY_ID, DISCOVERIES, tierFor, type Discovery } from '$lib/badges';
import { logger } from '$lib/server/logger';
import { listStaleRaePairs } from './tickets';
import { isWorkday, mondayOf, parseISODate, toISODate, todayInParis } from '$lib/utils/date';

const num = (v: unknown) => Number(v ?? 0);

export type BadgeState = {
	badgeId: string;
	value: number;
	tier: number;
	/** Palier déjà annoncé à l'écran : tier > seenTier ⇒ l'animation de déblocage est due. */
	seenTier: number;
	tierAt: Date | null;
};

/**
 * Plus longue suite de jours OUVRÉS consécutifs présents dans `days`.
 *
 * Les week-ends et fériés ne cassent pas la série (personne n'impute le dimanche), mais ils ne la
 * prolongent pas non plus : on ne parcourt que les jours ouvrés entre la première et la dernière
 * saisie. Un jour ouvré manquant remet le compteur à zéro.
 */
export function longestWorkdayRun(days: string[]): number {
	if (days.length === 0) return 0;
	const present = new Set(days);
	const sorted = [...present].sort();
	let best = 0;
	let run = 0;
	for (let d = parseISODate(sorted[0]); toISODate(d) <= sorted[sorted.length - 1]; d.setUTCDate(d.getUTCDate() + 1)) {
		const iso = toISODate(d);
		if (!isWorkday(iso)) continue;
		if (present.has(iso)) {
			run += 1;
			if (run > best) best = run;
		} else {
			run = 0;
		}
	}
	return best;
}

/** Jours où la personne a imputé « à temps » : saisie le jour même ou le lendemain. */
async function punctualDays(workspaceId: string, userId: string) {
	const rows = await db
		.select({
			day: timeEntry.day,
			// Première saisie de la journée : c'est elle qui dit si la personne a imputé à temps,
			// une correction trois semaines plus tard ne doit pas disqualifier le jour.
			firstAt: sql<string>`min(${timeEntry.createdAt} AT TIME ZONE 'Europe/Paris')::date`
		})
		.from(timeEntry)
		.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.userId, userId)))
		.groupBy(timeEntry.day);
	return rows.map((r) => ({ day: r.day, firstAt: r.firstAt }));
}

/**
 * Tickets terminés dont la conso de la personne tombe à ±10 % de l'estimation.
 *
 * Deux requêtes croisées en JS plutôt qu'une seule requête à sous-sélections : l'estimation et le
 * RAE se lisent par activité quand il y en a, avec repli sur les colonnes du ticket sinon (même
 * règle que resolvedRae/resolvedEstimation dans calc.ts) — en SQL ça devient illisible, et le
 * volume ici est celui des tickets d'une seule personne.
 */
async function bullseyeCount(workspaceId: string, userId: string): Promise<number> {
	const mine = await db
		.select({ ticketId: timeEntry.ticketId, conso: sql<string>`sum(${timeEntry.amount})` })
		.from(timeEntry)
		.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.userId, userId), isNotNull(timeEntry.ticketId)))
		.groupBy(timeEntry.ticketId);
	const ids = mine.map((m) => m.ticketId!).filter(Boolean);
	if (ids.length === 0) return 0;

	const [tickets, perActivity] = await Promise.all([
		db
			.select({
				id: ticket.id,
				estimationReal: ticket.estimationReal,
				estimationTest: ticket.estimationTest,
				raeReal: ticket.raeReal,
				raeTest: ticket.raeTest
			})
			.from(ticket)
			.where(inArray(ticket.id, ids)),
		db
			.select({
				ticketId: ticketActivityRae.ticketId,
				estimation: sql<string>`sum(${ticketActivityRae.estimation})`,
				rae: sql<string>`sum(${ticketActivityRae.raeReal} + ${ticketActivityRae.raeTest})`,
				lines: count()
			})
			.from(ticketActivityRae)
			.where(inArray(ticketActivityRae.ticketId, ids))
			.groupBy(ticketActivityRae.ticketId)
	]);

	const byActivity = new Map(perActivity.map((p) => [p.ticketId, p]));
	const consoById = new Map(mine.map((m) => [m.ticketId!, num(m.conso)]));

	let hits = 0;
	for (const t of tickets) {
		const act = byActivity.get(t.id);
		const hasLines = (act?.lines ?? 0) > 0;
		const estimation = hasLines ? num(act!.estimation) : num(t.estimationReal) + num(t.estimationTest);
		const rae = hasLines ? num(act!.rae) : num(t.raeReal) + num(t.raeTest);
		if (estimation <= 0 || rae > 0) continue; // pas chiffré, ou pas terminé
		const conso = consoById.get(t.id) ?? 0;
		if (Math.abs(conso - estimation) <= estimation * 0.1) hits += 1;
	}
	return hits;
}

/** Le plus gros nombre de tickets partagés avec une même personne. */
async function bestDuo(workspaceId: string, userId: string): Promise<number> {
	const te2 = alias(timeEntry, 'te2');
	const rows = await db
		.select({ other: te2.userId, shared: countDistinct(timeEntry.ticketId) })
		.from(timeEntry)
		.innerJoin(te2, and(eq(te2.ticketId, timeEntry.ticketId), eq(te2.workspaceId, timeEntry.workspaceId)))
		.where(
			and(
				eq(timeEntry.workspaceId, workspaceId),
				eq(timeEntry.userId, userId),
				isNotNull(timeEntry.ticketId),
				sql`${te2.userId} <> ${userId}`
			)
		)
		.groupBy(te2.userId)
		.orderBy(sql`2 desc`)
		.limit(1);
	return rows[0]?.shared ?? 0;
}

/** Semaines où TOUS les objectifs attribués à la personne ont été cochés (et il y en avait au moins un). */
async function fullObjectiveWeeks(workspaceId: string, userId: string): Promise<number> {
	const rows = await db
		.select({ week: weeklyObjective.weekMonday, total: count(), done: count(weeklyObjective.doneAt) })
		.from(weeklyObjective)
		.where(and(eq(weeklyObjective.workspaceId, workspaceId), eq(weeklyObjective.userId, userId)))
		.groupBy(weeklyObjective.weekMonday);
	return rows.filter((r) => r.total > 0 && r.done === r.total).length;
}

/**
 * Valeurs des 13 compteurs. Tout se recalcule depuis l'historique, sauf « RAE frais » qui n'a pas
 * d'historique en base : celui-là avance d'une semaine par passage propre (cf. badges.ts).
 */
async function computeValues(
	workspaceId: string,
	userId: string,
	isAdmin: boolean,
	previous: Map<string, { value: number; updatedAt: Date }>,
	only?: Set<string>
): Promise<Map<string, number>> {
	const today = todayInParis();
	// Recalcul ciblé : une saisie d'imputation ne doit pas relancer les treize compteurs, dont les
	// deux plus chers (bullseyeCount et bestDuo font chacun plusieurs jointures sur time_entry).
	// Un badge non demandé garde la valeur déjà en base, il n'est ni recalculé ni réécrit.
	const want = (id: string) => !only || only.has(id);
	const keep = (id: string) => previous.get(id)?.value ?? 0;
	const skip = Promise.resolve([{ n: 0 }]);

	const [days, mood, duty, support, absences, closings, estimated, bullseye, duo, objectiveWeeks, stale] =
		await Promise.all([
			want('assidu') || want('ponctuel') ? punctualDays(workspaceId, userId) : Promise.resolve([]),
			want('voix-du-peuple')
				? db
						.select({ n: count() })
						.from(moodVote)
						.where(and(eq(moodVote.workspaceId, workspaceId), eq(moodVote.userId, userId)))
				: skip,
			want('de-garde')
				? db
						.select({ n: count() })
						.from(supportDutyLog)
						.where(and(eq(supportDutyLog.workspaceId, workspaceId), eq(supportDutyLog.userId, userId)))
				: skip,
			want('pompier')
				? db
						.select({ n: count() })
						.from(supportTimeEntry)
						.where(and(eq(supportTimeEntry.workspaceId, workspaceId), eq(supportTimeEntry.userId, userId)))
				: skip,
			// Posée plus de 3 semaines avant le premier jour d'absence.
			want('prevoyant')
				? db
						.select({ n: count() })
						.from(absence)
						.where(
							and(
								eq(absence.workspaceId, workspaceId),
								eq(absence.userId, userId),
								sql`${absence.startDate}::date - (${absence.createdAt} AT TIME ZONE 'Europe/Paris')::date >= 21`
							)
						)
				: skip,
			isAdmin && want('comptable')
				? db
						.select({ n: count() })
						.from(monthlyClosing)
						.where(and(eq(monthlyClosing.workspaceId, workspaceId), eq(monthlyClosing.integratedById, userId)))
				: skip,
			// Un ticket compte une fois, quel que soit le nombre de retouches d'estimation.
			want('chiffreur')
				? db
						.select({ n: countDistinct(changeLog.entityId) })
						.from(changeLog)
						.where(
							and(
								eq(changeLog.workspaceId, workspaceId),
								eq(changeLog.entityType, 'TICKET'),
								eq(changeLog.changedById, userId),
								inArray(changeLog.field, ['estimation', 'estimationReal', 'estimationTest']),
								isNotNull(changeLog.newValue)
							)
						)
				: skip,
			want('dans-le-mille') ? bullseyeCount(workspaceId, userId) : Promise.resolve(keep('dans-le-mille')),
			want('binome') ? bestDuo(workspaceId, userId) : Promise.resolve(keep('binome')),
			want('parole-tenue') ? fullObjectiveWeeks(workspaceId, userId) : Promise.resolve(keep('parole-tenue')),
			want('rae-frais') ? listStaleRaePairs({ workspaceId, userId }) : Promise.resolve(null)
		]);

	// RAE frais : +1 par semaine civile où la personne n'a aucune paire périmée, une seule fois par
	// semaine (la ligne n'est touchée que par ce compteur, son updatedAt sert donc de marqueur).
	const raePrev = previous.get('rae-frais');
	const thisMonday = toISODate(mondayOf(parseISODate(today)));
	const lastCounted = raePrev ? toISODate(mondayOf(raePrev.updatedAt)) : '';
	const raeValue =
		stale && stale.length === 0 && lastCounted < thisMonday ? (raePrev?.value ?? 0) + 1 : (raePrev?.value ?? 0);

	const onTime = days.filter((d) => d.firstAt <= toISODate(new Date(parseISODate(d.day).getTime() + 86400000)));

	return new Map<string, number>([
		['assidu', want('assidu') ? longestWorkdayRun(onTime.map((d) => d.day)) : keep('assidu')],
		['ponctuel', want('ponctuel') ? days.filter((d) => d.firstAt === d.day).length : keep('ponctuel')],
		['rae-frais', raeValue],
		['chiffreur', want('chiffreur') ? (estimated[0]?.n ?? 0) : keep('chiffreur')],
		['dans-le-mille', bullseye],
		['voix-du-peuple', want('voix-du-peuple') ? (mood[0]?.n ?? 0) : keep('voix-du-peuple')],
		['parole-tenue', objectiveWeeks],
		['de-garde', want('de-garde') ? (duty[0]?.n ?? 0) : keep('de-garde')],
		['pompier', want('pompier') ? (support[0]?.n ?? 0) : keep('pompier')],
		['prevoyant', want('prevoyant') ? (absences[0]?.n ?? 0) : keep('prevoyant')],
		['binome', duo],
		// Explorateur : la valeur vient de la liste des découvertes déjà enregistrées, pas d'un calcul.
		['explorateur', keep('explorateur')],
		['comptable', isAdmin && want('comptable') ? (closings[0]?.n ?? 0) : keep('comptable')]
	]);
}

/**
 * Recalcule tous les badges de la personne et persiste ce qui a changé.
 * Renvoie l'état complet, avec les paliers restant à annoncer (tier > seenTier).
 */
export async function computeAll(
	workspaceId: string,
	userId: string,
	isAdmin: boolean,
	only?: string[]
): Promise<BadgeState[]> {
	const wanted = only ? new Set(only) : undefined;
	const rows = await db
		.select()
		.from(badgeProgress)
		.where(and(eq(badgeProgress.workspaceId, workspaceId), eq(badgeProgress.userId, userId)));
	const previous = new Map(rows.map((r) => [r.badgeId, { value: r.value, updatedAt: r.updatedAt }]));
	const byId = new Map(rows.map((r) => [r.badgeId, r]));

	const values = await computeValues(workspaceId, userId, isAdmin, previous, wanted);
	const now = new Date();
	const out: BadgeState[] = [];

	for (const def of BADGES) {
		if (def.adminOnly && !isAdmin) continue;
		const value = values.get(def.id) ?? 0;
		const tier = tierFor(value, def.thresholds);
		const row = byId.get(def.id);

		if (!row) {
			await db.insert(badgeProgress).values({
				workspaceId,
				userId,
				badgeId: def.id,
				value,
				tier,
				tierAt: tier > 0 ? now : null
			});
			out.push({ badgeId: def.id, value, tier, seenTier: 0, tierAt: tier > 0 ? now : null });
			continue;
		}

		if (value !== row.value || tier !== row.tier) {
			await db
				.update(badgeProgress)
				.set({ value, tier, updatedAt: now, ...(tier > row.tier ? { tierAt: now } : {}) })
				.where(eq(badgeProgress.id, row.id));
		}
		out.push({
			badgeId: def.id,
			value,
			tier,
			seenTier: row.seenTier,
			tierAt: tier > row.tier ? now : row.tierAt
		});
	}
	return out;
}

/**
 * Quels compteurs une action peut faire bouger. Recalculer les treize à chaque écriture serait
 * absurde : une case d'imputation ne change rien au nombre de votes mood ni aux clôtures, et les
 * deux compteurs les plus chers (bullseye, duo) seraient relancés à chaque frappe.
 */
export const BADGE_TRIGGERS = {
	imputation: ['assidu', 'ponctuel', 'dans-le-mille', 'binome'],
	mood: ['voix-du-peuple'],
	objectifs: ['parole-tenue'],
	supportTime: ['pompier'],
	supportDuty: ['de-garde'],
	absence: ['prevoyant'],
	ticket: ['chiffreur', 'dans-le-mille'],
	cloture: ['comptable'],
	rae: ['rae-frais']
} as const;
export type BadgeTrigger = keyof typeof BADGE_TRIGGERS;

/**
 * Recalcule les compteurs touchés par une action, juste après elle.
 *
 * Jamais throw : un badge est décoratif, il n'a aucune raison de faire échouer la saisie qui vient
 * de réussir. L'erreur est tracée et l'action rend son succès normalement.
 */
export async function refreshBadges(
	workspaceId: string,
	userId: string,
	isAdmin: boolean,
	trigger: BadgeTrigger
): Promise<void> {
	try {
		await computeAll(workspaceId, userId, isAdmin, [...BADGE_TRIGGERS[trigger]]);
	} catch (err) {
		logger.error('badges_refresh_failed', err, { userId, trigger });
	}
}

export type AnnouncedBadge = { id: string; name: string; tier: number; tierName: string };

/**
 * Paliers gagnés et pas encore montrés. Lecture seule d'une table indexée sur (espace, membre) :
 * assez léger pour tourner dans le layout, donc sur chaque navigation.
 */
export async function listToAnnounce(workspaceId: string, userId: string): Promise<AnnouncedBadge[]> {
	const rows = await db
		.select({ badgeId: badgeProgress.badgeId, tier: badgeProgress.tier })
		.from(badgeProgress)
		.where(
			and(
				eq(badgeProgress.workspaceId, workspaceId),
				eq(badgeProgress.userId, userId),
				sql`${badgeProgress.tier} > ${badgeProgress.seenTier}`
			)
		);
	return rows.flatMap((r) => {
		const def = BADGE_BY_ID.get(r.badgeId);
		if (!def || r.tier < 1) return [];
		return [{ id: def.id, name: def.name, tier: r.tier, tierName: def.tierNames[r.tier - 1] }];
	});
}

/** Marque les paliers comme vus : l'animation ne rejoue pas au prochain chargement. */
export async function markSeen(workspaceId: string, userId: string, badgeIds: string[]) {
	if (badgeIds.length === 0) return;
	await db
		.update(badgeProgress)
		.set({ seenTier: sql`${badgeProgress.tier}` })
		.where(
			and(
				eq(badgeProgress.workspaceId, workspaceId),
				eq(badgeProgress.userId, userId),
				inArray(badgeProgress.badgeId, badgeIds)
			)
		);
}

/**
 * Enregistre un recoin découvert (badge « Explorateur »). Idempotent : rejouer la même découverte
 * ne fait rien, c'est ce qui permet de l'appeler sans état côté client.
 */
export async function recordDiscovery(workspaceId: string, userId: string, key: Discovery): Promise<boolean> {
	if (!DISCOVERIES.includes(key)) return false;
	const rows = await db
		.select()
		.from(badgeProgress)
		.where(
			and(
				eq(badgeProgress.workspaceId, workspaceId),
				eq(badgeProgress.userId, userId),
				eq(badgeProgress.badgeId, 'explorateur')
			)
		);
	const found = new Set<string>(Array.isArray(rows[0]?.discoveries) ? (rows[0].discoveries as string[]) : []);
	if (found.has(key)) return false;
	found.add(key);

	const def = BADGES.find((b) => b.id === 'explorateur')!;
	const value = found.size;
	const tier = tierFor(value, def.thresholds);
	if (!rows[0]) {
		await db.insert(badgeProgress).values({
			workspaceId,
			userId,
			badgeId: 'explorateur',
			value,
			tier,
			discoveries: [...found],
			tierAt: tier > 0 ? new Date() : null
		});
		return true;
	}
	await db
		.update(badgeProgress)
		.set({
			value,
			tier,
			discoveries: [...found],
			updatedAt: new Date(),
			...(tier > rows[0].tier ? { tierAt: new Date() } : {})
		})
		.where(eq(badgeProgress.id, rows[0].id));
	return true;
}
