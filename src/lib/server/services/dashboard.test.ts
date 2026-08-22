import { describe, it, expect } from 'vitest';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { listCategories, listActivities } from './params';
import { makeWorkspace, addMember } from './test-helpers';
import { getDashboard } from './dashboard';
import { setMemberFactice } from './accounts';

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

		// 'Congé' est désormais alimenté uniquement depuis les absences validées (cf. imputation.ts,
		// assertTargetInWorkspace(blockLinkedCategory)) — 'Jour férié' sert ici juste d'exemple de
		// catégorie non productive non liée, ce qui est tout ce dont ce test a besoin.
		const conge = (await listCategories(ws.workspaceId)).find((c) => c.label === 'Jour férié')!;
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

		// Les deux entrées ci-dessus (ticket productif + congé non productif) n'ont pas d'activité
		// taguée (activityId: null) : elles tombent toutes les deux dans le même bucket "Non précisé",
		// mais doivent y rester distinguées.
		const nonPrecise = dash.byActivity.find((a) => a.label === 'Non précisé')!;
		expect(nonPrecise.productive).toBe(2);
		expect(nonPrecise.nonProductive).toBe(1);
		expect(nonPrecise.total).toBe(3);
	});

	it('sépare productif/non-productif au sein d’une même activité nommée (pas juste "Non précisé")', async () => {
		const ws = await makeWorkspace('dash-activity');
		// 'Dev' fait partie des activités par défaut d'un espace neuf (cf. DEFAULT_ACTIVITIES).
		const dev = (await listActivities(ws.workspaceId)).find((a) => a.label === 'Dev')!;

		const t = await createTicket(ws.workspaceId, { key: `DA-${ws.id}`, title: 'Ticket dev' });
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: dev.id,
			day: '2026-06-01',
			amount: 3
		});

		// Une catégorie non productive peut être taguée avec une activité — rien ne l'en empêche à la
		// saisie (cf. imputation/+page.svelte, formulaire d'ajout de ligne). 'Jour férié' plutôt que
		// 'Congé' : cette dernière est désormais réservée aux absences validées (blockLinkedCategory).
		const conge = (await listCategories(ws.workspaceId)).find((c) => c.label === 'Jour férié')!;
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'CATEGORY',
			targetId: conge.id,
			activityId: dev.id,
			day: '2026-06-01',
			amount: 1
		});

		const dash = await getDashboard(ws.workspaceId);
		const devRow = dash.byActivity.find((a) => a.label === 'Dev')!;
		expect(devRow.productive).toBe(3);
		expect(devRow.nonProductive).toBe(1);
		expect(devRow.total).toBe(4);
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

	it('excludeUserIds retire un membre de byPerson/byActivity et de ses totaux (cf. membres "factice")', async () => {
		const ws = await makeWorkspace('dash-exclude');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'dash-exclude-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const t = await createTicket(ws.workspaceId, { key: `DE-${ws.id}`, title: 'Ticket exclude' });
		const period = { from: '2026-06-01', to: '2026-06-30' };
		await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 1 });
		await setCell(ws.workspaceId, facticeId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-06-01', amount: 5 });

		// Mode période : kpis.consumedTotal dérive du même agrégat par personne que byPerson (cf.
		// dashboard.ts ligne ~188) — contrairement au mode "Tout l'espace" où il vient du chiffrage
		// ticket (listTickets), sans notion de personne, donc pas affecté par excludeUserIds.
		const withFactice = await getDashboard(ws.workspaceId, period);
		expect(withFactice.kpis.consumedTotal).toBe(6);
		expect(withFactice.byPerson.map((p) => p.name).sort()).toEqual(['dash-exclude owner', 'dash-exclude-factice']);

		const withoutFactice = await getDashboard(ws.workspaceId, period, true, [facticeId]);
		expect(withoutFactice.kpis.consumedTotal).toBe(1); // seule la ligne du membre non-factice compte
		expect(withoutFactice.byPerson.map((p) => p.name)).toEqual(['dash-exclude owner']);
		expect(withoutFactice.bySsp.every((r) => r.personName !== 'dash-exclude-factice')).toBe(true);
	});
});
