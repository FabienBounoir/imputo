import { eq } from 'drizzle-orm';
import { db, workspace } from '$lib/server/db';
import { getRefData } from '$lib/server/services/tickets';
import { listObjectivesForWorkspace, listVacationsForWeek, type WeeklyObjectiveWithUser } from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, isoWeek, formatRange } from '$lib/utils/date';

// Cartes larges plutôt qu'étroites : en 16/9 forcé, une grille à beaucoup de colonnes étroites
// laisse un cadre proche du contenu mais force les tâches à retourner à la ligne ; des cartes plus
// larges (2 colonnes max, cf. plus bas) remplissent mieux la largeur dispo et les tâches courantes
// tiennent sur une seule ligne.
const CARD_W = 420;
const CARD_GAP = 16;
const HEADER_H = 26;
const LINE_H = 18;
const PAD = 12;
const MARGIN = 16;
const TITLE_H = 30;
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

const WHITE = '#FFFFFF';
const HEADER_FILL = '#EFEFEF';
const BORDER = '#D9D9D9';
const TEXT_DARK = '#1F2937';
const TEXT_MUTE = '#64748B';

// Icônes de type (ticket/tâche) en trait — mêmes tracés que celles de la page, dessinées dans un
// <g> mis à l'échelle plutôt qu'un vrai composant SVG (on est côté serveur, texte brut).
function iconGroup(paths: string, x: number, y: number, size: number, color: string): string {
	return `<g transform="translate(${x},${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}
const TICKET_PATHS =
	'<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" /><path d="M13 6v2M13 11v2M13 16v2" />';
const TASK_PATHS = '<rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h6M9 17h3" />';
function kindIcon(kind: 'TICKET' | 'CUSTOM', x: number, y: number, size: number, color: string): string {
	return iconGroup(kind === 'TICKET' ? TICKET_PATHS : TASK_PATHS, x, y, size, color);
}

// Bande "en vacances" en bas de l'image : mêmes personnes qu'avant en carte pleine (qui n'affichait
// jamais rien d'autre qu'un badge) compactées en petites puces, pour laisser la place aux cartes qui
// ont du contenu réel (cf. même changement sur la page).
const VAC_CHIP_H = 22;
const VAC_CHIP_GAP_X = 6;
const VAC_CHIP_GAP_Y = 6;
const VAC_ICON_SIZE = 12;
const VAC_CHAR_W = 6;
const VAC_CHIP_FILL = '#F3F1EA';
const VAC_CHIP_TEXT = '#6B7280';

function vacChipWidth(name: string): number {
	return 10 + VAC_ICON_SIZE + 4 + Math.ceil(name.length * VAC_CHAR_W) + 10;
}

// Palmier plein (île + palmes), même dessin que l'icône vacances de la page pour rester cohérent
// entre l'appli et l'export. Contrairement aux autres icônes, c'est un tracé plein en viewBox 32.
const PALM_PATHS =
	'<path d="M14.5,24c-5.2,0-10.1,2.3-13.3,6.4c-0.2,0.3-0.3,0.7-0.1,1.1S1.6,32,2,32h25c0.4,0,0.7-0.2,0.9-0.6s0.1-0.8-0.1-1.1C24.6,26.3,19.7,24,14.5,24z" /><path d="M30.1,5.7c-3-1.7-6.2-1.8-9-0.4c-1.5,0.8-2.7,1.9-3.6,3.4c-0.3-2.1-1.2-3.9-2.7-5.3c-2.3-2.1-5.6-2.8-9-1.8C5.5,1.7,5.2,1.9,5.1,2.3c-0.1,0.4,0,0.7,0.3,1l2.6,2.4c0.1,0.1,0.3,0.2,0.4,0.2l0.7,0.2c0,0.1,0,0.2,0,0.2c0,0.3,0.1,0.5,0.3,0.7l1.1,1c-0.2,0-0.4,0-0.7,0c-3.1,0-5.9,1.6-7.8,4.4c-0.2,0.3-0.2,0.7,0,1C2.3,13.8,2.6,14,3,14h3.6c0.2,0,0.3,0,0.4-0.1l0.7-0.4C7.9,13.8,8.2,14,8.6,14h6.7c0.7,2.7,0.5,5.5-0.7,8c2.4,0,4.8,0.5,7,1.4c0.4-3.2-0.2-6.5-1.9-9.4l-0.6-1l1.6-0.8c0.1-0.1,0.3-0.2,0.3-0.3l0.5-0.6c0.3,0.2,0.6,0.2,1,0L30,7.5c0.3-0.2,0.5-0.5,0.5-0.9C30.6,6.2,30.4,5.9,30.1,5.7z" />';
function palmIcon(x: number, y: number): string {
	return `<g transform="translate(${x},${y}) scale(${VAC_ICON_SIZE / 32})" fill="${VAC_CHIP_TEXT}">${PALM_PATHS}</g>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Équivalent de color-mix(in srgb, accent X%, white/black) côté serveur (pas de CSS ici) — reproduit
// --accent-tint / --accent-ink de l'appli pour teinter la pilule d'activité avec l'accent de l'espace.
function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(hex: string, withHex: string, ratio: number): string {
	const [r1, g1, b1] = hexToRgb(hex);
	const [r2, g2, b2] = hexToRgb(withHex);
	const mix = (a: number, b: number) => Math.round(a * ratio + b * (1 - ratio));
	return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ponytail: heuristique de largeur de caractère (pas de mesure de texte réelle côté serveur) — 6.6px
// est une estimation prudente pour de l'Arial 12px (les libellés longs débordaient avec 6px).
const CHAR_W = 6.6;
function truncate(text: string, maxWidth: number): string {
	const maxChars = Math.max(3, Math.floor(maxWidth / CHAR_W));
	return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

/** Découpe un libellé trop long sur `maxLines` lignes (mot par mot) plutôt que de le tronquer d'un
 * coup — les tâches longues restent lisibles au lieu de perdre le principal en un "…" prématuré. */
function wrapLines(text: string, maxWidth: number, maxLines = 2): string[] {
	const maxChars = Math.max(3, Math.floor(maxWidth / CHAR_W));
	if (text.length <= maxChars) return [text];
	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';
	let i = 0;
	while (i < words.length && lines.length < maxLines - 1) {
		const candidate = current ? `${current} ${words[i]}` : words[i];
		if (candidate.length <= maxChars || !current) {
			current = candidate;
			i++;
		} else {
			lines.push(truncate(current, maxWidth));
			current = '';
		}
	}
	if (current) lines.push(truncate(current, maxWidth));
	const rest = words.slice(i).join(' ');
	if (rest) lines.push(truncate(rest, maxWidth));
	return lines;
}

function objectiveLine(o: WeeklyObjectiveWithUser): string {
	const base = o.kind === 'TICKET' ? `${o.ticketKey} — ${o.ticketTitle}` : (o.label ?? '');
	return o.activityLabel ? `${base} [${o.activityLabel}]` : base;
}

// Découpe une ligne en tspans : le "[Activité]" final (s'il y en a un) ressort teinté avec l'accent
// de l'espace plutôt que de se fondre dans le reste du texte gris.
function lineTspans(line: string, textColor: string, accentColor: string): string {
	const m = line.match(/^(.*?)(\s?\[[^[\]]*\])?$/);
	const bracket = m?.[2] ?? '';
	const before = bracket ? line.slice(0, line.length - bracket.length) : line;
	const beforeSpan = before ? `<tspan fill="${textColor}">${esc(before)}</tspan>` : '';
	const bracketSpan = bracket ? `<tspan fill="${accentColor}">${esc(bracket)}</tspan>` : '';
	return beforeSpan + bracketSpan;
}

export type ObjectivesSvg = { svg: string; width: number; height: number };

/** Image (SVG) de la vue globale des objectifs de la semaine — une carte par membre. */
export async function buildObjectivesSvg(workspaceId: string, weekMondayISO: string): Promise<ObjectivesSvg> {
	const monday = mondayOf(parseISODate(weekMondayISO));
	const [ref, objectives, vacations, wsRow] = await Promise.all([
		getRefData(workspaceId),
		listObjectivesForWorkspace(workspaceId, weekMondayISO),
		listVacationsForWeek(workspaceId, weekMondayISO),
		db.select({ accentColor: workspace.accentColor }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
	]);
	const accent = wsRow[0]?.accentColor ?? '#16A34A';
	const activityColor = mixHex(accent, '#000000', 0.78);
	// Membres "factice" (arrangements entre projets en clôture, pas de vraies personnes, cf.
	// schema.ts membership.factice) : exclus ici pour tout le monde, sans distinction de rôle — même
	// règle, sans condition, que la page en ligne (admin/objectifs/+page.server.ts).
	const members = ref.members.filter((m) => !m.factice);
	const innerW = CARD_W - PAD * 2;

	// blocks : un objectif par entrée, avec ses lignes (jusqu'à 2 si le libellé est long) — lines
	// reste la version "1 ligne" pour le cas simple "aucun objectif".
	type ObjBlock = { kind: 'TICKET' | 'CUSTOM'; ticketKey: string | null; lines: string[] };
	type Card = { name: string; lines: string[]; blocks: ObjBlock[]; empty: boolean; height: number; count: number };
	const TEXT_INDENT = 17; // largeur icône + espace — même repère pour tout le texte, y compris les retours à la ligne
	function buildBlock(o: WeeklyObjectiveWithUser): ObjBlock {
		return { kind: o.kind, ticketKey: o.kind === 'TICKET' ? o.ticketKey : null, lines: wrapLines(objectiveLine(o), innerW) };
	}
	const activeMembers = members.filter((m) => !vacations.has(m.id));
	const vacationMembers = members.filter((m) => vacations.has(m.id));
	// Celles avec le plus d'objectifs en premier, celles sans objectif en dernier.
	const cards: Card[] = activeMembers
		.map((m) => {
			const mine = objectives.filter((o) => o.userId === m.id);
			const lines = mine.length === 0 ? ['Aucun objectif.'] : [];
			const blocks: ObjBlock[] = mine.length === 0 ? [] : mine.map(buildBlock);
			const totalLines = blocks.length > 0 ? blocks.reduce((n, b) => n + b.lines.length, 0) : lines.length;
			const height = HEADER_H + PAD * 2 + Math.max(1, totalLines) * LINE_H;
			return { name: m.displayName, lines, blocks, empty: mine.length === 0, height, count: mine.length };
		})
		.sort((a, b) => b.count - a.count);

	// Choix du nombre de colonnes (2 max — des cartes larges plutôt qu'une grille à colonnes
	// étroites) : celui qui rapproche le plus le contenu d'un cadre 16/9.
	function layoutFor(cols: number) {
		const rows = Math.ceil(cards.length / cols) || 1;
		const rowHeights: number[] = [];
		for (let r = 0; r < rows; r++) {
			const rowCards = cards.slice(r * cols, r * cols + cols);
			rowHeights.push(Math.max(HEADER_H + PAD * 2 + LINE_H, ...rowCards.map((c) => c.height)));
		}
		const width = cols * CARD_W + (cols - 1) * CARD_GAP;
		const height = TITLE_H + rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * CARD_GAP;
		return { cols, rows, rowHeights, width, height };
	}
	const TARGET_RATIO = 16 / 9;
	const MAX_COLS = 2;
	let layout = layoutFor(1);
	let bestScore = Infinity;
	for (let c = 1; c <= Math.min(MAX_COLS, cards.length); c++) {
		const l = layoutFor(c);
		const score = Math.abs(l.width / l.height - TARGET_RATIO);
		if (score < bestScore) {
			bestScore = score;
			layout = l;
		}
	}
	const { cols, rows, rowHeights, width: contentWidth } = layout;

	// Puces "en vacances" repliées sur plusieurs lignes si besoin, dans la largeur du contenu.
	const vacRows: { name: string; w: number }[][] = [];
	{
		let row: { name: string; w: number }[] = [];
		let rowW = 0;
		for (const m of vacationMembers) {
			const w = vacChipWidth(m.displayName);
			const next = rowW + (row.length ? VAC_CHIP_GAP_X : 0) + w;
			if (row.length && next > contentWidth) {
				vacRows.push(row);
				row = [];
				rowW = 0;
			}
			row.push({ name: m.displayName, w });
			rowW += (row.length > 1 ? VAC_CHIP_GAP_X : 0) + w;
		}
		if (row.length) vacRows.push(row);
	}
	const vacStripH = vacRows.length > 0 ? vacRows.length * VAC_CHIP_H + (vacRows.length - 1) * VAC_CHIP_GAP_Y : 0;
	const contentHeight = layout.height + (vacStripH > 0 ? CARD_GAP + vacStripH : 0);

	// Cale le tout (contenu + marges) dans un cadre 16/9 exact — jamais rogné, juste complété par du
	// blanc réparti autour, pratique pour coller directement dans une slide sans recadrer.
	const minW = contentWidth + MARGIN * 2;
	const minH = contentHeight + MARGIN * 2;
	let width = minW;
	let height = minW / TARGET_RATIO;
	if (height < minH) {
		height = minH;
		width = minH * TARGET_RATIO;
	}
	const originX = MARGIN + (width - minW) / 2;
	const originY = MARGIN + (height - minH) / 2;

	const parts: string[] = [];
	parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
	parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`);
	parts.push(
		`<text x="${originX}" y="${originY + 16}" font-size="15" font-weight="700" fill="${TEXT_DARK}" ${FONT}>Objectifs — Semaine ${isoWeek(monday)} · ${esc(formatRange(monday))}</text>`
	);

	let y = originY + TITLE_H;
	for (let r = 0; r < rows; r++) {
		const rowCards = cards.slice(r * cols, r * cols + cols);
		const rowH = rowHeights[r];
		rowCards.forEach((c, i) => {
			const x = originX + i * (CARD_W + CARD_GAP);
			parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${rowH}" rx="8" fill="${WHITE}" stroke="${BORDER}"/>`);
			parts.push(`<path d="M${x + 8},${y} h${CARD_W - 16} a8,8 0 0 1 8,8 v${HEADER_H - 8} h-${CARD_W} v-${HEADER_H - 8} a8,8 0 0 1 8,-8 z" fill="${HEADER_FILL}"/>`);
			parts.push(
				`<text x="${x + PAD}" y="${y + HEADER_H / 2 + 4}" font-size="12.5" font-weight="700" fill="${TEXT_DARK}" ${FONT}>${esc(truncate(c.name, innerW))}</text>`
			);
			if (c.empty) {
				parts.push(
					`<text x="${x + PAD}" y="${y + HEADER_H + PAD + 11}" font-size="12" fill="${TEXT_MUTE}" ${FONT}>${esc(c.lines[0])}</text>`
				);
			} else {
				let li = 0;
				c.blocks.forEach((block) => {
					block.lines.forEach((line, sub) => {
						const ly = y + HEADER_H + PAD + li * LINE_H;
						const textX = x + PAD + TEXT_INDENT;
						// Icône (ticket/tâche) uniquement sur la 1ère ligne d'un objectif ; les lignes de
						// retour à la ligne gardent le même retrait pour rester alignées sous le texte.
						if (sub === 0) parts.push(kindIcon(block.kind, x + PAD, ly + 2, 13, accent));
						if (sub === 0 && block.ticketKey && line.startsWith(block.ticketKey)) {
							const rest = line.slice(block.ticketKey.length);
							parts.push(
								`<text x="${textX}" y="${ly + 11}" font-size="12" ${FONT}><tspan font-weight="700" fill="${TEXT_DARK}">${esc(block.ticketKey)}</tspan>${lineTspans(rest, TEXT_DARK, activityColor)}</text>`
							);
						} else {
							parts.push(`<text x="${textX}" y="${ly + 11}" font-size="12" ${FONT}>${lineTspans(line, TEXT_DARK, activityColor)}</text>`);
						}
						li++;
					});
				});
			}
		});
		y += rowH;
		if (r < rows - 1) y += CARD_GAP;
	}

	if (vacRows.length > 0) {
		y += CARD_GAP;
		vacRows.forEach((row) => {
			let x = originX;
			row.forEach((chip) => {
				parts.push(`<rect x="${x}" y="${y}" width="${chip.w}" height="${VAC_CHIP_H}" rx="${VAC_CHIP_H / 2}" fill="${VAC_CHIP_FILL}"/>`);
				parts.push(palmIcon(x + 10, y + (VAC_CHIP_H - VAC_ICON_SIZE) / 2));
				parts.push(
					`<text x="${x + 10 + VAC_ICON_SIZE + 4}" y="${y + VAC_CHIP_H / 2 + 4}" font-size="11" font-weight="600" fill="${VAC_CHIP_TEXT}" ${FONT}>${esc(chip.name)}</text>`
				);
				x += chip.w + VAC_CHIP_GAP_X;
			});
			y += VAC_CHIP_H + VAC_CHIP_GAP_Y;
		});
	}

	parts.push('</svg>');
	return { svg: parts.join(''), width, height };
}
