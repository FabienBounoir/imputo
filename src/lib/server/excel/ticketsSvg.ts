import type { SprintDashboard, SprintDashboardTicket } from '$lib/server/services/sprintDashboard';

// Même table que "Tickets du sprint / de la version" (SprintDashboardPanel.svelte), rendue en SVG
// pour export image — but : coller directement le tableau dans une diapo (retour utilisateur).

const MARGIN = 16;
const TITLE_H = 30;
const HEADER_H = 26;
const ROW_H = 26;
const GROUP_H = 22;
const SUBTOTAL_H = 26;
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

const WHITE = '#FFFFFF';
const BORDER = '#E7E3D8';
const HEADER_TEXT = '#969185';
const TEXT_DARK = '#26241E';
const TEXT_SOFT = '#5C5950';
const WARN = '#C2410C';
const SUBTOTAL_FILL = '#FBFAF6';
const BAR_BG = '#F3F1EA';

const STATE_W = 140;
const TICKET_W = 300;
const NUM_W = 78;
const ECART_W = 150;
const PROG_W = 110;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ponytail: heuristique de largeur de caractère (pas de mesure de texte réelle côté serveur) —
// suffisant pour éviter qu'un titre déborde de sa colonne.
function truncate(text: string, maxWidth: number, charW = 6.6): string {
	const maxChars = Math.max(3, Math.floor(maxWidth / charW));
	return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

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

export type TicketsSvg = { svg: string; width: number; height: number };

/**
 * Image (SVG) de la table "Tickets" d'un dashboard sprint/version — mêmes colonnes et le même
 * groupement optionnel que SprintDashboardPanel.svelte (`grouped` = préférence locale du client,
 * cf. downloadSprintTicketsPng côté page).
 */
export function buildSprintTicketsSvg(dashboard: SprintDashboard, grouped: boolean, accent = '#16A34A'): TicketsSvg {
	const hasBudget = dashboard.kpis.budgetTotal !== null;
	const hasEcartBudget = dashboard.kpis.ecartVsBudgetTotal !== null;

	const cols: { label: string; w: number; num?: boolean }[] = [
		{ label: 'État', w: STATE_W },
		{ label: 'Ticket', w: TICKET_W },
		...(hasBudget ? [{ label: 'Budget', w: NUM_W, num: true }] : []),
		{ label: 'Estimé', w: NUM_W, num: true },
		{ label: 'RAE', w: NUM_W, num: true },
		{ label: 'Consommé', w: NUM_W, num: true },
		...(hasEcartBudget ? [{ label: 'Écart vs budget', w: ECART_W, num: true }] : []),
		{ label: 'Écart vs estimé', w: ECART_W, num: true },
		{ label: 'Avancement', w: PROG_W, num: true }
	];
	const colX: number[] = [];
	{
		let x = MARGIN;
		for (const c of cols) {
			colX.push(x);
			x += c.w;
		}
	}
	const tableW = cols.reduce((a, c) => a + c.w, 0);
	const width = MARGIN * 2 + tableW;

	const pct = (v: number) => Math.round(v * 100);

	const bodyH =
		dashboard.tickets.length === 0
			? ROW_H
			: grouped
				? dashboard.ticketGroups.reduce((h, g) => h + GROUP_H + g.tickets.length * ROW_H + SUBTOTAL_H, 0)
				: dashboard.tickets.length * ROW_H;
	const bodyTop = MARGIN + TITLE_H + HEADER_H;
	const height = bodyTop + bodyH + MARGIN;

	const parts: string[] = [];
	parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
	parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`);

	const titleLabel = dashboard.kind === 'VERSION' ? 'Tickets de la version' : 'Tickets du sprint';
	parts.push(
		`<text x="${MARGIN}" y="${MARGIN + 16}" font-size="15" font-weight="700" fill="${TEXT_DARK}" ${FONT}>${esc(titleLabel)} — ${esc(dashboard.sprintName)}</text>`
	);

	// En-tête.
	const headerY = MARGIN + TITLE_H;
	parts.push(`<rect x="${MARGIN}" y="${headerY}" width="${tableW}" height="${HEADER_H}" fill="${WHITE}"/>`);
	cols.forEach((c, i) => {
		const x = c.num ? colX[i] + c.w - 10 : colX[i] + 10;
		const label = truncate(c.label.toUpperCase(), c.w - 14, 7.5);
		parts.push(
			`<text x="${x}" y="${headerY + HEADER_H / 2 + 4}" font-size="10.5" font-weight="700" text-anchor="${c.num ? 'end' : 'start'}" fill="${HEADER_TEXT}" ${FONT}>${esc(label)}</text>`
		);
	});
	parts.push(`<line x1="${MARGIN}" y1="${headerY + HEADER_H}" x2="${MARGIN + tableW}" y2="${headerY + HEADER_H}" stroke="${BORDER}"/>`);

	function progressBar(x: number, y: number, w: number, avancement: number): string {
		const barW = 60;
		const barX = x + w - 10 - barW - 34;
		const barY = y + ROW_H / 2 - 3;
		return (
			`<rect x="${barX}" y="${barY}" width="${barW}" height="6" rx="3" fill="${BAR_BG}"/>` +
			`<rect x="${barX}" y="${barY}" width="${Math.max(0, Math.min(barW, (barW * pct(avancement)) / 100))}" height="6" rx="3" fill="${accent}"/>` +
			`<text x="${x + w - 10}" y="${y + ROW_H / 2 + 4}" font-size="11" font-weight="700" text-anchor="end" fill="${TEXT_SOFT}" ${FONT}>${pct(avancement)}%</text>`
		);
	}
	function ecartCell(x: number, w: number, y: number, v: number): string {
		const color = v > 0 ? WARN : v < 0 ? accent : TEXT_DARK;
		const weight = v !== 0 ? 700 : 400;
		return `<text x="${x + w - 10}" y="${y + ROW_H / 2 + 4}" font-size="12" font-weight="${weight}" text-anchor="end" fill="${color}" ${FONT}>${v > 0 ? '+' : ''}${v || 0}</text>`;
	}
	function numCell(x: number, w: number, y: number, v: number | string): string {
		return `<text x="${x + w - 10}" y="${y + ROW_H / 2 + 4}" font-size="12" text-anchor="end" fill="${TEXT_DARK}" ${FONT}>${v}</text>`;
	}
	function ticketCell(x: number, w: number, y: number, t: SprintDashboardTicket): string {
		const keyW = Math.ceil(t.key.length * 6.2) + 8;
		const titleX = x + 10 + keyW;
		const titleMaxW = Math.max(20, w - 10 - keyW - 10);
		return (
			`<text x="${x + 10}" y="${y + ROW_H / 2 + 4}" font-size="11" font-weight="600" fill="${HEADER_TEXT}" ${FONT}>${esc(t.key)}</text>` +
			`<text x="${titleX}" y="${y + ROW_H / 2 + 4}" font-size="12" font-weight="500" fill="${TEXT_DARK}" ${FONT}>${esc(truncate(t.title, titleMaxW))}</text>`
		);
	}
	function stateCell(x: number, w: number, y: number, t: SprintDashboardTicket): string {
		const label = `${t.stateEmoji ?? ''} ${t.stateLabel ?? '—'}`.trim();
		if (!t.stateColor) {
			return `<text x="${x + 10}" y="${y + ROW_H / 2 + 4}" font-size="12" fill="${TEXT_SOFT}" ${FONT}>${esc(truncate(label, w - 16))}</text>`;
		}
		const fill = mixHex(t.stateColor, WHITE, 0.18);
		const txt = truncate(label, w - 34);
		const pillW = Math.min(w - 16, Math.ceil(txt.length * 6.4) + 20);
		const pillY = y + (ROW_H - 20) / 2;
		return (
			`<rect x="${x + 8}" y="${pillY}" width="${pillW}" height="20" rx="10" fill="${fill}"/>` +
			`<text x="${x + 8 + pillW / 2}" y="${pillY + 14}" font-size="11" font-weight="600" text-anchor="middle" fill="${t.stateColor}" ${FONT}>${esc(txt)}</text>`
		);
	}

	function ticketRow(y: number, t: SprintDashboardTicket): void {
		let i = 0;
		parts.push(stateCell(colX[i], cols[i].w, y, t));
		i++;
		parts.push(ticketCell(colX[i], cols[i].w, y, t));
		i++;
		if (hasBudget) {
			parts.push(numCell(colX[i], cols[i].w, y, t.budget ?? '—'));
			i++;
		}
		parts.push(numCell(colX[i], cols[i].w, y, t.estTotal));
		i++;
		parts.push(numCell(colX[i], cols[i].w, y, t.raeTotal));
		i++;
		parts.push(numCell(colX[i], cols[i].w, y, t.consumed || '—'));
		i++;
		if (hasEcartBudget) {
			parts.push(ecartCell(colX[i], cols[i].w, y, t.ecartVsBudget ?? 0));
			i++;
		}
		parts.push(ecartCell(colX[i], cols[i].w, y, t.ecartVsEstime));
		i++;
		parts.push(progressBar(colX[i], y, cols[i].w, t.avancement));
		parts.push(`<line x1="${MARGIN}" y1="${y + ROW_H}" x2="${MARGIN + tableW}" y2="${y + ROW_H}" stroke="${BORDER}"/>`);
	}

	let y = bodyTop;
	if (dashboard.tickets.length === 0) {
		parts.push(`<text x="${MARGIN}" y="${y + ROW_H / 2 + 4}" font-size="12" fill="${TEXT_SOFT}" ${FONT}>Aucun ticket.</text>`);
	} else if (grouped) {
		for (const g of dashboard.ticketGroups) {
			parts.push(
				`<text x="${MARGIN + 8}" y="${y + GROUP_H / 2 + 4}" font-size="11" font-weight="700" fill="${TEXT_SOFT}" ${FONT}>${esc(g.label.toUpperCase())} — ${g.tickets.length} ticket${g.tickets.length > 1 ? 's' : ''}</text>`
			);
			y += GROUP_H;
			for (const t of g.tickets) {
				ticketRow(y, t);
				y += ROW_H;
			}
			parts.push(`<rect x="${MARGIN}" y="${y}" width="${tableW}" height="${SUBTOTAL_H}" fill="${SUBTOTAL_FILL}"/>`);
			parts.push(`<text x="${MARGIN + 10}" y="${y + SUBTOTAL_H / 2 + 4}" font-size="12" font-weight="700" fill="${TEXT_SOFT}" ${FONT}>Sous-total</text>`);
			let i = hasBudget ? 2 : 1;
			// Estimé / RAE / Consommé du sous-groupe, alignés sur les mêmes colonnes que les lignes ticket
			// (écart(s) laissés vides, comme la table en ligne — seul l'avancement de groupe a du sens).
			const subVals = [g.estTotal, g.raeTotal, g.consumed || '—'];
			for (const v of subVals) {
				parts.push(numCell(colX[i], cols[i].w, y, v));
				i++;
			}
			const progCol = cols.length - 1;
			parts.push(progressBar(colX[progCol], y, cols[progCol].w, g.avancement));
			parts.push(`<line x1="${MARGIN}" y1="${y + SUBTOTAL_H}" x2="${MARGIN + tableW}" y2="${y + SUBTOTAL_H}" stroke="${BORDER}"/>`);
			y += SUBTOTAL_H;
		}
	} else {
		for (const t of dashboard.tickets) {
			ticketRow(y, t);
			y += ROW_H;
		}
	}

	parts.push('</svg>');
	return { svg: parts.join(''), width, height };
}
