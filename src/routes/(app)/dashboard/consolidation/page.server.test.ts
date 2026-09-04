import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { fakeLocals } from '$lib/server/test-helpers/http';
import { createPerimeter, setPerimeterMemberRole } from '$lib/server/services/perimeters';
import { createTicket } from '$lib/server/services/tickets';

const url = (search = '') => new URL(`http://localhost/dashboard/consolidation${search}`);

describe('dashboard/consolidation +page.server load', () => {
	it('le DP voit tous les périmètres', async () => {
		const { userId, workspaceId } = await makeWorkspace('cons-load');
		const p = await createPerimeter(workspaceId, 'Paiement', null, false);
		await createTicket(workspaceId, { key: `CL-${p.slice(0, 8)}`, title: 'x', perimeterId: p, estimationReal: '5' });

		const data = await load({ locals: await fakeLocals(userId), url: url() } as never);
		expect(data.consolidation.rows.some((r: { perimeterId: string | null }) => r.perimeterId === p)).toBe(true);
		expect(data.consolidation.partial).toBe(false);
	});

	it('un membre qui ne pilote aucun périmètre est redirigé', async () => {
		const { workspaceId } = await makeWorkspace('cons-load');
		const { userId } = await addMember(workspaceId, 'USER', 'cons-nobody');
		await expect(load({ locals: await fakeLocals(userId), url: url() } as never)).rejects.toMatchObject({
			status: 303
		});
	});

	it('les filtres viennent de l’URL (périmètres, transverses)', async () => {
		const { userId, workspaceId } = await makeWorkspace('cons-load');
		const applicatif = await createPerimeter(workspaceId, 'Applicatif', null, false);
		await createPerimeter(workspaceId, 'Chantiers', null, true);

		const filtered = await load({
			locals: await fakeLocals(userId),
			url: url(`?perimeters=${applicatif}`)
		} as never);
		expect(filtered.consolidation.rows).toHaveLength(1);
		expect(filtered.selectedPerimeterIds).toEqual([applicatif]);

		const noTransverse = await load({ locals: await fakeLocals(userId), url: url('?transverse=0') } as never);
		expect(noTransverse.includeTransverse).toBe(false);
		expect(
			noTransverse.consolidation.rows.every((r: { transverse: boolean }) => !r.transverse)
		).toBe(true);
	});

	it('un CP accède à la page et la vue est signalée partielle', async () => {
		const { workspaceId } = await makeWorkspace('cons-load');
		const { userId } = await addMember(workspaceId, 'USER', 'cons-cp');
		const mien = await createPerimeter(workspaceId, 'Le mien', null, false);
		await setPerimeterMemberRole(workspaceId, mien, userId, 'CP');

		const data = await load({ locals: await fakeLocals(userId), url: url() } as never);
		expect(data.consolidation.partial).toBe(true);
		expect(data.consolidation.rows.find((r: { perimeterId: string | null }) => r.perimeterId === mien)?.lead).toBe(true);
	});
});
