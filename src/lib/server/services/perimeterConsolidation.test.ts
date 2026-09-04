import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, ssp, timeEntry, workspace } from '$lib/server/db';
import { makeWorkspace, addMember, loadPerimeterCtx } from './test-helpers';
import { createPerimeter, setPerimeterMemberRole } from './perimeters';
import { createTicket, updateTicketField } from './tickets';
import { getPerimeterConsolidation } from './perimeterConsolidation';

/** Espace de test : deux périmètres applicatifs, un transverse, des tickets et des codes SSP. */
async function makeConsolidationFixture(tag: string) {
	const ws = await makeWorkspace(`cons-${tag}`);
	const dp = await loadPerimeterCtx(ws.workspaceId, ws.userId, 'ADMIN');
	const mobile = await createPerimeter(ws.workspaceId, `Mobile ${tag}`, '#111111', false);
	const web = await createPerimeter(ws.workspaceId, `Web ${tag}`, '#222222', false);
	const transverse = await createPerimeter(ws.workspaceId, `Chantiers ${tag}`, null, true);

	// Codes SSP : un par périmètre applicatif, un volontairement partagé (sans périmètre).
	const [sspMobile, sspWeb, sspShared] = await db
		.insert(ssp)
		.values([
			{ workspaceId: ws.workspaceId, code: `M-${tag}`, label: 'Mobile', budgetDays: '100', perimeterId: mobile },
			{ workspaceId: ws.workspaceId, code: `W-${tag}`, label: 'Web', budgetDays: '200', perimeterId: web },
			{ workspaceId: ws.workspaceId, code: `S-${tag}`, label: 'Partagé', budgetDays: '50', perimeterId: null }
		])
		.returning({ id: ssp.id });

	const tMobile = await createTicket(ws.workspaceId, {
		key: `CM-${tag}`,
		title: 'Mobile',
		perimeterId: mobile,
		estimationReal: '10',
		raeReal: '4',
		enveloppeTotale: '12',
		sspId: sspMobile.id
	});
	const tWeb = await createTicket(ws.workspaceId, {
		key: `CW-${tag}`,
		title: 'Web',
		perimeterId: web,
		estimationReal: '20',
		raeReal: '5',
		enveloppeTotale: '30',
		sspId: sspWeb.id
	});
	// Ticket transverse portant le code SSP partagé : c'est le cas qui piège une consolidation
	// qui ventilerait la conso par le code plutôt que par le périmètre du ticket.
	const tTransverse = await createTicket(ws.workspaceId, {
		key: `CT-${tag}`,
		title: 'Chantier',
		perimeterId: transverse,
		estimationReal: '6',
		raeReal: '6',
		sspId: sspShared.id
	});

	const impute = (ticketId: string, day: string, amount: string) =>
		db.insert(timeEntry).values({
			workspaceId: ws.workspaceId,
			userId: ws.userId,
			targetType: 'TICKET' as const,
			ticketId,
			day,
			amount
		});
	await impute(tMobile.id, '2026-03-02', '3');
	await impute(tWeb.id, '2026-03-03', '7');
	await impute(tTransverse.id, '2026-03-04', '2');

	return { ws, dp, mobile, web, transverse, tMobile, tWeb, tTransverse };
}

describe('consolidation par périmètre', () => {
	it('ventile charges et budget ticket par périmètre, transverse compris', async () => {
		const f = await makeConsolidationFixture('base');
		const { rows, total } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp);

		const mobile = rows.find((r) => r.perimeterId === f.mobile)!;
		expect(mobile.estTotal).toBe(10);
		expect(mobile.raeTotal).toBe(4);
		expect(mobile.consumedTotal).toBe(3);
		expect(mobile.ticketCount).toBe(1);
		// TNF budget = (RAE + conso) − enveloppe = (4 + 3) − 12 = −5
		expect(mobile.ecartVsBudgetTotal).toBe(-5);
		expect(mobile.enveloppeTotal).toBe(12);

		const web = rows.find((r) => r.perimeterId === f.web)!;
		expect(web.consumedTotal).toBe(7);
		expect(web.ecartVsBudgetTotal).toBe(-18); // (5 + 7) − 30

		expect(total.estTotal).toBe(36);
		expect(total.consumedTotal).toBe(12);
		expect(total.ticketCount).toBe(3);
	});

	// LE point de conception : la charge se ventile par le ticket, jamais par le code SSP. Le ticket
	// transverse porte le code « Partagé » ; sa conso doit rester sur le périmètre transverse.
	it('ventile la conso par le périmètre du TICKET, pas par celui du code SSP', async () => {
		const f = await makeConsolidationFixture('path');
		const { rows } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp);

		const transverse = rows.find((r) => r.perimeterId === f.transverse)!;
		expect(transverse.consumedTotal).toBe(2);
		expect(transverse.ticketCount).toBe(1);

		// La ligne « Partagé » ne porte QUE du budget (le code SSP sans périmètre), aucune charge.
		const shared = rows.find((r) => r.perimeterId === null)!;
		expect(shared.consumedTotal).toBe(0);
		expect(shared.ticketCount).toBe(0);
		expect(shared.budgetTotal).toBe(50);
		expect(shared.sspCount).toBe(1);
	});

	it('agrège le budget SSP sur le périmètre du code', async () => {
		const f = await makeConsolidationFixture('budget');
		const { rows } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp);
		expect(rows.find((r) => r.perimeterId === f.mobile)!.budgetTotal).toBe(100);
		expect(rows.find((r) => r.perimeterId === f.web)!.budgetTotal).toBe(200);
		expect(rows.find((r) => r.perimeterId === f.transverse)!.budgetTotal).toBe(0);
	});

	it('exclut les transverses sur demande', async () => {
		const f = await makeConsolidationFixture('excl');
		const { rows } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp, {
			includeTransverse: false
		});
		expect(rows.map((r) => r.perimeterId)).not.toContain(f.transverse);
		expect(rows.map((r) => r.perimeterId)).toContain(f.mobile);
	});

	it('restreint aux périmètres demandés', async () => {
		const f = await makeConsolidationFixture('pick');
		const { rows, total } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp, {
			perimeterIds: [f.web]
		});
		expect(rows).toHaveLength(1);
		expect(total.consumedTotal).toBe(7);
	});

	it("un CP ne voit l'argent que de ses périmètres, et le total refuse de mentir", async () => {
		const f = await makeConsolidationFixture('cp');
		const { userId } = await addMember(f.ws.workspaceId, 'USER', 'cons-cp');
		await setPerimeterMemberRole(f.ws.workspaceId, f.mobile, userId, 'CP');
		const ctx = await loadPerimeterCtx(f.ws.workspaceId, userId, 'USER');

		const { rows, total, partial } = await getPerimeterConsolidation(f.ws.workspaceId, false, ctx);
		const mobile = rows.find((r) => r.perimeterId === f.mobile)!;
		const web = rows.find((r) => r.perimeterId === f.web)!;

		expect(mobile.lead).toBe(true);
		expect(mobile.enveloppeTotal).toBe(12);
		expect(mobile.budgetTotal).toBe(100);

		// Les charges restent visibles (elles ne sont pas confidentielles) ; l'argent, non.
		expect(web.lead).toBe(false);
		expect(web.consumedTotal).toBe(7);
		expect(web.enveloppeTotal).toBeNull();
		expect(web.budgetTotal).toBeNull();
		expect(web.ecartVsBudgetTotal).toBeNull();

		// Un total d'argent partiel serait lu comme un total complet : on n'en affiche aucun.
		expect(total.budgetTotal).toBeNull();
		expect(total.enveloppeTotal).toBeNull();
		expect(total.consumedTotal).toBe(12); // les charges, elles, se totalisent
		expect(partial).toBe(true);
	});

	it('un périmètre archivé sort de la consolidation, ses codes SSP retombent en « Partagé »', async () => {
		const f = await makeConsolidationFixture('arch');
		// Déplacer le ticket avant d'archiver : l'archivage est refusé tant qu'il en reste (cf. service).
		await updateTicketField(f.ws.workspaceId, f.tWeb.id, 'perimeterId', f.mobile, f.dp, f.ws.userId);
		const { setPerimeterArchived } = await import('./perimeters');
		await setPerimeterArchived(f.ws.workspaceId, f.web, true);

		const { rows } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp);
		expect(rows.map((r) => r.perimeterId)).not.toContain(f.web);
		// Le budget du code SSP du périmètre archivé reste lisible sous « Partagé ».
		expect(rows.find((r) => r.perimeterId === null)!.budgetTotal).toBe(250);
	});

	it('le curseur du Suivi annuel ne fait pas disparaître le budget consolidé', async () => {
		const f = await makeConsolidationFixture('cursor');
		await db
			.update(workspace)
			.set({ annualTrackingMonth: '2026-03-01' })
			.where(eq(workspace.id, f.ws.workspaceId));
		const { rows } = await getPerimeterConsolidation(f.ws.workspaceId, false, f.dp);
		expect(rows.find((r) => r.perimeterId === f.mobile)!.budgetTotal).toBe(100);
	});
});
