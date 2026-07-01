import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	listTickets,
	getRefData,
	createTicket,
	updateTicketField,
	setTicketFlag,
	type TicketRow
} from '$lib/server/services/tickets';

const createSchema = z.object({
	key: z.string().trim().min(1, 'Clé requise').max(40),
	title: z.string().trim().min(1, 'Titre requis').max(200),
	parentId: z.string().uuid().optional().or(z.literal('')),
	projectId: z.string().uuid().optional().or(z.literal('')),
	sprintId: z.string().uuid().optional().or(z.literal('')),
	versionId: z.string().uuid().optional().or(z.literal('')),
	assigneeId: z.string().uuid().optional().or(z.literal('')),
	stateId: z.string().uuid().optional().or(z.literal('')),
	estimationReal: z.string().optional(),
	estimationTest: z.string().optional(),
	comment: z.string().optional()
});

/** Ordonne les tickets : chaque parent suivi de ses sous-tâches. */
function toDisplayOrder(tickets: TicketRow[]): (TicketRow & { isChild: boolean })[] {
	const byParent = new Map<string, TicketRow[]>();
	const roots: TicketRow[] = [];
	for (const t of tickets) {
		if (t.parentId) {
			if (!byParent.has(t.parentId)) byParent.set(t.parentId, []);
			byParent.get(t.parentId)!.push(t);
		} else roots.push(t);
	}
	const out: (TicketRow & { isChild: boolean })[] = [];
	const seen = new Set<string>();
	for (const r of roots) {
		out.push({ ...r, isChild: false });
		seen.add(r.id);
		for (const c of byParent.get(r.id) ?? []) {
			out.push({ ...c, isChild: true });
			seen.add(c.id);
		}
	}
	// orphelins (parent archivé/absent)
	for (const t of tickets) if (!seen.has(t.id)) out.push({ ...t, isChild: !!t.parentId });
	return out;
}

export const load: PageServerLoad = async ({ locals }) => {
	const ws = locals.workspace!;
	const [tickets, ref] = await Promise.all([listTickets(ws.workspaceId), getRefData(ws.workspaceId)]);
	return { tickets: toDisplayOrder(tickets), ref };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const ws = locals.workspace!;
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
				assigneeId: empty(d.assigneeId),
				stateId: empty(d.stateId),
				estimationReal: empty(d.estimationReal),
				estimationTest: empty(d.estimationTest),
				// RAE pré-rempli avec la suggestion (= estimation à la création, consommé = 0)
				// → l'avancement démarre à 0 % au lieu de 100 % (RAE vide).
				raeReal: empty(d.estimationReal),
				raeTest: empty(d.estimationTest),
				comment: empty(d.comment)
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
			await updateTicketField(ws.workspaceId, ticketId, field, value);
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
