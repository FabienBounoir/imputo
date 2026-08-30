import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { db, workspace } from '$lib/server/db';
import { listAllTimeEntries, getSupportTimeStats, type SupportTimeFilter } from '$lib/server/services/supportTime';
import { formatDuration } from '$lib/supportDuration';
import { buildTheme, finishDataSheet, addTotalsRow, addDataBar, tintArgb, pickInk } from './export';

const SCALE_BLUE = 'FF2563EB';

/** Clés de feuilles sélectionnables à l'export, même motif que SHEET_KEYS (export.ts). */
export const SUPPORT_SHEET_KEYS = ['synthese', 'detail', 'personne', 'ticket'] as const;
export type SupportSheetKey = (typeof SUPPORT_SHEET_KEYS)[number];

/**
 * Classeur Excel du temps passé sur les tickets de support (cf. workspace.supportTimeTrackingEnabled) —
 * seule donnée disponible sur ce sujet, l'entreprise ne trace ça nulle part ailleurs.
 * `filter` borne la période/personne (jamais un dump complet implicite : sur plusieurs années de
 * saisies, "tout" doit rester un choix explicite fait dans la modale d'export, pas le défaut silencieux).
 */
export async function buildSupportTimeWorkbook(
	workspaceId: string,
	workspaceName: string,
	filter: SupportTimeFilter = {},
	sheets?: string[]
): Promise<ExcelJS.Buffer> {
	const selected = (sheets ?? []).filter((s): s is SupportSheetKey => SUPPORT_SHEET_KEYS.includes(s as SupportSheetKey));
	const want = (key: SupportSheetKey) => selected.length === 0 || selected.includes(key);

	// Le détail brut est la seule requête qui ne passe pas à l'échelle sur plusieurs années :
	// on ne la lance que si la feuille "Détail" est effectivement demandée.
	const [stats, wsRow, entries] = await Promise.all([
		getSupportTimeStats(workspaceId, filter),
		db.select({ accentColor: workspace.accentColor }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1),
		want('detail') ? listAllTimeEntries(workspaceId, filter) : Promise.resolve([])
	]);
	const theme = buildTheme(wsRow[0]?.accentColor ?? '#16A34A');
	// Si la période filtre sur une seule personne, son nom vient déjà de l'agrégat (byPerson n'aura
	// qu'une entrée) — pas besoin d'une requête à part pour l'afficher dans la Synthèse.
	const personName = filter.userId ? stats.byPerson[0]?.name : undefined;

	const wb = new ExcelJS.Workbook();

	// ===== Synthèse =====
	if (want('synthese')) {
		const s0 = wb.addWorksheet('Synthèse');
		s0.getColumn(1).width = 30;
		s0.getColumn(2).width = 22;
		const title = s0.addRow([workspaceName || 'Espace']);
		s0.mergeCells(title.number, 1, title.number, 2);
		title.height = 34;
		title.getCell(1).font = { bold: true, size: 18, color: { argb: theme.ink } };
		title.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
		for (let c = 1; c <= 2; c++) title.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.header } };

		const meta = (label: string, value: string | number) => {
			const r = s0.addRow([label, value]);
			r.getCell(1).font = { color: { argb: 'FF64748B' } };
		};
		meta('Export généré le', new Date().toLocaleString('fr-FR'));
		meta('Période', filter.from || filter.to ? `${filter.from ?? 'origine'} → ${filter.to ?? "aujourd'hui"}` : 'Toutes les dates');
		if (personName) meta('Personne', personName);
		s0.addRow([]);

		const sectionBand = (text: string) => {
			const r = s0.addRow([text]);
			s0.mergeCells(r.number, 1, r.number, 2);
			r.getCell(1).font = { bold: true, size: 12, color: { argb: pickInk(theme.section) } };
			r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
			r.height = 22;
			for (let c = 1; c <= 2; c++) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.section } };
			return r;
		};
		sectionBand('Indicateurs clés');
		const kpis: [string, number, string?][] = [
			['Temps total', stats.totalMinutes / 60, '0.00 "h"'],
			['Saisies', stats.entryCount],
			['Tickets distincts', stats.distinctTickets],
			['Personnes ayant saisi', stats.distinctPeople]
		];
		for (const [label, value, fmt] of kpis) {
			const row = s0.addRow([label, value]);
			row.getCell(1).font = { bold: true, color: { argb: 'FF475569' } };
			const vc = row.getCell(2);
			if (fmt) vc.numFmt = fmt;
			vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tintArgb(theme.header, 0.9) } };
			vc.font = { bold: true };
			vc.alignment = { horizontal: 'right' };
		}
	}

	// ===== Détail =====
	if (want('detail')) {
		const s1 = wb.addWorksheet('Détail');
		s1.columns = [
			{ header: 'Jour', key: 'day', width: 13 },
			{ header: 'Personne', key: 'name', width: 24 },
			{ header: 'Ticket', key: 'ticket', width: 20 },
			{ header: 'Durée', key: 'duration', width: 12 },
			{ header: 'Heures', key: 'hours', width: 10 },
			{ header: 'Saisi le', key: 'createdAt', width: 20 }
		];
		s1.getColumn('hours').numFmt = '0.00';
		s1.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm';
		for (const e of entries) {
			s1.addRow({
				day: e.day,
				name: e.userDisplayName,
				ticket: e.ticketRef,
				duration: formatDuration(e.minutes),
				hours: e.minutes / 60,
				createdAt: e.createdAt
			});
		}
		finishDataSheet(s1, theme);
		if (entries.length) addTotalsRow(s1, { day: 'Total', hours: stats.totalMinutes / 60 }, theme);
	}

	// ===== Par personne =====
	if (want('personne')) {
		const s2 = wb.addWorksheet('Par personne');
		s2.columns = [
			{ header: 'Personne', key: 'name', width: 24 },
			{ header: 'Heures', key: 'hours', width: 12 },
			{ header: 'Saisies', key: 'entries', width: 10 },
			{ header: 'Tickets distincts', key: 'tickets', width: 16 }
		];
		s2.getColumn('hours').numFmt = '0.00';
		for (const p of stats.byPerson) s2.addRow({ name: p.name, hours: p.minutes / 60, entries: p.entries, tickets: p.tickets });
		finishDataSheet(s2, theme);
		if (stats.byPerson.length) {
			addTotalsRow(s2, { name: 'Total', hours: stats.totalMinutes / 60, entries: stats.entryCount }, theme);
			addDataBar(s2, 'hours', 2, stats.byPerson.length + 1, SCALE_BLUE);
		}
	}

	// ===== Par ticket (probablement la feuille la plus utile) =====
	if (want('ticket')) {
		const s3 = wb.addWorksheet('Par ticket');
		s3.columns = [
			{ header: 'Ticket', key: 'ticket', width: 22 },
			{ header: 'Heures', key: 'hours', width: 12 },
			{ header: 'Saisies', key: 'entries', width: 10 },
			{ header: 'Contributeurs', key: 'people', width: 14 }
		];
		s3.getColumn('hours').numFmt = '0.00';
		for (const t of stats.byTicket) s3.addRow({ ticket: t.ticketRef, hours: t.minutes / 60, entries: t.entries, people: t.people });
		finishDataSheet(s3, theme);
		if (stats.byTicket.length) {
			addTotalsRow(s3, { ticket: 'Total', hours: stats.totalMinutes / 60, entries: stats.entryCount }, theme);
			addDataBar(s3, 'hours', 2, stats.byTicket.length + 1, SCALE_BLUE);
		}
	}

	return wb.xlsx.writeBuffer();
}
