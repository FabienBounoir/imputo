import { getRefData } from '$lib/server/services/tickets';
import { listObjectivesForWorkspace, listVacationsForWeek, type WeeklyObjectiveWithUser } from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, isoWeek, formatRange } from '$lib/utils/date';

const CARD_W = 280;
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
const ACCENT = '#2563EB';
const VAC_FILL = '#FEF3C7';
const VAC_TEXT = '#92400E';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

export type ObjectivesSvg = { svg: string; width: number; height: number };

/** Image (SVG) de la vue globale des objectifs de la semaine — une carte par membre. */
export async function buildObjectivesSvg(workspaceId: string, weekMondayISO: string): Promise<ObjectivesSvg> {
	const monday = mondayOf(parseISODate(weekMondayISO));
	const [ref, objectives, vacations] = await Promise.all([
		getRefData(workspaceId),
		listObjectivesForWorkspace(workspaceId, weekMondayISO),
		listVacationsForWeek(workspaceId, weekMondayISO)
	]);
	const members = ref.members;
	const innerW = CARD_W - PAD * 2;

	// blocks : un tableau de lignes par objectif (jusqu'à 2 lignes si le libellé est long) — lines
	// reste la version "1 ligne par entrée" pour les cas simples (vacances / aucun objectif).
	type Card = { name: string; lines: string[]; blocks: string[][]; onVac: boolean; empty: boolean; height: number };
	const cards: Card[] = members.map((m) => {
		const onVac = vacations.has(m.id);
		const mine = objectives.filter((o) => o.userId === m.id);
		const lines = onVac ? ['🏖 En vacances'] : mine.length === 0 ? ['Aucun objectif.'] : [];
		const blocks = onVac || mine.length === 0 ? [] : mine.map((o) => wrapLines(objectiveLine(o), innerW));
		const totalLines = blocks.length > 0 ? blocks.reduce((n, b) => n + b.length, 0) : lines.length;
		const height = HEADER_H + PAD * 2 + Math.max(1, totalLines) * LINE_H;
		return { name: m.displayName, lines, blocks, onVac, empty: !onVac && mine.length === 0, height };
	});

	// Choix "intelligent" du nombre de colonnes : celui qui rapproche le plus le contenu d'un cadre
	// 16/9 (au lieu d'une grille à colonnes fixes qui laisse parfois beaucoup de vide, ou déborde en
	// hauteur) — on essaie chaque découpage possible et on garde celui qui colle le mieux au ratio.
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
	let layout = layoutFor(1);
	let bestScore = Infinity;
	for (let c = 1; c <= cards.length; c++) {
		const l = layoutFor(c);
		const score = Math.abs(l.width / l.height - TARGET_RATIO);
		if (score < bestScore) {
			bestScore = score;
			layout = l;
		}
	}
	const { cols, rows, rowHeights, width: contentWidth, height: contentHeight } = layout;

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
			if (c.onVac) {
				const bw = 90;
				parts.push(`<rect x="${x + PAD}" y="${y + HEADER_H + PAD}" width="${bw}" height="18" rx="9" fill="${VAC_FILL}"/>`);
				parts.push(
					`<text x="${x + PAD + bw / 2}" y="${y + HEADER_H + PAD + 13}" font-size="11" font-weight="600" text-anchor="middle" fill="${VAC_TEXT}" ${FONT}>🏖 En vacances</text>`
				);
			} else if (c.empty) {
				parts.push(
					`<text x="${x + PAD}" y="${y + HEADER_H + PAD + 11}" font-size="12" fill="${TEXT_MUTE}" ${FONT}>${esc(c.lines[0])}</text>`
				);
			} else {
				let li = 0;
				c.blocks.forEach((block) => {
					block.forEach((line, sub) => {
						const ly = y + HEADER_H + PAD + li * LINE_H;
						// Puce uniquement sur la 1ère ligne d'un objectif ; les lignes de retour à la
						// ligne gardent le même retrait pour rester alignées sous le texte, pas la puce.
						if (sub === 0) parts.push(`<circle cx="${x + PAD + 3}" cy="${ly + 7}" r="3" fill="${ACCENT}"/>`);
						parts.push(`<text x="${x + PAD + 12}" y="${ly + 11}" font-size="12" fill="${TEXT_DARK}" ${FONT}>${esc(line)}</text>`);
						li++;
					});
				});
			}
		});
		y += rowH + CARD_GAP;
	}

	parts.push('</svg>');
	return { svg: parts.join(''), width, height };
}
