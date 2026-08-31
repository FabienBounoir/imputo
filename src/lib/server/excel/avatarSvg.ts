// Avatar Dicebear embarqué en SVG export (ticketsSvg.ts, objectivesSvg.ts) — même rendu que
// UserAvatar.svelte (photo Dicebear, seed = userId, repli initiales/dégradé si le fetch échoue),
// mais en data URI puisqu'une image SVG exportée ne peut pas pointer vers une URL externe.

const AVATAR_GRADIENT_FROM = '#f2b56b';
const AVATAR_GRADIENT_TO = '#e8744f';
const AVATAR_FETCH_TIMEOUT_MS = 3000;

// Mêmes règles que UserAvatar.svelte : deux premiers mots du nom, première lettre, majuscule.
export function initials(name: string): string {
	return name
		.split(/\s+/)
		.map((w) => w[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();
}

export async function fetchAvatarDataUri(userId: string): Promise<string | null> {
	try {
		const res = await fetch(`https://api.dicebear.com/10.x/critters/svg?seed=${encodeURIComponent(userId)}`, {
			signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const svg = await res.text();
		return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
	} catch {
		return null;
	}
}

/** Un fetch par userId (dédupliqué), tous en parallèle plutôt qu'en série. */
export async function fetchAvatarDataUris(userIds: string[]): Promise<Map<string, string | null>> {
	const uniq = [...new Set(userIds)];
	const entries = await Promise.all(uniq.map(async (id) => [id, await fetchAvatarDataUri(id)] as const));
	return new Map(entries);
}

/** Cercle avatar (photo si dispo, sinon initiales sur dégradé) centré en (cx, cy), rayon r. clipId doit être unique dans le SVG parent. */
export function avatarCircle(
	photo: string | null | undefined,
	name: string,
	cx: number,
	cy: number,
	r: number,
	clipId: string,
	font: string
): string {
	if (photo) {
		return `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#${clipId})"><image x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" href="${photo}"/></g>`;
	}
	return (
		`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#avatarGrad)"/>` +
		`<text x="${cx}" y="${cy + r * 0.35}" font-size="${r}" font-weight="700" fill="#FFFFFF" text-anchor="middle" ${font}>${initials(name || '?')}</text>`
	);
}

export const AVATAR_GRADIENT_DEF = `<linearGradient id="avatarGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${AVATAR_GRADIENT_FROM}"/><stop offset="100%" stop-color="${AVATAR_GRADIENT_TO}"/></linearGradient>`;
