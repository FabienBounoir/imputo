import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchTicketSummaries } from '$lib/server/services/tickets';

/**
 * Recherche de tickets pour les sélecteurs (Mon imputation : TargetPicker et QuickAddPalette).
 * Distinct de /api/tickets, qui sert le scroll infini du tableau et renvoie des tickets enrichis
 * (consommé, RAE, contributeurs, groupes) : ici on ne veut que clé/titre/sprint/version, sans une
 * seule agrégation. Distinct aussi de /api/command/tickets, qui plafonne à 8 résultats et n'a ni
 * filtre version ni les champs nécessaires pour construire une ligne d'imputation.
 *
 * Ouvert à tout membre authentifié de l'espace : ces trois champs sont déjà visibles partout
 * ailleurs (tableau des tickets, sélecteurs), il n'y a rien à masquer par rôle ici.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ws = locals.workspace;
	if (!ws || !locals.user) error(401, 'Non authentifié.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const versionId = url.searchParams.get('version')?.trim() || undefined;
	const perimeterId = url.searchParams.get('perimeter')?.trim() || undefined;
	// Sans recherche ni filtre, l'appel n'a rien à faire ici : la liste d'amorce vient déjà du load
	// de la page. Renvoyer tout le catalogue serait exactement ce qu'on cherche à éviter.
	if (q.length < 2 && !versionId && !perimeterId) return json({ tickets: [] });

	return json({ tickets: await searchTicketSummaries(ws.workspaceId, { query: q, versionId, perimeterId }) });
};
