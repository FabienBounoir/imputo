import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, ssp, timeEntry, workspace } from '$lib/server/db';
import { makeWorkspace, loadPerimeterCtx } from './test-helpers';
import { createPerimeter, setPerimeterArchived } from './perimeters';
import { createTicket, updateTicketField } from './tickets';
import { getClosingView } from './monthlyClosing';
import { getAnnualTrackingView } from './sspAnnualTracking';

/**
 * Lot « groupement par périmètre » de la clôture mensuelle et du suivi annuel. Ces deux écrans ne
 * sont volontairement PAS découpés par périmètre (le prévu du mois est une donnée personne, la
 * chaîne RAE est portée par le code SSP) : le périmètre n'y ajoute que du groupement. Ces tests
 * vérifient donc que le rattachement remonte bien, et que les cas limites retombent sur « Partagé ».
 */
async function fixture(tag: string) {
	const ws = await makeWorkspace(`grp-${tag}`);
	const p = await createPerimeter(ws.workspaceId, `Périmètre ${tag}`, '#abcdef', false);
	const [avec, sans] = await db
		.insert(ssp)
		.values([
			{ workspaceId: ws.workspaceId, code: `A-${tag}`, label: 'Avec', budgetDays: '10', perimeterId: p },
			{ workspaceId: ws.workspaceId, code: `S-${tag}`, label: 'Sans', budgetDays: '20', perimeterId: null }
		])
		.returning({ id: ssp.id });

	const t1 = await createTicket(ws.workspaceId, { key: `G1-${tag}`, title: 'x', sspId: avec.id, perimeterId: p });
	const t2 = await createTicket(ws.workspaceId, { key: `G2-${tag}`, title: 'x', sspId: sans.id });
	for (const [ticketId, amount] of [
		[t1.id, '2'],
		[t2.id, '3']
	] as const) {
		await db.insert(timeEntry).values({
			workspaceId: ws.workspaceId,
			userId: ws.userId,
			targetType: 'TICKET',
			ticketId,
			day: '2026-04-02',
			amount
		});
	}
	return { ws, p, avec: avec.id, sans: sans.id, t1 };
}

describe('clôture mensuelle — groupement par périmètre', () => {
	it('chaque colonne SSP porte son périmètre, « Partagé » pour les codes sans rattachement', async () => {
		const f = await fixture('clo');
		const view = await getClosingView(f.ws.workspaceId, '2026-04');
		const avec = view.ssps.find((s) => s.id === f.avec)!;
		const sans = view.ssps.find((s) => s.id === f.sans)!;

		expect(avec.perimeterId).toBe(f.p);
		expect(avec.perimeterName).toMatch(/^Périmètre/);
		expect(avec.perimeterColor).toBe('#abcdef');
		expect(sans.perimeterId).toBeNull();
		expect(sans.perimeterName).toBeNull();
	});

	it('un code rattaché à un périmètre archivé retombe en « Partagé » plutôt que de disparaître', async () => {
		const f = await fixture('clo-arch');
		// Le périmètre doit être vidé de ses tickets avant archivage (cf. setPerimeterArchived).
		const dp = await loadPerimeterCtx(f.ws.workspaceId, f.ws.userId, 'ADMIN');
		const autre = await createPerimeter(f.ws.workspaceId, 'Accueil', null, false);
		await updateTicketField(f.ws.workspaceId, f.t1.id, 'perimeterId', autre, dp, f.ws.userId);
		await setPerimeterArchived(f.ws.workspaceId, f.p, true);

		const view = await getClosingView(f.ws.workspaceId, '2026-04');
		expect(view.ssps.find((s) => s.id === f.avec)!.perimeterId).toBeNull();
	});
});

describe('suivi annuel — groupement par périmètre', () => {
	it('chaque ligne SSP porte son périmètre, sans toucher aux indicateurs', async () => {
		const f = await fixture('ann');
		await db
			.update(workspace)
			.set({ annualTrackingMonth: '2026-04-01' })
			.where(eq(workspace.id, f.ws.workspaceId));

		const view = await getAnnualTrackingView(f.ws.workspaceId);
		const avec = view.rows.find((r) => r.sspId === f.avec)!;
		const sans = view.rows.find((r) => r.sspId === f.sans)!;

		expect(avec.perimeterId).toBe(f.p);
		expect(sans.perimeterId).toBeNull();
		// Le groupement ne doit rien changer aux chiffres : conso lue depuis les imputations.
		expect(avec.totalConso).toBe(2);
		expect(sans.totalConso).toBe(3);
		expect(avec.budgetDays).toBe(10);
	});
});
