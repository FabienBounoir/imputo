import { describe, it, expect } from 'vitest';
import { buildSprintTicketsSvg } from './ticketsSvg';
import type { SprintDashboard } from '$lib/server/services/sprintDashboard';

function makeTicket(overrides: Partial<SprintDashboard['tickets'][number]> = {}): SprintDashboard['tickets'][number] {
	return {
		id: 'the-id',
		key: 'ABC-1',
		title: 'Un titre de ticket',
		stateLabel: 'En cours',
		stateEmoji: '🔧',
		stateColor: '#16A34A',
		budget: null,
		estTotal: 5,
		raeTotal: 2,
		consumed: 3,
		ecartVsEstime: 0,
		ecartVsBudget: null,
		avancement: 0.6,
		...overrides
	};
}

function makeDashboard(overrides: Partial<SprintDashboard> = {}): SprintDashboard {
	return {
		sprintId: 'sprint-1',
		sprintName: 'Sprint 12',
		kind: 'SPRINT',
		kpis: {
			estTotal: 5,
			consumedTotal: 3,
			raeTotal: 2,
			avancement: 0.6,
			ecartVsEstimeTotal: 0,
			ecartVsBudgetTotal: null,
			budgetTotal: null,
			ticketCount: 1
		},
		byActivity: [],
		byPerson: [],
		history: [],
		tickets: [makeTicket()],
		ticketGroups: [
			{ groupId: null, label: 'Sans groupe', estTotal: 5, raeTotal: 2, consumed: 3, avancement: 0.6, tickets: [makeTicket()] }
		],
		...overrides
	};
}

describe('buildSprintTicketsSvg', () => {
	it('inclut la clé, le titre et le libellé du sprint', () => {
		const { svg } = buildSprintTicketsSvg(makeDashboard(), false);
		expect(svg).toContain('ABC-1');
		expect(svg).toContain('Un titre de ticket');
		expect(svg).toContain('Sprint 12');
		expect(svg).toContain('Tickets du sprint');
	});

	it('bascule le titre pour une VERSION', () => {
		const { svg } = buildSprintTicketsSvg(makeDashboard({ kind: 'VERSION' }), false);
		expect(svg).toContain('Tickets de la version');
	});

	it('masque les colonnes Budget/Écart vs budget quand budgetTotal est null (USER standard)', () => {
		const { svg } = buildSprintTicketsSvg(makeDashboard(), false);
		expect(svg).not.toContain('>BUDGET<');
		expect(svg).not.toContain('>ÉCART VS BUDGET<');
	});

	it('affiche les colonnes Budget/Écart vs budget quand budgetTotal est renseigné (ADMIN)', () => {
		const dashboard = makeDashboard({
			kpis: {
				estTotal: 5,
				consumedTotal: 3,
				raeTotal: 2,
				avancement: 0.6,
				ecartVsEstimeTotal: 0,
				ecartVsBudgetTotal: 1,
				budgetTotal: 10,
				ticketCount: 1
			},
			tickets: [makeTicket({ budget: 10, ecartVsBudget: 1 })]
		});
		const { svg } = buildSprintTicketsSvg(dashboard, false);
		expect(svg).toContain('>BUDGET<');
		expect(svg).toContain('>ÉCART VS BUDGET<');
	});

	it('regroupe par groupe de tickets avec un sous-total quand grouped=true', () => {
		const { svg } = buildSprintTicketsSvg(makeDashboard(), true);
		expect(svg).toContain('SANS GROUPE');
		expect(svg).toContain('Sous-total');
	});

	it('affiche "Aucun ticket." pour un dashboard vide', () => {
		const { svg } = buildSprintTicketsSvg(makeDashboard({ tickets: [], ticketGroups: [] }), false);
		expect(svg).toContain('Aucun ticket.');
	});
});
