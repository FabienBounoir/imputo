import { darkenHex } from '$lib/color';
import type { RequestHandler } from './$types';

const DEFAULT_COLOR = '#22c55e';

// Même gabarit (3 barres + cercle) que l'ancien static/favicon.svg, mais le dégradé part
// désormais de la couleur d'accent courante au lieu d'être figé en vert.
function faviconSvg(color: string): string {
	const dark = darkenHex(color, 0.35);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Imputo">
	<defs>
		<linearGradient id="fav" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="${color}" />
			<stop offset="1" stop-color="${dark}" />
		</linearGradient>
	</defs>
	<rect width="512" height="512" rx="120" fill="url(#fav)" />
	<g fill="#ffffff">
		<rect x="132" y="284" width="64" height="96" rx="30" />
		<rect x="224" y="230" width="64" height="150" rx="30" />
		<rect x="316" y="170" width="64" height="210" rx="30" />
		<circle cx="348" cy="116" r="32" />
	</g>
</svg>
`;
}

// Reprend la même priorité que le $effect racine (+layout.svelte) qui pilote --accent : préférence
// perso CUSTOM > espace, sauf qu'ici le mode RGB n'anime rien (une favicon ne peut pas défiler sans
// la re-fetcher en boucle côté client) — on fige simplement sur la couleur de base de l'espace.
export const GET: RequestHandler = ({ locals }) => {
	const ws = locals.workspace;
	const u = locals.user;
	const color = (u?.accentMode === 'CUSTOM' ? u.accentColor : ws?.accentColor) ?? DEFAULT_COLOR;

	return new Response(faviconSvg(color), {
		headers: {
			'Content-Type': 'image/svg+xml',
			// Dépend de la session (cookie) : jamais de cache partagé/CDN.
			'Cache-Control': 'private, max-age=300'
		}
	});
};
