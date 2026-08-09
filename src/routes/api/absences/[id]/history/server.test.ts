import { describe, it, expect } from 'vitest';
import { GET } from './+server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createAbsenceFor, listAbsencesForUser } from '$lib/server/services/absences';
import { logChange } from '$lib/server/services/changeLog';

const emptyLocals = {
	user: null,
	sessionToken: null,
	memberships: [],
	workspace: null,
	role: null,
	deactivatedWorkspace: null
};

describe('GET /api/absences/[id]/history', () => {
	it('rejette sans authentification', async () => {
		await expect(GET({ locals: emptyLocals, params: { id: 'x' } } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it("renvoie l'historique d'une absence de son espace", async () => {
		const { userId, workspaceId } = await makeWorkspace();
		await createAbsenceFor(
			workspaceId,
			{ userId },
			{ startDate: '2026-06-22', endDate: '2026-06-22', type: 'CONGE_VALIDE', period: 'FULL' }
		);
		const [absence] = await listAbsencesForUser(workspaceId, userId);
		await logChange({
			workspaceId,
			entityType: 'ABSENCE',
			entityId: absence.id,
			action: 'UPDATE',
			oldValue: null,
			newValue: 'created',
			changedById: userId
		});

		const locals = await fakeLocals(userId);
		const res = await GET({ locals, params: { id: absence.id } } as never);
		const body = await res.json();
		expect(body.entries).toHaveLength(1);
	});
});
