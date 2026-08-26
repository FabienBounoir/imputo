import { and, eq, gte, lte, sql } from 'drizzle-orm';
import {
	db,
	workspace,
	ssp,
	ticket,
	timeEntry,
	sspAnnualProd,
	sspAnnualRaeOverride
} from '$lib/server/db';
import { num, round, tnf } from './calc';
import { addMonths, monthBounds, toISODate } from '$lib/utils/date';

/**
 * Suivi annuel — reproduit l'onglet « Suivi Annuel » du modèle de suivi financier : pour chaque
 * code SSP, 4 indicateurs mensuels sur une fenêtre glissante de 12 mois (RAE, Conso, Prod, TNF).
 * Contrairement à la clôture mensuelle (monthlyClosing.ts), c'est un suivi au niveau SSP, pas par
 * collaborateur — volontairement hors périmètre (backlog de l'Excel).
 */

const WINDOW_SIZE = 12;

function currentMonthISO(): string {
	return `${toISODate(new Date()).slice(0, 7)}-01`;
}

export type AnnualTrackingMonthCell = {
	month: string; // 'YYYY-MM-01'
	rae: number | null; // null = rien de calculable pour ce mois
	raeEditable: boolean; // month <= curseur
	raeOverridden: boolean;
	conso: number; // dérivé des imputations, jamais null
	prod: number | null; // null = jamais saisi
	prodEditable: boolean; // month === curseur, strictement
	tnf: number | null; // null tant que prod est null
};

export type AnnualTrackingSspRow = {
	sspId: string;
	code: string;
	label: string;
	archived: boolean;
	budgetDays: number | null;
	cells: AnnualTrackingMonthCell[]; // 12, du plus ancien au plus récent, se termine au curseur
	totalConso: number; // depuis l'origine (pas juste la fenêtre de 12 mois), agrégé en BDD
	totalProd: number; // idem
	totalTnf: number; // totalConso - totalProd
};

export type AnnualTrackingView = {
	cursorMonth: string;
	windowMonths: string[];
	rows: AnnualTrackingSspRow[];
};

/**
 * Calcule la chaîne RAE(M) = RAE(M-1) - Prod(M), amorcée par `seedBudgetDays` au premier mois de
 * `months`. `months` est la chaîne complète depuis l'origine des données, PAS la fenêtre affichée :
 * amorcer au début de la fenêtre ferait remonter le RAE d'autant à chaque mois qui en sort.
 * Un override casse la chaîne : tout mois postérieur repart de sa valeur. `null` =
 * rien d'affichable (pas de budget connu et pas encore d'override) — jamais 0 par défaut, un 0
 * affiché doit vouloir dire « RAE épuisé », pas « pas de données ».
 */
export function computeRaeChain(
	seedBudgetDays: number | null,
	months: string[],
	overridesByMonth: Record<string, number>,
	prodByMonth: Record<string, number>
): Record<string, number | null> {
	const result: Record<string, number | null> = {};
	let prev: number | null = null;
	for (let i = 0; i < months.length; i++) {
		const month = months[i];
		const override = overridesByMonth[month];
		if (override !== undefined) {
			result[month] = round(override);
		} else if (prev !== null) {
			result[month] = round(prev - (prodByMonth[month] ?? 0));
		} else if (i === 0 && seedBudgetDays !== null) {
			result[month] = round(seedBudgetDays - (prodByMonth[month] ?? 0));
		} else {
			result[month] = null;
		}
		prev = result[month];
	}
	return result;
}

/**
 * Conso par (ssp, mois) sur une plage, en une seule requête groupée par mois — évite le N+1 d'un
 * appel à getConsoBySsp par mois. Pas de jointure `user` : on somme direct tous les collaborateurs.
 */
export async function getConsoBySspByMonth(
	workspaceId: string,
	range: { from: string; to: string }
): Promise<{ sspId: string | null; month: string; total: number }[]> {
	const rows = await db
		.select({
			sspId: ticket.sspId,
			month: sql<string>`date_trunc('month', ${timeEntry.day})::date`,
			total: sql<string>`sum(${timeEntry.amount})`
		})
		.from(timeEntry)
		.innerJoin(ticket, eq(timeEntry.ticketId, ticket.id))
		.where(
			and(eq(timeEntry.workspaceId, workspaceId), gte(timeEntry.day, range.from), lte(timeEntry.day, range.to))
		)
		.groupBy(ticket.sspId, sql`date_trunc('month', ${timeEntry.day})`);
	return rows.map((r) => ({ ...r, total: round(num(r.total)) }));
}

/**
 * Totaux Conso/Prod « depuis l'origine » par SSP (pas seulement la fenêtre de 12 mois affichée) —
 * agrégés en BDD (deux `SUM ... GROUP BY sspId`) pour ne pas rapatrier tout l'historique des
 * imputations côté serveur applicatif juste pour une somme.
 */
async function getAllTimeTotalsBySsp(
	workspaceId: string,
	upToMonth: string
): Promise<{ consoBySsp: Map<string, number>; prodBySsp: Map<string, number> }> {
	const to = monthBounds(upToMonth).end;
	const [consoRows, prodRows] = await Promise.all([
		db
			.select({ sspId: ticket.sspId, total: sql<string>`sum(${timeEntry.amount})` })
			.from(timeEntry)
			.innerJoin(ticket, eq(timeEntry.ticketId, ticket.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), lte(timeEntry.day, to)))
			.groupBy(ticket.sspId),
		db
			.select({ sspId: sspAnnualProd.sspId, total: sql<string>`sum(${sspAnnualProd.value})` })
			.from(sspAnnualProd)
			.where(and(eq(sspAnnualProd.workspaceId, workspaceId), lte(sspAnnualProd.month, upToMonth)))
			.groupBy(sspAnnualProd.sspId)
	]);
	return {
		consoBySsp: new Map(
			consoRows.filter((r): r is { sspId: string; total: string } => r.sspId !== null).map((r) => [r.sspId, round(num(r.total))])
		),
		prodBySsp: new Map(prodRows.map((r) => [r.sspId, round(num(r.total))]))
	};
}

/** Vue complète du Suivi annuel : curseur, fenêtre de 12 mois, grille RAE/Conso/Prod/TNF par SSP. */
export async function getAnnualTrackingView(workspaceId: string): Promise<AnnualTrackingView> {
	const [ws] = await db
		.select({ annualTrackingMonth: workspace.annualTrackingMonth })
		.from(workspace)
		.where(eq(workspace.id, workspaceId));
	const cursorMonth = ws?.annualTrackingMonth ?? currentMonthISO();
	const windowMonths: string[] = [];
	for (let i = WINDOW_SIZE - 1; i >= 0; i--) windowMonths.push(addMonths(cursorMonth, -i));

	const from = windowMonths[0];
	const to = monthBounds(cursorMonth).end;

	const [allSsps, consoRows, prodRows, overrideRows, allTimeTotals] = await Promise.all([
		db
			.select({ id: ssp.id, code: ssp.code, label: ssp.label, budgetDays: ssp.budgetDays, archivedAt: ssp.archivedAt })
			.from(ssp)
			.where(eq(ssp.workspaceId, workspaceId))
			.orderBy(ssp.code),
		getConsoBySspByMonth(workspaceId, { from, to }),
		// Prod et overrides depuis l'origine (pas seulement la fenêtre) : la chaîne RAE est récursive,
		// l'amorcer au début de la fenêtre rendrait au RAE la prod de chaque mois qui en sort.
		db
			.select({ sspId: sspAnnualProd.sspId, month: sspAnnualProd.month, value: sspAnnualProd.value })
			.from(sspAnnualProd)
			.where(and(eq(sspAnnualProd.workspaceId, workspaceId), lte(sspAnnualProd.month, cursorMonth))),
		db
			.select({ sspId: sspAnnualRaeOverride.sspId, month: sspAnnualRaeOverride.month, value: sspAnnualRaeOverride.value })
			.from(sspAnnualRaeOverride)
			.where(and(eq(sspAnnualRaeOverride.workspaceId, workspaceId), lte(sspAnnualRaeOverride.month, cursorMonth))),
		getAllTimeTotalsBySsp(workspaceId, cursorMonth)
	]);

	// Colonnes retenues : un SSP avec du budget, de la conso ou de la prod dans la fenêtre — un
	// référentiel de 30 codes dont la moitié est hors sujet cette année n'a rien à faire à l'écran.
	// prod/overrides sont filtrés sur la fenêtre ici : ils sont chargés depuis l'origine pour la
	// chaîne RAE, mais une prod de 2019 seule ne justifie pas d'afficher une ligne vide.
	const activeSspIds = new Set<string>([
		...consoRows.map((r) => r.sspId).filter((v): v is string => v !== null),
		...prodRows.filter((r) => r.month >= from).map((r) => r.sspId),
		...overrideRows.filter((r) => r.month >= from).map((r) => r.sspId),
		...allSsps.filter((s) => s.archivedAt === null && s.budgetDays !== null).map((s) => s.id)
	]);

	// Chaîne RAE : de l'origine des données jusqu'au curseur ; seuls les 12 derniers mois sont lus.
	const earliest = [...prodRows, ...overrideRows].reduce((min, r) => (r.month < min ? r.month : min), from);
	const chainMonths: string[] = [];
	for (let m = earliest; m <= cursorMonth; m = addMonths(m, 1)) chainMonths.push(m);

	const consoBySsp = new Map<string, Record<string, number>>();
	for (const r of consoRows) {
		if (r.sspId === null) continue;
		const rec = consoBySsp.get(r.sspId) ?? {};
		rec[r.month] = round((rec[r.month] ?? 0) + r.total);
		consoBySsp.set(r.sspId, rec);
	}
	const prodBySsp = new Map<string, Record<string, number>>();
	for (const r of prodRows) {
		const rec = prodBySsp.get(r.sspId) ?? {};
		rec[r.month] = num(r.value);
		prodBySsp.set(r.sspId, rec);
	}
	const overridesBySsp = new Map<string, Record<string, number>>();
	for (const r of overrideRows) {
		const rec = overridesBySsp.get(r.sspId) ?? {};
		rec[r.month] = num(r.value);
		overridesBySsp.set(r.sspId, rec);
	}

	const rows: AnnualTrackingSspRow[] = allSsps
		.filter((s) => activeSspIds.has(s.id))
		.map((s) => {
			const conso = consoBySsp.get(s.id) ?? {};
			const prod = prodBySsp.get(s.id) ?? {};
			const overrides = overridesBySsp.get(s.id) ?? {};
			const rae = computeRaeChain(s.budgetDays === null ? null : num(s.budgetDays), chainMonths, overrides, prod);
			const cells: AnnualTrackingMonthCell[] = windowMonths.map((month) => {
				const p = month in prod ? prod[month] : null;
				const c = conso[month] ?? 0;
				return {
					month,
					rae: rae[month],
					raeEditable: month <= cursorMonth,
					raeOverridden: overrides[month] !== undefined,
					conso: c,
					prod: p,
					prodEditable: month === cursorMonth,
					tnf: p === null ? null : tnf(c, p)
				};
			});
			const totalConso = allTimeTotals.consoBySsp.get(s.id) ?? 0;
			const totalProd = allTimeTotals.prodBySsp.get(s.id) ?? 0;
			return {
				sspId: s.id,
				code: s.code,
				label: s.label,
				archived: s.archivedAt !== null,
				budgetDays: s.budgetDays === null ? null : num(s.budgetDays),
				cells,
				totalConso,
				totalProd,
				totalTnf: round(totalConso - totalProd)
			};
		});

	return { cursorMonth, windowMonths, rows };
}

async function assertSspBelongsToWorkspace(workspaceId: string, sspId: string) {
	const [row] = await db.select({ id: ssp.id }).from(ssp).where(and(eq(ssp.id, sspId), eq(ssp.workspaceId, workspaceId)));
	if (!row) throw new Error('Code SSP introuvable dans cet espace.');
}

async function resolveCursorMonth(workspaceId: string): Promise<string> {
	const [ws] = await db.select({ annualTrackingMonth: workspace.annualTrackingMonth }).from(workspace).where(eq(workspace.id, workspaceId));
	return ws?.annualTrackingMonth ?? currentMonthISO();
}

/** La prod n'est modifiable que sur le mois curseur. `value = null` efface la saisie (retour à « jamais saisi »). */
export async function setProd(workspaceId: string, sspId: string, month: string, value: number | null): Promise<void> {
	await assertSspBelongsToWorkspace(workspaceId, sspId);
	const cursorMonth = await resolveCursorMonth(workspaceId);
	if (month !== cursorMonth) throw new Error('La production n\'est modifiable que sur le mois en cours.');
	if (value !== null && !Number.isFinite(value)) throw new Error('Valeur invalide.');
	if (value === null) {
		await db.delete(sspAnnualProd).where(and(eq(sspAnnualProd.sspId, sspId), eq(sspAnnualProd.month, month)));
		return;
	}
	await db
		.insert(sspAnnualProd)
		.values({ workspaceId, sspId, month, value: String(value) })
		.onConflictDoUpdate({
			target: [sspAnnualProd.sspId, sspAnnualProd.month],
			set: { value: String(value), updatedAt: new Date() }
		});
}

/** Le RAE n'est modifiable que sur un mois passé ou le mois curseur — jamais un mois futur. */
export async function setRaeOverride(workspaceId: string, sspId: string, month: string, value: number | null): Promise<void> {
	await assertSspBelongsToWorkspace(workspaceId, sspId);
	const cursorMonth = await resolveCursorMonth(workspaceId);
	if (month > cursorMonth) throw new Error('Le RAE ne peut être modifié que sur un mois passé ou le mois en cours.');
	if (value !== null && !Number.isFinite(value)) throw new Error('Valeur invalide.');
	if (value === null) {
		await db.delete(sspAnnualRaeOverride).where(and(eq(sspAnnualRaeOverride.sspId, sspId), eq(sspAnnualRaeOverride.month, month)));
		return;
	}
	await db
		.insert(sspAnnualRaeOverride)
		.values({ workspaceId, sspId, month, value: String(value) })
		.onConflictDoUpdate({
			target: [sspAnnualRaeOverride.sspId, sspAnnualRaeOverride.month],
			set: { value: String(value), updatedAt: new Date() }
		});
}

/** Avance le curseur du Suivi annuel d'un mois (amorce sur le mois calendaire courant si jamais initialisé). */
export async function advanceCursor(workspaceId: string): Promise<string> {
	const cursorMonth = await resolveCursorMonth(workspaceId);
	const next = addMonths(cursorMonth, 1);
	await db.update(workspace).set({ annualTrackingMonth: next }).where(eq(workspace.id, workspaceId));
	return next;
}
