import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, session } from '$lib/server/db';
import { createSession, validateSession } from './session';
import { hashToken } from './tokens';
import { makeWorkspace } from '$lib/server/services/test-helpers';

const DAY = 86_400_000;

describe('session glissante', () => {
	it('prolongée à 7 jours quand il en reste moins de la moitié, pas avant', async () => {
		const { userId, workspaceId } = await makeWorkspace('sess');
		const { token } = await createSession(userId, workspaceId);

		expect((await validateSession(token)).renewed).toBe(false); // neuve : 7 jours devant elle

		await db.update(session).set({ expiresAt: new Date(Date.now() + DAY) }).where(eq(session.id, hashToken(token)));
		const res = await validateSession(token);
		expect(res.renewed).toBe(true);
		expect(res.session!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);

		const [row] = await db.select().from(session).where(eq(session.id, hashToken(token)));
		expect(row.expiresAt.getTime()).toBe(res.session!.expiresAt.getTime()); // écrit en base, pas juste renvoyé
		expect((await validateSession(token)).renewed).toBe(false);
	});
});
