import { describe, it, expect, beforeAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, ssp, ticket, timeEntry, monthlyClosing, membership } from '$lib/server/db';
import { makeWorkspace, addMember } from './test-helpers';
import {
	getClosingView,
	openClosing,
	setComplement,
	setPlanned,
	setWorkdays,
	addClosingSsp,
	removeClosingSsp,
	integrate
} from './monthlyClosing';

// Mois volontairement dans le passé et loin de tout : les tests ne doivent pas dépendre du
// calendrier courant, et janvier 2024 n'a qu'un férié (le 1er, un lundi) → 22 jours ouvrés.
const MONTH = '2024-01';
const JAN_2024_WORKDAYS = 22;

let ws: Awaited<ReturnType<typeof makeWorkspace>>;
let sspA: string;
let sspB: string;
let ticketA: string;

beforeAll(async () => {
	ws = await makeWorkspace('closing');
	const inserted = await db
		.insert(ssp)
		.values([
			{ workspaceId: ws.workspaceId, code: '8364BEB5354', label: 'Site Internet' },
			{ workspaceId: ws.workspaceId, code: '123DBS34842', label: 'Application' }
		])
		.returning();
	sspA = inserted.find((s) => s.code === '8364BEB5354')!.id;
	sspB = inserted.find((s) => s.code === '123DBS34842')!.id;
	const [t] = await db
		.insert(ticket)
		.values({ workspaceId: ws.workspaceId, key: 'CLO-1', title: 'Ticket clôture', sspId: sspA })
		.returning({ id: ticket.id });
	ticketA = t.id;
});

async function impute(day: string, amount: number) {
	await db.insert(timeEntry).values({
		workspaceId: ws.workspaceId,
		userId: ws.userId,
		targetType: 'TICKET',
		ticketId: ticketA,
		day,
		amount: String(amount)
	});
}

describe('monthlyClosing', () => {
	it('sans passe ouverte : la vue existe et le prévu part des jours ouvrés', async () => {
		const view = await getClosingView(ws.workspaceId, MONTH);
		expect(view.closing).toBeNull();
		// Rien d'imputé encore : aucune colonne retenue, les deux codes restent proposés à l'ajout.
		expect(view.ssps).toHaveLength(0);
		expect(view.availableSsps).toHaveLength(2);
		// Le détail du calcul est exposé pour être contestable : 23 jours de semaine en janvier 2024,
		// moins le 1er (lundi férié).
		expect(view.workdays.weekdays).toBe(23);
		expect(view.workdays.holidays).toEqual(['2024-01-01']);
		expect(view.workdays.computed).toBe(JAN_2024_WORKDAYS);
		expect(view.workdays.override).toBeNull();
		const owner = view.members.find((m) => m.userId === ws.userId)!;
		expect(owner.absenceDays).toBe(0);
		expect(owner.planned).toBe(JAN_2024_WORKDAYS);
		// Rien d'imputé encore : tout le prévu reste à ventiler.
		expect(owner.toAllocate).toBe(JAN_2024_WORKDAYS);
	});

	it('remonte la conso réelle par code SSP', async () => {
		await impute('2024-01-15', 3);
		await impute('2024-01-16', 2);
		// Hors du mois : ne doit pas être comptée.
		await impute('2024-02-01', 7);
		const view = await getClosingView(ws.workspaceId, MONTH);
		const owner = view.members.find((m) => m.userId === ws.userId)!;
		expect(owner.conso[sspA]).toBe(5);
		expect(owner.consoTotal).toBe(5);
		expect(owner.toAllocate).toBe(JAN_2024_WORKDAYS - 5);
	});

	it('openClosing est idempotent tant que la passe est ouverte', async () => {
		const a = await openClosing(ws.workspaceId, MONTH);
		const b = await openClosing(ws.workspaceId, MONTH);
		expect(b).toBe(a);
		const view = await getClosingView(ws.workspaceId, MONTH);
		expect(view.closing?.seq).toBe(1);
		expect(view.closing?.status).toBe('DRAFT');
	});

	it('les compléments réduisent le reste à ventiler, un complément à 0 efface la ligne', async () => {
		const id = await openClosing(ws.workspaceId, MONTH);
		await setComplement(ws.workspaceId, id, ws.userId, sspB, 4);
		let owner = (await getClosingView(ws.workspaceId, MONTH)).members.find(
			(m) => m.userId === ws.userId
		)!;
		expect(owner.complement[sspB]).toBe(4);
		expect(owner.toAllocate).toBe(JAN_2024_WORKDAYS - 5 - 4);

		await setComplement(ws.workspaceId, id, ws.userId, sspB, 0);
		owner = (await getClosingView(ws.workspaceId, MONTH)).members.find((m) => m.userId === ws.userId)!;
		expect(owner.complement[sspB]).toBeUndefined();
		expect(owner.toAllocate).toBe(JAN_2024_WORKDAYS - 5);
	});

	it('le prévu est écrasable, et se vide pour revenir au calcul', async () => {
		const id = await openClosing(ws.workspaceId, MONTH);
		await setPlanned(ws.workspaceId, id, ws.userId, 10);
		let owner = (await getClosingView(ws.workspaceId, MONTH)).members.find(
			(m) => m.userId === ws.userId
		)!;
		expect(owner.plannedOverride).toBe(10);
		expect(owner.planned).toBe(10);
		expect(owner.toAllocate).toBe(5); // 10 − 5 de conso

		await setPlanned(ws.workspaceId, id, ws.userId, null);
		owner = (await getClosingView(ws.workspaceId, MONTH)).members.find((m) => m.userId === ws.userId)!;
		expect(owner.plannedOverride).toBeNull();
		expect(owner.planned).toBe(JAN_2024_WORKDAYS);
	});

	it("l'intégration fige la conso : une imputation postérieure creuse l'écart sans bouger la photo", async () => {
		const id = await openClosing(ws.workspaceId, MONTH);
		await setComplement(ws.workspaceId, id, ws.userId, sspB, 2);
		await integrate(ws.workspaceId, id, ws.userId);

		let view = await getClosingView(ws.workspaceId, MONTH);
		let owner = view.members.find((m) => m.userId === ws.userId)!;
		expect(view.closing?.status).toBe('INTEGRATED');
		expect(owner.conso[sspA]).toBe(5);
		expect(owner.consoLive?.[sspA]).toBe(5);

		// Quelqu'un saisit la fin de mois après le report GPS.
		await impute('2024-01-31', 1.5);
		view = await getClosingView(ws.workspaceId, MONTH);
		owner = view.members.find((m) => m.userId === ws.userId)!;
		expect(owner.conso[sspA]).toBe(5); // photo inchangée
		expect(owner.consoLive?.[sspA]).toBe(6.5);
	});

	it('une passe intégrée refuse toute saisie', async () => {
		const view = await getClosingView(ws.workspaceId, MONTH);
		await expect(
			setComplement(ws.workspaceId, view.closing!.id, ws.userId, sspB, 1)
		).rejects.toThrow(/intégrée/);
		await expect(setPlanned(ws.workspaceId, view.closing!.id, ws.userId, 1)).rejects.toThrow(
			/intégrée/
		);
	});

	it('une nouvelle passe recopie les compléments et repart des consos à jour', async () => {
		await openClosing(ws.workspaceId, MONTH);
		const view = await getClosingView(ws.workspaceId, MONTH);
		expect(view.closing?.seq).toBe(2);
		expect(view.closing?.status).toBe('DRAFT');
		expect(view.passes).toHaveLength(2);
		const owner = view.members.find((m) => m.userId === ws.userId)!;
		expect(owner.complement[sspB]).toBe(2); // recopié de la passe 1
		expect(owner.conso[sspA]).toBe(6.5); // conso vivante, pas la photo

		// La passe 1 reste consultable, toujours figée sur ses 5 jours.
		const pass1 = await getClosingView(ws.workspaceId, MONTH, 1);
		expect(pass1.members.find((m) => m.userId === ws.userId)!.conso[sspA]).toBe(5);
	});

	it('une clôture d\'un autre espace est inaccessible', async () => {
		const other = await makeWorkspace('closing-other');
		const view = await getClosingView(ws.workspaceId, MONTH);
		await expect(
			setComplement(other.workspaceId, view.closing!.id, ws.userId, sspB, 1)
		).rejects.toThrow(/introuvable/i);
		// Et l'autre espace ne voit rien de nos passes.
		expect((await getClosingView(other.workspaceId, MONTH)).passes).toHaveLength(0);
	});

	it('deux brouillons sur le même mois sont impossibles', async () => {
		await expect(
			db
				.insert(monthlyClosing)
				.values({ workspaceId: ws.workspaceId, month: `${MONTH}-01`, seq: 99 })
		).rejects.toThrow();
		// La contrainte porte bien sur le statut, pas sur le mois : une seq de plus reste possible
		// une fois la précédente intégrée (couvert par le test « nouvelle passe » ci-dessus).
		const passes = await db
			.select()
			.from(monthlyClosing)
			.where(eq(monthlyClosing.workspaceId, ws.workspaceId));
		expect(passes.filter((p) => p.status === 'DRAFT')).toHaveLength(1);
	});

	// Un férié effectivement travaillé, ou un pont d'entreprise que le calendrier légal ignore :
	// l'ajustement porte sur le mois, donc sur tout le monde d'un coup.
	it("ajuster les jours ouvrés du mois change le prévu de tout le monde", async () => {
		const m = '2024-03';
		const id = await openClosing(ws.workspaceId, m);
		const base = (await getClosingView(ws.workspaceId, m)).workdays.computed;

		await setWorkdays(ws.workspaceId, id, base + 1);
		let view = await getClosingView(ws.workspaceId, m);
		expect(view.workdays.override).toBe(base + 1);
		expect(view.workdays.effective).toBe(base + 1);
		expect(view.workdays.computed).toBe(base); // le calcul d'origine reste lisible
		expect(view.members.every((x) => x.planned === base + 1)).toBe(true);

		// Un prévu individuel prime toujours sur la base du mois.
		await setPlanned(ws.workspaceId, id, ws.userId, 3);
		view = await getClosingView(ws.workspaceId, m);
		expect(view.members.find((x) => x.userId === ws.userId)!.planned).toBe(3);

		await setWorkdays(ws.workspaceId, id, null);
		expect((await getClosingView(ws.workspaceId, m)).workdays.effective).toBe(base);
	});

	it('une nouvelle passe reprend l\'ajustement des jours ouvrés', async () => {
		const m = '2024-04';
		const id = await openClosing(ws.workspaceId, m);
		await setWorkdays(ws.workspaceId, id, 15);
		await integrate(ws.workspaceId, id, ws.userId);
		await openClosing(ws.workspaceId, m);
		const view = await getClosingView(ws.workspaceId, m);
		expect(view.closing?.seq).toBe(2);
		expect(view.workdays.override).toBe(15);
	});

	// Par défaut la clôture ne montre que les codes réellement imputés : sur un référentiel fourni,
	// afficher tout le monde rendrait la table illisible.
	it("ne retient que les codes imputés, et accepte d'en ajouter un pour rattraper", async () => {
		const m = '2024-06';
		const id = await openClosing(ws.workspaceId, m);
		// Rien d'imputé sur juin : aucune colonne, les deux codes sont proposés à l'ajout.
		let view = await getClosingView(ws.workspaceId, m);
		expect(view.ssps).toHaveLength(0);
		expect(view.availableSsps.map((s) => s.id).sort()).toEqual([sspA, sspB].sort());

		await addClosingSsp(ws.workspaceId, id, sspB);
		view = await getClosingView(ws.workspaceId, m);
		expect(view.ssps.map((s) => s.id)).toEqual([sspB]);
		expect(view.availableSsps.map((s) => s.id)).toEqual([sspA]);

		// Ajouter deux fois ne duplique pas la colonne.
		await addClosingSsp(ws.workspaceId, id, sspB);
		expect((await getClosingView(ws.workspaceId, m)).ssps).toHaveLength(1);

		// Une colonne vide se retire ; une colonne complétée non.
		await setComplement(ws.workspaceId, id, ws.userId, sspB, 2);
		await expect(removeClosingSsp(ws.workspaceId, id, sspB)).rejects.toThrow(/complément/);
		await setComplement(ws.workspaceId, id, ws.userId, sspB, 0);
		await removeClosingSsp(ws.workspaceId, id, sspB);
		expect((await getClosingView(ws.workspaceId, m)).ssps).toHaveLength(0);
	});

	it('un code imputé sur le mois est une colonne, et ne peut pas être retiré', async () => {
		// Janvier porte des imputations sur sspA (cf. tests plus haut) : sa colonne est imposée.
		const view = await getClosingView(ws.workspaceId, MONTH);
		expect(view.ssps.map((s) => s.id)).toContain(sspA);
		expect(view.availableSsps.map((s) => s.id)).not.toContain(sspA);
		const draft = view.passes.find((p) => p.status === 'DRAFT')!;
		await expect(removeClosingSsp(ws.workspaceId, draft.id, sspA)).rejects.toThrow(/imputations/);
	});

	// Trois régressions trouvées en revue, toutes silencieuses : elles retiraient des jours de
	// l'écran sans rien retirer de la base, donc le total reporté dans GPS devenait faux.
	it('un code archivé après saisie garde sa colonne, et sort des codes proposés', async () => {
		const w = await makeWorkspace('arch');
		const [s] = await db
			.insert(ssp)
			.values({ workspaceId: w.workspaceId, code: 'AR-1', label: 'Archivable' })
			.returning();
		const id = await openClosing(w.workspaceId, '2024-09');
		await setComplement(w.workspaceId, id, w.userId, s.id, 4);
		await db.update(ssp).set({ archivedAt: new Date() }).where(eq(ssp.id, s.id));

		const view = await getClosingView(w.workspaceId, '2024-09');
		expect(view.ssps.map((x) => x.id)).toEqual([s.id]);
		expect(view.ssps[0].archived).toBe(true);
		expect(view.members[0].complement[s.id]).toBe(4);
		// Archivé : plus proposé à l'ajout ailleurs.
		expect(view.availableSsps).toHaveLength(0);
	});

	it('un membre désactivé garde sa ligne tant qu\'il porte des jours', async () => {
		const w = await makeWorkspace('inact');
		const gone = await addMember(w.workspaceId, 'USER', 'partant');
		const [s] = await db
			.insert(ssp)
			.values({ workspaceId: w.workspaceId, code: 'DE-1', label: 'Code' })
			.returning();
		const [t] = await db
			.insert(ticket)
			.values({ workspaceId: w.workspaceId, key: 'RV-1', title: 't', sspId: s.id })
			.returning({ id: ticket.id });
		await db.insert(timeEntry).values({
			workspaceId: w.workspaceId,
			userId: gone.userId,
			targetType: 'TICKET',
			ticketId: t.id,
			day: '2024-09-10',
			amount: '6'
		});
		await db
			.update(membership)
			.set({ active: false })
			.where(and(eq(membership.workspaceId, w.workspaceId), eq(membership.userId, gone.userId)));

		const view = await getClosingView(w.workspaceId, '2024-09');
		const row = view.members.find((m) => m.userId === gone.userId);
		expect(row?.inactive).toBe(true);
		expect(row?.consoTotal).toBe(6);
		// Un inactif SANS jour ne pollue pas la table.
		const idle = await addMember(w.workspaceId, 'USER', 'idle');
		await db
			.update(membership)
			.set({ active: false })
			.where(and(eq(membership.workspaceId, w.workspaceId), eq(membership.userId, idle.userId)));
		expect(
			(await getClosingView(w.workspaceId, '2024-09')).members.find((m) => m.userId === idle.userId)
		).toBeUndefined();
	});

	it("refuse un collaborateur ou un code SSP d'un autre espace", async () => {
		const a = await makeWorkspace('scope-a');
		const b = await makeWorkspace('scope-b');
		const [sspB] = await db
			.insert(ssp)
			.values({ workspaceId: b.workspaceId, code: 'B-1', label: 'Chez B' })
			.returning();
		const [sspA] = await db
			.insert(ssp)
			.values({ workspaceId: a.workspaceId, code: 'A-1', label: 'Chez A' })
			.returning();
		const id = await openClosing(a.workspaceId, '2024-10');
		await expect(setComplement(a.workspaceId, id, b.userId, sspA.id, 9)).rejects.toThrow(
			/Collaborateur introuvable/
		);
		await expect(setComplement(a.workspaceId, id, a.userId, sspB.id, 9)).rejects.toThrow(
			/Code SSP introuvable/
		);
		await expect(setPlanned(a.workspaceId, id, b.userId, 5)).rejects.toThrow(
			/Collaborateur introuvable/
		);
	});
});
