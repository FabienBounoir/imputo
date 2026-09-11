import { and, count, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db, workspace, moodVote, membership, user, type MoodPeriodKind } from '$lib/server/db';
import { previousMoodPeriodStart } from '$lib/utils/date';

export type { MoodPeriodKind };

/** Nombre total de votes enregistrés (toutes plages confondues) — pour un badge admin en un coup d'œil. */
/** Participation sur la plage en cours : nombre de votes / membres actifs. Jamais le score, pour ne pas influencer les votes restants. */
export async function getPeriodParticipation(
	workspaceId: string,
	periodStart: string
): Promise<{ voted: number; total: number }> {
	const [votedRows, totalRows] = await Promise.all([
		db
			.select({ n: count() })
			.from(moodVote)
			.where(and(eq(moodVote.workspaceId, workspaceId), eq(moodVote.periodStart, periodStart))),
		db
			.select({ n: count() })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(
				and(
					eq(membership.workspaceId, workspaceId),
					eq(membership.active, true),
					eq(user.active, true),
					isNotNull(user.passwordHash)
				)
			)
	]);
	return { voted: votedRows[0]?.n ?? 0, total: totalRows[0]?.n ?? 0 };
}

export async function getMoodConfig(
	workspaceId: string
): Promise<{ enabled: boolean; periodKind: MoodPeriodKind; startWeekday: number }> {
	const rows = await db
		.select({
			enabled: workspace.moodEnabled,
			periodKind: workspace.moodPeriodKind,
			startWeekday: workspace.moodStartWeekday
		})
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	const row = rows[0];
	if (!row) throw new Error('Espace introuvable.');
	return row;
}

export async function setMoodEnabled(workspaceId: string, enabled: boolean) {
	await db.update(workspace).set({ moodEnabled: enabled }).where(eq(workspace.id, workspaceId));
}

export async function setMoodPeriodConfig(workspaceId: string, periodKind: MoodPeriodKind, startWeekday: number) {
	if (startWeekday < 0 || startWeekday > 6) throw new Error('Jour de départ invalide.');
	await db
		.update(workspace)
		.set({ moodPeriodKind: periodKind, moodStartWeekday: startWeekday })
		.where(eq(workspace.id, workspaceId));
}

/** Le vote existant de l'utilisateur pour la plage courante (pour pré-remplir son formulaire). */
export async function getMyVote(
	workspaceId: string,
	userId: string,
	periodStart: string
): Promise<{ score: number; message: string | null } | null> {
	const rows = await db
		.select({ score: moodVote.score, message: moodVote.message })
		.from(moodVote)
		.where(
			and(
				eq(moodVote.workspaceId, workspaceId),
				eq(moodVote.userId, userId),
				eq(moodVote.periodStart, periodStart)
			)
		);
	return rows[0] ?? null;
}

/** Nombre de plages consécutives (jusqu'à la plus récente votée) où l'utilisateur a voté — son propre vote, jamais anonymisé pour lui-même. */
export async function getMyStreak(
	workspaceId: string,
	userId: string,
	kind: MoodPeriodKind,
	currentPeriodStart: string
): Promise<number> {
	const rows = await db
		.select({ periodStart: moodVote.periodStart })
		.from(moodVote)
		.where(and(eq(moodVote.workspaceId, workspaceId), eq(moodVote.userId, userId)));
	const voted = new Set(rows.map((r) => r.periodStart));

	let pointer = voted.has(currentPeriodStart) ? currentPeriodStart : previousMoodPeriodStart(kind, currentPeriodStart);
	let streak = 0;
	while (voted.has(pointer)) {
		streak += 1;
		pointer = previousMoodPeriodStart(kind, pointer);
	}
	return streak;
}

/** Upsert du vote de l'utilisateur pour la plage — modifiable tant que la plage est active. */
export async function submitVote(
	workspaceId: string,
	userId: string,
	periodStart: string,
	periodEnd: string,
	score: number,
	message: string | null
) {
	if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Note invalide (entre 1 et 5).');
	const trimmedMessage = message?.trim() || null;
	await db
		.insert(moodVote)
		.values({ workspaceId, userId, periodStart, periodEnd, score, message: trimmedMessage })
		.onConflictDoUpdate({
			target: [moodVote.workspaceId, moodVote.userId, moodVote.periodStart],
			set: { score, message: trimmedMessage, updatedAt: new Date() }
		});
}

/** Supprime tous les votes d'une plage (réservé ADMIN) — irréversible, l'anonymat empêche toute restauration ciblée. */
export async function resetPeriodVotes(workspaceId: string, periodStart: string) {
	await db
		.delete(moodVote)
		.where(and(eq(moodVote.workspaceId, workspaceId), eq(moodVote.periodStart, periodStart)));
}

export type MoodPeriodResult = {
	periodStart: string;
	periodEnd: string;
	voteCount: number;
	avgScore: number;
	distribution: Record<1 | 2 | 3 | 4 | 5, number>;
	messages: string[];
};

/** Même chose sans les messages : c'est eux qui pèsent, le reste tient en quelques nombres. */
export type MoodPeriodStats = Omit<MoodPeriodResult, 'messages'>;

/** Nombre de plages ramenées par page de liste, et par appel de scroll infini. */
export const MOOD_PAGE_SIZE = 20;

/**
 * Agrégat par plage sur TOUT l'historique, sans les messages — une seule requête GROUP BY, au lieu
 * de rapatrier chaque vote pour le réduire en JS.
 * Sert aux statistiques qui doivent porter sur tout : courbe de tendance, camembert global,
 * meilleure/moins bonne plage, export CSV. Elles seraient fausses si on les calculait sur la seule
 * page affichée — d'où leur séparation d'avec listMoodResultsPage ci-dessous.
 * Comme partout ici, userId n'est jamais sélectionné : le vote reste anonyme, même pour un admin.
 */
export async function listMoodPeriodStats(workspaceId: string): Promise<MoodPeriodStats[]> {
	const rows = await db
		.select({
			periodStart: moodVote.periodStart,
			periodEnd: moodVote.periodEnd,
			voteCount: count(),
			sumScore: sql<number>`sum(${moodVote.score})::int`,
			s1: sql<number>`count(*) filter (where ${moodVote.score} = 1)::int`,
			s2: sql<number>`count(*) filter (where ${moodVote.score} = 2)::int`,
			s3: sql<number>`count(*) filter (where ${moodVote.score} = 3)::int`,
			s4: sql<number>`count(*) filter (where ${moodVote.score} = 4)::int`,
			s5: sql<number>`count(*) filter (where ${moodVote.score} = 5)::int`
		})
		.from(moodVote)
		.where(eq(moodVote.workspaceId, workspaceId))
		.groupBy(moodVote.periodStart, moodVote.periodEnd)
		.orderBy(desc(moodVote.periodStart));

	return rows.map((r) => ({
		periodStart: r.periodStart,
		periodEnd: r.periodEnd,
		voteCount: r.voteCount,
		avgScore: r.voteCount > 0 ? Math.round((r.sumScore / r.voteCount) * 100) / 100 : 0,
		distribution: { 1: r.s1, 2: r.s2, 3: r.s3, 4: r.s4, 5: r.s5 }
	}));
}

/**
 * Une page de plages AVEC leurs messages, de la plus récente à la plus ancienne. `before` = curseur
 * (periodStart strictement antérieur), fourni par la page précédente — plutôt qu'un OFFSET, qui
 * décalerait la pagination si un vote arrivait entre deux appels.
 */
export async function listMoodResultsPage(
	workspaceId: string,
	opts: { limit?: number; before?: string } = {}
): Promise<{ periods: MoodPeriodResult[]; hasMore: boolean }> {
	const limit = opts.limit ?? MOOD_PAGE_SIZE;
	// +1 pour savoir s'il reste quelque chose après, sans faire un COUNT séparé.
	const starts = await db
		.selectDistinct({ periodStart: moodVote.periodStart })
		.from(moodVote)
		.where(
			opts.before
				? and(eq(moodVote.workspaceId, workspaceId), lt(moodVote.periodStart, opts.before))
				: eq(moodVote.workspaceId, workspaceId)
		)
		.orderBy(desc(moodVote.periodStart))
		.limit(limit + 1);

	const hasMore = starts.length > limit;
	const pageStarts = starts.slice(0, limit).map((r) => r.periodStart);
	if (pageStarts.length === 0) return { periods: [], hasMore: false };

	const rows = await db
		.select({ periodStart: moodVote.periodStart, periodEnd: moodVote.periodEnd, score: moodVote.score, message: moodVote.message })
		.from(moodVote)
		.where(and(eq(moodVote.workspaceId, workspaceId), inArray(moodVote.periodStart, pageStarts)));

	return { periods: aggregatePeriods(rows), hasMore };
}

/** Réduction en mémoire d'un lot de votes déjà borné (une page de plages), cf. listMoodResultsPage. */
function aggregatePeriods(
	rows: { periodStart: string; periodEnd: string; score: number; message: string | null }[]
): MoodPeriodResult[] {
	const byPeriod = new Map<string, MoodPeriodResult>();
	for (const r of rows) {
		let period = byPeriod.get(r.periodStart);
		if (!period) {
			period = {
				periodStart: r.periodStart,
				periodEnd: r.periodEnd,
				voteCount: 0,
				avgScore: 0,
				distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
				messages: []
			};
			byPeriod.set(r.periodStart, period);
		}
		period.voteCount += 1;
		period.distribution[r.score as 1 | 2 | 3 | 4 | 5] += 1;
		period.avgScore += r.score;
		if (r.message) period.messages.push(r.message);
	}

	const results = [...byPeriod.values()].map((p) => ({
		...p,
		avgScore: p.voteCount > 0 ? Math.round((p.avgScore / p.voteCount) * 100) / 100 : 0,
		messages: p.messages.sort()
	}));
	return results.sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
}
