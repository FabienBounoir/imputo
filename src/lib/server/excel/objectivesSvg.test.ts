import { describe, it, expect } from 'vitest';
import { buildObjectivesSvg } from './objectivesSvg';
import { db, activity } from '$lib/server/db';
import { makeWorkspace, addMember } from '$lib/server/services/test-helpers';
import { setMemberFactice } from '$lib/server/services/accounts';
import { createTicket } from '$lib/server/services/tickets';
import { addObjective } from '$lib/server/services/weeklyObjectives';

describe('buildObjectivesSvg', () => {
	it('exclut un membre "factice" pour tout le monde, sans distinction de rôle (cf. la page en ligne)', async () => {
		const ws = await makeWorkspace('objsvg');
		const { userId: facticeId } = await addMember(ws.workspaceId, 'USER', 'objsvg-factice');
		await setMemberFactice(ws.workspaceId, facticeId, true);

		const { svg } = await buildObjectivesSvg(ws.workspaceId, '2026-06-22');

		expect(svg).not.toContain('objsvg-factice');
		expect(svg).toContain('objsvg owner');
	});

	it('une note posée sur un objectif TICKET remplace le titre affiché (même règle que Mon imputation), la clé reste visible', async () => {
		const ws = await makeWorkspace('objsvg-note');
		const t = await createTicket(ws.workspaceId, { key: 'OBS-1', title: 'Titre original du ticket' });
		await addObjective(ws.workspaceId, ws.userId, {
			userId: ws.userId,
			weekMondayISO: '2026-06-22',
			kind: 'TICKET',
			ticketId: t.id,
			label: 'Ce qu’on attend réellement cette semaine'
		});

		const { svg } = await buildObjectivesSvg(ws.workspaceId, '2026-06-22');

		expect(svg).toContain('OBS-1');
		expect(svg).toContain('Ce qu’on attend réellement cette semaine');
		expect(svg).not.toContain('Titre original du ticket');
	});

	it('un "[Activité]" à libellé multi-mots reste entier (jamais coupé par le retour à la ligne)', async () => {
		const ws = await makeWorkspace('objsvg-wrap');
		const t = await createTicket(ws.workspaceId, {
			key: 'OBS-2',
			// Longueur choisie pour que le point de coupure de wrapLines tombe précisément entre
			// "[Retours" et "qualif]" (vérifié par calcul avec l'ancienne implémentation) — un titre
			// "naturel" ne reproduit pas forcément le bug, le point de coupure dépend de la longueur
			// exacte du texte avant l'activité.
			title: 'x'.repeat(36)
		});
		const [act] = await db.insert(activity).values({ workspaceId: ws.workspaceId, label: 'Retours qualif' }).returning();
		await addObjective(ws.workspaceId, ws.userId, {
			userId: ws.userId,
			weekMondayISO: '2026-06-22',
			kind: 'TICKET',
			ticketId: t.id,
			activityId: act.id
		});

		const { svg } = await buildObjectivesSvg(ws.workspaceId, '2026-06-22');

		// Avant le fix, un retour à la ligne tombant entre les deux mots de l'activité produisait
		// des fragments disjoints "[Retours" / "qualif]" — jamais cette sous-chaîne contiguë.
		expect(svg).toContain('[Retours qualif]');
	});

	it('un "[Activité]" qui ne tient pas sur la dernière ligne repart à la ligne plutôt que de déborder de la carte', async () => {
		const ws = await makeWorkspace('objsvg-overflow');
		const t = await createTicket(ws.workspaceId, {
			key: 'OBS-3',
			// Longueur choisie pour que le corps seul tienne sur une ligne (< 60 caractères), mais
			// que corps + " [Industrialisation]" dépasse largement — vérifié par calcul : avant le
			// fix, l'activité était rattachée telle quelle à la dernière ligne sans vérifier la
			// place disponible, produisant une seule ligne de 68 caractères qui débordait du cadre.
			title: 'y'.repeat(40)
		});
		const [act] = await db.insert(activity).values({ workspaceId: ws.workspaceId, label: 'Industrialisation' }).returning();
		await addObjective(ws.workspaceId, ws.userId, {
			userId: ws.userId,
			weekMondayISO: '2026-06-22',
			kind: 'TICKET',
			ticketId: t.id,
			activityId: act.id
		});

		const { svg } = await buildObjectivesSvg(ws.workspaceId, '2026-06-22');

		// L'activité doit être seule sur sa propre ligne (son propre <text>), pas accolée au texte
		// qui déborderait alors du cadre de la carte.
		expect(svg).toMatch(/<text[^>]*><tspan fill="[^"]*">\[Industrialisation\]<\/tspan><\/text>/);
	});
});
