import ExcelJS from 'exceljs';
import { getRefData } from '$lib/server/services/tickets';
import { listAbsencesForRange, buildAbsenceGrid, listExternalMembers } from '$lib/server/services/absences';
import {
	ABSENCE_TYPES,
	ABSENCE_TYPE_LABELS,
	ABSENCE_TYPE_COLORS,
	absenceRangeBounds,
	groupDaysByMonth,
	type AbsenceType,
	type AbsencePeriod,
	type AbsenceSpan
} from '$lib/absenceTypes';
import { hexToArgb } from './export';
import { formatMonthLabel, formatMonthShortLabel, toISODate, parseISODate, addDays } from '$lib/utils/date';

const WHITE = 'FFFFFFFF';
const EXTERNAL_TINT = 'FFF1F5F9'; // très léger, distingue une ligne "membre externe"
const WEEKEND_FILL = 'FFEFF1F4';
const ZEBRA_FILL = 'FFFAFAFB'; // à peine plus foncé que blanc, une ligne membre sur deux
const HEADER_FILL = 'FFEFEFEF';
const HEADER_WEEKEND_FILL = 'FFE2E4E8';

// Trois niveaux de bordure : fine entre deux jours, plus marquée au lundi (semaine), nette au 1er du mois.
const THIN_GREY = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } };
const WEEK_BORDER = { style: 'thin' as const, color: { argb: 'FFADB5BD' } };
const MONTH_BORDER = { style: 'medium' as const, color: { argb: 'FF475569' } };
const NAME_COL_BORDER = { style: 'medium' as const, color: { argb: 'FF94A3B8' } };

const solidFill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function fillFor(cell: { type: AbsenceType; period: AbsencePeriod }): ExcelJS.Fill {
	const argb = hexToArgb(ABSENCE_TYPE_COLORS[cell.type]);
	if (cell.period === 'FULL') return solidFill(argb);
	// Demi-journée : dégradé diagonal blanc → couleur, comme dans "Prévisions congés.xlsx".
	return {
		type: 'gradient',
		gradient: 'angle',
		degree: 135,
		stops: [
			{ position: 0, color: { argb: WHITE } },
			{ position: 1, color: { argb } }
		]
	};
}

const isWeekend = (dISO: string) => {
	const dow = parseISODate(dISO).getUTCDay();
	return dow === 0 || dow === 6;
};

/** Génère un export .xlsx de la plage demandée, esthétique proche de "Prévisions congés.xlsx". */
export async function buildAbsencesWorkbook(workspaceId: string, anchorISO: string, span: AbsenceSpan): Promise<ExcelJS.Buffer> {
	const range = absenceRangeBounds(anchorISO, span);
	const days: string[] = [];
	for (let d = parseISODate(range.start); toISODate(d) <= range.end; d = addDays(d, 1)) days.push(toISODate(d));

	const [ref, absences, externalMembers] = await Promise.all([
		getRefData(workspaceId),
		listAbsencesForRange(workspaceId, range.start, range.end),
		listExternalMembers(workspaceId)
	]);
	const grid = buildAbsenceGrid(absences, days);
	const rows = [
		...ref.members.map((m) => ({ id: m.id, displayName: m.displayName, external: false })),
		...externalMembers.map((m) => ({ id: m.id, displayName: m.displayName, external: true }))
	];

	// Bordure gauche de la colonne du jour `i` : nette si nouveau mois, marquée si lundi, fine sinon.
	const leftBorderFor = (i: number) => {
		if (i === 0) return THIN_GREY;
		if (formatMonthShortLabel(days[i]) !== formatMonthShortLabel(days[i - 1])) return MONTH_BORDER;
		return parseISODate(days[i]).getUTCDay() === 1 ? WEEK_BORDER : THIN_GREY;
	};

	const wb = new ExcelJS.Workbook();
	const sheetName = (
		span === 1 ? formatMonthLabel(range.start) : `${formatMonthLabel(range.start)} - ${formatMonthLabel(range.end)}`
	).slice(0, 31);
	const sheet = wb.addWorksheet(sheetName);

	sheet.getColumn(1).width = 18;
	for (let i = 0; i < days.length; i++) sheet.getColumn(2 + i).width = 4.5;

	// Ligne 1 : mois (fusionné sur ses jours) — ligne 2 : numéro du jour — membres à partir de la ligne 3.
	const monthRow = sheet.getRow(1);
	const dayRow = sheet.getRow(2);
	days.forEach((d, i) => (dayRow.getCell(2 + i).value = parseISODate(d).getUTCDate()));
	let cursor = 0;
	for (const g of groupDaysByMonth(days)) {
		const col = 2 + cursor;
		if (g.count > 1) sheet.mergeCells(1, col, 1, col + g.count - 1);
		monthRow.getCell(col).value = g.label;
		cursor += g.count;
	}
	sheet.mergeCells(1, 1, 2, 1);
	monthRow.getCell(1).value = 'Membre';
	for (let col = 1; col <= days.length + 1; col++) {
		for (const row of [monthRow, dayRow]) {
			const c = row.getCell(col);
			c.font = { bold: true };
			c.alignment = { horizontal: col === 1 ? 'left' : 'center', vertical: 'middle' };
		}
	}
	monthRow.getCell(1).fill = solidFill(HEADER_FILL);
	days.forEach((d, i) => {
		const fill = solidFill(isWeekend(d) ? HEADER_WEEKEND_FILL : HEADER_FILL);
		monthRow.getCell(2 + i).fill = fill;
		dayRow.getCell(2 + i).fill = fill;
	});

	rows.forEach((m, r) => {
		const row = sheet.getRow(3 + r);
		const zebra = r % 2 === 1;
		row.getCell(1).value = m.displayName;
		row.getCell(1).fill = solidFill(m.external ? EXTERNAL_TINT : zebra ? ZEBRA_FILL : WHITE);
		days.forEach((d, i) => {
			const c = row.getCell(2 + i); // touche chaque cellule pour que la bordure s'applique même sans absence
			const cell = grid[m.id]?.[d];
			if (cell) c.fill = fillFor(cell);
			else if (m.external) c.fill = solidFill(EXTERNAL_TINT);
			else if (isWeekend(d)) c.fill = solidFill(WEEKEND_FILL);
			else if (zebra) c.fill = solidFill(ZEBRA_FILL);
		});
	});

	sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

	// Bordures : fines par défaut, marquées au lundi et nettes au 1er du mois pour repérer une
	// colonne au premier coup d'œil ; colonne "Membre" détachée pour ne jamais perdre la ligne.
	const lastGridRow = 2 + rows.length;
	for (let r = 1; r <= lastGridRow; r++) {
		const row = sheet.getRow(r);
		row.getCell(1).border = { top: THIN_GREY, bottom: THIN_GREY, left: THIN_GREY, right: NAME_COL_BORDER };
		days.forEach((d, i) => {
			row.getCell(2 + i).border = { top: THIN_GREY, bottom: THIN_GREY, left: leftBorderFor(i), right: THIN_GREY };
		});
	}

	// Légende, comme en bas des feuilles du fichier source.
	let legendRow = rows.length + 5;
	for (const t of ABSENCE_TYPES) {
		sheet.getRow(legendRow).getCell(2).fill = fillFor({ type: t, period: 'FULL' });
		sheet.getRow(legendRow).getCell(3).value = ABSENCE_TYPE_LABELS[t];
		legendRow++;
		sheet.getRow(legendRow).getCell(2).fill = fillFor({ type: t, period: 'AM' });
		sheet.getRow(legendRow).getCell(3).value = `1/2 journée ${ABSENCE_TYPE_LABELS[t].toLowerCase()}`;
		legendRow++;
	}

	return wb.xlsx.writeBuffer();
}
