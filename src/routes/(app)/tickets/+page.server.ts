import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	listTicketsPage,
	getRefData,
	createTicket,
	updateTicketField,
	setTicketFlag,
	type TicketFilters
} from '$lib/server/services/tickets';
import { setTicketInGroup } from '$lib/server/services/ticketGroups';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';

const PAGE_SIZE = 50;

const createSchema = z.object({
	key: z.string().trim().min(1, 'Clé requise').max(40),
	title: z.string().trim().min(1, 'Titre requis').max(200),
	parentId: z.string().uuid().optional().or(z.literal('')),
	projectId: z.string().uuid().optional().or(z.literal('')),
	sprintId: z.string().uuid().optional().or(z.literal('')),
	versionId: z.string().uuid().optional().or(z.literal('')),
	stateId: z.string().uuid().optional().or(z.literal('')),
	estimationReal: z.string().optional(),
	estimationTest: z.string().optional(),
	comment: z.string().optional(),
	sspCode: z.string().optional(),
	estimationPrev: z.string().optional(),
	enveloppeTotale: z.string().optional()
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	// ADMIN ou MANAGER : même règle en lecture qu'en écriture pour les champs budget et le
	// chiffrage (cf. isManagerOrAdmin) — un MANAGER pouvait les écrire sans jamais les voir.
	const isAdmin = isManagerOrAdmin(locals.role);
	const view = url.searchParams.get('view') === 'kanban' ? 'kanban' : 'table';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const filters: TicketFilters = {
		query: url.searchParams.get('q') ?? undefined,
		stateId: url.searchParams.get('state') ?? undefined,
		projectId: url.searchParams.get('project') ?? undefined,
		sprintId: url.searchParams.get('sprint') ?? undefined,
		versionId: url.searchParams.get('version') ?? undefined,
		// Lien direct depuis un dashboard sprint/version (SprintDashboardPanel) : clé exacte,
		// pas de recherche substring — sinon "SBX-3" isolerait aussi SBX-30..39.
		exactKey: url.searchParams.get('ticket') ?? undefined
	};
	// Lien depuis l'imputation (clic sur le sprint/version d'une ligne) : filtre sur le sprint ou la
	// version (liste complète, pas juste ce ticket) + surbrillance du ticket d'origine dans la liste.
	const highlightKey = url.searchParams.get('highlight') ?? undefined;

	// Kanban a besoin du board complet (pas de pagination) ; le tableau ne charge qu'une page —
	// évite de tout charger d'un coup quand l'espace a beaucoup de tickets (§ retour utilisateur).
	// estimationPrev/enveloppeTotale/tnfBudget : redaction faite dans listTicketsPage() (source
	// unique, tout appelant en profite) — pas juste ici, sinon un autre consommateur la raterait.
	const [{ rows: tickets, total }, ref] = await Promise.all([
		listTicketsPage(ws.workspaceId, ws.testPhase, isAdmin, filters, view === 'table' ? { pageSize: PAGE_SIZE, page } : undefined),
		getRefData(ws.workspaceId)
	]);
	return {
		tickets,
		total,
		page,
		pageSize: PAGE_SIZE,
		pageCount: view === 'table' ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1,
		view,
		filters,
		highlightKey,
		ref,
		testPhase: ws.testPhase,
		isAdmin,
		// Budget par activité (sous-lignes) : ADMIN strict, contrairement au reste du chiffrage
		// (isManagerOrAdmin) — cf. canEditActivityField côté service.
		isStrictAdmin: locals.role === 'ADMIN',
		/** Chiffrage global (estimations, prépa) : lecture seule pour un USER standard. */
		canEditEstimation: isManagerOrAdmin(locals.role),
		selfId: locals.user!.id
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const ws = locals.workspace!;
		// ADMIN ou MANAGER : voit/édite les champs budget (Estimation Prév., Enveloppe totale, TNF).
		const isAdmin = isManagerOrAdmin(locals.role);
		const form = Object.fromEntries(await request.formData());
		const parsed = createSchema.safeParse(form);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;
		const empty = (v?: string) => (v && v !== '' ? v : null);
		try {
			await createTicket(ws.workspaceId, {
				key: d.key,
				title: d.title,
				parentId: empty(d.parentId),
				projectId: empty(d.projectId),
				sprintId: empty(d.sprintId),
				versionId: empty(d.versionId),
				stateId: empty(d.stateId),
				estimationReal: empty(d.estimationReal),
				estimationTest: empty(d.estimationTest),
				// RAE pré-rempli avec la suggestion (= estimation à la création, consommé = 0)
				// → l'avancement démarre à 0 % au lieu de 100 % (RAE vide).
				raeReal: empty(d.estimationReal),
				raeTest: empty(d.estimationTest),
				comment: empty(d.comment),
				sspCode: empty(d.sspCode),
				// Invisible pour un USER : ignoré silencieusement si soumis malgré tout.
				estimationPrev: isAdmin ? empty(d.estimationPrev) : null,
				enveloppeTotale: isAdmin ? empty(d.enveloppeTotale) : null
			});
		} catch (e) {
			return fail(400, {
				error:
					e instanceof Error && /unique|duplicate/i.test(e.message)
						? 'Un ticket avec cette clé existe déjà.'
						: 'Erreur lors de la création.'
			});
		}
		return { ok: true };
	},

	update: async ({ request, locals }) => {
		const ws = locals.workspace!;
		const f = await request.formData();
		const ticketId = String(f.get('ticketId') ?? '');
		const field = String(f.get('field') ?? '');
		const value = String(f.get('value') ?? '');
		if (!ticketId || !field) return fail(400, { error: 'Données invalides.' });
		try {
			await updateTicketField(ws.workspaceId, ticketId, field, value, locals.role, locals.user?.id ?? null);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	groupToggle: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const ticketId = String(f.get('ticketId') ?? '');
		const groupId = String(f.get('groupId') ?? '');
		const member = f.get('member') === 'true';
		if (!ticketId || !groupId) return fail(400, { error: 'Données invalides.' });
		try {
			await setTicketInGroup(ws.workspaceId, ticketId, groupId, member);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	flag: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws) return fail(401, { error: 'Non authentifié.' });
		const f = await request.formData();
		const ticketId = String(f.get('ticketId') ?? '');
		const key = String(f.get('key') ?? '');
		const value = String(f.get('value') ?? '');
		if (!ticketId || !key) return fail(400, { error: 'Données invalides.' });
		try {
			await setTicketFlag(ws.workspaceId, ticketId, key, value);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	}
};
