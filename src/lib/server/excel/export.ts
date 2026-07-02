import ExcelJS from 'exceljs';
import { and, eq, isNull, sql, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	db,
	ticket,
	state,
	user,
	sprint,
	project,
	category,
	activity,
	membership,
	timeEntry,
	workspace
} from '$lib/server/db';
import { parseFlags } from '$lib/server/services/tickets';
import { num, totalEstimation, totalRae, ecart, avancement, round } from '$lib/server/services/calc';
import { countWorkdays, parseISODate, addDays, dayNum, toISODate } from '$lib/utils/date';

/** Alias de la table sprint pour joindre séparément les versions sur un ticket. */
const versionTbl = alias(sprint, 'version');

const SEP_FILL = 'FFB7AE9B'; // gris/taupe (séparateur Synthèse US)
const OVER_RED = 'FFC2410C';
const SCALE_GREEN = 'FF16A34A';
const SCALE_AMBER = 'FFF59E0B';
const SCALE_RED = 'FFDC2626';
const GRID_LINE = 'FF94A3B8';

// --- Helpers couleur (purs) : dérivent tout le thème de l'accent du workspace. ---
const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Décompose un hex (#RRGGBB, RRGGBB ou FFRRGGBB) en [r, g, b]. */
function parseHex(hex: string): [number, number, number] {
	let h = hex.replace('#', '').trim();
	if (h.length === 8) h = h.slice(2); // retire l'alpha éventuel
	const n = parseInt(h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toArgb = (r: number, g: number, b: number) =>
	'FF' + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Convertit un hex en ARGB ExcelJS ('FFRRGGBB'). */
export function hexToArgb(hex: string): string {
	const [r, g, b] = parseHex(hex);
	return toArgb(r, g, b);
}
/** Choisit un texte clair ou foncé selon la luminance perçue du fond (contraste). */
export function pickInk(bgHex: string): string {
	const [r, g, b] = parseHex(bgHex);
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 140 ? 'FF1F2937' : 'FFFFFFFF';
}
/** Éclaircit vers le blanc (amount 0→1). Pour les fonds légers. */
function tintArgb(hex: string, amount: number): string {
	const [r, g, b] = parseHex(hex);
	return toArgb(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
/** Assombrit vers le noir (amount 0→1). Pour les bandeaux foncés. */
function shadeArgb(hex: string, amount: number): string {
	const [r, g, b] = parseHex(hex);
	return toArgb(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

type Theme = {
	header: string; // fond d'en-tête (= accent)
	ink: string; // texte sur en-tête
	memberHeader: string; // bandeau foncé (colonnes/lignes par-personne)
	memberInk: string;
	zebra: string; // lignes alternées
	totals: string; // ligne TOTAL
	section: string; // bandes de section (page de garde)
};
function buildTheme(accentHex: string): Theme {
	const memberHeader = shadeArgb(accentHex, 0.28);
	return {
		header: hexToArgb(accentHex),
		ink: pickInk(accentHex),
		memberHeader,
		memberInk: pickInk(memberHeader),
		zebra: tintArgb(accentHex, 0.93),
		totals: tintArgb(accentHex, 0.82),
		section: tintArgb(accentHex, 0.78)
	};
}

function styleHeader(row: ExcelJS.Row, theme: Theme) {
	row.font = { bold: true, color: { argb: theme.ink } };
	row.eachCell((c) => {
		c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.header } };
		c.alignment = { vertical: 'middle' };
	});
	row.height = 20;
}

/** En-tête accent + figé + autofiltre + zébrage des lignes de données. */
function finishDataSheet(
	sheet: ExcelJS.Worksheet,
	theme: Theme,
	opts: { xSplit?: number; stripe?: boolean } = {}
) {
	const { xSplit = 0, stripe = true } = opts;
	styleHeader(sheet.getRow(1), theme);
	sheet.views = [{ state: 'frozen', ySplit: 1, xSplit }];
	sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
	if (stripe) {
		for (let r = 2; r <= sheet.rowCount; r++) {
			if (r % 2 === 0)
				sheet.getRow(r).eachCell((c) => {
					c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.zebra } };
				});
		}
	}
}

/** Ajoute une ligne de totaux (gras + fond teinté + bordure haute). Après finishDataSheet. */
function addTotalsRow(
	sheet: ExcelJS.Worksheet,
	values: Record<string, string | number>,
	theme: Theme
) {
	const row = sheet.addRow(values);
	row.font = { bold: true };
	row.eachCell((c) => {
		c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.totals } };
		c.border = { top: { style: 'thin', color: { argb: GRID_LINE } } };
	});
	return row;
}

/** Mise en forme conditionnelle : barre de données sur une colonne (plage de lignes de données). */
function addDataBar(sheet: ExcelJS.Worksheet, colKey: string, firstRow: number, lastRow: number, argb: string) {
	if (lastRow < firstRow) return;
	const col = sheet.getColumn(colKey).letter;
	sheet.addConditionalFormatting({
		ref: `${col}${firstRow}:${col}${lastRow}`,
		rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb }, priority: 1 } as unknown as ExcelJS.ConditionalFormattingRule]
	});
}
/** Échelle 3 couleurs (min→mid→max) sur une colonne. */
function addColorScale(
	sheet: ExcelJS.Worksheet,
	colKey: string,
	firstRow: number,
	lastRow: number,
	colors: [string, string, string]
) {
	if (lastRow < firstRow) return;
	const col = sheet.getColumn(colKey).letter;
	sheet.addConditionalFormatting({
		ref: `${col}${firstRow}:${col}${lastRow}`,
		rules: [
			{
				type: 'colorScale',
				cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
				color: colors.map((argb) => ({ argb })),
				priority: 1
			} as ExcelJS.ConditionalFormattingRule
		]
	});
}

/** Construit le classeur Excel complet (multi-feuilles) pour un espace, borné sur une période. */
/** Clés de feuilles sélectionnables à l'export (ordre = ordre dans le classeur). */
export const SHEET_KEYS = [
	'synthese',
	'us',
	'projsprint',
	'activite',
	'imputation',
	'personne',
	'absences'
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export async function buildWorkbook(
	workspaceId: string,
	workspaceName: string,
	period: { from: string; to: string; sheets?: string[] }
): Promise<ArrayBuffer> {
	const { from, to } = period;
	// Feuilles retenues : liste valide non vide, sinon toutes.
	const selected = (period.sheets ?? []).filter((s): s is SheetKey =>
		SHEET_KEYS.includes(s as SheetKey)
	);
	const inPeriod = and(gte(timeEntry.day, from), lte(timeEntry.day, to));

	// --- Récupération des données (toutes scopées workspace) ---
	const [
		tickets,
		members,
		ticketUser,
		catUser,
		activityUser,
		states,
		dayEntries,
		wsRow
	] = await Promise.all([
		db
			.select({
				id: ticket.id,
				key: ticket.key,
				title: ticket.title,
				estimationReal: ticket.estimationReal,
				raeReal: ticket.raeReal,
				estimationTest: ticket.estimationTest,
				prepa: ticket.prepa,
				raeTest: ticket.raeTest,
				stateLabel: state.label,
				stateEmoji: state.emoji,
				assignee: user.displayName,
				projectName: project.name,
				sprintName: sprint.name,
				versionName: versionTbl.name,
				flags: ticket.flags
			})
			.from(ticket)
			.leftJoin(state, eq(ticket.stateId, state.id))
			.leftJoin(user, eq(ticket.assigneeId, user.id))
			.leftJoin(project, eq(ticket.projectId, project.id))
			.leftJoin(sprint, eq(ticket.sprintId, sprint.id))
			.leftJoin(versionTbl, eq(ticket.versionId, versionTbl.id))
			.where(and(eq(ticket.workspaceId, workspaceId), isNull(ticket.archivedAt))),
		db
			.select({ id: user.id, name: user.displayName, capacity: membership.capacityPerDay })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(and(eq(membership.workspaceId, workspaceId), eq(membership.active, true))),
		db
			.select({
				ticketId: timeEntry.ticketId,
				userId: timeEntry.userId,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.targetType, 'TICKET'), inPeriod))
			.groupBy(timeEntry.ticketId, timeEntry.userId),
		db
			.select({
				userId: timeEntry.userId,
				userName: user.displayName,
				label: category.label,
				kind: category.kind,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.innerJoin(category, eq(timeEntry.categoryId, category.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), eq(timeEntry.targetType, 'CATEGORY'), inPeriod))
			.groupBy(timeEntry.userId, user.displayName, category.label, category.kind),
		db
			.select({
				userId: timeEntry.userId,
				userName: user.displayName,
				label: sql<string>`coalesce(${activity.label}, 'Non précisé')`,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.leftJoin(activity, eq(timeEntry.activityId, activity.id))
			.innerJoin(user, eq(timeEntry.userId, user.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), inPeriod))
			.groupBy(timeEntry.userId, user.displayName, sql`coalesce(${activity.label}, 'Non précisé')`),
		db
			.select({ label: state.label, emoji: state.emoji, color: state.color })
			.from(state)
			.where(eq(state.workspaceId, workspaceId))
			.orderBy(state.sortOrder),
		// Imputations au jour (pour la grille jour-par-jour de la feuille "Par personne").
		db
			.select({
				userId: timeEntry.userId,
				day: timeEntry.day,
				targetType: timeEntry.targetType,
				ticketId: timeEntry.ticketId,
				categoryId: timeEntry.categoryId,
				catLabel: category.label,
				catKind: category.kind,
				total: sql<string>`sum(${timeEntry.amount})`
			})
			.from(timeEntry)
			.leftJoin(category, eq(timeEntry.categoryId, category.id))
			.where(and(eq(timeEntry.workspaceId, workspaceId), inPeriod))
			.groupBy(
				timeEntry.userId,
				timeEntry.day,
				timeEntry.targetType,
				timeEntry.ticketId,
				timeEntry.categoryId,
				category.label,
				category.kind
			),
		db
			.select({ accentColor: workspace.accentColor, testPhase: workspace.testPhase })
			.from(workspace)
			.where(eq(workspace.id, workspaceId))
			.limit(1)
	]);

	// Thème dérivé de l'accent de l'espace (fallback vert). Contraste texte auto.
	const theme = buildTheme(wsRow[0]?.accentColor ?? '#16A34A');
	// Phase Test activée ? Si non, les colonnes/totaux Test sont exclus de l'export.
	const testPhase = wsRow[0]?.testPhase ?? true;
	// Couleur d'état (clé = "emoji label") → hex, pour teinter les cellules "État".
	const stateColorByKey = new Map<string, string>();
	for (const st of states) {
		if (st.color) stateColorByKey.set(`${st.emoji ?? ''} ${st.label}`.trim(), st.color);
	}

	const memberName = new Map(members.map((m) => [m.id, m.name]));

	// consommé par ticket par user (période)
	const consumedByTicketUser = new Map<string, Map<string, number>>();
	for (const r of ticketUser) {
		if (!r.ticketId) continue;
		if (!consumedByTicketUser.has(r.ticketId)) consumedByTicketUser.set(r.ticketId, new Map());
		consumedByTicketUser.get(r.ticketId)!.set(r.userId, num(r.total));
	}
	const ticketConsumed = (id: string) => {
		const m = consumedByTicketUser.get(id);
		if (!m) return 0;
		let s = 0;
		for (const v of m.values()) s += v;
		return round(s);
	};

	// Les feuilles orientées "US" (Synthèse US, Par projet & sprint, KPI) sont bornées sur
	// la période : on ne garde que les tickets ayant du consommé sur [from, to]. Une période
	// sans imputation donne donc un export vide, comme attendu.
	const periodTickets = tickets.filter((t) => consumedByTicketUser.has(t.id));

	// --- Agrégats globaux + par projet/sprint + par personne×projet ---
	type Group = { name: string; tickets: number; est: number; rae: number; consumed: number };
	const projAgg = new Map<string, Group>();
	const sprintAgg = new Map<string, Group>();
	const bumpGroup = (map: Map<string, Group>, name: string, est: number, rae: number, consumed: number) => {
		const g = map.get(name) ?? { name, tickets: 0, est: 0, rae: 0, consumed: 0 };
		g.tickets += 1;
		g.est += est;
		g.rae += rae;
		g.consumed += consumed;
		map.set(name, g);
	};

	const projectNames = new Set<string>();
	const personProject = new Map<string, Map<string, number>>(); // userId → projectName → days
	const stateCount = new Map<string, number>();
	let estTotal = 0;
	let raeTotalSum = 0;
	let consumedTickets = 0;

	for (const t of periodTickets) {
		const est = totalEstimation(t.estimationReal, t.estimationTest, testPhase);
		const rae = totalRae(t.raeReal, t.raeTest, testPhase);
		const consumed = ticketConsumed(t.id);
		const projName = t.projectName ?? 'Sans projet';
		const sprName = t.sprintName ?? 'Sans sprint';
		projectNames.add(projName);
		estTotal += est;
		raeTotalSum += rae;
		consumedTickets += consumed;
		bumpGroup(projAgg, projName, est, rae, consumed);
		bumpGroup(sprintAgg, sprName, est, rae, consumed);
		const stKey = t.stateLabel ? `${t.stateEmoji ?? ''} ${t.stateLabel}`.trim() : 'Sans état';
		stateCount.set(stKey, (stateCount.get(stKey) ?? 0) + 1);
		const perUser = consumedByTicketUser.get(t.id);
		if (perUser) {
			for (const [uid, v] of perUser) {
				if (!personProject.has(uid)) personProject.set(uid, new Map());
				const pp = personProject.get(uid)!;
				pp.set(projName, round((pp.get(projName) ?? 0) + v));
			}
		}
	}
	estTotal = round(estTotal);
	raeTotalSum = round(raeTotalSum);
	consumedTickets = round(consumedTickets);

	// productif / non productif par personne (tickets = productif ; catégorie selon kind)
	const prodByName = new Map<string, number>();
	const nonProdByName = new Map<string, number>();
	for (const perUser of consumedByTicketUser.values())
		for (const [uid, v] of perUser) {
			const name = memberName.get(uid) ?? '—';
			prodByName.set(name, round((prodByName.get(name) ?? 0) + v));
		}
	let catProdTotal = 0;
	let catNonProdTotal = 0;
	for (const r of catUser) {
		const v = num(r.total);
		const map = r.kind === 'NON_PRODUCTIVE' ? nonProdByName : prodByName;
		map.set(r.userName, round((map.get(r.userName) ?? 0) + v));
		if (r.kind === 'NON_PRODUCTIVE') catNonProdTotal = round(catNonProdTotal + v);
		else catProdTotal = round(catProdTotal + v);
	}
	const productiveTotal = round(consumedTickets + catProdTotal);
	const nonProductiveTotal = round(catNonProdTotal);

	const workdays = countWorkdays(from, to);
	const projectList = [...projectNames].sort();

	const wb = new ExcelJS.Workbook();
	wb.creator = 'Imputo';
	wb.created = new Date();

	// ===== Feuille 0 — Page de garde / KPIs =====
	const s0 = wb.addWorksheet('Synthèse');
	s0.getColumn(1).width = 32;
	s0.getColumn(2).width = 24;

	// Bandeau titre (fond accent, texte contrasté, fusionné sur 2 colonnes).
	const title = s0.addRow([workspaceName || 'Espace']);
	s0.mergeCells(title.number, 1, title.number, 2);
	title.height = 34;
	title.getCell(1).font = { bold: true, size: 18, color: { argb: theme.ink } };
	title.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
	for (let c = 1; c <= 2; c++)
		title.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.header } };

	const meta = (label: string, value: string | number) => {
		const r = s0.addRow([label, value]);
		r.getCell(1).font = { color: { argb: 'FF64748B' } };
	};
	meta('Export généré le', new Date().toLocaleString('fr-FR'));
	meta('Période (consommé)', `${from} → ${to}`);
	meta('Jours ouvrés sur la période', workdays);
	s0.addRow([]);

	// Bande de section + en-tête KPI.
	const sectionBand = (text: string) => {
		const r = s0.addRow([text]);
		s0.mergeCells(r.number, 1, r.number, 2);
		r.getCell(1).font = { bold: true, size: 12, color: { argb: pickInk(theme.section) } };
		r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
		r.height = 22;
		for (let c = 1; c <= 2; c++)
			r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.section } };
		return r;
	};
	sectionBand('Indicateurs clés');
	const kpiRows: [string, number, string?][] = [
		['Tickets (avec conso période)', periodTickets.length],
		['Estimé total (j)', estTotal, '0.00'],
		['Consommé sur tickets (j)', consumedTickets, '0.00'],
		['RAE total (j)', raeTotalSum, '0.00'],
		['Avancement global', avancement(estTotal, raeTotalSum), '0%'],
		['Productif (j)', productiveTotal, '0.00'],
		['Non productif (j)', nonProductiveTotal, '0.00']
	];
	for (const [label, value, fmt] of kpiRows) {
		const row = s0.addRow([label, value]);
		row.getCell(1).font = { bold: true, color: { argb: 'FF475569' } };
		const vc = row.getCell(2);
		if (fmt) vc.numFmt = fmt;
		// Carte valeur teintée.
		vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tintArgb(theme.header, 0.9) } };
		vc.font = { bold: true };
		vc.alignment = { horizontal: 'right' };
	}
	s0.addRow([]);

	sectionBand('Tickets par état');
	for (const st of states) {
		const key = `${st.emoji ?? ''} ${st.label}`.trim();
		if (!stateCount.has(key)) continue;
		const row = s0.addRow([key, stateCount.get(key)!]);
		if (st.color) {
			row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tintArgb(st.color, 0.78) } };
			row.getCell(1).font = { color: { argb: pickInk(tintArgb(st.color, 0.78)) } };
		}
	}
	if (stateCount.has('Sans état')) s0.addRow(['Sans état', stateCount.get('Sans état')!]);

	// ===== Feuille 1 — Synthèse US =====
	const s1 = wb.addWorksheet('Synthèse US');
	// Colonnes liées à la phase Test : retirées si l'admin l'a désactivée.
	const TEST_COL_KEYS = ['et', 'pr', 'rt', 'cypress', 'docTech', 'prepaQualif'];
	const baseCols = [
		{ header: 'Clé', key: 'key', width: 14 },
		{ header: 'Titre', key: 'title', width: 42 },
		{ header: 'Projet', key: 'project', width: 16 },
		{ header: 'Sprint', key: 'sprint', width: 14 },
		{ header: 'Version', key: 'version', width: 14 },
		{ header: 'État', key: 'state', width: 22 },
		{ header: 'Dev (assigné)', key: 'assignee', width: 16 },
		{ header: 'Est. Réal', key: 'er', width: 10 },
		{ header: 'RAE Réal', key: 'rr', width: 10 },
		{ header: 'Est. Test', key: 'et', width: 10 },
		{ header: 'Prépa', key: 'pr', width: 9 },
		{ header: 'RAE Test', key: 'rt', width: 10 },
		{ header: 'Est. Totale', key: 'te', width: 11 },
		{ header: 'RAE Total', key: 'tr', width: 11 },
		{ header: 'Consommé', key: 'consumed', width: 11 },
		{ header: 'Écart', key: 'ecart', width: 9 },
		{ header: '% Avanc.', key: 'pct', width: 10 },
		{ header: 'Cypress', key: 'cypress', width: 10 },
		{ header: 'Doc tech.', key: 'docTech', width: 10 },
		{ header: 'Prépa qualif', key: 'prepaQualif', width: 12 }
	].filter((c) => testPhase || !TEST_COL_KEYS.includes(c.key));
	const sepCol = { header: '', key: '__sep', width: 3 };
	const memberCols = members.map((m) => ({ header: m.name, key: `u_${m.id}`, width: 13 }));
	s1.columns = [...baseCols, sepCol, ...memberCols];
	const sepIndex = baseCols.length + 1;
	const numKeys = ['er', 'rr', 'et', 'pr', 'rt', 'te', 'tr', 'consumed', 'ecart'].filter(
		(k) => testPhase || !TEST_COL_KEYS.includes(k)
	);
	for (const key of numKeys) s1.getColumn(key).numFmt = '0.00';
	s1.getColumn('pct').numFmt = '0%';

	let totEr = 0, totRr = 0, totEt = 0, totPr = 0, totRt = 0, totTe = 0, totTr = 0, totCons = 0;
	for (const t of periodTickets) {
		const totalEst = totalEstimation(t.estimationReal, t.estimationTest, testPhase);
		const rae = totalRae(t.raeReal, t.raeTest, testPhase);
		const perUser = consumedByTicketUser.get(t.id) ?? new Map();
		const consumed = ticketConsumed(t.id);
		const fl = parseFlags(t.flags);
		const rowData: Record<string, string | number> = {
			key: t.key,
			title: t.title,
			project: t.projectName ?? '',
			sprint: t.sprintName ?? '',
			version: t.versionName ?? '',
			state: t.stateLabel ? `${t.stateEmoji ?? ''} ${t.stateLabel}`.trim() : '',
			assignee: t.assignee ?? '',
			er: num(t.estimationReal),
			rr: num(t.raeReal),
			et: num(t.estimationTest),
			pr: num(t.prepa),
			rt: num(t.raeTest),
			te: totalEst,
			tr: rae,
			consumed,
			ecart: ecart(consumed, totalEst),
			pct: avancement(totalEst, rae),
			cypress: fl.cypress,
			docTech: fl.docTech,
			prepaQualif: fl.prepaQualif
		};
		for (const m of members) rowData[`u_${m.id}`] = perUser.get(m.id) ?? 0;
		const row = s1.addRow(rowData);
		if (totalEst > 0 && ecart(consumed, totalEst) > 0) row.getCell('ecart').font = { color: { argb: OVER_RED } };
		const stColor = stateColorByKey.get(String(rowData.state));
		if (stColor) {
			const bg = tintArgb(stColor, 0.78);
			row.getCell('state').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
			row.getCell('state').font = { color: { argb: pickInk(bg) } };
		}
		totEr += num(t.estimationReal); totRr += num(t.raeReal); totEt += num(t.estimationTest);
		totPr += num(t.prepa); totRt += num(t.raeTest); totTe += totalEst; totTr += rae; totCons += consumed;
	}
	styleHeader(s1.getRow(1), theme);
	s1.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
	s1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: baseCols.length } };
	// zébrage des lignes de données (avant la ligne TOTAL).
	for (let r = 2; r <= s1.rowCount; r++)
		if (r % 2 === 0)
			s1.getRow(r).eachCell((c) => {
				if (!c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.zebra } };
			});
	// séparateur + en-têtes par-personne
	for (let r = 1; r <= s1.rowCount; r++)
		s1.getRow(r).getCell(sepIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEP_FILL } };
	for (let c = sepIndex + 1; c <= s1.columnCount; c++) {
		const cell = s1.getRow(1).getCell(c);
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.memberHeader } };
		cell.font = { bold: true, color: { argb: theme.memberInk } };
		cell.alignment = { vertical: 'middle' };
	}
	// Barres de données (Consommé, % Avanc.) + échelle Écart, sur les lignes de données.
	const s1Last = 1 + periodTickets.length;
	addDataBar(s1, 'consumed', 2, s1Last, theme.header);
	addDataBar(s1, 'pct', 2, s1Last, theme.header);
	addColorScale(s1, 'ecart', 2, s1Last, [SCALE_GREEN, 'FFFFFFFF', SCALE_RED]);
	addTotalsRow(s1, {
		key: 'TOTAL', er: round(totEr), rr: round(totRr), et: round(totEt), pr: round(totPr),
		rt: round(totRt), te: round(totTe), tr: round(totTr), consumed: round(totCons),
		ecart: round(totCons - totTe), pct: avancement(round(totTe), round(totTr))
	}, theme);

	// ===== Feuille 2 — Synthèse par projet & sprint =====
	const s2 = wb.addWorksheet('Par projet & sprint');
	s2.columns = [
		{ header: 'Type', key: 'type', width: 10 },
		{ header: 'Nom', key: 'name', width: 26 },
		{ header: 'Tickets', key: 'tickets', width: 10 },
		{ header: 'Estimé', key: 'est', width: 11 },
		{ header: 'Consommé', key: 'consumed', width: 12 },
		{ header: 'RAE', key: 'rae', width: 10 },
		{ header: 'Écart', key: 'ecart', width: 10 },
		{ header: '% Avanc.', key: 'pct', width: 10 }
	];
	for (const key of ['est', 'consumed', 'rae', 'ecart']) s2.getColumn(key).numFmt = '0.00';
	s2.getColumn('pct').numFmt = '0%';
	const addGroupRows = (label: string, map: Map<string, Group>) => {
		for (const g of [...map.values()].sort((a, b) => b.est - a.est)) {
			const est = round(g.est), consumed = round(g.consumed), rae = round(g.rae);
			const row = s2.addRow({
				type: label, name: g.name, tickets: g.tickets, est, consumed, rae,
				ecart: round(consumed - est), pct: avancement(est, rae)
			});
			if (est > 0 && consumed - est > 0) row.getCell('ecart').font = { color: { argb: OVER_RED } };
		}
	};
	addGroupRows('Projet', projAgg);
	addGroupRows('Sprint', sprintAgg);
	finishDataSheet(s2, theme, { stripe: false });
	// Teintes distinctes par bloc (Projet vs Sprint) au lieu du zébrage.
	const projTint = tintArgb(theme.header, 0.9);
	const sprTint = 'FFF1F5F9';
	const projCount = projAgg.size;
	for (let r = 2; r <= s2.rowCount; r++) {
		const fill = r <= 1 + projCount ? projTint : sprTint;
		s2.getRow(r).eachCell((c) => {
			c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
		});
	}
	const s2Last = 1 + projAgg.size + sprintAgg.size;
	addDataBar(s2, 'consumed', 2, s2Last, theme.header);
	addDataBar(s2, 'pct', 2, s2Last, theme.header);
	addColorScale(s2, 'ecart', 2, s2Last, [SCALE_GREEN, 'FFFFFFFF', SCALE_RED]);

	// ===== Feuille 3 — Par activité =====
	const s3 = wb.addWorksheet('Par activité');
	const actByLabel = new Map<string, Map<string, number>>();
	for (const r of activityUser) {
		if (!actByLabel.has(r.label)) actByLabel.set(r.label, new Map());
		actByLabel.get(r.label)!.set(r.userId, round((actByLabel.get(r.label)!.get(r.userId) ?? 0) + num(r.total)));
	}
	s3.columns = [
		{ header: 'Activité', key: 'activity', width: 20 },
		{ header: 'Total', key: 'total', width: 10 },
		...members.map((m) => ({ header: m.name, key: `u_${m.id}`, width: 13 }))
	];
	s3.getColumn('total').numFmt = '0.00';
	for (const m of members) s3.getColumn(`u_${m.id}`).numFmt = '0.00';
	const actTotals = new Map<string, number>();
	let actGrand = 0;
	for (const [label, perUser] of [...actByLabel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		let total = 0;
		const rowData: Record<string, string | number> = { activity: label };
		for (const m of members) {
			const v = perUser.get(m.id) ?? 0;
			rowData[`u_${m.id}`] = v;
			total += v;
			actTotals.set(m.id, round((actTotals.get(m.id) ?? 0) + v));
		}
		rowData.total = round(total);
		actGrand += total;
		s3.addRow(rowData);
	}
	finishDataSheet(s3, theme, { xSplit: 1 });
	const actTotalRow: Record<string, string | number> = { activity: 'TOTAL', total: round(actGrand) };
	for (const m of members) actTotalRow[`u_${m.id}`] = round(actTotals.get(m.id) ?? 0);
	addTotalsRow(s3, actTotalRow, theme);

	// ===== Feuille 4 — Imputation détaillée (par personne × cible) =====
	const s4 = wb.addWorksheet('Imputation détaillée');
	s4.columns = [
		{ header: 'Personne', key: 'person', width: 18 },
		{ header: 'Type', key: 'type', width: 12 },
		{ header: 'Référence', key: 'ref', width: 16 },
		{ header: 'Libellé', key: 'label', width: 42 },
		{ header: 'Jours consommés', key: 'days', width: 16 }
	];
	s4.getColumn('days').numFmt = '0.00';
	const ticketByIdName = new Map(tickets.map((t) => [t.id, { key: t.key, title: t.title }]));
	for (const [tid, perUser] of consumedByTicketUser) {
		const info = ticketByIdName.get(tid);
		for (const [uid, total] of perUser)
			s4.addRow({
				person: memberName.get(uid) ?? '—', type: 'Ticket',
				ref: info?.key ?? '', label: info?.title ?? '', days: round(total)
			});
	}
	for (const r of catUser)
		s4.addRow({
			person: r.userName, type: r.kind === 'NON_PRODUCTIVE' ? 'Absence/Hors' : 'Catégorie',
			ref: '', label: r.label, days: round(num(r.total))
		});
	finishDataSheet(s4, theme);

	// ===== Feuille 5 — Synthèse par personne (enrichie) =====
	const s5 = wb.addWorksheet('Par personne');
	s5.columns = [
		{ header: 'Personne', key: 'person', width: 20 },
		{ header: 'Jours ouvrés', key: 'workdays', width: 12 },
		{ header: 'Capacité/j', key: 'cap', width: 10 },
		{ header: 'Capacité période', key: 'capPeriod', width: 15 },
		{ header: 'Productif', key: 'prod', width: 11 },
		{ header: 'Non productif', key: 'nonprod', width: 14 },
		{ header: 'Total', key: 'total', width: 10 },
		{ header: "Taux d'occupation", key: 'occ', width: 16 },
		...projectList.map((p) => ({ header: p, key: `p_${p}`, width: 14 }))
	];
	for (const key of ['cap', 'capPeriod', 'prod', 'nonprod', 'total']) s5.getColumn(key).numFmt = '0.00';
	s5.getColumn('occ').numFmt = '0%';
	for (const p of projectList) s5.getColumn(`p_${p}`).numFmt = '0.00';
	for (const m of members) {
		const prod = round(prodByName.get(m.name) ?? 0);
		const nonprod = round(nonProdByName.get(m.name) ?? 0);
		const total = round(prod + nonprod);
		const capNum = num(m.capacity);
		const capPeriod = round(workdays * capNum);
		const pp = personProject.get(m.id);
		const rowData: Record<string, string | number> = {
			person: m.name, workdays, cap: capNum, capPeriod, prod, nonprod, total,
			occ: capPeriod > 0 ? total / capPeriod : 0
		};
		for (const p of projectList) rowData[`p_${p}`] = pp?.get(p) ?? 0;
		const row = s5.addRow(rowData);
		if (capPeriod > 0 && total > capPeriod) row.getCell('occ').font = { color: { argb: OVER_RED } };
	}
	finishDataSheet(s5, theme, { xSplit: 1 });
	// Échelle sur le taux d'occupation (vert faible → ambre ~plein → rouge surcharge).
	addColorScale(s5, 'occ', 2, 1 + members.length, [SCALE_GREEN, SCALE_AMBER, SCALE_RED]);

	// --- Détail jour-par-jour par personne (grille "Mon imputation") ---
	// ponytail: 2e table dans la même feuille ; la ligne vide avant chaque section
	// coupe la plage de l'autofiltre du tableau du haut, donc filtrer ne touche pas le détail.
	// Colonnes jour = tous les jours ouvrés de la période (comme la page imputation, qui
	// montre la semaine lun→ven même vide) ∪ les week-ends réellement imputés (rien perdu).
	const WD = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
	type GridTarget = { emoji: string; label: string; days: Map<string, number> };
	const gridByUser = new Map<string, Map<string, GridTarget>>();
	const dayset = new Set<string>();
	for (const r of dayEntries) {
		if (!r.userId) continue;
		dayset.add(r.day);
		if (!gridByUser.has(r.userId)) gridByUser.set(r.userId, new Map());
		const um = gridByUser.get(r.userId)!;
		let key: string, label: string, emoji: string;
		if (r.targetType === 'TICKET') {
			const info = r.ticketId ? ticketByIdName.get(r.ticketId) : undefined;
			key = 'T:' + (r.ticketId ?? '?');
			label = info ? `${info.key} — ${info.title}` : '(ticket supprimé)';
			emoji = '📋';
		} else {
			key = 'C:' + (r.categoryId ?? '?');
			label = r.catLabel ?? '(catégorie)';
			emoji = r.catKind === 'NON_PRODUCTIVE' ? '🌴' : '📁';
		}
		if (!um.has(key)) um.set(key, { emoji, label, days: new Map() });
		const t = um.get(key)!;
		t.days.set(r.day, round((t.days.get(r.day) ?? 0) + num(r.total)));
	}
	// ajoute tous les jours ouvrés de la période (colonnes visibles même sans imputation).
	for (let d = parseISODate(from); toISODate(d) <= to; d = addDays(d, 1)) {
		const w = d.getUTCDay();
		if (w !== 0 && w !== 6) dayset.add(toISODate(d));
	}
	const dayList = [...dayset].sort();
	const dayHead = (iso: string) => {
		const d = parseISODate(iso);
		return `${WD[d.getUTCDay()]} ${String(dayNum(d)).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	};
	const isWknd = (iso: string) => {
		const w = parseISODate(iso).getUTCDay();
		return w === 0 || w === 6;
	};
	const lastCol = dayList.length + 2; // libellé + jours + Σ

	// Les colonnes-jour au-delà du tableau des totaux du haut n'ont pas de largeur définie
	// (défaut ExcelJS = étroit). On les élargit pour égaliser avec les premières.
	const definedCols = 8 + projectList.length;
	for (let c = definedCols + 1; c <= lastCol; c++) s5.getColumn(c).width = 10;

	s5.addRow([]);
	for (const m of members) {
		const um = gridByUser.get(m.id);
		if (!um || um.size === 0) continue;

		const head = s5.addRow([m.name]);
		s5.mergeCells(head.number, 1, head.number, lastCol);
		head.getCell(1).font = { bold: true, size: 12, color: { argb: theme.memberInk } };
		head.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.memberHeader } };

		const hr = s5.addRow(['Tâche / catégorie', ...dayList.map(dayHead), 'Σ']);
		hr.font = { bold: true };
		hr.eachCell((c, col) => {
			c.border = { bottom: { style: 'thin', color: { argb: GRID_LINE } } };
			if (col >= 2) c.alignment = { horizontal: 'center' };
			if (col >= 2 && col < lastCol && isWknd(dayList[col - 2]))
				c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.zebra } };
		});

		const dayTot = new Map<string, number>();
		let grand = 0;
		for (const t of [...um.values()].sort((a, b) => a.label.localeCompare(b.label))) {
			const cells: (string | number)[] = [`${t.emoji} ${t.label}`];
			let rowSum = 0;
			for (const iso of dayList) {
				const v = t.days.get(iso) ?? 0;
				cells.push(v || ''); // vide si 0, comme la grille du site
				rowSum += v;
				if (v) dayTot.set(iso, round((dayTot.get(iso) ?? 0) + v));
			}
			cells.push(round(rowSum));
			grand += rowSum;
			const row = s5.addRow(cells);
			// surcharge le numFmt de colonne du tableau du haut (dont 0% sur "occ").
			for (let col = 2; col <= lastCol; col++) row.getCell(col).numFmt = '0.00';
		}
		const foot = s5.addRow(['Total / jour', ...dayList.map((iso) => dayTot.get(iso) ?? ''), round(grand)]);
		foot.font = { bold: true };
		foot.eachCell((c, col) => {
			c.border = { top: { style: 'thin', color: { argb: GRID_LINE } } };
			c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.totals } };
			if (col >= 2) c.numFmt = '0.00';
		});
		s5.addRow([]);
	}

	// ===== Feuille 6 — Hors-projet & absences =====
	const s6 = wb.addWorksheet('Hors-projet & absences');
	s6.columns = [
		{ header: 'Personne', key: 'person', width: 20 },
		{ header: 'Catégorie', key: 'cat', width: 22 },
		{ header: 'Nature', key: 'kind', width: 16 },
		{ header: 'Jours', key: 'days', width: 10 }
	];
	s6.getColumn('days').numFmt = '0.00';
	for (const r of catUser)
		s6.addRow({
			person: r.userName, cat: r.label,
			kind: r.kind === 'NON_PRODUCTIVE' ? 'Non productif' : 'Productif', days: round(num(r.total))
		});
	finishDataSheet(s6, theme, { stripe: false });
	// Teintes par nature : non-productif = chaud (ambre), productif = froid (accent clair).
	const warmTint = 'FFFEF3C7';
	const coolTint = tintArgb(theme.header, 0.9);
	for (let r = 2; r <= s6.rowCount; r++) {
		const fill = catUser[r - 2]?.kind === 'NON_PRODUCTIVE' ? warmTint : coolTint;
		s6.getRow(r).eachCell((c) => {
			c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
		});
	}

	// Retire les feuilles non sélectionnées (sélection vide = on garde tout).
	if (selected.length > 0) {
		const registry: Record<SheetKey, ExcelJS.Worksheet> = {
			synthese: s0,
			us: s1,
			projsprint: s2,
			activite: s3,
			imputation: s4,
			personne: s5,
			absences: s6
		};
		for (const key of SHEET_KEYS) if (!selected.includes(key)) wb.removeWorksheet(registry[key].id);
	}

	const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
	const ab = new ArrayBuffer(out.byteLength);
	new Uint8Array(ab).set(out);
	return ab;
}
