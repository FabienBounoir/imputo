import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, session, setupToken, ticket, category, project } from '$lib/server/db';
import { makeWorkspace, defaultPerimeterId } from './test-helpers';
import { runCleanup } from './jobs';

const DAY_MS = 86400000;

describe('runCleanup', () => {
	it('purge sessions/tokens expirés et archives au-delà de la rétention (30j), épargne le reste', async () => {
		const ws = await makeWorkspace('cleanup');

		const [expiredSession] = await db
			.insert(session)
			.values({ id: crypto.randomUUID(), userId: ws.userId, workspaceId: ws.workspaceId, expiresAt: new Date(Date.now() - DAY_MS) })
			.returning({ id: session.id });
		const [validSession] = await db
			.insert(session)
			.values({ id: crypto.randomUUID(), userId: ws.userId, workspaceId: ws.workspaceId, expiresAt: new Date(Date.now() + DAY_MS) })
			.returning({ id: session.id });

		const [usedToken] = await db
			.insert(setupToken)
			.values({
				id: crypto.randomUUID(),
				userId: ws.userId,
				workspaceId: ws.workspaceId,
				purpose: 'INVITE',
				expiresAt: new Date(Date.now() + DAY_MS),
				usedAt: new Date()
			})
			.returning({ id: setupToken.id });
		const [freshToken] = await db
			.insert(setupToken)
			.values({
				id: crypto.randomUUID(),
				userId: ws.userId,
				workspaceId: ws.workspaceId,
				purpose: 'INVITE',
				expiresAt: new Date(Date.now() + DAY_MS)
			})
			.returning({ id: setupToken.id });

		const [oldTicket] = await db
			.insert(ticket)
			.values({ workspaceId: ws.workspaceId, perimeterId: await defaultPerimeterId(ws.workspaceId), key: `OLD-${ws.id}`, title: 'Ancien', archivedAt: new Date(Date.now() - 40 * DAY_MS) })
			.returning({ id: ticket.id });
		const [recentTicket] = await db
			.insert(ticket)
			.values({ workspaceId: ws.workspaceId, perimeterId: await defaultPerimeterId(ws.workspaceId), key: `RECENT-${ws.id}`, title: 'Récent', archivedAt: new Date(Date.now() - 10 * DAY_MS) })
			.returning({ id: ticket.id });

		const [oldCategory] = await db
			.insert(category)
			.values({ workspaceId: ws.workspaceId, label: `Old cat ${ws.id}`, archivedAt: new Date(Date.now() - 40 * DAY_MS) })
			.returning({ id: category.id });
		const [oldProject] = await db
			.insert(project)
			.values({ workspaceId: ws.workspaceId, name: `Old proj ${ws.id}`, archivedAt: new Date(Date.now() - 40 * DAY_MS) })
			.returning({ id: project.id });

		const result = await runCleanup();

		expect(result.purged.tickets).toBeGreaterThanOrEqual(1);
		expect(result.purged.categories).toBeGreaterThanOrEqual(1);
		expect(result.purged.projects).toBeGreaterThanOrEqual(1);

		expect(await db.select().from(session).where(eq(session.id, expiredSession.id))).toEqual([]);
		expect(await db.select().from(session).where(eq(session.id, validSession.id))).toHaveLength(1);

		expect(await db.select().from(setupToken).where(eq(setupToken.id, usedToken.id))).toEqual([]);
		expect(await db.select().from(setupToken).where(eq(setupToken.id, freshToken.id))).toHaveLength(1);

		expect(await db.select().from(ticket).where(eq(ticket.id, oldTicket.id))).toEqual([]);
		expect(await db.select().from(ticket).where(eq(ticket.id, recentTicket.id))).toHaveLength(1);

		expect(await db.select().from(category).where(eq(category.id, oldCategory.id))).toEqual([]);
		expect(await db.select().from(project).where(eq(project.id, oldProject.id))).toEqual([]);

		// Nettoie ce que runCleanup n'a pas purgé et que le cascade de suppression de l'espace ne couvrira pas déjà.
		await db.delete(session).where(eq(session.id, validSession.id));
		await db.delete(setupToken).where(eq(setupToken.id, freshToken.id));
		await db.delete(ticket).where(eq(ticket.id, recentTicket.id));
	});

	it('est idempotent : un second passage sans rien à purger ne casse rien', async () => {
		const result = await runCleanup();
		expect(result.expiredSessions).toBeGreaterThanOrEqual(0);
		expect(result.purged.tickets).toBeGreaterThanOrEqual(0);
	});
});
