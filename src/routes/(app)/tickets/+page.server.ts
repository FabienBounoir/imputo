import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import {
	listTicketsPage,
	getRefData,
	createTicket,
	updateTicketField,
	setTicketFlag,
	deleteTicket,
	parseTicketFiltersSnapshot,
	type TicketFilters
} from '$lib/server/services/tickets';
import { setTicketInGroup } from '$lib/server/services/ticketGroups';
import { isManagerOrAdmin } from '$lib/server/services/workspaces';
import { leadScope } from '$lib/server/services/perimeters';
import {
	getTicketFiltersPref,
	setTicketFiltersSnapshot,
	getCompactTicketActivityPref,
	setCompactTicketActivityPref
} from '$lib/server/services/accounts';

const PAGE_SIZE = 50;

// Drizzle enveloppe l'erreur Postgres dans une DrizzleQueryError dont `.message` est la requête
// SQL (pas l'erreur) — la vraie PostgresError (code, message) est dans `.cause`.
function isUniqueViolation(e: unknown): boolean {
	const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
	return code === '23505';
}

const createSchema = z.object({
	key: z.string().trim().min(1, 'Clé requise').max(40),
	title: z.string().trim().min(1, 'Titre requis').max(200),
	// Omis = périmètre par défaut de l'espace (createTicket), pour ne pas casser une création
	// programmatique ; le formulaire, lui, le pré-remplit toujours.
	perimeterId: z.string().uuid().optional().or(z.literal('')),
	parentId: z.string().uuid().optional().or(z.literal('')),
	projectId: z.string().uuid().optional().or(z.literal('')),
	sprintId: z.string().uuid().optional().or(z.literal('')),
	versionId: z.string().uuid().optional().or(z.literal('')),
	stateId: z.string().uuid().optional().or(z.literal('')),
	estimationReal: z.string().optional(),
	estimationTest: z.string().optional(),
	comment: z.string().optional(),
	sspId: z.string().uuid().optional().or(z.literal('')),
	estimationPrev: z.string().optional(),
	enveloppeTotale: z.string().optional()
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const ws = locals.workspace!;
	// ADMIN ou MANAGER : même règle en lecture qu'en écriture pour les champs budget et le
	// chiffrage (cf. isManagerOrAdmin) — un MANAGER pouvait les écrire sans jamais les voir.
	const isAdmin = isManagerOrAdmin(locals.role);

	// Arrivée "à blanc" (aucun paramètre : lien de nav, favori, saisie directe de l'URL) — si le
	// compte a un instantané de filtres mémorisé (préférence "Garder mes filtres", cf. réglages), on
	// relance vers l'URL équivalente. L'URL reste la seule source de vérité de ce qui est affiché
	// (jamais un état caché côté serveur) : tout ce qui porte déjà un paramètre — reset, pagination,
	// deep-link ?ticket=/?highlight=, ?new=1 — n'est donc jamais réécrit ici.
	if (!url.search) {
		const { remember, rememberSearch, snapshotRaw } = await getTicketFiltersPref(locals.user!.id);
		const snapshot = remember ? parseTicketFiltersSnapshot(snapshotRaw) : null;
		if (snapshot) {
			// Un compte peut appartenir à plusieurs espaces : état/projet/sprint/version sont propres
			// à l'espace où ils ont été enregistrés — on ne réinjecte que les id qui existent bien
			// dans l'espace courant (ignorés silencieusement sinon), pour éviter un "0 résultat" muet
			// juste après un changement d'espace.
			const ref = await getRefData(ws.workspaceId);
			const target = new URLSearchParams();
			if (snapshot.view === 'kanban') target.set('view', 'kanban');
			// La recherche a sa propre sous-préférence (cf. réglages) : le snapshot la garde toujours
			// à jour, seule sa réapplication à l'arrivée est conditionnelle.
			if (snapshot.query && rememberSearch) target.set('q', snapshot.query);
			if (snapshot.stateId && ref.states.some((s) => s.id === snapshot.stateId)) target.set('state', snapshot.stateId);
			if (snapshot.projectId && ref.projects.some((p) => p.id === snapshot.projectId)) target.set('project', snapshot.projectId);
			if (snapshot.sprintId && ref.sprints.some((s) => s.id === snapshot.sprintId)) target.set('sprint', snapshot.sprintId);
			if (snapshot.versionId && ref.versions.some((v) => v.id === snapshot.versionId)) target.set('version', snapshot.versionId);
			if (snapshot.perimeterId && ref.perimeters.some((p) => p.id === snapshot.perimeterId))
				target.set('perimeter', snapshot.perimeterId);
			if ([...target.keys()].length > 0) redirect(303, `/tickets?${target}`);
		}
	}

	const view = url.searchParams.get('view') === 'kanban' ? 'kanban' : 'table';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const sort = url.searchParams.get('sort') === 'priority' ? 'priority' : 'created';
	const filters: TicketFilters = {
		query: url.searchParams.get('q') ?? undefined,
		stateId: url.searchParams.get('state') ?? undefined,
		projectId: url.searchParams.get('project') ?? undefined,
		sprintId: url.searchParams.get('sprint') ?? undefined,
		versionId: url.searchParams.get('version') ?? undefined,
		// Un seul périmètre à la fois dans la barre de filtres (comme projet/sprint/version), même si
		// le service en accepte plusieurs — la consolidation, elle, en croise plusieurs.
		perimeterIds: url.searchParams.get('perimeter') ? [url.searchParams.get('perimeter')!] : undefined,
		// Lien direct depuis un dashboard sprint/version (SprintDashboardPanel) : clé exacte,
		// pas de recherche substring — sinon "SBX-3" isolerait aussi SBX-30..39.
		exactKey: url.searchParams.get('ticket') ?? undefined,
		// Lien direct depuis l'historique de sync Jira (Admin > Jira) : même principe que exactKey,
		// URL-only — jamais un champ du formulaire de filtres (cf. TicketFilters#syncRunId).
		syncRunId: url.searchParams.get('jiraRun') ?? undefined,
		// Lien depuis la clôture mensuelle (colonne « Sans code SSP ») : ces tickets ne remontent
		// dans aucun code budgétaire, on vient les corriger.
		noSsp: url.searchParams.get('ssp') === 'none',
		// Lot de tickets tout juste créés (popover « Nouveau ticket ») : accumulé côté client à
		// chaque création réussie (cf. +page.svelte) pour les retrouver et les traiter à la suite.
		keys: url.searchParams.get('created')?.split(',').filter(Boolean)
	};
	// Lien depuis l'imputation (clic sur le sprint/version d'une ligne) : filtre sur le sprint ou la
	// version (liste complète, pas juste ce ticket) + surbrillance du ticket d'origine dans la liste.
	const highlightKey = url.searchParams.get('highlight') ?? undefined;

	// Kanban a besoin du board complet (pas de pagination) ; le tableau ne charge qu'une page —
	// évite de tout charger d'un coup quand l'espace a beaucoup de tickets (§ retour utilisateur).
	// Avec le pull Jira, un espace peut monter à plusieurs milliers de tickets : le kanban exige
	// donc un sprint ou une version pour se déclencher, sinon la requête complète (et son rendu)
	// tourne pour rien — on ne l'exécute même pas (§ retour utilisateur, sync Jira).
	const kanbanNeedsScope = view === 'kanban' && !filters.sprintId && !filters.versionId;
	// Chaque colonne du kanban EST un état (cf. kanbanCols côté client) : filtrer par état n'y a
	// aucun sens (une seule colonne resterait peuplée) — ignoré pour la requête en mode kanban,
	// pas seulement caché côté UI, sinon un ?state= traînant depuis la vue tableau viderait le
	// board silencieusement sans que le contrôle pour l'expliquer soit visible.
	const queryFilters: TicketFilters = view === 'kanban' ? { ...filters, stateId: undefined } : filters;
	// estimationPrev/enveloppeTotale/tnfBudget : redaction faite dans listTicketsPage() (source
	// unique, tout appelant en profite) — pas juste ici, sinon un autre consommateur la raterait.
	// `ticketsPage` n'est PAS awaité : la requête (jointures + enrichissement par activité) est la
	// partie lente de la page — on la laisse streamer après le shell (filtres, chrome) pendant que
	// `ref` (petites tables de référence) est prêt tout de suite (§ retour utilisateur, page trop lente).
	const ticketsPage = kanbanNeedsScope
		? Promise.resolve({ tickets: [], total: 0, pageCount: 1 })
		: listTicketsPage(
				ws.workspaceId,
				ws.testPhase,
				locals.perimeterCtx,
				queryFilters,
				view === 'table' ? { pageSize: PAGE_SIZE, page } : undefined,
				// Le détail par activité n'est rendu que dans les lignes fines de la vue tableau — le
				// kanban charge tout le board sans pagination, l'économiser y compte double (cf. audit).
				view === 'table',
				sort
			).then(({ rows: tickets, total }) => ({
				tickets,
				total,
				pageCount: view === 'table' ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1
			}));
	const ref = await getRefData(ws.workspaceId, locals.user!.sortActivitiesAlpha);
	return {
		ticketsPage,
		page,
		pageSize: PAGE_SIZE,
		view,
		sort,
		kanbanNeedsScope,
		filters,
		// Périmètres pilotés — 'ALL' pour le DP. Sert à savoir si le sélecteur de périmètre de la
		// modale est actif : déplacer un ticket exige d'être lead des deux côtés (cf. updateTicketField).
		leadPerimeters: leadScope(locals.perimeterCtx),
		highlightKey,
		ref,
		testPhase: ws.testPhase,
		isAdmin,
		// Budget par activité (sous-lignes) : ADMIN strict, contrairement au reste du chiffrage
		// (isManagerOrAdmin) — cf. canEditActivityField côté service.
		isStrictAdmin: locals.role === 'ADMIN',
		/** Chiffrage global (estimations, prépa) : lecture seule pour un USER standard. */
		canEditEstimation: isManagerOrAdmin(locals.role),
		selfId: locals.user!.id,
		// Édition de la clé / suppression de ticket : créateur de l'espace (super admin) ou ADMIN, cf. deleteTicket().
		isOwner: locals.user!.id === ws.createdByUserId || locals.role === 'ADMIN',
		compactTicketActivity: await getCompactTicketActivityPref(locals.user!.id)
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
		let created: { id: string };
		try {
			created = await createTicket(ws.workspaceId, {
				key: d.key,
				title: d.title,
				perimeterId: empty(d.perimeterId) ?? undefined,
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
				sspId: empty(d.sspId),
				// Invisible pour un USER : ignoré silencieusement si soumis malgré tout.
				estimationPrev: isAdmin ? empty(d.estimationPrev) : null,
				enveloppeTotale: isAdmin ? empty(d.enveloppeTotale) : null
			});
		} catch (e) {
			if (!isUniqueViolation(e)) logger.error('ticket_create_failed', e, { workspaceId: ws.workspaceId });
			return fail(400, {
				error: isUniqueViolation(e) ? 'Un ticket avec cette clé existe déjà.' : 'Erreur lors de la création.'
			});
		}
		return { ok: true, id: created.id };
	},

	update: async ({ request, locals }) => {
		const ws = locals.workspace!;
		const f = await request.formData();
		const ticketId = String(f.get('ticketId') ?? '');
		const field = String(f.get('field') ?? '');
		const value = String(f.get('value') ?? '');
		if (!ticketId || !field) return fail(400, { error: 'Données invalides.' });
		try {
			await updateTicketField(
				ws.workspaceId,
				ticketId,
				field,
				value,
				locals.perimeterCtx,
				locals.user?.id ?? null,
				locals.user!.id === ws.createdByUserId || locals.role === 'ADMIN'
			);
		} catch (e) {
			if (!isUniqueViolation(e))
				logger.error('ticket_update_failed', e, { workspaceId: ws.workspaceId, ticketId, field });
			return fail(400, {
				error: isUniqueViolation(e) ? 'Un ticket avec cette clé existe déjà.' : 'Erreur lors de la mise à jour.'
			});
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
			logger.error('ticket_group_toggle_failed', e, { workspaceId: ws.workspaceId, ticketId, groupId });
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
			logger.error('ticket_flag_failed', e, { workspaceId: ws.workspaceId, ticketId, key });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true };
	},

	// Réservé au créateur de l'espace (super admin) et aux ADMIN — la modal ne propose le bouton
	// qu'à eux, mais on revérifie ici, seul point de passage réel de la suppression.
	delete: async ({ request, locals }) => {
		const ws = locals.workspace;
		if (!ws || !locals.user) return fail(401, { error: 'Non authentifié.' });
		if (locals.user.id !== ws.createdByUserId && locals.role !== 'ADMIN')
			return fail(403, { error: 'Réservé au créateur de l’espace ou à un admin.' });
		const f = await request.formData();
		const ticketId = String(f.get('ticketId') ?? '');
		if (!ticketId) return fail(400, { error: 'Données invalides.' });
		try {
			await deleteTicket(ws.workspaceId, ticketId);
		} catch (e) {
			logger.error('ticket_delete_failed', e, { workspaceId: ws.workspaceId, ticketId });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { ok: true, deletedId: ticketId };
	},

	// Action de compte (garde !locals.user, pas !ws comme le reste de ce fichier) : appelée en
	// fire-and-forget à chaque interaction filtre depuis navigateWith (cf. +page.svelte).
	rememberFilters: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setTicketFiltersSnapshot(locals.user.id, {
			view: f.get('view') === 'kanban' ? 'kanban' : 'table',
			query: (f.get('q') as string) || null,
			stateId: (f.get('state') as string) || null,
			projectId: (f.get('project') as string) || null,
			sprintId: (f.get('sprint') as string) || null,
			versionId: (f.get('version') as string) || null,
			perimeterId: (f.get('perimeter') as string) || null
		});
		return { ok: true };
	},

	// Action de compte (garde !locals.user) : appelée par le bouton "Tout déplier/replier" —
	// le dépli/repli par ticket, lui, reste local à la session, jamais persisté (cf. +page.svelte).
	compactActivityPref: async ({ request, locals }) => {
		if (!locals.user) return fail(401);
		const f = await request.formData();
		await setCompactTicketActivityPref(locals.user.id, f.get('value') === 'true');
		return { ok: true };
	}
};
