import { lt, isNotNull, and } from 'drizzle-orm';
import { db, session, setupToken, ticket, category, project, sprint, activity, changeLog } from '$lib/server/db';
import { config } from '$lib/server/config';

/** Nettoyage idempotent : sessions/tokens expirés + purge des archives au-delà de la rétention. */
export async function runCleanup() {
	const now = new Date();
	const purgeBefore = new Date(now.getTime() - config.archiveRetentionMs);

	const expiredSessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
	const usedTokens = await db.delete(setupToken).where(isNotNull(setupToken.usedAt)).returning({ id: setupToken.id });
	const expiredTokens = await db.delete(setupToken).where(lt(setupToken.expiresAt, now)).returning({ id: setupToken.id });

	const purgedTickets = await db.delete(ticket).where(and(isNotNull(ticket.archivedAt), lt(ticket.archivedAt, purgeBefore))).returning({ id: ticket.id });
	const purgedCategories = await db.delete(category).where(and(isNotNull(category.archivedAt), lt(category.archivedAt, purgeBefore))).returning({ id: category.id });
	const purgedProjects = await db.delete(project).where(and(isNotNull(project.archivedAt), lt(project.archivedAt, purgeBefore))).returning({ id: project.id });
	const purgedSprints = await db.delete(sprint).where(and(isNotNull(sprint.archivedAt), lt(sprint.archivedAt, purgeBefore))).returning({ id: sprint.id });
	const purgedActivities = await db.delete(activity).where(and(isNotNull(activity.archivedAt), lt(activity.archivedAt, purgeBefore))).returning({ id: activity.id });
	// Historique des modifications (estimations tickets, absences) — même rétention que les archives,
	// affiché sur /admin/history dans la même fenêtre (cf. HISTORY_WINDOW_MS, changeLog.ts).
	const purgedChangeLog = await db.delete(changeLog).where(lt(changeLog.createdAt, purgeBefore)).returning({ id: changeLog.id });

	return {
		expiredSessions: expiredSessions.length,
		tokensRemoved: usedTokens.length + expiredTokens.length,
		purged: {
			tickets: purgedTickets.length,
			categories: purgedCategories.length,
			projects: purgedProjects.length,
			sprints: purgedSprints.length,
			activities: purgedActivities.length,
			changeLog: purgedChangeLog.length
		}
	};
}
