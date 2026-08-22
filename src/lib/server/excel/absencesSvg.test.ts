import { describe, it, expect } from 'vitest';
import { buildAbsencesSvg } from './absencesSvg';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { setMemberFactice } from '$lib/server/services/accounts';

describe('buildAbsencesSvg', () => {
	it('isAdmin=false exclut un membre "factice" du SVG ; isAdmin=true (défaut) le garde', async () => {
		const ws = await makeWorkspace('abssvg');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'abssvg-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const { svg: svgWith } = await buildAbsencesSvg(ws.workspaceId, '2026-06-01', '2026-06-07');
		expect(svgWith).toContain('abssvg-factice');

		const { svg: svgWithout } = await buildAbsencesSvg(ws.workspaceId, '2026-06-01', '2026-06-07', null, false);
		expect(svgWithout).not.toContain('abssvg-factice');
		expect(svgWithout).toContain('abssvg owner');
	});

	it('un rowIds ciblant un factice pour un non-admin ne le fait pas réapparaître', async () => {
		const ws = await makeWorkspace('abssvg-bypass');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'abssvg-bypass-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const { svg } = await buildAbsencesSvg(ws.workspaceId, '2026-06-01', '2026-06-07', [facticeId], false);
		expect(svg).not.toContain('abssvg-bypass-factice');
	});
});
