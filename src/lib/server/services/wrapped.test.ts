import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, category, supportDutyLog, wrappedSnapshot } from '$lib/server/db';
import { makeWorkspace, addMember } from './test-helpers';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { setSupportEnabled } from './support';
import { round } from './calc';
import { computeUserWrapped, isWrappedWindowOpen, wrappedYearFor, runWrapped } from './wrapped';

describe('isWrappedWindowOpen / wrappedYearFor', () => {
	it('ouvre du 1 novembre au 5 janvier, fermé le reste de l’année', () => {
		expect(isWrappedWindowOpen('2026-11-01')).toBe(true);
		expect(isWrappedWindowOpen('2026-11-30')).toBe(true);
		expect(isWrappedWindowOpen('2026-12-31')).toBe(true);
		expect(isWrappedWindowOpen('2027-01-05')).toBe(true);
		expect(isWrappedWindowOpen('2027-01-06')).toBe(false);
		expect(isWrappedWindowOpen('2026-10-31')).toBe(false);
	});

	it('reste sur l’année en cours en décembre, bascule sur l’année précédente en janvier', () => {
		expect(wrappedYearFor('2026-12-15')).toBe(2026);
		expect(wrappedYearFor('2027-01-03')).toBe(2026);
	});

	it('reste sur l’année en cours le reste de l’année (aperçu admin hors fenêtre)', () => {
		expect(wrappedYearFor('2026-08-25')).toBe(2026);
		expect(wrappedYearFor('2026-01-06')).toBe(2026);
	});
});

describe('computeUserWrapped', () => {
	it('calcule le ticket le plus chronophage, la série ouvrée et le % productif', async () => {
		const ws = await makeWorkspace('wrap');
		const key = `WRAP-${ws.id}`;
		const title = 'Ticket wrap';
		const t = await createTicket(ws.workspaceId, { key, title });

		const [cat] = await db
			.insert(category)
			.values({ workspaceId: ws.workspaceId, label: `Non prod ${ws.id}`, kind: 'NON_PRODUCTIVE' })
			.returning({ id: category.id });

		// Lundi 5, mardi 6, mercredi 7 janvier 2026 : série de 3 jours ouvrés consécutifs.
		for (const day of ['2026-01-05', '2026-01-06', '2026-01-07']) {
			await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day, amount: 4 });
		}
		// Jeudi 8 : rien — coupe la série. Vendredi 9 : imputation non productive.
		await setCell(ws.workspaceId, ws.userId, {
			targetType: 'CATEGORY',
			targetId: cat.id,
			activityId: null,
			day: '2026-01-09',
			amount: 2
		});

		const wrapped = await computeUserWrapped(ws.workspaceId, ws.userId, 2026);

		expect(wrapped.topTicket).toEqual({ key, title, hours: 12 });
		expect(wrapped.streakDays).toBe(3);
		expect(wrapped.totalHours).toBe(14);
		expect(wrapped.productivePct).toBe(round((12 / 14) * 100));
	});

	it('sans aucune imputation, renvoie des stats vides plutôt que de planter', async () => {
		const ws = await makeWorkspace('wrapempty');
		const wrapped = await computeUserWrapped(ws.workspaceId, ws.userId, 2026);
		expect(wrapped.topTicket).toBeNull();
		expect(wrapped.streakDays).toBe(0);
		expect(wrapped.totalHours).toBe(0);
		expect(wrapped.productivePct).toBe(0);
	});

	it('exclut décembre (comme Spotify Wrapped — le mois n’est pas terminé à l’ouverture de la fenêtre)', async () => {
		const ws = await makeWorkspace('wrapdec');
		const t = await createTicket(ws.workspaceId, { key: `WRAPDEC-${ws.id}`, title: 'Ticket décembre' });
		await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-11-30', amount: 3 });
		await setCell(ws.workspaceId, ws.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day: '2026-12-15', amount: 5 });

		const wrapped = await computeUserWrapped(ws.workspaceId, ws.userId, 2026);

		expect(wrapped.totalHours).toBe(3);
	});

	it('compte les lignes de supportDutyLog dans la plage, filtrées par utilisateur et espace', async () => {
		const ws = await makeWorkspace('wrapsupport');
		const { userId: other } = await addMember(ws.workspaceId, 'USER', 'other');
		await setSupportEnabled(ws.workspaceId, true);

		await db.insert(supportDutyLog).values([
			{ workspaceId: ws.workspaceId, periodStart: '2026-02-02', userId: ws.userId }, // dans la plage
			{ workspaceId: ws.workspaceId, periodStart: '2026-05-04', userId: ws.userId }, // dans la plage
			{ workspaceId: ws.workspaceId, periodStart: '2025-12-29', userId: ws.userId }, // avant l'année, exclu
			{ workspaceId: ws.workspaceId, periodStart: '2026-03-02', userId: other } // autre personne, exclu
		]);

		const wrapped = await computeUserWrapped(ws.workspaceId, ws.userId, 2026);
		expect(wrapped.supportEnabled).toBe(true);
		expect(wrapped.supportCount).toBe(2);
	});

	it('reste à 0 quand supportEnabled est faux, même avec des lignes déjà journalisées', async () => {
		const ws = await makeWorkspace('wrapsupportoff');
		await db.insert(supportDutyLog).values({ workspaceId: ws.workspaceId, periodStart: '2026-02-02', userId: ws.userId });

		const wrapped = await computeUserWrapped(ws.workspaceId, ws.userId, 2026);
		expect(wrapped.supportEnabled).toBe(false);
		expect(wrapped.supportCount).toBe(0);
	});
});

describe('runWrapped', () => {
	it('ne fait rien hors fenêtre, fige un instantané par membre actif dans la fenêtre', async () => {
		const ws = await makeWorkspace('wrapjob');

		const outside = await runWrapped('2026-06-15', ws.workspaceId);
		expect(outside).toEqual({ workspaces: 0, users: 0 });

		const inside = await runWrapped('2026-12-10', ws.workspaceId);
		expect(inside.workspaces).toBe(1);
		expect(inside.users).toBeGreaterThanOrEqual(1);

		const rows = await db
			.select()
			.from(wrappedSnapshot)
			.where(and(eq(wrappedSnapshot.workspaceId, ws.workspaceId), eq(wrappedSnapshot.userId, ws.userId), eq(wrappedSnapshot.year, 2026)));
		expect(rows).toHaveLength(1);
	});

	it('est idempotent : un second passage dans la fenêtre ne recalcule personne', async () => {
		const ws = await makeWorkspace('wrapjob2');

		const first = await runWrapped('2026-12-01', ws.workspaceId);
		expect(first.users).toBeGreaterThanOrEqual(1);

		const second = await runWrapped('2026-12-02', ws.workspaceId);
		expect(second.users).toBe(0);

		const rows = await db
			.select()
			.from(wrappedSnapshot)
			.where(and(eq(wrappedSnapshot.workspaceId, ws.workspaceId), eq(wrappedSnapshot.userId, ws.userId), eq(wrappedSnapshot.year, 2026)));
		expect(rows).toHaveLength(1);
	});
});
