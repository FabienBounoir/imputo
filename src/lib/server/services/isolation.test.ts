import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspace, user } from '$lib/server/db';
import { createWorkspaceWithOwner } from './workspaces';
import { listTickets, createTicket, updateTicketField } from './tickets';
import { createPerimeter, setPerimeterMemberRole, loadPerimeterCtx } from './perimeters';
import { inviteMember } from './accounts';
import { setCell, getWeek } from './imputation';
import { addObjective } from './weeklyObjectives';
import { encryptSecret } from '../auth/secretCrypto';
import { syncWorkspace, type JiraSyncConfig } from './jiraSync';

// Test d'isolation multi-espaces : un espace ne doit JAMAIS voir les données d'un autre.
const rnd = Math.random().toString(36).slice(2, 8);
const wsIds: string[] = [];

afterAll(async () => {
	for (const id of wsIds) await db.delete(workspace).where(eq(workspace.id, id)); // cascade
});

describe('isolation multi-espaces', () => {
	it('listTickets ne renvoie que les tickets de son espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A',
			email: `a-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B',
			email: `b-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		await createTicket(a.workspaceId, { key: `A-${rnd}`, title: 'Ticket A' });
		await createTicket(b.workspaceId, { key: `B-${rnd}`, title: 'Ticket B' });

		const ticketsA = await listTickets(a.workspaceId);
		const ticketsB = await listTickets(b.workspaceId);

		expect(ticketsA.map((t) => t.key)).toContain(`A-${rnd}`);
		expect(ticketsA.map((t) => t.key)).not.toContain(`B-${rnd}`);
		expect(ticketsB.map((t) => t.key)).toContain(`B-${rnd}`);
		expect(ticketsB.map((t) => t.key)).not.toContain(`A-${rnd}`);
	});

	it('setCell refuse d’imputer sur un ticket d’un autre espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A2',
			email: `a2-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A2'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B2',
			email: `b2-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B2'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		const ticketA = await createTicket(a.workspaceId, { key: `AX-${rnd}`, title: 'Ticket A' });

		// L'utilisateur B tente d'imputer sur un ticket de l'espace A → rejet.
		await expect(
			setCell(b.workspaceId, b.userId, {
				targetType: 'TICKET',
				targetId: ticketA.id,
				activityId: null,
				day: '2026-06-22',
				amount: 1
			})
		).rejects.toThrow();

		// Sa feuille reste vide.
		const week = await getWeek(b.workspaceId, b.userId, '2026-06-22');
		expect(week.rows.length).toBe(0);
	});

	it('un objectif custom est imputable par son destinataire mais pas par un autre espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A3',
			email: `a3-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A3'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B3',
			email: `b3-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B3'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		await addObjective(a.workspaceId, a.userId, {
			userId: a.userId,
			weekMondayISO: '2026-06-22',
			kind: 'CUSTOM',
			label: 'Rédiger la doc du connecteur X'
		});
		const [objective] = await db.query.weeklyObjective.findMany({
			where: (t, { eq }) => eq(t.userId, a.userId)
		});

		// La destinataire peut imputer dessus, et la ligne porte bien son libellé.
		await setCell(a.workspaceId, a.userId, {
			targetType: 'OBJECTIVE',
			targetId: objective.id,
			activityId: null,
			day: '2026-06-22',
			amount: 0.5
		});
		const weekA = await getWeek(a.workspaceId, a.userId, '2026-06-22');
		expect(weekA.rows.find((r) => r.targetId === objective.id)?.label).toBe('Rédiger la doc du connecteur X');

		// Un utilisateur d'un autre espace ne peut pas imputer sur cet objectif.
		await expect(
			setCell(b.workspaceId, b.userId, {
				targetType: 'OBJECTIVE',
				targetId: objective.id,
				activityId: null,
				day: '2026-06-22',
				amount: 1
			})
		).rejects.toThrow();
	});

	it('syncWorkspace ne lit/écrit jamais la config ou les tickets Jira d’un autre espace', async () => {
		const a = await createWorkspaceWithOwner({
			displayName: 'A4',
			email: `a4-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: 'Espace A4'
		});
		const b = await createWorkspaceWithOwner({
			displayName: 'B4',
			email: `b4-${rnd}@beta.test`,
			password: 'password123',
			workspaceName: 'Espace B4'
		});
		wsIds.push(a.workspaceId, b.workspaceId);

		const encKey = Buffer.alloc(32, 3).toString('base64');
		const cfg: JiraSyncConfig = {
			azureTenantId: 't',
			azureClientId: 'c',
			azureClientSecret: 's',
			jiraBaseUrl: 'https://jira.example.test',
			patEncryptionKey: encKey
		};

		// Seul l'espace A est configuré (PAT + JQL) ; B ne l'est jamais.
		await db
			.update(workspace)
			.set({ jiraPatEncrypted: encryptSecret('pat-de-A', encKey), jiraJql: 'project = A' })
			.where(eq(workspace.id, a.workspaceId));

		const fetchImpl = (async (input: RequestInfo | URL) => {
			const url = input.toString();
			if (url.includes('login.microsoftonline.com')) {
				return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
			}
			if (url.includes('/rest/api/2/search')) {
				const issue = {
					key: `ISO-${rnd}`,
					fields: { summary: 'Ticket isolation', issuetype: { name: 'Story' }, project: { name: 'X' } }
				};
				return new Response(JSON.stringify({ startAt: 0, total: 1, issues: [issue] }), { status: 200 });
			}
			throw new Error(`unexpected url: ${url}`);
		}) as typeof fetch;

		// B n'a ni PAT ni JQL -> échec de config propre, sans jamais utiliser la config de A.
		const resB = await syncWorkspace(db, cfg, b.workspaceId, { fetchImpl });
		expect(resB.ok).toBe(false);

		// A est configuré -> sync réussi.
		const resA = await syncWorkspace(db, cfg, a.workspaceId, { fetchImpl });
		expect(resA.ok).toBe(true);

		// Le ticket créé par le sync de A n'existe que dans A, jamais visible depuis B.
		const ticketsA = await listTickets(a.workspaceId);
		const ticketsB = await listTickets(b.workspaceId);
		expect(ticketsA.map((t) => t.key)).toContain(`ISO-${rnd}`);
		expect(ticketsB.map((t) => t.key)).not.toContain(`ISO-${rnd}`);
	});
});

// ---------------------------------------------------------------------------------------------
// Isolation par PÉRIMÈTRE — deuxième niveau, à l'intérieur d'un même espace. L'isolation d'espace
// ci-dessus reste la frontière dure ; celle-ci ne fait que restreindre ce qu'un CP pilote.
// ---------------------------------------------------------------------------------------------
describe('cloisonnement par périmètre (dans un même espace)', () => {
	/** Un espace avec deux périmètres, un CP sur le premier, et un ticket dans chacun. */
	async function makeTwoPerimeters(tag: string) {
		const ws = await createWorkspaceWithOwner({
			displayName: 'DP',
			email: `dp-${tag}-${rnd}@acme.test`,
			password: 'password123',
			workspaceName: `Espace ${tag} ${rnd}`
		});
		wsIds.push(ws.workspaceId);
		const perimA = await createPerimeter(ws.workspaceId, `Périmètre A ${tag}`, null, false);
		const perimB = await createPerimeter(ws.workspaceId, `Périmètre B ${tag}`, null, false);
		const { userId: cpId } = await (async () => {
			await inviteMember({
				workspaceId: ws.workspaceId,
				email: `cp-${tag}-${rnd}@acme.test`,
				displayName: 'CP',
				role: 'USER'
			});
			const [u] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.email, `cp-${tag}-${rnd}@acme.test`));
			return { userId: u.id };
		})();
		await setPerimeterMemberRole(ws.workspaceId, perimA, cpId, 'CP');

		const tA = await createTicket(ws.workspaceId, {
			key: `PA-${tag}-${rnd}`,
			title: 'Ticket A',
			perimeterId: perimA,
			enveloppeTotale: '100'
		});
		const tB = await createTicket(ws.workspaceId, {
			key: `PB-${tag}-${rnd}`,
			title: 'Ticket B',
			perimeterId: perimB,
			enveloppeTotale: '200'
		});
		return { ws, perimA, perimB, cpId, tA, tB };
	}

	it("un CP ne peut pas éditer le chiffrage d'un ticket d'un autre périmètre, mais peut sur le sien", async () => {
		const { ws, cpId, tA, tB } = await makeTwoPerimeters('edit');
		const ctx = await loadPerimeterCtx(ws.workspaceId, cpId, 'USER');

		await updateTicketField(ws.workspaceId, tA.id, 'estimationReal', '3', ctx, cpId);
		await expect(
			updateTicketField(ws.workspaceId, tB.id, 'estimationReal', '3', ctx, cpId)
		).rejects.toThrow('Champ non éditable.');
	});

	it("un CP ne peut pas éditer le budget d'un ticket d'un autre périmètre", async () => {
		const { ws, cpId, tA, tB } = await makeTwoPerimeters('budget');
		const ctx = await loadPerimeterCtx(ws.workspaceId, cpId, 'USER');

		await updateTicketField(ws.workspaceId, tA.id, 'enveloppeTotale', '150', ctx, cpId);
		await expect(
			updateTicketField(ws.workspaceId, tB.id, 'enveloppeTotale', '150', ctx, cpId)
		).rejects.toThrow('Champ non éditable.');
	});

	it('listTickets masque le budget des tickets hors des périmètres pilotés, ticket par ticket', async () => {
		const { ws, cpId, tA, tB } = await makeTwoPerimeters('read');
		const ctx = await loadPerimeterCtx(ws.workspaceId, cpId, 'USER');

		const rows = await listTickets(ws.workspaceId, true, ctx);
		expect(rows.find((r) => r.id === tA.id)?.enveloppeTotale).toBe(100);
		expect(rows.find((r) => r.id === tB.id)?.enveloppeTotale).toBeNull();
		// …et le ticket reste bien visible : c'est le champ budget qui est masqué, pas la ligne.
		expect(rows.find((r) => r.id === tB.id)).toBeDefined();
	});

	it('le DP voit et édite le budget des deux périmètres sans y être rattaché', async () => {
		const { ws, tA, tB } = await makeTwoPerimeters('dp');
		const dp = await loadPerimeterCtx(ws.workspaceId, ws.userId, 'ADMIN');

		const rows = await listTickets(ws.workspaceId, true, dp);
		expect(rows.find((r) => r.id === tA.id)?.enveloppeTotale).toBe(100);
		expect(rows.find((r) => r.id === tB.id)?.enveloppeTotale).toBe(200);
		await updateTicketField(ws.workspaceId, tB.id, 'enveloppeTotale', '250', dp, ws.userId);
	});

	it('un backup a exactement les mêmes droits que le CP titulaire', async () => {
		const { ws, perimA, tA } = await makeTwoPerimeters('backup');
		await inviteMember({
			workspaceId: ws.workspaceId,
			email: `backup-${rnd}@acme.test`,
			displayName: 'Backup',
			role: 'USER'
		});
		const [b] = await db.select({ id: user.id }).from(user).where(eq(user.email, `backup-${rnd}@acme.test`));
		await setPerimeterMemberRole(ws.workspaceId, perimA, b.id, 'CP_BACKUP');
		const ctx = await loadPerimeterCtx(ws.workspaceId, b.id, 'USER');

		await updateTicketField(ws.workspaceId, tA.id, 'enveloppeTotale', '120', ctx, b.id);
		const rows = await listTickets(ws.workspaceId, true, ctx);
		expect(rows.find((r) => r.id === tA.id)?.enveloppeTotale).toBe(120);
	});

	it("le périmètre ne franchit jamais la frontière d'espace : CP ici ≠ droits là-bas", async () => {
		const one = await makeTwoPerimeters('cross-1');
		const two = await makeTwoPerimeters('cross-2');
		// Le CP de l'espace 1 n'est même pas membre de l'espace 2 : son contexte y est vide.
		const ctxElsewhere = await loadPerimeterCtx(two.ws.workspaceId, one.cpId, 'USER');
		expect(ctxElsewhere.leadPerimeterIds.size).toBe(0);

		await expect(
			updateTicketField(two.ws.workspaceId, two.tA.id, 'enveloppeTotale', '999', ctxElsewhere, one.cpId)
		).rejects.toThrow('Champ non éditable.');
		// …et le ticket de l'autre espace reste introuvable depuis le premier, périmètre ou pas.
		await expect(
			updateTicketField(one.ws.workspaceId, two.tA.id, 'title', 'x', ctxElsewhere, one.cpId)
		).rejects.toThrow('Ticket introuvable dans cet espace.');
	});
});
