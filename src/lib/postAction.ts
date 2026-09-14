import { deserialize } from '$app/forms';
import { toast } from 'svelte-sonner';

const DEFAULT = 'Enregistrement impossible.';

/**
 * POST vers une action SvelteKit (`?/x`) ou une route `/api`, avec le message d'erreur du serveur
 * remonté en toast.
 *
 * Sans passage obligé de ce genre, un refus (règle métier, droits, réseau) ne laisse aucune trace à
 * l'écran : les pages de cette app écrivent leur modification de façon optimiste, donc la valeur
 * refusée reste affichée et l'écart n'apparaît qu'au rechargement suivant — l'utilisateur croit
 * avoir enregistré, et ne comprend pas ce qu'il voit ensuite.
 *
 * Renvoie la réponse (clonable, le corps n'est pas consommé) ou `null` si le serveur a refusé ;
 * c'est à l'appelant de décider comment revenir en arrière, lui seul sait ce qu'il a écrit.
 */
export async function postOrToast(url: string, init: RequestInit): Promise<Response | null> {
	const res = await fetch(url, init).catch(() => null);
	if (!res) {
		toast.error('Connexion perdue : modification non enregistrée.');
		return null;
	}
	// Une action SvelteKit répond toujours par un ActionResult sérialisé, succès comme échec —
	// `res.ok` n'y suffit pas, le message vit dans `data.error` (cf. `fail(400, { error })`).
	if (url.includes('?/')) {
		const result = deserialize(await res.clone().text());
		if (result.type === 'success') return res;
		toast.error(
			result.type === 'failure'
				? String(result.data?.error ?? DEFAULT)
				: result.type === 'error'
					? (result.error?.message ?? DEFAULT)
					// Une action ne redirige ici que sur une session perdue (garde de hooks.server).
					: 'Session expirée — reconnecte-toi.'
		);
		return null;
	}
	if (res.ok) return res;
	// Routes /api : `error(status, message)` de SvelteKit, sérialisé en `{ message }`.
	toast.error((await res.clone().json().catch(() => null))?.message ?? DEFAULT);
	return null;
}
