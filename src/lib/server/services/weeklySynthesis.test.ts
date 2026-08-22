import { describe, it, expect } from 'vitest';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { makeWorkspace, addMember } from './test-helpers';
import { getWeeklySynthesis } from './weeklySynthesis';
import { setMemberFactice } from './accounts';

describe('getWeeklySynthesis', () => {
	it('agrège le total imputé par semaine/personne avec le % de capacité', async () => {
		const ws = await makeWorkspace('wsynth');
		const t = await createTicket(ws.workspaceId, { key: `WS-${ws.id}`, title: 'Ticket synthèse' });

		// Semaine du lundi 2026-06-01 : 1 + 0.5 = 1.5 jour imputé.
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: '2026-06-01',
			amount: 1
		});
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: '2026-06-02',
			amount: 0.5
		});

		const rows = await getWeeklySynthesis(ws.workspaceId, '2026-06-01', '2026-06-07');

		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.userId).toBe(ws.userId);
		expect(row.mondayISO).toBe('2026-06-01');
		expect(row.total).toBe(1.5);
		expect(row.days['2026-06-01']).toBe(1);
		expect(row.days['2026-06-02']).toBe(0.5);
		expect(row.pct).toBeGreaterThan(0);
		expect(row.overCapacity).toBe(false);
	});

	it("ignore les imputations hors de la période demandée", async () => {
		const ws = await makeWorkspace('wsynth-out');
		const t = await createTicket(ws.workspaceId, { key: `WSO-${ws.id}`, title: 'Hors période' });
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: '2026-07-15',
			amount: 1
		});

		const rows = await getWeeklySynthesis(ws.workspaceId, '2026-06-01', '2026-06-07');
		expect(rows).toEqual([]);
	});

	it('excludeUserIds retire un membre des lignes retournées (cf. membres "factice")', async () => {
		const ws = await makeWorkspace('wsynth-exclude');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'wsynth-exclude-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);
		const t = await createTicket(ws.workspaceId, { key: `WSE-${ws.id}`, title: 'Ticket' });
		await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 1 });
		await setCell(ws.workspaceId, facticeId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 1 });

		const withFactice = await getWeeklySynthesis(ws.workspaceId, '2026-06-01', '2026-06-07');
		expect(withFactice.map((r) => r.userId).sort()).toEqual([facticeId, ws.userId].sort());

		const withoutFactice = await getWeeklySynthesis(ws.workspaceId, '2026-06-01', '2026-06-07', [facticeId]);
		expect(withoutFactice.map((r) => r.userId)).toEqual([ws.userId]);
	});
});
