import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { db, ticket, sprint, ssp } from '$lib/server/db';
import { makeWorkspace } from './test-helpers';
import { listTicketsPage, ticketFiltersFromUrl, updateTicketField } from './tickets';
import {
	applyImport,
	listImports,
	looksLikeTypo,
	parseImportFile,
	planImport,
	undoImport,
	IMPORT_MAX_ROWS,
	type ImportContext,
	type ParsedFile
} from './ticketImport';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
	testPhase: true,
	tickets: [],
	projects: [],
	sprints: [],
	versions: [],
	ssps: [],
	states: [],
	members: [],
	...over
});
/** Les lignes commencent à 2, comme dans un classeur (la 1 porte les en-têtes). */
const file = (headers: string[], ...rows: string[][]): ParsedFile => ({
	headers,
	rows: rows.map((cells, i) => ({ line: i + 2, cells }))
});

describe('planImport', () => {
	it('reconnaît les en-têtes sans casse ni accents et signale les colonnes ignorées', () => {
		const { plan } = planImport(file(['ISSUE KEY', 'résumé', 'Story points', 'est. réal'], ['A-1', 'Un', '5', '2']), ctx());
		expect(plan.columns).toEqual([
			{ header: 'ISSUE KEY', label: 'Clé' },
			{ header: 'résumé', label: 'Titre' },
			{ header: 'Story points', label: null },
			{ header: 'est. réal', label: 'Estimé' }
		]);
		expect(plan.counts.new).toBe(1);
	});

	it('classe les lignes : à créer, ignorée, erreurs', () => {
		const { plan } = planImport(
			file(
				['Clé', 'Titre', 'Estimé'],
				['A-1', 'Nouveau', '3,5'],
				['A-2', 'Déjà là', ''],
				['A-3', '', ''],
				['A-1', 'Doublon', ''],
				['A-4', 'Mauvais nombre', '3j'],
				['', 'Sans clé', ''],
				['A-5', 'Archivé', '']
			),
			ctx({
				tickets: [
					{ id: 't2', key: 'A-2', archived: false },
					{ id: 't5', key: 'A-5', archived: true }
				]
			})
		);
		expect(plan.lines.map((l) => [l.line, l.status, l.notes[0] ?? ''])).toEqual([
			[2, 'new', ''],
			[3, 'skip', 'Déjà dans l’espace.'],
			[4, 'err', 'Titre vide.'],
			[5, 'err', 'Clé déjà présente à la ligne 2.'],
			[6, 'err', 'Estimé « 3j » illisible : écrivez 3 ou 3,5.'],
			[7, 'err', 'Clé vide.'],
			[8, 'skip', 'Déjà dans l’espace, ticket archivé.']
		]);
		expect(plan.counts).toEqual({ total: 7, new: 1, skip: 2, err: 4, noted: 0 });
	});

	it("sans RAE, reprend l'estimé ; les colonnes de test sont ignorées hors phase Test", () => {
		const f = file(['Clé', 'Titre', 'Estimé', 'RAE', 'Est. Test'], ['A-1', 'Un', '3,5', '', '2'], ['A-2', 'Deux', '4', '1', '']);
		const on = planImport(f, ctx()).drafts;
		expect(on[0].nums).toMatchObject({ estimationReal: '3.5', raeReal: '3.5', estimationTest: '2', raeTest: '2' });
		expect(on[1].nums).toMatchObject({ estimationReal: '4', raeReal: '1', raeTest: null });

		const off = planImport(f, ctx({ testPhase: false }));
		expect(off.drafts[0].nums.estimationTest).toBeNull();
		expect(off.plan.columns.at(-1)).toEqual({ header: 'Est. Test', label: null, why: 'phase Test désactivée dans l’espace' });
		// Deux colonnes pour le même champ : la seconde est ignorée, avec la raison.
		expect(planImport(file(['Clé', 'Key', 'Titre'], ['A-1', 'B-1', 'Un']), ctx()).plan.columns[1]).toMatchObject({ label: null, why: expect.stringContaining('en double') });
	});

	it('liste les référentiels à créer, sauf ceux décochés ; un code SSP est toujours créé', () => {
		const f = file(
			['Clé', 'Titre', 'Version', 'Sprint', 'Code SSP'],
			['A-1', 'Un', 'V4.2', 'Sprint 31', 'SSP-NEW'],
			['A-2', 'Deux', 'v4.2', 'Sprint 30', 'ssp-old']
		);
		const base = ctx({
			sprints: [{ id: 's30', name: 'Sprint 30' }],
			ssps: [{ id: 'old', code: 'SSP-OLD', label: 'Ancien', archived: false }]
		});
		const { plan, drafts } = planImport(f, base);
		expect(plan.toCreate.version).toEqual([{ name: 'V4.2', tickets: 2 }]);
		expect(plan.toCreate.sprint).toEqual([{ name: 'Sprint 31', tickets: 1 }]);
		expect(plan.toCreate.ssp).toEqual([{ name: 'SSP-NEW', tickets: 1 }]);
		expect(plan.lines[0].tags).toEqual([
			{ text: 'Sprint 31', add: true },
			{ text: 'V4.2', add: true },
			{ text: 'SSP-NEW', add: true }
		]);
		expect(drafts[1].refs).toEqual({ sprint: 'sprint 30', version: 'v4.2', ssp: 'ssp-old' });

		const skipped = planImport(f, base, new Set(['version:v4.2', 'ssp:ssp-new']));
		expect(skipped.plan.toCreate.version).toEqual([]);
		expect(skipped.drafts[0].refs.version).toBeUndefined();
		expect(skipped.plan.toCreate.ssp).toHaveLength(1);
	});

	it("signale un code SSP à une faute de frappe d'un code existant, ou déjà archivé", () => {
		const { plan } = planImport(
			file(['Clé', 'Titre', 'SSP'], ['A-1', 'Un', '009922Q083'], ['A-2', 'Deux', '009922Q0084'], ['A-3', 'Trois', 'VIEUX']),
			ctx({
				ssps: [
					{ id: '1', code: '009922Q0083', label: 'MCO 2026-27', archived: false },
					{ id: '2', code: 'vieux', label: 'vieux', archived: true }
				]
			})
		);
		expect(plan.toCreate.ssp).toEqual([
			{ name: '009922Q083', tickets: 1, similarTo: '009922Q0083 (MCO 2026-27)' },
			{ name: '009922Q0084', tickets: 1 },
			{ name: 'VIEUX', tickets: 1, archived: true }
		]);
	});

	it('état, assigné, parent, priorité et indicateur inconnus : remarque, ticket créé quand même', () => {
		const { plan, drafts } = planImport(
			file(
				['Clé', 'Titre', 'État', 'Assigné à', 'Parent', 'Priorité', 'Cypress'],
				['A-1', 'Un', 'En recette', 'M. Durand', 'A-900', 'Critique', 'peut-être'],
				['A-2', 'Deux', 'en cours', 'LUCAS@ACME.TEST', 'A-3', 'p1', 'oui'],
				['A-3', 'Trois', '', '', 'A-0', 'Haute', '']
			),
			ctx({
				tickets: [{ id: 't0', key: 'A-0', archived: false }],
				states: [{ id: 'st', label: 'En cours' }],
				members: [{ id: 'u1', name: 'Lucas', email: 'lucas@acme.test' }]
			})
		);
		expect(plan.counts).toMatchObject({ new: 3, noted: 1 });
		expect(plan.lines[0].notes).toEqual([
			'État « En recette » inconnu : champ laissé vide.',
			'Assigné « M. Durand » introuvable : champ laissé vide.',
			'Priorité « Critique » inconnue : Normal par défaut.',
			'Cypress « peut-être » : valeur inconnue, champ laissé vide.',
			'Parent A-900 introuvable : champ laissé vide.'
		]);
		expect(plan.neverCreated).toEqual(['État « En recette » (1 ticket)', 'Assigné « M. Durand » (1 ticket)']);
		expect(drafts[1]).toMatchObject({ stateId: 'st', assigneeId: 'u1', parentKey: 'A-3', priority: 1, flags: { cypress: 'Oui' } });
		expect(drafts[2]).toMatchObject({ parentKey: 'A-0', priority: 1 });
	});

	it('refuse un fichier sans colonne obligatoire, vide ou au-delà du plafond', () => {
		expect(planImport(file(['Titre'], ['Un']), ctx()).plan.fatal).toMatch(/Colonne « Clé » introuvable/);
		expect(planImport(file(['Clé', 'Titre']), ctx()).plan.fatal).toMatch(/Aucune ligne/);
		const big = file(['Clé', 'Titre'], ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => [`A-${i}`, 'x']));
		expect(planImport(big, ctx()).plan.fatal).toMatch(/501 lignes : 500 au plus/);
	});
});

describe('looksLikeTypo', () => {
	it('un caractère en trop ou en moins, ou deux voisins inversés', () => {
		expect(looksLikeTypo('009922Q083', '009922Q0083')).toBe(true);
		expect(looksLikeTypo('009922Q0083', '009922q083')).toBe(true);
		expect(looksLikeTypo('009922Q0038', '009922Q0083')).toBe(true);
	});
	it("ne signale ni un seul caractère différent, ni l'identique, ni le lointain", () => {
		expect(looksLikeTypo('009922Q0084', '009922Q0083')).toBe(false);
		expect(looksLikeTypo('ABC', 'abc')).toBe(false);
		expect(looksLikeTypo('009922B0613', '009922Q0083')).toBe(false);
	});
});

describe('parseImportFile', () => {
	it('CSV Excel français : point-virgule, Windows-1252, zéros de tête conservés', async () => {
		const text = 'Clé;Titre;Code SSP;Estimé\r\nA-1;"Écran; choix";009922;3,5\r\n;;;\r\nA-2;Été;;\r\n';
		const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0)); // é = 0xE9 : invalide en UTF-8
		expect(await parseImportFile(bytes.buffer, 'tickets.csv')).toEqual({
			headers: ['Clé', 'Titre', 'Code SSP', 'Estimé'],
			rows: [
				{ line: 2, cells: ['A-1', 'Écran; choix', '009922', '3,5'] },
				{ line: 4, cells: ['A-2', 'Été', '', ''] }
			]
		});
	});

	it('xlsx : feuille « Tickets », nombres, formules rendues par leur résultat', async () => {
		const wb = new ExcelJS.Workbook();
		wb.addWorksheet('Autre').addRow(['bruit']);
		const ws = wb.addWorksheet('Tickets');
		ws.addRow(['Clé', 'Titre', 'Estimé']);
		ws.addRow(['A-1', 'Un', 2.5]);
		ws.addRow(['A-2', { richText: [{ text: 'De' }, { text: 'ux' }] }, { formula: 'C2*2', result: 5 }]);
		const parsed = await parseImportFile((await wb.xlsx.writeBuffer()) as ArrayBuffer, 'tickets.xlsx');
		expect(parsed.headers).toEqual(['Clé', 'Titre', 'Estimé']);
		expect(parsed.rows).toEqual([
			{ line: 2, cells: ['A-1', 'Un', '2.5'] },
			{ line: 3, cells: ['A-2', 'Deux', '5'] }
		]);
	});
});

describe('applyImport (base réelle)', () => {
	it('crée tickets et référentiels en une fois, puis ignore tout au second passage', async () => {
		const { workspaceId, userId } = await makeWorkspace('import');
		const meta = { fileName: 'essai.xlsx', userId };
		const f = file(
			['Clé', 'Titre', 'Version', 'Sprint', 'Code SSP', 'Parent', 'Estimé', 'Cypress'],
			['IMP-2', 'Enfant', 'V9', 'Sprint 99', '009922Q0083', 'IMP-1', '3,5', 'Oui'],
			['IMP-1', 'Parent', 'V9', '', '', '', '', ''],
			['IMP-3', '', '', '', '', '', '', '']
		);

		const first = await applyImport(workspaceId, f, true, meta, new Set(['sprint:sprint 99']));
		expect(first).toMatchObject({ created: 2, refs: { project: 0, sprint: 0, version: 1, ssp: 1 }, skipped: 0 });
		expect('errors' in first && first.errors.map((e) => e.line)).toEqual([4]);

		const rows = await db.select().from(ticket).where(eq(ticket.workspaceId, workspaceId));
		const child = rows.find((t) => t.key === 'IMP-2')!;
		const parent = rows.find((t) => t.key === 'IMP-1')!;
		expect(rows).toHaveLength(2);
		expect(child).toMatchObject({
			parentId: parent.id,
			sprintId: null,
			estimationReal: '3.50',
			raeReal: '3.50',
			priority: 2,
			flags: '{"cypress":"Oui"}'
		});
		expect(child.versionId).toBe(parent.versionId);
		const [version] = await db.select().from(sprint).where(eq(sprint.id, child.versionId!));
		expect(version).toMatchObject({ name: 'V9', kind: 'VERSION' });
		const [code] = await db.select().from(ssp).where(eq(ssp.id, child.sspId!));
		expect(code).toMatchObject({ code: '009922Q0083', label: '009922Q0083' });

		const again = await applyImport(workspaceId, f, true, meta);
		expect(again).toMatchObject({ importId: null, created: 0, refs: { version: 0, ssp: 0, sprint: 0 }, skipped: 2 });
	});
});

describe('undoImport (base réelle)', () => {
	it('supprime les tickets restés tels qu’importés, garde ceux qui ont servi et leurs parents', async () => {
		const { workspaceId, userId } = await makeWorkspace('undo');
		const f = file(
			['Clé', 'Titre', 'Parent', 'Version'],
			['UND-1', 'Parent', '', 'V-undo'],
			['UND-2', 'Enfant retouché', 'UND-1', ''],
			['UND-3', 'Jamais touché', '', ''],
			['UND-4', 'Enfant intact', 'UND-3', '']
		);
		const res = await applyImport(workspaceId, f, true, { fileName: 'lot.xlsx', userId });
		if ('fatal' in res) throw new Error(res.fatal);
		expect(await listImports(workspaceId)).toMatchObject([{ id: res.importId, fileName: 'lot.xlsx', ticketsCreated: 4, undoneAt: null }]);

		const before = await db.select().from(ticket).where(eq(ticket.workspaceId, workspaceId));
		expect(before.every((t) => t.createdByImportId === res.importId && t.updatedAt.getTime() === t.createdAt.getTime())).toBe(true);

		// « Voir les tickets » : /tickets?import=<lot> n'affiche que ce lot, un id mal formé est ignoré.
		await db.insert(ticket).values({ workspaceId, key: 'HORS-LOT', title: 'Créé à la main' });
		const lotUrl = ticketFiltersFromUrl(new URL(`http://x/tickets?import=${res.importId}`), userId);
		const lot = await listTicketsPage(workspaceId, true, true, lotUrl.filters);
		expect(lot.rows.map((t) => t.key).sort()).toEqual(['UND-1', 'UND-2', 'UND-3', 'UND-4']);
		expect(ticketFiltersFromUrl(new URL('http://x/tickets?import=nimporte'), userId).filters.importId).toBeUndefined();

		// Une vraie édition, par le même chemin que l'écran Tickets.
		await updateTicketField(workspaceId, before.find((t) => t.key === 'UND-2')!.id, 'comment', 'repris à la main');

		expect(await undoImport(workspaceId, res.importId!, userId)).toEqual({ deleted: 2, kept: 2 });
		const after = await db.select({ key: ticket.key }).from(ticket).where(eq(ticket.workspaceId, workspaceId));
		expect(after.map((t) => t.key).sort()).toEqual(['HORS-LOT', 'UND-1', 'UND-2']);
		// Le référentiel créé par l'import reste en place.
		expect(await db.select().from(sprint).where(eq(sprint.workspaceId, workspaceId))).toHaveLength(1);

		expect((await listImports(workspaceId))[0].undoneAt).toBeInstanceOf(Date);
		await expect(undoImport(workspaceId, res.importId!, userId)).rejects.toThrow('déjà été annulé');
		const other = await makeWorkspace('undo-autre');
		await expect(undoImport(other.workspaceId, res.importId!, other.userId)).rejects.toThrow('introuvable');
	});
});
