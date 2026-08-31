import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSprintTicketsSvg } from './ticketsSvg';
import type { SprintDashboard } from '$lib/server/services/sprintDashboard';

afterEach(() => {
	vi.unstubAllGlobals();
});

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
		priority: 2,
		assigneeId: null,
		assigneeName: null,
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
	it('inclut la clé, le titre et le libellé du sprint', async () => {
		const { svg } = await buildSprintTicketsSvg(makeDashboard(), false);
		expect(svg).toContain('ABC-1');
		expect(svg).toContain('Un titre de ticket');
		expect(svg).toContain('Sprint 12');
		expect(svg).toContain('Tickets du sprint');
	});

	it('bascule le titre pour une VERSION', async () => {
		const { svg } = await buildSprintTicketsSvg(makeDashboard({ kind: 'VERSION' }), false);
		expect(svg).toContain('Tickets de la version');
	});

	it('masque les colonnes Budget/Écart vs budget quand budgetTotal est null (USER standard)', async () => {
		const { svg } = await buildSprintTicketsSvg(makeDashboard(), false);
		expect(svg).not.toContain('>BUDGET<');
		expect(svg).not.toContain('>ÉCART VS BUDGET<');
	});

	it('affiche les colonnes Budget/Écart vs budget quand budgetTotal est renseigné (ADMIN)', async () => {
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
		const { svg } = await buildSprintTicketsSvg(dashboard, false);
		expect(svg).toContain('>BUDGET<');
		expect(svg).toContain('>ÉCART VS BUDGET<');
	});

	it('regroupe par groupe de tickets avec un sous-total quand grouped=true', async () => {
		const { svg } = await buildSprintTicketsSvg(makeDashboard(), true);
		expect(svg).toContain('SANS GROUPE');
		expect(svg).toContain('Sous-total');
	});

	it('affiche "Aucun ticket." pour un dashboard vide', async () => {
		const { svg } = await buildSprintTicketsSvg(makeDashboard({ tickets: [], ticketGroups: [] }), false);
		expect(svg).toContain('Aucun ticket.');
	});

	it("colore l'écart négatif en vert fixe, jamais avec l'accent de l'espace", async () => {
		const dashboard = makeDashboard({ tickets: [makeTicket({ ecartVsEstime: -2 })] });
		const { svg } = await buildSprintTicketsSvg(dashboard, false, '#FF0000');
		expect(svg).toContain('fill="#22C55E"');
		expect(svg).not.toContain('fill="#FF0000">-2');
	});

	it("colore l'écart positif en orange fixe (WARN)", async () => {
		const dashboard = makeDashboard({ tickets: [makeTicket({ ecartVsEstime: 2 })] });
		const { svg } = await buildSprintTicketsSvg(dashboard, false, '#FF0000');
		expect(svg).toContain('fill="#C2410C"');
	});

	it("affiche le badge de priorité (P0 en rouge, même échelle que Tickets & chiffrage)", async () => {
		const dashboard = makeDashboard({ tickets: [makeTicket({ priority: 0 })] });
		const { svg } = await buildSprintTicketsSvg(dashboard, false);
		expect(svg).toContain('>P0<');
		expect(svg).toContain('fill="#e34948"');
	});

	it("récupère le vrai avatar Dicebear de l'assigné et l'embarque en data URI (image rognée en rond)", async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<svg>fake-avatar</svg>', { status: 200 }))
		);
		const dashboard = makeDashboard({ tickets: [makeTicket({ assigneeId: 'u1', assigneeName: 'Alice Admin' })] });
		const { svg } = await buildSprintTicketsSvg(dashboard, false);
		expect(svg).toContain('clip-path="url(#avatarClip)"');
		expect(svg).toContain('href="data:image/svg+xml;base64,');
		expect(svg).toContain('>Alice Admin<');
	});

	it("retombe sur les initiales/dégradé si le fetch de l'avatar échoue", async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		const dashboard = makeDashboard({ tickets: [makeTicket({ assigneeId: 'u1', assigneeName: 'Alice Admin' })] });
		const { svg } = await buildSprintTicketsSvg(dashboard, false);
		expect(svg).toContain('fill="url(#avatarGrad)"');
		expect(svg).toContain('>AA<');
		expect(svg).not.toContain('data:image/svg+xml');
	});

	it("n'affiche aucun avatar pour un ticket non assigné (et ne fetch rien)", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { svg } = await buildSprintTicketsSvg(makeDashboard({ tickets: [makeTicket({ assigneeId: null })] }), false);
		expect(svg).not.toContain('fill="url(#avatarGrad)"');
		expect(svg).not.toContain('clip-path="url(#avatarClip)"');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
