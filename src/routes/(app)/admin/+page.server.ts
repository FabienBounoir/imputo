import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db, membership, user } from '$lib/server/db';
import { inviteSchema } from '$lib/server/validation/auth';
import {
	inviteMember,
	buildInviteMessage,
	setAccentColor,
	setTestPhase,
	setMemberRole,
	setMemberActive,
	setMemberCapacity,
	regenerateInvite
} from '$lib/server/services/accounts';
import {
	listRefs,
	createRef,
	renameRef,
	setRefArchived,
	type RefType
} from '$lib/server/services/referentials';
import {
	listCategories,
	createCategory,
	renameCategory,
	setCategoryKind,
	setCategoryArchived,
	listActivities,
	createActivity,
	renameActivity,
	setActivityArchived,
	listStates,
	createState,
	updateState,
	moveState,
	deleteState,
	type CategoryKind
} from '$lib/server/services/params';

function refType(v: FormDataEntryValue | null): RefType {
	return v === 'sprint' || v === 'version' ? v : 'project';
}

const accentSchema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (hex)') });

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	const ws = locals.workspace!;
	const members = await db
		.select({
			id: user.id,
			displayName: user.displayName,
			email: user.email,
			role: membership.role,
			active: membership.active,
			capacity: membership.capacityPerDay,
			pending: user.passwordHash
		})
		.from(membership)
		.innerJoin(user, eq(membership.userId, user.id))
		.where(eq(membership.workspaceId, ws.workspaceId));

	const [projects, sprints, versions, categories, activities, states] = await Promise.all([
		listRefs(ws.workspaceId, 'project'),
		listRefs(ws.workspaceId, 'sprint'),
		listRefs(ws.workspaceId, 'version'),
		listCategories(ws.workspaceId),
		listActivities(ws.workspaceId),
		listStates(ws.workspaceId)
	]);

	return {
		members: members.map((m) => ({ ...m, pending: m.pending === null })),
		selfId: locals.user!.id,
		allowedDomain: ws.allowedDomain,
		accentColor: ws.accentColor,
		testPhase: ws.testPhase,
		projects,
		sprints,
		versions,
		categories,
		activities,
		states
	};
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const form = Object.fromEntries(await request.formData());
		const parsed = inviteSchema.safeParse(form);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		try {
			const { token } = await inviteMember({
				workspaceId: ws.workspaceId,
				email: parsed.data.email,
				displayName: parsed.data.displayName,
				role: parsed.data.role
			});
			const msg = buildInviteMessage({
				workspaceName: ws.workspaceName,
				inviterName: locals.user!.displayName,
				email: parsed.data.email,
				token
			});
			return { invite: msg };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
	},

	accent: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const parsed = accentSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		await setAccentColor(ws.workspaceId, parsed.data.color);
		return { accentOk: true };
	},

	testPhase: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const enabled = (await request.formData()).get('enabled') === 'true';
		await setTestPhase(ws.workspaceId, enabled);
		return { testPhaseOk: true };
	},

	refCreate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const type = refType(f.get('type'));
		try {
			await createRef(ws.workspaceId, type, String(f.get('name') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { refOk: type };
	},

	refRename: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const type = refType(f.get('type'));
		try {
			await renameRef(ws.workspaceId, type, String(f.get('id')), String(f.get('name') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { refOk: type };
	},

	refArchive: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const archived = f.get('archived') === 'true';
		const type = refType(f.get('type'));
		try {
			await setRefArchived(ws.workspaceId, type, String(f.get('id')), archived);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { refOk: type };
	},

	memberRole: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId'));
		const role = f.get('role') === 'ADMIN' ? 'ADMIN' : 'USER';
		if (userId === locals.user!.id) return fail(400, { error: 'Vous ne pouvez pas changer votre propre rôle.' });
		try {
			await setMemberRole(ws.workspaceId, userId, role);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { memberOk: true };
	},

	memberActive: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId'));
		const active = f.get('active') === 'true';
		if (userId === locals.user!.id) return fail(400, { error: 'Vous ne pouvez pas vous désactiver vous-même.' });
		try {
			await setMemberActive(ws.workspaceId, userId, active);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { memberOk: true };
	},

	memberCapacity: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await setMemberCapacity(ws.workspaceId, String(f.get('userId')), Number(f.get('capacity')));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { memberOk: true };
	},

	memberInvite: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const userId = String(f.get('userId'));
		try {
			const { token, email } = await regenerateInvite(ws.workspaceId, userId);
			const msg = buildInviteMessage({
				workspaceName: ws.workspaceName,
				inviterName: locals.user!.displayName,
				email,
				token
			});
			return { invite: msg };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
	},

	catCreate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const kind: CategoryKind = f.get('kind') === 'NON_PRODUCTIVE' ? 'NON_PRODUCTIVE' : 'PRODUCTIVE';
		try {
			await createCategory(ws.workspaceId, String(f.get('label') ?? ''), kind);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { catOk: true };
	},

	catRename: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await renameCategory(ws.workspaceId, String(f.get('id')), String(f.get('label') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { catOk: true };
	},

	catKind: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const kind: CategoryKind = f.get('kind') === 'NON_PRODUCTIVE' ? 'NON_PRODUCTIVE' : 'PRODUCTIVE';
		try {
			await setCategoryKind(ws.workspaceId, String(f.get('id')), kind);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { catOk: true };
	},

	catArchive: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await setCategoryArchived(ws.workspaceId, String(f.get('id')), f.get('archived') === 'true');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { catOk: true };
	},

	actCreate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await createActivity(ws.workspaceId, String(f.get('label') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { actOk: true };
	},

	actRename: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await renameActivity(ws.workspaceId, String(f.get('id')), String(f.get('label') ?? ''));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { actOk: true };
	},

	actArchive: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await setActivityArchived(ws.workspaceId, String(f.get('id')), f.get('archived') === 'true');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { actOk: true };
	},

	stateCreate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await createState(
				ws.workspaceId,
				String(f.get('label') ?? ''),
				String(f.get('emoji') ?? ''),
				String(f.get('color') ?? '#94A3B8')
			);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { stateOk: true };
	},

	stateUpdate: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		const fields: { label?: string; emoji?: string; color?: string } = {};
		if (f.has('label')) fields.label = String(f.get('label'));
		if (f.has('emoji')) fields.emoji = String(f.get('emoji'));
		if (f.has('color')) fields.color = String(f.get('color'));
		try {
			await updateState(ws.workspaceId, String(f.get('id')), fields);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { stateOk: true };
	},

	stateMove: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await moveState(ws.workspaceId, String(f.get('id')), f.get('dir') === 'up' ? 'up' : 'down');
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { stateOk: true };
	},

	stateDelete: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const f = await request.formData();
		try {
			await deleteState(ws.workspaceId, String(f.get('id')));
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
		return { stateOk: true };
	}
};
