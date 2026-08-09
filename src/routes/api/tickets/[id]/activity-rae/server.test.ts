import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, ticketActivityRae } from '$lib/server/db';
import { POST } from './+server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals, jsonRequest } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { listActivities } from '$lib/server/services/params';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

async function setup() {
	const { userId, workspaceId } = await makeWorkspace('rae');
	const t = await createTicket(workspaceId, { key: 'RAE-1', title: 'Ticket' });
	const activities = await listActivities(workspaceId);
	return { userId, workspaceId, ticketId: t.id, activityId: activities[0].id };
}

describe('POST /api/tickets/[id]/activity-rae', () => {
	it('rejette sans authentification', async () => {
		await expect(
			POST({
				locals: emptyLocals,
				params: { id: 'x' },
				request: jsonRequest({ activityId: 'x', field: 'raeReal', value: 1 })
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('rejette un body invalide', async () => {
		const { userId, ticketId } = await setup();
		const locals = await fakeLocals(userId);
		await expect(
			POST({ locals, params: { id: ticketId }, request: jsonRequest({}) } as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it("un USER n'ayant jamais imputé sur cette activité ne peut pas éditer le RAE (403)", async () => {
		const { workspaceId, ticketId, activityId } = await setup();
		const { userId: otherUserId } = await addMember(workspaceId, 'USER', 'rae-other');
		const locals = await fakeLocals(otherUserId);
		await expect(
			POST({
				locals,
				params: { id: ticketId },
				request: jsonRequest({ activityId, field: 'raeReal', value: 3 })
			} as never)
		).rejects.toMatchObject({ status: 403 });
	});

	it('un ADMIN peut éditer le RAE même sans avoir imputé', async () => {
		const { userId, ticketId, activityId } = await setup();
		const locals = await fakeLocals(userId); // owner créé par makeWorkspace -> ADMIN
		const res = await POST({
			locals,
			params: { id: ticketId },
			request: jsonRequest({ activityId, field: 'raeReal', value: 5 })
		} as never);
		const body = await res.json();
		expect(Number(body.rows.find((r: { activityId: string }) => r.activityId === activityId)?.raeReal)).toBe(5);

		// La FK ticket_activity_rae.activity_id est en ON DELETE RESTRICT (protège le RAE saisi
		// contre une suppression d'activité accidentelle) : on nettoie nous-mêmes cette ligne pour
		// que le afterAll partagé (test-helpers.ts) puisse ensuite supprimer le workspace de test.
		await db.delete(ticketActivityRae).where(eq(ticketActivityRae.ticketId, ticketId));
	});
});
