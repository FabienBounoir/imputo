import { describe, it, expect } from 'vitest';
import { load as loadUntyped } from './+page.server';
import { makeWorkspace } from '$lib/server/services/test-helpers';
import { fakeLocals, fakeCookies } from '$lib/server/test-helpers/http';
import { createTicket } from '$lib/server/services/tickets';
import { setCell, pinRow } from '$lib/server/services/imputation';
import { addObjective, setObjectivesEnabled, listObjectivesForUser } from '$lib/server/services/weeklyObjectives';
import { mondayOf, parseISODate, toISODate, todayInParis } from '$lib/utils/date';

const load = loadUntyped as (event: unknown) => Promise<Record<string, any>>;
const event = async (userId: string, search = '') => ({
	locals: await fakeLocals(userId),
	cookies: fakeCookies(),
	url: new URL(`http://localhost/imputation${search}`),
	depends: () => {}
});

const lundiCourant = () => toISODate(mondayOf(parseISODate(todayInParis())));

/**
 * `tickets` n'est plus le catalogue complet mais une graine bornée par ce qui est réellement à
 * l'écran (cf. +page.server.ts). Ces tests verrouillent les DEUX moitiés du contrat, car une
 * régression d'un côté comme de l'autre est invisible au type-checking :
 *  - trop peu → une ligne déjà saisie s'affiche sans titre ni sprint (buildRow ne la résout plus) ;
 *  - trop → on réembarque tout le backlog dans la page, ce que la graine visait à supprimer.
 */
describe('imputation +page.server load — graine de tickets', () => {
	it('contient le ticket d’une ligne déjà saisie', async () => {
		const { userId, workspaceId } = await makeWorkspace('imp-sheet');
		const t = await createTicket(workspaceId, { key: 'SEED-1', title: 'Ligne saisie' });
		await setCell(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: lundiCourant(),
			amount: 1
		});

		const res = await load(await event(userId));
		expect(res.tickets.map((x: { key: string }) => x.key)).toContain('SEED-1');
	});

	it('contient le ticket d’une ligne épinglée sans heures', async () => {
		const { userId, workspaceId } = await makeWorkspace('imp-pin');
		const t = await createTicket(workspaceId, { key: 'SEED-2', title: 'Épinglé' });
		const lundi = lundiCourant();
		await pinRow(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			firstDay: lundi,
			lastDay: lundi
		});

		const res = await load(await event(userId));
		expect(res.tickets.map((x: { key: string }) => x.key)).toContain('SEED-2');
	});

	it('contient le ticket d’un objectif attribué', async () => {
		const { userId, workspaceId } = await makeWorkspace('imp-obj');
		await setObjectivesEnabled(workspaceId, true);
		const t = await createTicket(workspaceId, { key: 'SEED-3', title: 'Objectif' });
		await addObjective(workspaceId, userId, {
			userId,
			weekMondayISO: lundiCourant(),
			kind: 'TICKET',
			ticketId: t.id
		});
		expect(await listObjectivesForUser(workspaceId, userId, lundiCourant())).toHaveLength(1);

		const res = await load(await event(userId));
		expect(res.tickets.map((x: { key: string }) => x.key)).toContain('SEED-3');
	});

	it('n’embarque PAS un ticket que rien n’amène à l’écran', async () => {
		const { userId, workspaceId } = await makeWorkspace('imp-noise');
		await createTicket(workspaceId, { key: 'SEED-4', title: 'Utilisé' });
		// Bruit : jamais imputé, jamais épinglé, jamais attribué — il ne doit pas voyager.
		for (let i = 0; i < 30; i++) await createTicket(workspaceId, { key: `NOISE-${i}`, title: `Bruit ${i}` });

		const res = await load(await event(userId));
		expect(res.tickets.some((x: { key: string }) => x.key.startsWith('NOISE-'))).toBe(false);
	});

	it('les résumés portent bien sprint et version, dont buildRow a besoin', async () => {
		const { userId, workspaceId } = await makeWorkspace('imp-shape');
		const t = await createTicket(workspaceId, { key: 'SEED-5', title: 'Forme' });
		await setCell(workspaceId, userId, {
			targetType: 'TICKET',
			targetId: t.id,
			activityId: null,
			day: lundiCourant(),
			amount: 0.5
		});

		const res = await load(await event(userId));
		expect(res.tickets.find((x: { key: string }) => x.key === 'SEED-5')).toEqual({
			id: t.id,
			key: 'SEED-5',
			title: 'Forme',
			sprintId: null,
			versionId: null,
			sprintName: null
		});
	});

	it('espace sans objectifs : aucun objectif chargé, donc aucun bandeau ni ligne auto-épinglée', async () => {
		const { userId } = await makeWorkspace('imp-off');
		const res = await load(await event(userId));
		expect(res.objectivesEnabled).toBe(false);
		expect(res.weeklyObjectives).toEqual([]);
	});
});
