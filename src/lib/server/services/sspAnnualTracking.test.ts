import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, ssp, ticket, timeEntry, workspace } from '$lib/server/db';
import { makeWorkspace } from './test-helpers';
import { computeRaeChain, getAnnualTrackingView, setProd, setRaeOverride, advanceCursor } from './sspAnnualTracking';

describe('computeRaeChain (pur)', () => {
	const months = ['2024-01-01', '2024-02-01', '2024-03-01'];

	it('sans budget ni override : tout est vide', () => {
		expect(computeRaeChain(null, months, {}, {})).toEqual({
			'2024-01-01': null,
			'2024-02-01': null,
			'2024-03-01': null
		});
	});

	it('budget seedé, pas de prod : le RAE reste plat', () => {
		expect(computeRaeChain(100, months, {}, {})).toEqual({
			'2024-01-01': 100,
			'2024-02-01': 100,
			'2024-03-01': 100
		});
	});

	it('budget + prod sur 3 mois : décrément correct', () => {
		const prod = { '2024-01-01': 10, '2024-02-01': 5, '2024-03-01': 20 };
		expect(computeRaeChain(100, months, {}, prod)).toEqual({
			'2024-01-01': 90,
			'2024-02-01': 85,
			'2024-03-01': 65
		});
	});

	it('un override en milieu de fenêtre casse la chaîne : ce qui précède reste inchangé, ce qui suit repart de lui', () => {
		const prod = { '2024-01-01': 10, '2024-02-01': 5, '2024-03-01': 20 };
		const overrides = { '2024-02-01': 50 };
		expect(computeRaeChain(100, months, overrides, prod)).toEqual({
			'2024-01-01': 90,
			'2024-02-01': 50,
			'2024-03-01': 30
		});
	});

	it('deux overrides : le second gouverne à partir de son mois', () => {
		const overrides = { '2024-01-01': 40, '2024-03-01': 5 };
		const prod = { '2024-02-01': 3 };
		expect(computeRaeChain(100, months, overrides, prod)).toEqual({
			'2024-01-01': 40,
			'2024-02-01': 37,
			'2024-03-01': 5
		});
	});
});

let ws: Awaited<ReturnType<typeof makeWorkspace>>;
let sspA: string;
let ticketA: string;

beforeAll(async () => {
	ws = await makeWorkspace('annual');
	const [s] = await db
		.insert(ssp)
		.values({ workspaceId: ws.workspaceId, code: 'AN-1', label: 'Suivi annuel test', budgetDays: '50' })
		.returning();
	sspA = s.id;
	const [t] = await db
		.insert(ticket)
		.values({ workspaceId: ws.workspaceId, key: 'ANN-1', title: 'Ticket suivi annuel', sspId: sspA })
		.returning({ id: ticket.id });
	ticketA = t.id;
	// Curseur fixé loin dans le passé : les tests ne doivent pas dépendre du calendrier courant.
	await db.update(workspace).set({ annualTrackingMonth: '2024-06-01' }).where(eq(workspace.id, ws.workspaceId));
});

describe('sspAnnualTracking (intégration DB)', () => {
	it('la conso est sommée par mois et le TNF suit une fois une prod saisie', async () => {
		await db.insert(timeEntry).values([
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'TICKET', ticketId: ticketA, day: '2024-06-05', amount: '3' },
			{ workspaceId: ws.workspaceId, userId: ws.userId, targetType: 'TICKET', ticketId: ticketA, day: '2024-06-10', amount: '2' }
		]);
		let view = await getAnnualTrackingView(ws.workspaceId);
		const row = () => view.rows.find((r) => r.sspId === sspA)!;
		const juneCell = () => row().cells.find((c) => c.month === '2024-06-01')!;
		expect(view.cursorMonth).toBe('2024-06-01');
		expect(juneCell().conso).toBe(5);
		expect(juneCell().prod).toBeNull();
		expect(juneCell().tnf).toBeNull(); // pas de prod saisie : TNF pas calculable

		await setProd(ws.workspaceId, sspA, '2024-06-01', 4);
		view = await getAnnualTrackingView(ws.workspaceId);
		expect(juneCell().prod).toBe(4);
		expect(juneCell().tnf).toBe(1); // 5 - 4
	});

	it('setProd rejette un mois hors curseur', async () => {
		await expect(setProd(ws.workspaceId, sspA, '2024-05-01', 4)).rejects.toThrow(/mois en cours/);
	});

	it('setRaeOverride rejette un mois futur', async () => {
		await expect(setRaeOverride(ws.workspaceId, sspA, '2024-07-01', 10)).rejects.toThrow(/passé ou le mois en cours/);
	});

	it('setRaeOverride accepte le mois curseur et se reflète dans la vue', async () => {
		await setRaeOverride(ws.workspaceId, sspA, '2024-06-01', 42);
		const view = await getAnnualTrackingView(ws.workspaceId);
		const cell = view.rows.find((r) => r.sspId === sspA)!.cells.find((c) => c.month === '2024-06-01')!;
		expect(cell.rae).toBe(42);
		expect(cell.raeOverridden).toBe(true);
	});

	it('advanceCursor amorce depuis le curseur courant puis incrémente d\'un mois à chaque appel, et la fenêtre suit', async () => {
		const next = await advanceCursor(ws.workspaceId);
		expect(next).toBe('2024-07-01');
		const view = await getAnnualTrackingView(ws.workspaceId);
		expect(view.cursorMonth).toBe('2024-07-01');
		expect(view.windowMonths[view.windowMonths.length - 1]).toBe('2024-07-01');
		expect(view.windowMonths).toHaveLength(12);
	});
});
