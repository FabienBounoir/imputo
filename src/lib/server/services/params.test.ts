import { describe, it, expect } from 'vitest';
import { makeWorkspace } from './test-helpers';
import {
	listCategories,
	createCategory,
	renameCategory,
	setCategoryKind,
	setCategoryArchived,
	listActivities,
	createActivity,
	renameActivity,
	setActivityActive,
	countActivityUsage,
	deleteActivity,
	reorderActivities,
	listStates,
	createState,
	updateState,
	moveState,
	deleteState
} from './params';

describe('params — catégories', () => {
	it('crée, renomme, change de nature et archive une catégorie', async () => {
		const { workspaceId } = await makeWorkspace('cat');

		await createCategory(workspaceId, 'Réunion', 'PRODUCTIVE');
		let cats = await listCategories(workspaceId);
		const c = cats.find((x) => x.label === 'Réunion');
		expect(c).toMatchObject({ kind: 'PRODUCTIVE', archived: false, usage: 0 });

		await renameCategory(workspaceId, c!.id, 'Réunion client');
		await setCategoryKind(workspaceId, c!.id, 'NON_PRODUCTIVE');
		await setCategoryArchived(workspaceId, c!.id, true);

		cats = await listCategories(workspaceId);
		const updated = cats.find((x) => x.id === c!.id);
		expect(updated).toMatchObject({ label: 'Réunion client', kind: 'NON_PRODUCTIVE', archived: true });
	});

	it('refuse deux catégories actives de même nom (insensible à la casse)', async () => {
		const { workspaceId } = await makeWorkspace('cat-dup');
		await createCategory(workspaceId, 'Support', 'PRODUCTIVE');
		await expect(createCategory(workspaceId, 'support', 'PRODUCTIVE')).rejects.toThrow();
	});

	it('renameCategory sur un id inexistant échoue', async () => {
		const { workspaceId } = await makeWorkspace('cat-404');
		await expect(renameCategory(workspaceId, crypto.randomUUID(), 'X')).rejects.toThrow();
	});
});

describe('params — activités', () => {
	it('crée, renomme, désactive/réactive une activité', async () => {
		const { workspaceId } = await makeWorkspace('act');
		await createActivity(workspaceId, 'Développement');
		let acts = await listActivities(workspaceId);
		const a = acts.find((x) => x.label === 'Développement');
		expect(a).toMatchObject({ archived: false, usage: 0 });

		await renameActivity(workspaceId, a!.id, 'Développement backend');
		await setActivityActive(workspaceId, a!.id, false);
		acts = await listActivities(workspaceId);
		expect(acts.find((x) => x.id === a!.id)).toMatchObject({ label: 'Développement backend', archived: true });

		await setActivityActive(workspaceId, a!.id, true);
		acts = await listActivities(workspaceId);
		expect(acts.find((x) => x.id === a!.id)?.archived).toBe(false);
	});

	it('deleteActivity supprime une activité inutilisée', async () => {
		const { workspaceId } = await makeWorkspace('act-del');
		await createActivity(workspaceId, 'Jetable');
		const acts = await listActivities(workspaceId);
		const a = acts.find((x) => x.label === 'Jetable')!;
		expect(await countActivityUsage(workspaceId, a.id)).toBe(0);

		await deleteActivity(workspaceId, a.id);
		const after = await listActivities(workspaceId);
		expect(after.find((x) => x.id === a.id)).toBeUndefined();
	});

	it('deleteActivity refuse si l’activité est utilisée par une imputation', async () => {
		const { workspaceId, userId } = await makeWorkspace('act-used');
		await createActivity(workspaceId, 'Utilisée');
		const a = (await listActivities(workspaceId)).find((x) => x.label === 'Utilisée')!;
		await createCategory(workspaceId, 'Cat imputation', 'PRODUCTIVE');
		const cat = (await listCategories(workspaceId)).find((x) => x.label === 'Cat imputation')!;

		const { setCell } = await import('./imputation');
		await setCell(workspaceId, userId, {
			targetType: 'CATEGORY',
			targetId: cat.id,
			activityId: a.id,
			day: '2026-06-23',
			amount: 1
		});

		expect(await countActivityUsage(workspaceId, a.id)).toBeGreaterThan(0);
		await expect(deleteActivity(workspaceId, a.id)).rejects.toThrow();
	});

	it('reorderActivities applique le nouvel ordre et ignore les id d’un autre espace', async () => {
		// Un espace neuf a déjà des activités par défaut (seedDefaults) : on regarde uniquement
		// nos 3 nouvelles activités, pas la position absolue dans la liste complète.
		const ws = await makeWorkspace('act-reorder');
		const other = await makeWorkspace('act-reorder-other');
		await createActivity(ws.workspaceId, 'A');
		await createActivity(ws.workspaceId, 'B');
		await createActivity(ws.workspaceId, 'C');
		await createActivity(other.workspaceId, 'X');
		const byLabel = <T extends { label: string }>(rows: T[]) => rows.filter((r) => ['A', 'B', 'C'].includes(r.label));
		const [a, b, c] = byLabel(await listActivities(ws.workspaceId));
		const [x] = (await listActivities(other.workspaceId)).filter((r) => r.label === 'X');
		expect([a.label, b.label, c.label]).toEqual(['A', 'B', 'C']); // ordre de création par défaut

		await reorderActivities(ws.workspaceId, [c.id, a.id, x.id, b.id]);

		expect(byLabel(await listActivities(ws.workspaceId)).map((r) => r.label)).toEqual(['C', 'A', 'B']);
		expect((await listActivities(other.workspaceId)).map((r) => r.label)).toContain('X');
	});
});

describe('params — états', () => {
	it('crée des états et les réordonne avec moveState', async () => {
		// L'espace a déjà des états par défaut (seedDefaults) : les nôtres arrivent en dernier
		// (sortOrder croissant), donc on ne regarde que les 3 dernières lignes.
		const { workspaceId } = await makeWorkspace('state');
		await createState(workspaceId, 'À faire', '📝', '#112233');
		await createState(workspaceId, 'En cours', '🚧', '#445566');
		await createState(workspaceId, 'Fait', '✅', '#778899');

		let states = await listStates(workspaceId);
		const [first, second, third] = states.slice(-3);
		expect([first.label, second.label, third.label]).toEqual(['À faire', 'En cours', 'Fait']);

		await moveState(workspaceId, third.id, 'up');
		states = await listStates(workspaceId);
		expect(states.slice(-3).map((s) => s.label)).toEqual(['À faire', 'Fait', 'En cours']);

		await updateState(workspaceId, first.id, { label: 'À traiter', color: '#000000' });
		states = await listStates(workspaceId);
		expect(states.find((s) => s.id === first.id)).toMatchObject({ label: 'À traiter', color: '#000000' });
	});

	it('moveState ne fait rien sur les bords (premier vers le haut, dernier vers le bas)', async () => {
		const { workspaceId } = await makeWorkspace('state-edge');
		await createState(workspaceId, 'Unique A', '', '#111111');
		await createState(workspaceId, 'Unique B', '', '#222222');
		const before = await listStates(workspaceId);

		await moveState(workspaceId, before[0].id, 'up');
		await moveState(workspaceId, before[before.length - 1].id, 'down');

		const after = await listStates(workspaceId);
		expect(after.map((s) => s.sortOrder)).toEqual(before.map((s) => s.sortOrder));
	});

	it('updateState rejette une couleur non hexadécimale', async () => {
		const { workspaceId } = await makeWorkspace('state-color');
		await createState(workspaceId, 'X', '', '#123456');
		const [s] = await listStates(workspaceId);
		await expect(updateState(workspaceId, s.id, { color: 'not-a-color' })).rejects.toThrow();
	});

	it('deleteState supprime un état', async () => {
		const { workspaceId } = await makeWorkspace('state-del');
		await createState(workspaceId, 'À supprimer', '', '#123123');
		const [s] = await listStates(workspaceId);
		await deleteState(workspaceId, s.id);
		expect((await listStates(workspaceId)).find((x) => x.id === s.id)).toBeUndefined();
	});
});
