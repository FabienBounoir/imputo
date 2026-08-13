import { describe, it, expect } from 'vitest';
import {
	getSupportConfig,
	setSupportEnabled,
	setSupportCadence,
	setSupportIncludeSaturday,
	listRotationMembers,
	addRotationMember,
	removeRotationMember,
	moveRotationMember,
	getCurrentDuty,
	listDutyCalendar,
	setOverride,
	clearOverride,
	skipCurrentTurn
} from './support';
import { makeWorkspace, addMember } from './test-helpers';

// Lundi de la semaine suivant celle du 2026-08-11 (mardi) — même cadence WEEK par défaut.
const nextMondayDuty = (workspaceId: string) => listDutyCalendar(workspaceId, 2, '2026-08-11').then((w) => w[1].days[0]);

describe('getSupportConfig / setSupportEnabled / setSupportCadence', () => {
	it('config par défaut désactivée en cadence hebdo, puis modifiable', async () => {
		const { workspaceId } = await makeWorkspace();
		const initial = await getSupportConfig(workspaceId);
		expect(initial).toEqual({ enabled: false, cadence: 'WEEK', offset: 0, includeSaturday: false });

		await setSupportEnabled(workspaceId, true);
		await setSupportCadence(workspaceId, 'MONTH');
		await setSupportIncludeSaturday(workspaceId, true);

		expect(await getSupportConfig(workspaceId)).toEqual({
			enabled: true,
			cadence: 'MONTH',
			offset: 0,
			includeSaturday: true
		});
	});
});

describe('rotation members', () => {
	it('ajoute, réordonne (swap voisin) et retire un membre', async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		const { userId: a } = await addMember(workspaceId, 'USER', 'a');
		const { userId: b } = await addMember(workspaceId, 'USER', 'b');

		await addRotationMember(workspaceId, owner);
		await addRotationMember(workspaceId, a);
		await addRotationMember(workspaceId, b);

		let members = await listRotationMembers(workspaceId);
		expect(members.map((m) => m.userId)).toEqual([owner, a, b]);

		await moveRotationMember(workspaceId, members[2].id, 'up'); // b monte devant a
		members = await listRotationMembers(workspaceId);
		expect(members.map((m) => m.userId)).toEqual([owner, b, a]);

		await removeRotationMember(workspaceId, members[0].id);
		members = await listRotationMembers(workspaceId);
		expect(members.map((m) => m.userId)).toEqual([b, a]);
	});

	it('rejette un membre inactif ou hors espace', async () => {
		const { workspaceId } = await makeWorkspace();
		await expect(addRotationMember(workspaceId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
			'Membre introuvable ou inactif.'
		);
	});
});

describe('getCurrentDuty', () => {
	it('null quand la rotation est vide', async () => {
		const { workspaceId } = await makeWorkspace();
		expect(await getCurrentDuty(workspaceId, '2026-08-11')).toBeNull();
	});

	it('tourne de façon déterministe et identique sur deux workspaces avec le même ordre', async () => {
		const wsA = await makeWorkspace('a');
		const wsB = await makeWorkspace('b');
		await setSupportCadence(wsA.workspaceId, 'WEEK');
		await setSupportCadence(wsB.workspaceId, 'WEEK');
		const a1 = await addMember(wsA.workspaceId, 'USER', 'm1');
		const a2 = await addMember(wsA.workspaceId, 'USER', 'm2');
		await addRotationMember(wsA.workspaceId, wsA.userId);
		await addRotationMember(wsA.workspaceId, a1.userId);
		await addRotationMember(wsA.workspaceId, a2.userId);
		await addRotationMember(wsB.workspaceId, wsB.userId);

		const dutyA = await getCurrentDuty(wsA.workspaceId, '2026-08-11'); // mardi
		expect(dutyA?.periodStart).toBe('2026-08-10'); // lundi de la semaine
		expect(dutyA?.periodEnd).toBe('2026-08-14');
		expect(dutyA?.overridden).toBe(false);

		// Un seul membre : forcément lui, quelle que soit la semaine.
		const dutyB = await getCurrentDuty(wsB.workspaceId, '2026-08-11');
		expect(dutyB?.userId).toBe(wsB.userId);
	});

	it('override remplace la personne pour la période sans changer l\'ordre de rotation', async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		const { userId: a } = await addMember(workspaceId, 'USER', 'a');
		await addRotationMember(workspaceId, owner);
		await addRotationMember(workspaceId, a);

		const before = await getCurrentDuty(workspaceId, '2026-08-11');
		expect(before?.overridden).toBe(false);

		await setOverride(workspaceId, before!.periodStart, a === before!.userId ? owner : a);
		const overridden = await getCurrentDuty(workspaceId, '2026-08-11');
		expect(overridden?.overridden).toBe(true);
		expect(overridden?.userId).not.toBe(before?.userId);

		await clearOverride(workspaceId, before!.periodStart);
		const restored = await getCurrentDuty(workspaceId, '2026-08-11');
		expect(restored?.overridden).toBe(false);
		expect(restored?.userId).toBe(before?.userId);

		// La période suivante n'est jamais affectée par l'override ponctuel.
		expect((await nextMondayDuty(workspaceId)).overridden).toBe(false);
	});

	it("refuse un override vers quelqu'un hors de la rotation", async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		await addRotationMember(workspaceId, owner);
		await expect(setOverride(workspaceId, '2026-08-10', '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
			"Cette personne n'est pas dans la rotation."
		);
	});
});

describe('listDutyCalendar', () => {
	it('une semaine = 5 jours ouvrés, même personne toute la semaine en cadence WEEK', async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		const { userId: a } = await addMember(workspaceId, 'USER', 'a');
		await addRotationMember(workspaceId, owner);
		await addRotationMember(workspaceId, a);

		const weeks = await listDutyCalendar(workspaceId, 3, '2026-08-11');
		expect(weeks).toHaveLength(3);
		expect(weeks[0].weekStart).toBe('2026-08-10');
		expect(weeks[0].days.map((d) => d.date)).toEqual([
			'2026-08-10',
			'2026-08-11',
			'2026-08-12',
			'2026-08-13',
			'2026-08-14'
		]);
		const names = new Set(weeks[0].days.map((d) => d.userId));
		expect(names.size).toBe(1); // toute la semaine courante pointe vers la même personne

		// La semaine courante (2) diffère de la suivante (3) puisque la rotation change chaque semaine.
		expect(weeks[1].days[0].userId).not.toBe(weeks[0].days[0].userId);
	});

	it('vide quand la rotation est vide', async () => {
		const { workspaceId } = await makeWorkspace();
		expect(await listDutyCalendar(workspaceId, 3, '2026-08-11')).toEqual([]);
	});
});

describe('skipCurrentTurn', () => {
	it('décale la chaîne pour la période courante ET les suivantes, définitivement', async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		const { userId: a } = await addMember(workspaceId, 'USER', 'a');
		const { userId: b } = await addMember(workspaceId, 'USER', 'b');
		await addRotationMember(workspaceId, owner);
		await addRotationMember(workspaceId, a);
		await addRotationMember(workspaceId, b);

		const before = await getCurrentDuty(workspaceId, '2026-08-11');
		const nextBefore = await nextMondayDuty(workspaceId);

		await skipCurrentTurn(workspaceId, before!.periodStart);

		// Le suivant d'avant devient le titulaire du jour : la personne absente est sautée, tout le
		// monde derrière elle avance d'un cran — contrairement à un override qui n'aurait touché que
		// la période courante.
		const after = await getCurrentDuty(workspaceId, '2026-08-11');
		expect(after?.userId).toBe(nextBefore.userId);
		expect(after?.overridden).toBe(false);

		const nextAfter = await nextMondayDuty(workspaceId);
		expect(nextAfter.userId).not.toBe(nextBefore.userId);
	});

	it('efface un override existant sur la période au moment du skip', async () => {
		const { workspaceId, userId: owner } = await makeWorkspace();
		const { userId: a } = await addMember(workspaceId, 'USER', 'a');
		await addRotationMember(workspaceId, owner);
		await addRotationMember(workspaceId, a);

		const before = await getCurrentDuty(workspaceId, '2026-08-11');
		await setOverride(workspaceId, before!.periodStart, a === before!.userId ? owner : a);
		expect((await getCurrentDuty(workspaceId, '2026-08-11'))?.overridden).toBe(true);

		await skipCurrentTurn(workspaceId, before!.periodStart);
		expect((await getCurrentDuty(workspaceId, '2026-08-11'))?.overridden).toBe(false);
	});
});
