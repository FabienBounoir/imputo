import { describe, it, expect } from 'vitest';
import { makeWorkspace, addMember } from './test-helpers';
import {
	listObjectivesForUser,
	listObjectivesForUserWeeks,
	listObjectivesForWorkspace,
	listVacationsForWeek,
	isOnVacation,
	vacationWeeks,
	addObjective,
	moveObjective,
	setVacation
} from './weeklyObjectives';

const WEEK_1 = '2026-06-22';
const WEEK_2 = '2026-06-29';

describe('weeklyObjectives — listing', () => {
	it('listObjectivesForUser ne renvoie que les objectifs de la bonne semaine', async () => {
		const { workspaceId, userId } = await makeWorkspace('wo-user');
		await addObjective(workspaceId, userId, {
			userId,
			weekMondayISO: WEEK_1,
			kind: 'CUSTOM',
			label: 'Semaine 1'
		});
		await addObjective(workspaceId, userId, {
			userId,
			weekMondayISO: WEEK_2,
			kind: 'CUSTOM',
			label: 'Semaine 2'
		});

		const week1 = await listObjectivesForUser(workspaceId, userId, WEEK_1);
		expect(week1.map((o) => o.label)).toEqual(['Semaine 1']);

		const both = await listObjectivesForUserWeeks(workspaceId, userId, [WEEK_1, WEEK_2]);
		expect(both.map((o) => o.label).sort()).toEqual(['Semaine 1', 'Semaine 2']);

		expect(await listObjectivesForUserWeeks(workspaceId, userId, [])).toEqual([]);
	});

	it('crée des objectifs et les réordonne avec moveObjective, sans effet sur une autre semaine', async () => {
		const { workspaceId, userId } = await makeWorkspace('wo-order');
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_1, kind: 'CUSTOM', label: 'A' });
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_1, kind: 'CUSTOM', label: 'B' });
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_1, kind: 'CUSTOM', label: 'C' });
		await addObjective(workspaceId, userId, { userId, weekMondayISO: WEEK_2, kind: 'CUSTOM', label: 'Autre semaine' });

		let week1 = await listObjectivesForUser(workspaceId, userId, WEEK_1);
		expect(week1.map((o) => o.label)).toEqual(['A', 'B', 'C']);

		await moveObjective(workspaceId, week1[2].id, 'up');
		week1 = await listObjectivesForUser(workspaceId, userId, WEEK_1);
		expect(week1.map((o) => o.label)).toEqual(['A', 'C', 'B']);

		// Bord : monter le premier ne fait rien.
		await moveObjective(workspaceId, week1[0].id, 'up');
		week1 = await listObjectivesForUser(workspaceId, userId, WEEK_1);
		expect(week1.map((o) => o.label)).toEqual(['A', 'C', 'B']);

		const week2 = await listObjectivesForUser(workspaceId, userId, WEEK_2);
		expect(week2.map((o) => o.label)).toEqual(['Autre semaine']);
	});

	it('listObjectivesForWorkspace agrège tous les membres avec leur displayName', async () => {
		const { workspaceId, userId: ownerId } = await makeWorkspace('wo-ws');
		const { userId: memberId } = await addMember(workspaceId, 'USER', 'wo-member');

		await addObjective(workspaceId, ownerId, {
			userId: ownerId,
			weekMondayISO: WEEK_1,
			kind: 'CUSTOM',
			label: 'Objectif owner'
		});
		await addObjective(workspaceId, ownerId, {
			userId: memberId,
			weekMondayISO: WEEK_1,
			kind: 'CUSTOM',
			label: 'Objectif membre'
		});

		const all = await listObjectivesForWorkspace(workspaceId, WEEK_1);
		expect(all).toHaveLength(2);
		expect(all.every((o) => typeof o.displayName === 'string' && o.displayName.length > 0)).toBe(true);
	});
});

describe('weeklyObjectives — vacances', () => {
	it('setVacation active/désactive et isOnVacation/vacationWeeks/listVacationsForWeek reflètent l’état', async () => {
		const { workspaceId, userId } = await makeWorkspace('wo-vac');

		expect(await isOnVacation(workspaceId, userId, WEEK_1)).toBe(false);

		await setVacation(workspaceId, userId, WEEK_1, true);
		expect(await isOnVacation(workspaceId, userId, WEEK_1)).toBe(true);
		expect(await listVacationsForWeek(workspaceId, WEEK_1)).toEqual(new Set([userId]));
		expect(await vacationWeeks(workspaceId, userId, [WEEK_1, WEEK_2])).toEqual([WEEK_1]);

		// Idempotent (onConflictDoNothing).
		await setVacation(workspaceId, userId, WEEK_1, true);
		expect(await vacationWeeks(workspaceId, userId, [WEEK_1, WEEK_2])).toEqual([WEEK_1]);

		await setVacation(workspaceId, userId, WEEK_1, false);
		expect(await isOnVacation(workspaceId, userId, WEEK_1)).toBe(false);
		expect(await listVacationsForWeek(workspaceId, WEEK_1)).toEqual(new Set());
	});

	it('addObjective refuse d’attribuer un objectif à quelqu’un en vacances cette semaine-là', async () => {
		const { workspaceId, userId } = await makeWorkspace('wo-vac-block');
		await setVacation(workspaceId, userId, WEEK_1, true);

		await expect(
			addObjective(workspaceId, userId, {
				userId,
				weekMondayISO: WEEK_1,
				kind: 'CUSTOM',
				label: 'Impossible'
			})
		).rejects.toThrow();

		// La semaine suivante, sans congé, ça passe.
		await addObjective(workspaceId, userId, {
			userId,
			weekMondayISO: WEEK_2,
			kind: 'CUSTOM',
			label: 'Possible'
		});
		const week2 = await listObjectivesForUser(workspaceId, userId, WEEK_2);
		expect(week2.map((o) => o.label)).toEqual(['Possible']);
	});
});
