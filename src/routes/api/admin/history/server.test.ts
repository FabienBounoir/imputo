import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { logChange } from '$lib/server/services/changeLog';

describe('GET /api/admin/history', () => {
	it("rejette un non-admin (403)", async () => {
		const { workspaceId } = await makeWorkspace('adm-hist');
		const { userId } = await addMember(workspaceId, 'USER', 'adm-hist-member');
		const locals = await fakeLocals(userId);
		await expect(GET({ locals, url: new URL('http://localhost/x') } as never)).rejects.toMatchObject({
			status: 403
		});
	});

	it("un ADMIN reçoit une page paginée de l'historique de son espace", async () => {
		const { userId, workspaceId } = await makeWorkspace('adm-hist2');
		const t = await createTicket(workspaceId, { key: 'ADMHIST-1', title: 'Ticket' });
		await logChange({
			workspaceId,
			entityType: 'TICKET',
			entityId: t.id,
			action: 'UPDATE',
			oldValue: null,
			newValue: 'x',
			changedById: userId
		});

		const locals = await fakeLocals(userId);
		const res = await GET({ locals, url: new URL('http://localhost/x') } as never);
		const body = await res.json();
		expect(body.entries.length).toBeGreaterThanOrEqual(1);
		expect(body).toHaveProperty('nextCursor');
	});
});
