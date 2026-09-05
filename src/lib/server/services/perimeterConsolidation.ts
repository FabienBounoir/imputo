import { eq } from 'drizzle-orm';
import { db, workspace, ssp, perimeter } from '$lib/server/db';
import { listTickets } from './tickets';
import { listActivePerimeters, canLeadArg, leadScopeArg, type LeadScopeArg } from './perimeters';
import { getAnnualTrackingView } from './sspAnnualTracking';
import { avancement, ecartVsBudget, ecartVsEstime, ppr, round } from './calc';

/**
 * Consolidation par périmètre — l'écran du DP : « voir chaque périmètre, et consolider les charges
 * et l'économie sur plusieurs d'entre eux ».
 *
 * Deux versants, et surtout DEUX CHEMINS DE RATTACHEMENT DIFFÉRENTS, qu'il ne faut jamais
 * confondre (cf. schema.ts, ssp.perimeterId) :
 *
 *  - CHARGES et budget porté par le ticket → `ticket.perimeterId`. Exact en toutes circonstances.
 *  - BUDGET/PROD portés par le code SSP    → `ssp.perimeterId`. `budgetDays` n'a pas d'autre
 *    porteur possible ; un code partagé entre périmètres tombe dans une ligne « Partagé » plutôt
 *    que d'être réparti au hasard.
 *
 * Passer la conso par le SSP donnerait des chiffres faux dès qu'un code est partagé — c'est le
 * piège que cette séparation existe pour éviter.
 *
 * Portée temporelle : état courant, pas de filtre de période. La partie économie (budget alloué,
 * prod, TNF) est cumulative par construction — la borner à une période la rendrait incomparable à
 * elle-même, et la juxtaposer à des charges bornées mettrait deux notions différentes côte à côte
 * sur la même ligne. Le détail mois par mois vit déjà dans le Suivi annuel.
 */

export type PerimeterConsolidationRow = {
	/** `null` = ligne « Partagé » : codes SSP rattachés à aucun périmètre (versant économie seul). */
	perimeterId: string | null;
	name: string;
	color: string | null;
	transverse: boolean;
	/** L'appelant pilote-t-il ce périmètre ? Sinon les colonnes budget sont à `null`. */
	lead: boolean;

	// ---- Charges (via ticket.perimeterId) ----
	estTotal: number;
	consumedTotal: number;
	raeTotal: number;
	ecartVsEstimeTotal: number;
	avancement: number;
	ticketCount: number;

	// ---- Économie portée par les tickets (via ticket.perimeterId), lead only ----
	enveloppeTotal: number | null;
	pprTotal: number | null;
	/** TNF budget agrégé — `(RAE + conso) − enveloppe`, sur les seuls tickets qui ont une enveloppe. */
	ecartVsBudgetTotal: number | null;

	// ---- Économie portée par les codes SSP (via ssp.perimeterId), lead only ----
	budgetTotal: number | null;
	prodTotal: number | null;
	/** conso − prod, cumulé depuis l'origine (même définition que le Suivi annuel). */
	tnfTotal: number | null;
	sspCount: number;
};

export type PerimeterConsolidation = {
	rows: PerimeterConsolidationRow[];
	/** Somme des lignes affichées. Les colonnes budget y sont `null` si une seule ligne les masque —
	 *  un total partiel présenté comme un total serait pire que pas de total du tout. */
	total: Omit<PerimeterConsolidationRow, 'perimeterId' | 'name' | 'color' | 'transverse' | 'lead'>;
	/** true = des périmètres existent mais sont hors de la portée de l'appelant (CP, pas DP). */
	partial: boolean;
};

export type ConsolidationOptions = {
	/** Restreint l'affichage à ces périmètres. Vide/absent = tous ceux visibles. */
	perimeterIds?: string[];
	/** Inclure les périmètres transverses (défaut : oui). */
	includeTransverse?: boolean;
};

const EMPTY_TOTALS = {
	estTotal: 0,
	consumedTotal: 0,
	raeTotal: 0,
	ecartVsEstimeTotal: 0,
	avancement: 0,
	ticketCount: 0,
	enveloppeTotal: 0,
	pprTotal: 0,
	ecartVsBudgetTotal: 0,
	budgetTotal: 0,
	prodTotal: 0,
	tnfTotal: 0,
	sspCount: 0
};

export async function getPerimeterConsolidation(
	workspaceId: string,
	testPhase: boolean,
	lead: LeadScopeArg,
	opts: ConsolidationOptions = {}
): Promise<PerimeterConsolidation> {
	const { includeTransverse = true } = opts;
	const [ws] = await db
		.select({ pprRatio: workspace.pprRatio })
		.from(workspace)
		.where(eq(workspace.id, workspaceId));

	const [perimeters, tickets, annual] = await Promise.all([
		listActivePerimeters(workspaceId),
		// `lead` redacte déjà enveloppeTotale/estimationPrev ticket par ticket : les colonnes budget
		// ci-dessous héritent de cette rédaction sans avoir à la refaire.
		listTickets(workspaceId, testPhase, lead),
		// Réutilise la chaîne RAE/prod/TNF du Suivi annuel plutôt que de la recalculer : c'est la même
		// définition du TNF, et elle est déjà testée.
		getAnnualTrackingView(workspaceId)
	]);

	const scope = leadScopeArg(lead);
	const isLead = (id: string) => canLeadArg(lead, id);

	const rows = new Map<string | null, PerimeterConsolidationRow>();
	const blank = (id: string | null, name: string, color: string | null, transverse: boolean) => ({
		perimeterId: id,
		name,
		color,
		transverse,
		lead: id === null ? scope === 'ALL' : isLead(id),
		...EMPTY_TOTALS,
		enveloppeTotal: 0,
		pprTotal: 0,
		ecartVsBudgetTotal: 0,
		budgetTotal: 0,
		prodTotal: 0,
		tnfTotal: 0
	});
	for (const p of perimeters) rows.set(p.id, blank(p.id, p.name, p.color, p.transverse));

	// ---- Charges + économie ticket ----
	for (const t of tickets) {
		const row = rows.get(t.perimeterId);
		if (!row) continue; // périmètre archivé : ses tickets ne pèsent plus dans la consolidation
		const est = round(t.estimationReal + (testPhase ? t.estimationTest : 0));
		const rae = round(t.raeReal + (testPhase ? t.raeTest : 0));
		row.estTotal = round(row.estTotal + est);
		row.raeTotal = round(row.raeTotal + rae);
		row.consumedTotal = round(row.consumedTotal + t.consumed);
		row.ticketCount += 1;
		row.pprTotal = round((row.pprTotal ?? 0) + ppr(t.estimationReal, ws?.pprRatio ?? '0.90'));
		if (t.enveloppeTotale !== null) {
			row.enveloppeTotal = round((row.enveloppeTotal ?? 0) + t.enveloppeTotale);
			row.ecartVsBudgetTotal = round(
				(row.ecartVsBudgetTotal ?? 0) + ecartVsBudget(t.raeReal, t.consumed, t.enveloppeTotale)
			);
		}
	}

	// ---- Économie SSP ----
	// getAnnualTrackingView ne porte pas le périmètre du code : on le relit ici, une requête.
	const sspPerimeters = await listSspPerimeters(workspaceId);
	for (const s of annual.rows) {
		const perimeterId = sspPerimeters.get(s.sspId) ?? null;
		let row = rows.get(perimeterId);
		if (!row) {
			// Code sans périmètre (ou rattaché à un périmètre archivé) : ligne « Partagé », créée à la
			// demande pour ne pas afficher une ligne vide dans les espaces qui n'en ont pas.
			row = blank(null, 'Partagé', null, false);
			rows.set(null, row);
		}
		row.sspCount += 1;
		row.budgetTotal = round((row.budgetTotal ?? 0) + (s.budgetDays ?? 0));
		row.prodTotal = round((row.prodTotal ?? 0) + s.totalProd);
		row.tnfTotal = round((row.tnfTotal ?? 0) + s.totalTnf);
	}

	// ---- Finalisation, filtrage, rédaction ----
	const allVisible = [...rows.values()].filter((r) => r.lead || scope === 'ALL');
	const partial = rows.size > allVisible.length;

	let list = [...rows.values()];
	if (!includeTransverse) list = list.filter((r) => !r.transverse);
	if (opts.perimeterIds?.length) list = list.filter((r) => r.perimeterId && opts.perimeterIds!.includes(r.perimeterId));

	for (const r of list) {
		r.ecartVsEstimeTotal = ecartVsEstime(r.raeTotal, r.consumedTotal, r.estTotal);
		r.avancement = avancement(r.estTotal, r.raeTotal, r.consumedTotal);
		if (!r.lead) {
			// Même règle que les tickets : les chiffres d'argent d'un périmètre qu'on ne pilote pas
			// sont invisibles, pas seulement en lecture seule.
			r.enveloppeTotal = null;
			r.pprTotal = null;
			r.ecartVsBudgetTotal = null;
			r.budgetTotal = null;
			r.prodTotal = null;
			r.tnfTotal = null;
		}
	}

	const total = { ...EMPTY_TOTALS } as PerimeterConsolidation['total'];
	const moneyVisibleEverywhere = list.every((r) => r.lead);
	for (const r of list) {
		total.estTotal = round(total.estTotal + r.estTotal);
		total.raeTotal = round(total.raeTotal + r.raeTotal);
		total.consumedTotal = round(total.consumedTotal + r.consumedTotal);
		total.ticketCount += r.ticketCount;
		total.sspCount += r.sspCount;
		if (moneyVisibleEverywhere) {
			total.enveloppeTotal = round((total.enveloppeTotal ?? 0) + (r.enveloppeTotal ?? 0));
			total.pprTotal = round((total.pprTotal ?? 0) + (r.pprTotal ?? 0));
			total.ecartVsBudgetTotal = round((total.ecartVsBudgetTotal ?? 0) + (r.ecartVsBudgetTotal ?? 0));
			total.budgetTotal = round((total.budgetTotal ?? 0) + (r.budgetTotal ?? 0));
			total.prodTotal = round((total.prodTotal ?? 0) + (r.prodTotal ?? 0));
			total.tnfTotal = round((total.tnfTotal ?? 0) + (r.tnfTotal ?? 0));
		}
	}
	if (!moneyVisibleEverywhere) {
		total.enveloppeTotal = null;
		total.pprTotal = null;
		total.ecartVsBudgetTotal = null;
		total.budgetTotal = null;
		total.prodTotal = null;
		total.tnfTotal = null;
	}
	total.ecartVsEstimeTotal = ecartVsEstime(total.raeTotal, total.consumedTotal, total.estTotal);
	total.avancement = avancement(total.estTotal, total.raeTotal, total.consumedTotal);

	// Périmètres applicatifs d'abord (ordre d'affichage), transverses ensuite, « Partagé » en dernier :
	// on lit une consolidation par application, le reste est du contexte.
	const order = new Map(perimeters.map((p, i) => [p.id, i]));
	list.sort((a, b) => {
		const rank = (r: PerimeterConsolidationRow) =>
			r.perimeterId === null ? 2 : r.transverse ? 1 : 0;
		return rank(a) - rank(b) || (order.get(a.perimeterId!) ?? 0) - (order.get(b.perimeterId!) ?? 0);
	});

	return { rows: list, total, partial };
}

/** Périmètre de chaque code SSP actif — `undefined` si le code n'en a pas (ligne « Partagé »). */
async function listSspPerimeters(workspaceId: string): Promise<Map<string, string | null>> {
	const rows = await db
		.select({ id: ssp.id, perimeterId: ssp.perimeterId, archivedAt: perimeter.archivedAt })
		.from(ssp)
		.leftJoin(perimeter, eq(ssp.perimeterId, perimeter.id))
		.where(eq(ssp.workspaceId, workspaceId));
	// Un code rattaché à un périmètre archivé retombe en « Partagé » plutôt que de disparaître :
	// son budget existe toujours, il doit rester lisible quelque part.
	return new Map(rows.map((r) => [r.id, r.archivedAt === null ? r.perimeterId : null]));
}
