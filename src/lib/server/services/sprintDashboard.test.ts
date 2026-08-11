import { describe, it, expect } from 'vitest';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { createRef, listRefs } from './referentials';
import { makeWorkspace } from './test-helpers';
import { getSprintDashboard } from './sprintDashboard';

describe('getSprintDashboard', () => {
	it('scope les KPIs et tickets sur le sprint demandé (kind SPRINT)', async () => {
		const ws = await makeWorkspace('sprintdash');
		await createRef(ws.workspaceId, 'sprint', `Sprint ${ws.id}`);
		const [sprint] = (await listRefs(ws.workspaceId, 'sprint')).filter((s) => s.name === `Sprint ${ws.id}`);

		const inSprint = await createTicket(ws.workspaceId, {
			key: `SP-${ws.id}`,
			title: 'Dans le sprint',
			sprintId: sprint.id,
			estimationReal: '5',
			raeReal: '2'
		});
		await createTicket(ws.workspaceId, { key: `OUT-${ws.id}`, title: 'Hors sprint', estimationReal: '9' });

		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: inSprint.id,
			activityId: null,
			day: '2026-06-01',
			amount: 1
		});

		const dash = await getSprintDashboard(ws.workspaceId, sprint.id);

		expect(dash.kind).toBe('SPRINT');
		expect(dash.kpis.ticketCount).toBe(1);
		expect(dash.kpis.estTotal).toBe(5);
		expect(dash.kpis.raeTotal).toBe(2);
		expect(dash.tickets.map((t) => t.key)).toEqual([`SP-${ws.id}`]);
		expect(dash.byPerson.find((p) => p.name === 'sprintdash owner')?.consumed).toBe(1);
	});

	it('scope sur une version (kind VERSION) et masque ecartVsBudgetTotal pour un non-admin', async () => {
		const ws = await makeWorkspace('versiondash');
		await createRef(ws.workspaceId, 'version', `Version ${ws.id}`);
		const [version] = (await listRefs(ws.workspaceId, 'version')).filter((v) => v.name === `Version ${ws.id}`);

		await createTicket(ws.workspaceId, {
			key: `V-${ws.id}`,
			title: 'Dans la version',
			versionId: version.id,
			estimationReal: '2'
		});

		const asAdmin = await getSprintDashboard(ws.workspaceId, version.id, true, true);
		expect(asAdmin.kind).toBe('VERSION');
		expect(asAdmin.kpis.ticketCount).toBe(1);
		expect(asAdmin.kpis.ecartVsBudgetTotal).not.toBeNull();

		const asUser = await getSprintDashboard(ws.workspaceId, version.id, true, false);
		expect(asUser.kpis.ecartVsBudgetTotal).toBeNull();
	});

	it('lève une erreur pour un sprint/version inexistant dans cet espace', async () => {
		const ws = await makeWorkspace('nodash');
		await expect(getSprintDashboard(ws.workspaceId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow();
	});
});
