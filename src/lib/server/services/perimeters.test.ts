import { describe, it, expect } from 'vitest';
import { makeWorkspace, addMember, defaultPerimeterId } from './test-helpers';
import { createTicket } from './tickets';
import {
	listPerimeters,
	listActivePerimeters,
	createPerimeter,
	updatePerimeter,
	setPerimeterArchived,
	movePerimeter,
	setPerimeterMemberRole,
	listPerimeterCollaborators,
	loadPerimeterCtx,
	resolveDefaultPerimeterId,
	canLead,
	leadScope,
	hasLeadScope,
	isLeadRole,
	EMPTY_PERIMETER_CTX
} from './perimeters';

describe('perimeters — prédicats', () => {
	it('CP et backup sont tous deux des rôles de pilotage', () => {
		expect(isLeadRole('CP')).toBe(true);
		expect(isLeadRole('CP_BACKUP')).toBe(true);
		expect(isLeadRole('CONTRIBUTOR')).toBe(false);
	});

	it('le DP pilote tout périmètre, y compris un qu’il ne connaît pas', () => {
		const dp = { ...EMPTY_PERIMETER_CTX, role: 'ADMIN' as const, isDp: true };
		expect(canLead(dp, 'un-id-quelconque')).toBe(true);
		expect(leadScope(dp)).toBe('ALL');
		expect(hasLeadScope(dp)).toBe(true);
	});

	it("un contexte vide ne pilote rien, et un périmètre inconnu (null) n'accorde aucun droit", () => {
		expect(canLead(EMPTY_PERIMETER_CTX, 'x')).toBe(false);
		expect(canLead(EMPTY_PERIMETER_CTX, null)).toBe(false);
		expect(hasLeadScope(EMPTY_PERIMETER_CTX)).toBe(false);
		expect(leadScope(EMPTY_PERIMETER_CTX)).toEqual([]);
	});
});

describe('perimeters — référentiel', () => {
	it('un espace neuf a son périmètre applicatif et son périmètre transverse', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const rows = await listActivePerimeters(workspaceId);
		expect(rows).toHaveLength(2);
		expect(rows.filter((p) => p.transverse)).toHaveLength(1);
		// Le périmètre d'atterrissage par défaut n'est jamais le transverse tant qu'il reste un
		// périmètre applicatif : un ticket créé sans choix ne doit pas devenir « transverse ».
		const def = await resolveDefaultPerimeterId(workspaceId);
		expect(rows.find((p) => p.id === def)?.transverse).toBe(false);
	});

	it('refuse deux périmètres actifs de même nom (casse ignorée)', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		await createPerimeter(workspaceId, 'Paiement', null, false);
		await expect(createPerimeter(workspaceId, 'paiement', null, false)).rejects.toThrow(
			'Un périmètre actif porte déjà ce nom.'
		);
	});

	it("refuse d'archiver un périmètre qui porte encore des tickets", async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const id = await createPerimeter(workspaceId, 'Avec tickets', null, false);
		await createTicket(workspaceId, { key: `PTK-${id.slice(0, 8)}`, title: 'x', perimeterId: id });

		await expect(setPerimeterArchived(workspaceId, id, true)).rejects.toThrow(/ticket\(s\) y sont encore rattachés/);
	});

	it("refuse d'archiver le dernier périmètre actif de l'espace", async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const [first, second] = await listActivePerimeters(workspaceId);
		await setPerimeterArchived(workspaceId, second.id, true);
		await expect(setPerimeterArchived(workspaceId, first.id, true)).rejects.toThrow(
			"Impossible d'archiver le dernier périmètre de l'espace."
		);
	});

	it('archive puis restaure un périmètre vide', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const id = await createPerimeter(workspaceId, 'Éphémère', null, false);
		await setPerimeterArchived(workspaceId, id, true);
		expect((await listActivePerimeters(workspaceId)).map((p) => p.id)).not.toContain(id);
		await setPerimeterArchived(workspaceId, id, false);
		expect((await listActivePerimeters(workspaceId)).map((p) => p.id)).toContain(id);
	});

	it('renomme, recolore et bascule en transverse', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const id = await createPerimeter(workspaceId, 'Chantiers', null, false);
		await updatePerimeter(workspaceId, id, 'Chantiers transverses', '#123456', true);
		const row = (await listPerimeters(workspaceId)).find((p) => p.id === id)!;
		expect(row.name).toBe('Chantiers transverses');
		expect(row.color).toBe('#123456');
		expect(row.transverse).toBe(true);
	});

	it('movePerimeter échange la position avec le voisin', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const before = await listActivePerimeters(workspaceId);
		await movePerimeter(workspaceId, before[1].id, 'up');
		const after = await listActivePerimeters(workspaceId);
		expect(after.map((p) => p.id)).toEqual([before[1].id, before[0].id]);
	});

	it('ne touche jamais un périmètre d’un autre espace', async () => {
		const a = await makeWorkspace('perim-a');
		const b = await makeWorkspace('perim-b');
		const idB = await createPerimeter(b.workspaceId, 'Chez B', null, false);

		await expect(updatePerimeter(a.workspaceId, idB, 'Volé', null, false)).rejects.toThrow(
			'Introuvable dans cet espace.'
		);
		await expect(setPerimeterArchived(a.workspaceId, idB, true)).rejects.toThrow();
	});
});

describe('perimeters — rattachement des membres', () => {
	it('rattache, change le rôle, puis retire une personne', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const { userId } = await addMember(workspaceId, 'USER');
		const id = await defaultPerimeterId(workspaceId);

		await setPerimeterMemberRole(workspaceId, id, userId, 'CONTRIBUTOR');
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).memberPerimeterIds.has(id)).toBe(true);
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).leadPerimeterIds.has(id)).toBe(false);

		await setPerimeterMemberRole(workspaceId, id, userId, 'CP');
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).leadPerimeterIds.has(id)).toBe(true);

		await setPerimeterMemberRole(workspaceId, id, userId, null);
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).memberPerimeterIds.size).toBe(0);
	});

	it("refuse de rattacher quelqu'un qui n'est pas membre actif de l'espace", async () => {
		const a = await makeWorkspace('perim-a');
		const b = await makeWorkspace('perim-b');
		const id = await defaultPerimeterId(a.workspaceId);

		await expect(setPerimeterMemberRole(a.workspaceId, id, b.userId, 'CP')).rejects.toThrow(
			"Cette personne n'est pas un membre actif de l'espace."
		);
	});

	it('un même CP peut être backup d’un autre périmètre — le cas « CP backup d’un CP »', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const { userId } = await addMember(workspaceId, 'USER');
		const mien = await createPerimeter(workspaceId, 'Le mien', null, false);
		const autre = await createPerimeter(workspaceId, "Celui d'à côté", null, false);

		await setPerimeterMemberRole(workspaceId, mien, userId, 'CP');
		await setPerimeterMemberRole(workspaceId, autre, userId, 'CP_BACKUP');

		const ctx = await loadPerimeterCtx(workspaceId, userId, 'USER');
		expect(canLead(ctx, mien)).toBe(true);
		expect(canLead(ctx, autre)).toBe(true); // le backup agit comme CP
		expect([...ctx.leadPerimeterIds].sort()).toEqual([mien, autre].sort());
	});

	it('listPerimeterCollaborators renvoie la population des périmètres demandés, et [] pour aucun', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const { userId: alice } = await addMember(workspaceId, 'USER', 'alice');
		const { userId: bob } = await addMember(workspaceId, 'USER', 'bob');
		const p1 = await createPerimeter(workspaceId, 'P1', null, false);
		const p2 = await createPerimeter(workspaceId, 'P2', null, false);
		await setPerimeterMemberRole(workspaceId, p1, alice, 'CONTRIBUTOR');
		await setPerimeterMemberRole(workspaceId, p2, bob, 'CONTRIBUTOR');

		expect(await listPerimeterCollaborators(workspaceId, [p1])).toEqual([alice]);
		expect((await listPerimeterCollaborators(workspaceId, [p1, p2])).sort()).toEqual([alice, bob].sort());
		// Aucune portée ne veut PAS dire « tout le monde » — sinon un membre sans périmètre verrait tout.
		expect(await listPerimeterCollaborators(workspaceId, [])).toEqual([]);
	});

	it('un périmètre archivé sort du contexte de ses membres', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const { userId } = await addMember(workspaceId, 'USER');
		const id = await createPerimeter(workspaceId, 'À archiver', null, false);
		await setPerimeterMemberRole(workspaceId, id, userId, 'CP');
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).leadPerimeterIds.has(id)).toBe(true);

		await setPerimeterArchived(workspaceId, id, true);
		expect((await loadPerimeterCtx(workspaceId, userId, 'USER')).leadPerimeterIds.has(id)).toBe(false);
	});

	it('listPerimeters compte les tickets actifs et remonte les pilotes en tête', async () => {
		const { workspaceId } = await makeWorkspace('perim');
		const { userId: contrib } = await addMember(workspaceId, 'USER', 'zorro'); // nom en fin d'alphabet
		const { userId: cp } = await addMember(workspaceId, 'USER', 'amelie');
		const id = await createPerimeter(workspaceId, 'Compté', null, false);
		await setPerimeterMemberRole(workspaceId, id, contrib, 'CONTRIBUTOR');
		await setPerimeterMemberRole(workspaceId, id, cp, 'CP');
		await createTicket(workspaceId, { key: `CNT-${id.slice(0, 8)}`, title: 'x', perimeterId: id });

		const row = (await listPerimeters(workspaceId)).find((p) => p.id === id)!;
		expect(row.ticketCount).toBe(1);
		expect(row.members[0].userId).toBe(cp);
	});
});
