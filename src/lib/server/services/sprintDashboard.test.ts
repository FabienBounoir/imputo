import { describe, it, expect } from 'vitest';
import { createTicket, upsertTicketActivityRae } from './tickets';
import { setCell } from './imputation';
import { createRef, listRefs } from './referentials';
import { createActivity, listActivities, reorderActivities } from './params';
import { makeWorkspace, addMember } from './test-helpers';
import { getSprintDashboard } from './sprintDashboard';
import { createTicketGroup, listTicketGroups, reorderTicketGroups, setTicketInGroup } from './ticketGroups';
import { setMemberFactice } from './accounts';

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

	it('excludeUserIds retire un membre de byPerson (cf. membres "factice")', async () => {
		const ws = await makeWorkspace('sprintdash-exclude');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'sprintdash-exclude-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);
		await createRef(ws.workspaceId, 'sprint', `Sprint ${ws.id}`);
		const [sprint] = (await listRefs(ws.workspaceId, 'sprint')).filter((s) => s.name === `Sprint ${ws.id}`);

		const t = await createTicket(ws.workspaceId, { key: `SPX-${ws.id}`, title: 'Ticket', sprintId: sprint.id });
		await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 1 });
		await setCell(ws.workspaceId, facticeId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 4 });

		const withFactice = await getSprintDashboard(ws.workspaceId, sprint.id);
		expect(withFactice.byPerson.map((p) => p.name).sort()).toEqual(['sprintdash-exclude owner', 'sprintdash-exclude-factice']);

		const withoutFactice = await getSprintDashboard(ws.workspaceId, sprint.id, true, true, false, [facticeId]);
		expect(withoutFactice.byPerson.map((p) => p.name)).toEqual(['sprintdash-exclude owner']);
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

	it('découpe les tickets en sections par groupe, un ticket multi-groupe dans chaque section, "Sans groupe" en dernier', async () => {
		const ws = await makeWorkspace('groupdash');
		await createRef(ws.workspaceId, 'sprint', `Sprint ${ws.id}`);
		const [sprint] = (await listRefs(ws.workspaceId, 'sprint')).filter((s) => s.name === `Sprint ${ws.id}`);

		await createTicketGroup(ws.workspaceId, `Backend ${ws.id}`);
		await createTicketGroup(ws.workspaceId, `Frontend ${ws.id}`);
		const groups = await listTicketGroups(ws.workspaceId);
		const backend = groups.find((g) => g.label === `Backend ${ws.id}`)!;
		const frontend = groups.find((g) => g.label === `Frontend ${ws.id}`)!;

		// Gros ticket dans les deux groupes (doit apparaître dans les deux sections).
		const shared = await createTicket(ws.workspaceId, {
			key: `SH-${ws.id}`,
			title: 'Partagé',
			sprintId: sprint.id,
			estimationReal: '10'
		});
		await setTicketInGroup(ws.workspaceId, shared.id, backend.id, true);
		await setTicketInGroup(ws.workspaceId, shared.id, frontend.id, true);
		// Petit ticket dans un seul groupe.
		const small = await createTicket(ws.workspaceId, {
			key: `SM-${ws.id}`,
			title: 'Petit',
			sprintId: sprint.id,
			estimationReal: '1'
		});
		await setTicketInGroup(ws.workspaceId, small.id, frontend.id, true);
		// Ticket sans groupe.
		await createTicket(ws.workspaceId, { key: `NG-${ws.id}`, title: 'Sans groupe', sprintId: sprint.id, estimationReal: '2' });

		const dash = await getSprintDashboard(ws.workspaceId, sprint.id);

		// Ordre = sortOrder (ordre de création par défaut) : Backend avant Frontend ; "Sans groupe" toujours en dernier.
		expect(dash.ticketGroups.map((g) => g.label)).toEqual([`Backend ${ws.id}`, `Frontend ${ws.id}`, 'Sans groupe']);
		const backendSection = dash.ticketGroups.find((g) => g.label === `Backend ${ws.id}`)!;
		const frontendSection = dash.ticketGroups.find((g) => g.label === `Frontend ${ws.id}`)!;
		const ungrouped = dash.ticketGroups.find((g) => g.label === 'Sans groupe')!;
		expect(backendSection.tickets.map((t) => t.key)).toEqual([`SH-${ws.id}`]);
		expect(frontendSection.tickets.map((t) => t.key).sort()).toEqual([`SH-${ws.id}`, `SM-${ws.id}`].sort());
		expect(ungrouped.tickets.map((t) => t.key)).toEqual([`NG-${ws.id}`]);
		expect(backendSection.estTotal).toBe(10);
		expect(frontendSection.estTotal).toBe(11);

		// Paramétrable (retour utilisateur) : réordonner (drag-and-drop) change l'ordre final dans la synthèse.
		await reorderTicketGroups(ws.workspaceId, [frontend.id, backend.id]);
		const dashReordered = await getSprintDashboard(ws.workspaceId, sprint.id);
		expect(dashReordered.ticketGroups.map((g) => g.label)).toEqual([`Frontend ${ws.id}`, `Backend ${ws.id}`, 'Sans groupe']);
	});

	it('byActivity suit l’ordre des référentiels par défaut, alphabétique si demandé', async () => {
		const ws = await makeWorkspace('act-order');
		await createRef(ws.workspaceId, 'sprint', `Sprint ${ws.id}`);
		const [sprint] = (await listRefs(ws.workspaceId, 'sprint')).filter((s) => s.name === `Sprint ${ws.id}`);

		await createActivity(ws.workspaceId, `Zebra ${ws.id}`);
		await createActivity(ws.workspaceId, `Alpha ${ws.id}`);
		const acts = await listActivities(ws.workspaceId);
		const zebra = acts.find((a) => a.label === `Zebra ${ws.id}`)!;
		const alpha = acts.find((a) => a.label === `Alpha ${ws.id}`)!;

		const t = await createTicket(ws.workspaceId, { key: `AO-${ws.id}`, title: 'Ticket', sprintId: sprint.id });
		await upsertTicketActivityRae(ws.workspaceId, t.id, zebra.id, 'raeReal', 3);
		await upsertTicketActivityRae(ws.workspaceId, t.id, alpha.id, 'raeReal', 2);

		const byDefault = await getSprintDashboard(ws.workspaceId, sprint.id);
		// Ordre de création (sortOrder) : Zebra avant Alpha, pas alphabétique.
		expect(byDefault.byActivity.map((a) => a.label)).toEqual([`Zebra ${ws.id}`, `Alpha ${ws.id}`]);

		const alphaSorted = await getSprintDashboard(ws.workspaceId, sprint.id, true, true, true);
		expect(alphaSorted.byActivity.map((a) => a.label)).toEqual([`Alpha ${ws.id}`, `Zebra ${ws.id}`]);

		// Paramétrable dans les référentiels aussi : réordonner change l'ordre par défaut.
		await reorderActivities(ws.workspaceId, [alpha.id, zebra.id]);
		const afterReorder = await getSprintDashboard(ws.workspaceId, sprint.id);
		expect(afterReorder.byActivity.map((a) => a.label)).toEqual([`Alpha ${ws.id}`, `Zebra ${ws.id}`]);
	});
});
