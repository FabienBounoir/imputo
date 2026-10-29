import { json, error } from '@sveltejs/kit';
import { setCell } from '$lib/server/services/imputation';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const schema = z.object({
	targetType: z.enum(['TICKET', 'CATEGORY']),
	targetId: z.string().uuid(),
	activityId: z.string().uuid().nullable().optional(),
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	amount: z.number().min(0).max(1)
});

export const POST: RequestHandler = async ({ locals, request }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');

	const body = schema.safeParse(await request.json().catch(() => ({})));
	if (!body.success) error(400, body.error.message);

	await setCell(ws.workspaceId, locals.user.id, {
		...body.data,
		activityId: body.data.activityId ?? null,
		objectiveId: null
	});

	return json({ ok: true });
};
