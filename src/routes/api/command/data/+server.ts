import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, membership, user } from '$lib/server/db';
import { listRefs } from '$lib/server/services/referentials';

/** Données de référence pour la palette de commandes (recherche projets/sprints/versions/membres). */
export const GET: RequestHandler = async ({ locals }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');

	const [projects, sprints, versions] = await Promise.all([
		listRefs(ws.workspaceId, 'project'),
		listRefs(ws.workspaceId, 'sprint'),
		listRefs(ws.workspaceId, 'version')
	]);

	// Liste des membres réservée à l'ADMIN : sert au raccourci "/imput <nom>" (consultation de
	// l'imputation d'un autre membre, déjà réservée à l'ADMIN côté /imputation?u=<id>).
	let members: { id: string; displayName: string }[] = [];
	if (locals.role === 'ADMIN') {
		members = await db
			.select({ id: user.id, displayName: user.displayName })
			.from(membership)
			.innerJoin(user, eq(membership.userId, user.id))
			.where(and(eq(membership.workspaceId, ws.workspaceId), eq(membership.active, true)));
	}

	const strip = (rows: { id: string; name: string; archived: boolean }[]) =>
		rows.filter((r) => !r.archived).map((r) => ({ id: r.id, name: r.name }));

	return json({
		projects: strip(projects),
		sprints: strip(sprints),
		versions: strip(versions),
		members
	});
};
