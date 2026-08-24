import { and, count, eq, isNotNull } from 'drizzle-orm';
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

/**
 * Résultats agrégés par plage — réservé admin. Ne sélectionne JAMAIS userId : le vote reste
 * anonyme y compris côté admin, seuls les scores et messages agrégés par plage sont exposés.
 */
export async function listMoodResults(workspaceId: string): Promise<MoodPeriodResult[]> {
	const rows = await db
		.select({ periodStart: moodVote.periodStart, periodEnd: moodVote.periodEnd, score: moodVote.score, message: moodVote.message })
		.from(moodVote)
		.where(eq(moodVote.workspaceId, workspaceId));

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
