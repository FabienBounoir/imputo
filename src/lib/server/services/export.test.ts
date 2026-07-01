import { describe, it, expect, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { db, workspace } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { createTicket } from './tickets';
import { setCell } from './imputation';
import { buildWorkbook } from '../excel/export';
import { toISODate } from '$lib/utils/date';

const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id));
});

describe('export buildWorkbook', () => {
	it('génère un classeur non vide avec des données (toutes les feuilles)', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'Export',
			email: `exp-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Export'
		});
		wsIds.push(a.workspaceId);

		const t = await createTicket(a.workspaceId, { key: `E-${rnd}`, title: 'Ticket export', estimationReal: '2' });
		const today = toISODate(new Date());
		await setCell(a.workspaceId, a.userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: today,
			amount: 1
		});

		const buf = await buildWorkbook(a.workspaceId, 'Espace Export', { from: today, to: today });
		// Un .xlsx valide (zip) fait largement plus de 1 ko et commence par "PK".
		expect(buf.byteLength).toBeGreaterThan(1000);
		expect(new Uint8Array(buf).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
	});

	it('feuille "Par personne" : grille jour-par-jour (1 colonne = 1 jour)', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'Grid',
			email: `grid-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace Grid'
		});
		wsIds.push(a.workspaceId);

		const t = await createTicket(a.workspaceId, { key: `G-${rnd}`, title: 'Ticket grille', estimationReal: '2' });
		const d1 = '2026-06-01'; // lundi
		const d2 = '2026-06-02'; // mardi
		for (const [day, amount] of [[d1, 1], [d2, 0.5]] as const)
			await setCell(a.workspaceId, a.userId, { targetType: 'TICKET', targetId: t.id, activityId: null, day, amount });

		const buf = await buildWorkbook(a.workspaceId, 'Espace Grid', { from: d1, to: d2, sheets: ['personne'] });
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(buf);
		const sheet = wb.getWorksheet('Par personne')!;

		// En-tête de grille : deux colonnes jour (lun. 01/06, mar. 02/06) + Σ.
		const headers: string[] = [];
		sheet.eachRow((row) => {
			if (row.getCell(1).value === 'Tâche / catégorie')
				row.eachCell((c) => headers.push(String(c.value)));
		});
		expect(headers).toContain('lun. 01/06');
		expect(headers).toContain('mar. 02/06');
		expect(headers).toContain('Σ');

		// Ligne "Total / jour" : 1 + 0,5 sur les deux jours = 1,5 au total.
		let footTotal: unknown;
		sheet.eachRow((row) => {
			if (row.getCell(1).value === 'Total / jour') footTotal = row.getCell(4).value; // libellé + 2 jours + Σ
		});
		expect(footTotal).toBe(1.5);
	});
});
