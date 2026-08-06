import { getRefData } from '$lib/server/services/tickets';
import { listAbsencesForRange, buildAbsenceGrid, listExternalMembers } from '$lib/server/services/absences';
import { ABSENCE_TYPES, ABSENCE_TYPE_LABELS, ABSENCE_TYPE_COLORS, groupDaysByMonth, type AbsenceType } from '$lib/absenceTypes';
import { formatDayRange, toISODate, parseISODate, addDays } from '$lib/utils/date';

const DAY_W = 30;
const NAME_W = 190;
const ROW_H = 26;
const TITLE_H = 30;
const MARGIN = 16;
const LEGEND_ROW_H = 20;
const LEGEND_GAP = 22;
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

const WHITE = '#FFFFFF';
const EXTERNAL_TINT = '#94A3B8';
const WEEKEND_FILL = '#EFF1F4';
const ZEBRA_FILL = '#FAFAFB';
const HEADER_FILL = '#EFEFEF';
const HEADER_WEEKEND_FILL = '#E2E4E8';
const GRID_LINE = '#D9D9D9';
const WEEK_LINE = '#ADB5BD';
const MONTH_LINE = '#475569';
const NAME_BORDER = '#94A3B8';
const TEXT_DARK = '#1F2937';
const TEXT_MUTE = '#64748B';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ponytail: heuristique de largeur de caractère (pas de mesure de texte réelle côté serveur) —
// suffisant pour éviter qu'un nom déborde de sa colonne, à revoir si des noms très larges apparaissent.
function truncate(name: string, maxWidth: number): string {
	const maxChars = Math.max(3, Math.floor(maxWidth / 6.5));
	return name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
}

const isWeekend = (d: string) => {
	const dow = parseISODate(d).getUTCDay();
	return dow === 0 || dow === 6;
};

export type AbsencesSvg = { svg: string; width: number; height: number };

/**
 * Image (SVG) d'un extrait de la synthèse équipe — mêmes couleurs/séparateurs que l'export Excel.
 * `rowIds` filtre les lignes affichées ; omis ou vide = toutes les lignes (réels + externes).
 */
export async function buildAbsencesSvg(
	workspaceId: string,
	fromISO: string,
	toISO: string,
	rowIds?: string[] | null
): Promise<AbsencesSvg> {
	const days: string[] = [];
	for (let d = parseISODate(fromISO); toISODate(d) <= toISO; d = addDays(d, 1)) days.push(toISODate(d));

	const [ref, absences, externalMembers] = await Promise.all([
		getRefData(workspaceId),
		listAbsencesForRange(workspaceId, fromISO, toISO),
		listExternalMembers(workspaceId)
	]);
	const grid = buildAbsenceGrid(absences, days);
	let rows = [
		...ref.members.map((m) => ({ id: m.id, displayName: m.displayName, external: false })),
		...externalMembers.map((m) => ({ id: m.id, displayName: m.displayName, external: true }))
	];
	if (rowIds && rowIds.length > 0) {
		const keep = new Set(rowIds);
		rows = rows.filter((r) => keep.has(r.id));
	}

	const monthGroups = groupDaysByMonth(days);
	const monthStartIdx = new Set<number>();
	{
		let c = 0;
		for (const g of monthGroups) {
			monthStartIdx.add(c);
			c += g.count;
		}
	}

	// Types réellement présents parmi les lignes filtrées → légende compacte, jamais plus large que nécessaire.
	const usedFull = new Set<AbsenceType>();
	const usedHalf = new Set<AbsenceType>();
	for (const r of rows) {
		const dayMap = grid[r.id];
		if (!dayMap) continue;
		for (const day of days) {
			const cell = dayMap[day];
			if (!cell) continue;
			(cell.period === 'FULL' ? usedFull : usedHalf).add(cell.type);
		}
	}
	const legendLines = ABSENCE_TYPES.flatMap((t) => [
		usedFull.has(t) ? { type: t, half: false } : null,
		usedHalf.has(t) ? { type: t, half: true } : null
	]).filter((x): x is { type: AbsenceType; half: boolean } => x !== null);
	const legendRowCount = Math.max(legendLines.length, 1);

	const gridTop = MARGIN + TITLE_H;
	const headerH = 2 * ROW_H;
	const bodyTop = gridTop + headerH;
	const gridBottom = bodyTop + rows.length * ROW_H;
	const legendTop = gridBottom + LEGEND_GAP;
	const width = MARGIN * 2 + NAME_W + days.length * DAY_W;
	const height = legendTop + legendRowCount * LEGEND_ROW_H + MARGIN;

	const gridLeft = MARGIN + NAME_W;
	const dayX = (i: number) => gridLeft + i * DAY_W;

	const parts: string[] = [];
	parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
	parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`);

	parts.push('<defs>');
	for (const t of ABSENCE_TYPES) {
		parts.push(
			`<linearGradient id="grad-${t}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${WHITE}"/><stop offset="1" stop-color="${ABSENCE_TYPE_COLORS[t]}"/></linearGradient>`
		);
	}
	parts.push('</defs>');

	parts.push(
		`<text x="${MARGIN}" y="${MARGIN + 16}" font-size="15" font-weight="700" fill="${TEXT_DARK}" ${FONT}>Absences — ${esc(formatDayRange(fromISO, toISO))}</text>`
	);

	// En-tête : bandeau mois (ligne 1) + numéros de jour (ligne 2).
	let cursor = 0;
	for (const g of monthGroups) {
		const x = dayX(cursor);
		const w = g.count * DAY_W;
		parts.push(`<rect x="${x}" y="${gridTop}" width="${w}" height="${ROW_H}" fill="${HEADER_FILL}" stroke="${GRID_LINE}"/>`);
		parts.push(
			`<text x="${x + w / 2}" y="${gridTop + ROW_H / 2 + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="${TEXT_MUTE}" ${FONT}>${esc(g.label)}</text>`
		);
		cursor += g.count;
	}
	days.forEach((d, i) => {
		const x = dayX(i);
		const y = gridTop + ROW_H;
		parts.push(
			`<rect x="${x}" y="${y}" width="${DAY_W}" height="${ROW_H}" fill="${isWeekend(d) ? HEADER_WEEKEND_FILL : HEADER_FILL}" stroke="${GRID_LINE}"/>`
		);
		parts.push(
			`<text x="${x + DAY_W / 2}" y="${y + ROW_H / 2 + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="${TEXT_MUTE}" ${FONT}>${parseISODate(d).getUTCDate()}</text>`
		);
	});
	parts.push(`<rect x="${MARGIN}" y="${gridTop}" width="${NAME_W}" height="${headerH}" fill="${HEADER_FILL}" stroke="${GRID_LINE}"/>`);
	parts.push(
		`<text x="${MARGIN + 10}" y="${gridTop + headerH / 2 + 4}" font-size="12" font-weight="700" fill="${TEXT_DARK}" ${FONT}>Membre</text>`
	);

	// Lignes.
	rows.forEach((m, r) => {
		const y = bodyTop + r * ROW_H;
		const zebra = r % 2 === 1;
		parts.push(`<rect x="${MARGIN}" y="${y}" width="${NAME_W}" height="${ROW_H}" fill="${zebra ? ZEBRA_FILL : WHITE}" stroke="${GRID_LINE}"/>`);
		if (m.external) parts.push(`<rect x="${MARGIN}" y="${y}" width="${NAME_W}" height="${ROW_H}" fill="${EXTERNAL_TINT}" fill-opacity="0.12"/>`);
		parts.push(
			`<text x="${MARGIN + 10}" y="${y + ROW_H / 2 + 4}" font-size="12" fill="${TEXT_DARK}" ${FONT}>${esc(truncate(m.displayName, NAME_W - 30))}</text>`
		);
		if (m.external) parts.push(`<circle cx="${MARGIN + NAME_W - 12}" cy="${y + ROW_H / 2}" r="3" fill="${EXTERNAL_TINT}"/>`);

		days.forEach((d, i) => {
			const x = dayX(i);
			const cell = grid[m.id]?.[d];
			let fillAttr: string;
			if (cell) fillAttr = cell.period === 'FULL' ? `fill="${ABSENCE_TYPE_COLORS[cell.type]}"` : `fill="url(#grad-${cell.type})"`;
			else if (m.external) fillAttr = `fill="${EXTERNAL_TINT}" fill-opacity="0.12"`;
			else if (isWeekend(d)) fillAttr = `fill="${WEEKEND_FILL}"`;
			else if (zebra) fillAttr = `fill="${ZEBRA_FILL}"`;
			else fillAttr = `fill="${WHITE}"`;
			parts.push(`<rect x="${x}" y="${y}" width="${DAY_W}" height="${ROW_H}" ${fillAttr} stroke="${GRID_LINE}"/>`);
		});
	});

	// Séparateurs renforcés par-dessus les cellules : lundi (semaine) et 1er du mois — pour suivre
	// une colonne au premier coup d'œil — et colonne "Membre" détachée pour ne jamais perdre une ligne.
	days.forEach((d, i) => {
		if (i === 0) return;
		const x = dayX(i);
		if (monthStartIdx.has(i)) parts.push(`<line x1="${x}" y1="${gridTop}" x2="${x}" y2="${gridBottom}" stroke="${MONTH_LINE}" stroke-width="2"/>`);
		else if (parseISODate(d).getUTCDay() === 1) parts.push(`<line x1="${x}" y1="${gridTop}" x2="${x}" y2="${gridBottom}" stroke="${WEEK_LINE}"/>`);
	});
	parts.push(`<line x1="${gridLeft}" y1="${gridTop}" x2="${gridLeft}" y2="${gridBottom}" stroke="${NAME_BORDER}" stroke-width="2"/>`);

	// Légende.
	if (legendLines.length === 0) {
		parts.push(`<text x="${MARGIN}" y="${legendTop + 13}" font-size="12" fill="${TEXT_MUTE}" ${FONT}>Aucune absence sur cette plage.</text>`);
	} else {
		legendLines.forEach((l, i) => {
			const y = legendTop + i * LEGEND_ROW_H;
			const fill = l.half ? `url(#grad-${l.type})` : ABSENCE_TYPE_COLORS[l.type];
			parts.push(`<rect x="${MARGIN}" y="${y}" width="14" height="14" fill="${fill}" stroke="${GRID_LINE}"/>`);
			const label = ABSENCE_TYPE_LABELS[l.type] + (l.half ? ' (demi-journée)' : '');
			parts.push(`<text x="${MARGIN + 20}" y="${y + 11}" font-size="12" fill="${TEXT_DARK}" ${FONT}>${esc(label)}</text>`);
		});
	}

	parts.push('</svg>');
	return { svg: parts.join(''), width, height };
}
