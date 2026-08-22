import { describe, it, expect } from 'vitest';
import { buildObjectivesSvg } from './objectivesSvg';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { setMemberFactice } from '$lib/server/services/accounts';

describe('buildObjectivesSvg', () => {
	it('exclut un membre "factice" pour tout le monde, sans distinction de rôle (cf. la page en ligne)', async () => {
		const ws = await makeWorkspace('objsvg');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'objsvg-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const { svg } = await buildObjectivesSvg(ws.workspaceId, '2026-06-22');

		expect(svg).not.toContain('objsvg-factice');
		expect(svg).toContain('objsvg owner');
	});
});
