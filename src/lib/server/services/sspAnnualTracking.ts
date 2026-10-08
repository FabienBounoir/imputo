import { and, eq, gte, lte, sql, inArray } from 'drizzle-orm';
import {
	db,
	workspace,
	ssp,
	ticket,
	timeEntry,
	sspAnnualProd,
	sspAnnualRaeOverride,
	monthlyClosing,
	monthlyClosingLine,
	user
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
	conso: number; // conso GPS : détail d'intégration (photo + complément) si intégré, sinon réel vivant
	consoIntegrated: boolean; // true = photo de la dernière clôture GPS intégrée sur ce mois, false = réel vivant
	consoIntegratedAt: Date | null; // date de cette intégration, null si consoIntegrated est false
	consoIntegratedBy: string | null; // qui a intégré, idem
	consoReal: number; // imputations réelles du mois, à date — jamais figé, sans complément
	prod: number | null; // null = jamais saisi
	prodEditable: boolean; // month === curseur, strictement
	tnf: number | null; // conso GPS - prod, null tant que prod est null
	tnfReal: number | null; // conso réelle - prod : l'écart budgétaire réel, idem
};

export type AnnualTrackingSspRow = {
	sspId: string;
	code: string;
	label: string;
	archived: boolean;
	budgetDays: number | null;
	cells: AnnualTrackingMonthCell[]; // 12, du plus ancien au plus récent, se termine au curseur
	// Cumuls depuis l'origine (pas juste la fenêtre de 12 mois). Les TNF ne somment que les mois
	// dont la prod est saisie, comme leurs cellules : de la conso sans prod en face (mois antérieurs
	// au suivi) n'est pas un dérapage. D'où totalTnf ≠ totalConso - totalProd dans ce cas.
	totalConso: number; // conso GPS
	totalConsoReal: number;
	totalProd: number;
	totalTnf: number; // Σ tnf des mois avec prod
	totalTnfReal: number; // Σ tnfReal des mois avec prod
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
	range: { from?: string; to: string } // from absent = depuis l'origine
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
			and(
				eq(timeEntry.workspaceId, workspaceId),
				range.from ? gte(timeEntry.day, range.from) : undefined,
				lte(timeEntry.day, range.to)
			)
		)
		.groupBy(ticket.sspId, sql`date_trunc('month', ${timeEntry.day})`);
	return rows.map((r) => ({ ...r, total: round(num(r.total)) }));
}

export type ClosingIntegrationInfo = { id: string; integratedAt: Date; integratedByName: string | null };

/**
 * Dernière passe INTEGRATED par mois, sur la plage demandée — un mois clôturé dans GPS doit
 * afficher cette photo plutôt que le réel vivant (cf. computeRaeChain : même logique de "figer"
 * que monthlyClosing.consoSnapshot). Bornes au format `YYYY-MM-01`, comme `monthlyClosing.month` ;
 * `from` absent = depuis l'origine (cumuls).
 * `integratedAt`/`integratedByName` remontent avec la photo pour que la cellule Conso explique sa
 * source au survol (par qui, quand) plutôt qu'une simple couleur.
 */
async function getLatestIntegratedClosingByMonth(
	workspaceId: string,
	range: { from?: string; to: string }
): Promise<Map<string, ClosingIntegrationInfo>> {
	const rows = await db
		.select({
			id: monthlyClosing.id,
			month: monthlyClosing.month,
			seq: monthlyClosing.seq,
			integratedAt: monthlyClosing.integratedAt,
			integratedByName: user.displayName
		})
		.from(monthlyClosing)
		.leftJoin(user, eq(monthlyClosing.integratedById, user.id))
		.where(
			and(
				eq(monthlyClosing.workspaceId, workspaceId),
				range.from ? gte(monthlyClosing.month, range.from) : undefined,
				lte(monthlyClosing.month, range.to),
				eq(monthlyClosing.status, 'INTEGRATED')
			)
		);
	const bestSeqByMonth = new Map<string, number>();
	const infoByMonth = new Map<string, ClosingIntegrationInfo>();
	for (const r of rows) {
		if ((bestSeqByMonth.get(r.month) ?? -1) < r.seq) {
			bestSeqByMonth.set(r.month, r.seq);
			infoByMonth.set(r.month, { id: r.id, integratedAt: r.integratedAt!, integratedByName: r.integratedByName });
		}
	}
	return infoByMonth;
}

/**
 * Conso par (ssp, mois) figée à l'intégration — détail d'intégration complet (consoSnapshot +
 * complement), pas la seule photo du réel. `complement` est le rattrapage manuel saisi pour
 * atteindre le prévu réellement reporté dans GPS (cf. monthlyClosingLine.complement) : l'ignorer
 * fait mentir la conso affichée ici vis-à-vis de ce que GPS a effectivement reçu.
 */
async function getSnapshotConsoBySspByMonth(
	closingIdByMonth: Map<string, string>
): Promise<{ sspId: string; month: string; total: number }[]> {
	if (closingIdByMonth.size === 0) return [];
	const monthByClosingId = new Map([...closingIdByMonth].map(([month, id]) => [id, month]));
	const rows = await db
		.select({
			closingId: monthlyClosingLine.closingId,
			sspId: monthlyClosingLine.sspId,
			total: sql<string>`sum(coalesce(${monthlyClosingLine.consoSnapshot}, 0) + ${monthlyClosingLine.complement})`
		})
		.from(monthlyClosingLine)
		.where(inArray(monthlyClosingLine.closingId, [...closingIdByMonth.values()]))
		.groupBy(monthlyClosingLine.closingId, monthlyClosingLine.sspId);
	return rows.map((r) => ({
		sspId: r.sspId,
		month: monthByClosingId.get(r.closingId)!,
		total: round(num(r.total))
	}));
}

/** (ssp, mois) → valeur, à partir de lignes plates. Les sspId null (tickets sans SSP) sont ignorés. */
function bySspByMonth(rows: { sspId: string | null; month: string; total: number }[]): Map<string, Record<string, number>> {
	const out = new Map<string, Record<string, number>>();
	for (const r of rows) {
		if (r.sspId === null) continue;
		const rec = out.get(r.sspId) ?? {};
		rec[r.month] = round((rec[r.month] ?? 0) + r.total);
		out.set(r.sspId, rec);
	}
	return out;
}

/**
 * Vue complète du Suivi annuel : curseur, fenêtre de 12 mois, grille RAE/Conso/Prod/TNF par SSP.
 * Deux lectures de la conso, côte à côte :
 *  - GPS : ce qui a été déclaré (détail d'intégration = photo + complément) pour un mois intégré,
 *    le réel vivant sinon. Face à la prod GPS, c'est la cohérence de la déclaration.
 *  - Réelle : les imputations du mois à date, sans complément ni photo. Face à la prod GPS, c'est
 *    l'écart budgétaire réel — juste seulement si tout le monde impute dans imputo (collabs
 *    « fictifs » compris), sinon il sous-estime la conso.
 */
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

	// Tout depuis l'origine, par (ssp, mois) : les cellules n'en lisent que la fenêtre, les cumuls
	// somment le tout — une seule source pour les deux, ils ne peuvent pas diverger.
	const [allSsps, liveRows, prodRows, overrideRows, integrationByMonth] = await Promise.all([
		db
			.select({ id: ssp.id, code: ssp.code, label: ssp.label, budgetDays: ssp.budgetDays, archivedAt: ssp.archivedAt })
			.from(ssp)
			.where(eq(ssp.workspaceId, workspaceId))
			.orderBy(ssp.code),
		getConsoBySspByMonth(workspaceId, { to }),
		// Prod et overrides depuis l'origine aussi : la chaîne RAE est récursive, l'amorcer au début
		// de la fenêtre rendrait au RAE la prod de chaque mois qui en sort.
		db
			.select({ sspId: sspAnnualProd.sspId, month: sspAnnualProd.month, value: sspAnnualProd.value })
			.from(sspAnnualProd)
			.where(and(eq(sspAnnualProd.workspaceId, workspaceId), lte(sspAnnualProd.month, cursorMonth))),
		db
			.select({ sspId: sspAnnualRaeOverride.sspId, month: sspAnnualRaeOverride.month, value: sspAnnualRaeOverride.value })
			.from(sspAnnualRaeOverride)
			.where(and(eq(sspAnnualRaeOverride.workspaceId, workspaceId), lte(sspAnnualRaeOverride.month, cursorMonth))),
		getLatestIntegratedClosingByMonth(workspaceId, { to: cursorMonth })
	]);
	// Conso GPS figée : un mois clôturé dans GPS affiche le détail de sa dernière intégration plutôt
	// que le réel vivant — sinon le TNF GPS dérive au fil des imputations tardives sur un mois déjà
	// reporté. Un mois jamais clôturé (typiquement le mois curseur) reste sur le réel.
	const snapshotRows = await getSnapshotConsoBySspByMonth(
		new Map([...integrationByMonth].map(([month, info]) => [month, info.id]))
	);

	// Colonnes retenues : un SSP avec du budget, de la conso ou de la prod dans la fenêtre — un
	// référentiel de 30 codes dont la moitié est hors sujet cette année n'a rien à faire à l'écran.
	// Tout est chargé depuis l'origine, d'où le filtre sur la fenêtre : une prod de 2019 seule ne
	// justifie pas d'afficher une ligne vide.
	const activeSspIds = new Set<string>([
		...liveRows.filter((r) => r.month >= from).map((r) => r.sspId).filter((v): v is string => v !== null),
		...snapshotRows.filter((r) => r.month >= from).map((r) => r.sspId),
		...prodRows.filter((r) => r.month >= from).map((r) => r.sspId),
		...overrideRows.filter((r) => r.month >= from).map((r) => r.sspId),
		...allSsps.filter((s) => s.archivedAt === null && s.budgetDays !== null).map((s) => s.id)
	]);

	// Chaîne RAE : de l'origine des données jusqu'au curseur ; seuls les 12 derniers mois sont lus.
	const earliest = [...prodRows, ...overrideRows].reduce((min, r) => (r.month < min ? r.month : min), from);
	const chainMonths: string[] = [];
	for (let m = earliest; m <= cursorMonth; m = addMonths(m, 1)) chainMonths.push(m);

	const liveBySsp = bySspByMonth(liveRows);
	const snapshotBySsp = bySspByMonth(snapshotRows);
	const prodBySsp = bySspByMonth(prodRows.map((r) => ({ sspId: r.sspId, month: r.month, total: num(r.value) })));
	const overridesBySsp = bySspByMonth(overrideRows.map((r) => ({ sspId: r.sspId, month: r.month, total: num(r.value) })));

	const rows: AnnualTrackingSspRow[] = allSsps
		.filter((s) => activeSspIds.has(s.id))
		.map((s) => {
			const live = liveBySsp.get(s.id) ?? {};
			const snapshot = snapshotBySsp.get(s.id) ?? {};
			const prod = prodBySsp.get(s.id) ?? {};
			const overrides = overridesBySsp.get(s.id) ?? {};
			const rae = computeRaeChain(s.budgetDays === null ? null : num(s.budgetDays), chainMonths, overrides, prod);

			const monthFigures = (month: string) => {
				const integration = integrationByMonth.get(month) ?? null;
				const conso = integration ? (snapshot[month] ?? 0) : (live[month] ?? 0);
				const consoReal = live[month] ?? 0;
				const p = month in prod ? prod[month] : null;
				return {
					integration,
					conso,
					consoReal,
					prod: p,
					tnf: p === null ? null : tnf(conso, p),
					tnfReal: p === null ? null : tnf(consoReal, p)
				};
			};

			const cells: AnnualTrackingMonthCell[] = windowMonths.map((month) => {
				const f = monthFigures(month);
				return {
					month,
					rae: rae[month],
					raeEditable: month <= cursorMonth,
					raeOverridden: overrides[month] !== undefined,
					conso: f.conso,
					consoIntegrated: f.integration !== null,
					consoIntegratedAt: f.integration?.integratedAt ?? null,
					consoIntegratedBy: f.integration?.integratedByName ?? null,
					consoReal: f.consoReal,
					prod: f.prod,
					prodEditable: month === cursorMonth,
					tnf: f.tnf,
					tnfReal: f.tnfReal
				};
			});

			const historyMonths = new Set([...Object.keys(live), ...Object.keys(snapshot), ...Object.keys(prod)]);
			const totals = { conso: 0, consoReal: 0, prod: 0, tnf: 0, tnfReal: 0 };
			for (const month of historyMonths) {
				const f = monthFigures(month);
				totals.conso += f.conso;
				totals.consoReal += f.consoReal;
				totals.prod += f.prod ?? 0;
				totals.tnf += f.tnf ?? 0;
				totals.tnfReal += f.tnfReal ?? 0;
			}
			return {
				sspId: s.id,
				code: s.code,
				label: s.label,
				archived: s.archivedAt !== null,
				budgetDays: s.budgetDays === null ? null : num(s.budgetDays),
				cells,
				totalConso: round(totals.conso),
				totalConsoReal: round(totals.consoReal),
				totalProd: round(totals.prod),
				totalTnf: round(totals.tnf),
				totalTnfReal: round(totals.tnfReal)
			};
		});

	return { cursorMonth, windowMonths, rows };
}

/**
 * Totaux Prod/TNF d'un mois, tous SSP confondus — cartes « Produit (mois) » / « TNF (mois) » de la
 * Synthèse. Même source que les cellules du Suivi annuel (somme de leurs `prod`/`tnf` non nulles) :
 * seuls les SSP dont la prod du mois est saisie comptent, conso figée si le mois est intégré GPS.
 * `null` = aucune prod saisie ce mois-ci, pas 0 (« pas encore travaillé » ≠ « rien produit »).
 */
export async function getMonthProdTnf(
	workspaceId: string,
	month: string
): Promise<{ prod: number; tnf: number; sspCount: number } | null> {
	const prodRows = await db
		.select({ sspId: sspAnnualProd.sspId, value: sspAnnualProd.value })
		.from(sspAnnualProd)
		.where(and(eq(sspAnnualProd.workspaceId, workspaceId), eq(sspAnnualProd.month, month)));
	if (prodRows.length === 0) return null;

	const integration = (await getLatestIntegratedClosingByMonth(workspaceId, { from: month, to: month })).get(month);
	const consoRows = integration
		? await getSnapshotConsoBySspByMonth(new Map([[month, integration.id]]))
		: await getConsoBySspByMonth(workspaceId, { from: month, to: monthBounds(month).end });
	const consoBySsp = new Map<string, number>();
	for (const r of consoRows) {
		if (r.sspId !== null) consoBySsp.set(r.sspId, round((consoBySsp.get(r.sspId) ?? 0) + r.total));
	}

	let prod = 0;
	let tnfTotal = 0;
	for (const r of prodRows) {
		const p = num(r.value);
		prod += p;
		tnfTotal += tnf(consoBySsp.get(r.sspId) ?? 0, p);
	}
	return { prod: round(prod), tnf: round(tnfTotal), sspCount: prodRows.length };
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
