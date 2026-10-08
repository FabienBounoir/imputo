import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import {
	applyImport,
	listImports,
	loadImportContext,
	parseImportFile,
	planImport,
	undoImport,
	IMPORT_MAX_BYTES,
	IMPORT_MAX_ROWS
} from '$lib/server/services/ticketImport';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.role !== 'ADMIN') redirect(303, '/imputation');
	return {
		maxRows: IMPORT_MAX_ROWS,
		maxBytes: IMPORT_MAX_BYTES,
		imports: await listImports(locals.workspace!.workspaceId)
	};
};

/** Lit le fichier du formulaire. Toute erreur levée ici porte un message affichable tel quel. */
async function readUpload(request: Request) {
	const fd = await request.formData();
	const file = fd.get('file');
	if (!(file instanceof File) || file.size === 0) throw new Error('Choisissez un fichier .xlsx ou .csv.');
	if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error('Format non pris en charge : déposez un .xlsx ou un .csv.');
	if (file.size > IMPORT_MAX_BYTES)
		throw new Error('Fichier trop lourd (480 Ko au plus) : retirez la mise en forme ou enregistrez-le en CSV.');
	try {
		return { fd, fileName: file.name, parsed: await parseImportFile(await file.arrayBuffer(), file.name) };
	} catch {
		throw new Error('Fichier illisible : vérifiez que c’est bien un classeur .xlsx ou un .csv.');
	}
}

export const actions: Actions = {
	// Aperçu : ne touche pas à la base.
	check: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		let upload;
		try {
			upload = await readUpload(request);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		const { plan } = planImport(upload.parsed, await loadImportContext(ws.workspaceId, ws.testPhase));
		if (plan.fatal) return fail(400, { error: plan.fatal });
		return { fileName: upload.fileName, plan };
	},

	// Le fichier est renvoyé avec la validation et replanifié sur l'état courant de la base : aucun
	// aperçu n'est gardé côté serveur, et un ticket créé entre-temps est simplement ignoré.
	apply: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		let upload;
		try {
			upload = await readUpload(request);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		// `listed` = versions / sprints / projets proposés à l'aperçu, `create` = ceux restés cochés.
		// Une valeur absente de `listed` (apparue depuis) est créée, comme une case cochée par défaut.
		const kept = new Set(upload.fd.getAll('create').map(String));
		const skip = new Set(upload.fd.getAll('listed').map(String).filter((token) => !kept.has(token)));
		try {
			const result = await applyImport(
				ws.workspaceId,
				upload.parsed,
				ws.testPhase,
				{ fileName: upload.fileName, userId: locals.user!.id },
				skip
			);
			if ('fatal' in result) return fail(400, { error: result.fatal });
			logger.info('ticket_import_applied', { workspaceId: ws.workspaceId, created: result.created, refs: result.refs });
			return { fileName: upload.fileName, result };
		} catch (e) {
			logger.error('ticket_import_failed', e, { workspaceId: ws.workspaceId });
			return fail(400, { error: 'L’import a échoué, rien n’a été créé. Relancez la vérification.' });
		}
	},

	// « Annuler ce lot » : supprime les tickets de l'import restés tels qu'importés (cf. undoImport).
	undo: async ({ request, locals }) => {
		if (locals.role !== 'ADMIN') return fail(403, { error: 'Réservé aux admins.' });
		const ws = locals.workspace!;
		const importId = String((await request.formData()).get('importId') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(importId)) return fail(400, { error: 'Import introuvable.' });
		try {
			const undone = await undoImport(ws.workspaceId, importId, locals.user!.id);
			logger.info('ticket_import_undone', { workspaceId: ws.workspaceId, importId, ...undone });
			return { undone };
		} catch (e) {
			logger.error('ticket_import_undo_failed', e, { workspaceId: ws.workspaceId, importId });
			return fail(400, { error: e instanceof Error ? e.message : 'Erreur.' });
		}
	}
};
