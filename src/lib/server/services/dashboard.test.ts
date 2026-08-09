import { describe, it, expect } from 'vitest';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { listCategories } from './params';
import { makeWorkspace } from './test-helpers';
import { getDashboard } from './dashboard';

describe('getDashboard', () => {
	it('agrège KPIs, état et productif/non-productif sur tout l’espace', async () => {
		const ws = await makeWorkspace('dash');
		const t = await createTicket(ws.workspaceId, {
			key: `D-${ws.id}`,
			title: 'Ticket dashboard',
			estimationReal: '4',
			raeReal: '1'
		});
		const day = '2026-06-01';
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day,
			amount: 2
		});

		const conge = (await listCategories(ws.workspaceId)).find((c) => c.label === 'Congé')!;
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'CATEGORY',
			targetId: conge.id,
			activityId: null,
			day,
			amount: 1
		});

		const dash = await getDashboard(ws.workspaceId);

		expect(dash.kpis.ticketCount).toBe(1);
		expect(dash.kpis.estTotal).toBe(4);
		expect(dash.kpis.raeTotal).toBe(1);
		expect(dash.kpis.consumedTotal).toBe(2);
		expect(dash.productiveVsNot.productive).toBe(2);
		expect(dash.productiveVsNot.nonProductive).toBe(1);

		const person = dash.byPerson.find((p) => p.name === 'dash owner')!;
		expect(person.productive).toBe(2);
		expect(person.nonProductive).toBe(1);
		expect(person.total).toBe(3);

		const stateEntry = dash.byState.find((s) => s.label === 'Sans état');
		expect(stateEntry?.count).toBe(1);

		const project = dash.byProject.find((p) => p.name === 'Sans projet')!;
		expect(project.ticketCount).toBe(1);
		expect(project.est).toBe(4);
	});

	it('en mode période, masque le chiffrage et ne renvoie que les stats bornées', async () => {
		const ws = await makeWorkspace('dash-period');
		const t = await createTicket(ws.workspaceId, {
			key: `DP-${ws.id}`,
			title: 'Ticket période',
			estimationReal: '3'
		});
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
			day: '2026-07-01',
			amount: 1
		});

		const dash = await getDashboard(ws.workspaceId, { from: '2026-06-01', to: '2026-06-30' });

		expect(dash.kpis.estTotal).toBe(0); // chiffrage masqué en mode période
		expect(dash.kpis.consumedTotal).toBe(1); // seule l'imputation de juin compte
		expect(dash.byProject).toEqual([]);
		expect(dash.byState).toEqual([]);
	});
});
