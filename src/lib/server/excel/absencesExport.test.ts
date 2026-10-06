import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildAbsencesWorkbook } from './absencesExport';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { setMemberFactice } from '$lib/server/services/accounts';

describe('buildAbsencesWorkbook', () => {
	it('isAdmin=false exclut un membre "factice" de la feuille ; isAdmin=true (défaut) le garde', async () => {
		const ws = await makeWorkspace('absxls');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'absxls-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const withFactice = await buildAbsencesWorkbook(ws.workspaceId, '2026-06-01', 1);
		const wbWith = new ExcelJS.Workbook();
		await wbWith.xlsx.load(withFactice);
		const namesWith: string[] = [];
		wbWith.worksheets[0].eachRow((row) => namesWith.push(String(row.getCell(1).value)));
		expect(namesWith).toContain('absxls-factice');

		const withoutFactice = await buildAbsencesWorkbook(ws.workspaceId, '2026-06-01', 1, false);
		const wbWithout = new ExcelJS.Workbook();
		await wbWithout.xlsx.load(withoutFactice);
		const namesWithout: string[] = [];
		wbWithout.worksheets[0].eachRow((row) => namesWithout.push(String(row.getCell(1).value)));
		expect(namesWithout).not.toContain('absxls-factice');
		expect(namesWithout).toContain('absxls owner');
	});

	it('colore en rouge pâle la colonne d\'un jour férié (1er mai 2026), pas un jour ouvré normal', async () => {
		const ws = await makeWorkspace('absxls-ferie');
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await buildAbsencesWorkbook(ws.workspaceId, '2026-05-01', 1));
		const sheet = wb.worksheets[0];
		const fg = (day: number) => (sheet.getRow(3).getCell(1 + day).fill as ExcelJS.FillPattern).fgColor?.argb;
		expect(fg(1)).toBe('FFF6E1DF'); // 1er mai, vendredi férié
		expect(fg(4)).not.toBe('FFF6E1DF'); // lundi 4 mai, ouvré
	});
});
