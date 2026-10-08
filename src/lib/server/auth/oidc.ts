import { createHash, randomBytes } from 'node:crypto';
import { config } from '$lib/server/config';

// Flux "authorization code" + PKCE contre n'importe quel fournisseur OIDC (Entra, Keycloak,
// GitLab…) découvert via son `.well-known` — rien de propre à un fournisseur ici.

export const OIDC_COOKIE = 'imputo_oidc';

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string };

// ponytail: cache process, jamais invalidé — les endpoints d'un fournisseur ne bougent pas ; un
// redémarrage du pod suffit si on change OIDC_ISSUER_URL.
let discovery: Promise<Discovery> | null = null;

function getDiscovery(): Promise<Discovery> {
	discovery ??= fetch(`${config.oidcIssuerUrl}/.well-known/openid-configuration`)
		.then((r) => {
			if (!r.ok) throw new Error(`OIDC discovery HTTP ${r.status}`);
			return r.json() as Promise<Discovery>;
		})
		.catch((e) => {
			discovery = null; // retente au prochain login plutôt que de figer l'échec
			throw e;
		});
	return discovery;
}

export const redirectUri = () => `${config.publicBaseUrl}/auth/callback`;

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Paramètres à garder côté navigateur (cookie httpOnly) entre la redirection et le retour. */
export type OidcPending = { state: string; nonce: string; verifier: string };

export async function buildAuthorizationUrl(): Promise<{ url: string; pending: OidcPending }> {
	const d = await getDiscovery();
	const pending = { state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)) };
	const url = new URL(d.authorization_endpoint);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: config.oidcClientId,
		redirect_uri: redirectUri(),
		scope: 'openid profile email',
		state: pending.state,
		nonce: pending.nonce,
		code_challenge: b64url(createHash('sha256').update(pending.verifier).digest()),
		code_challenge_method: 'S256'
	}).toString();
	return { url: url.toString(), pending };
}

type IdClaims = { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; email?: string; preferred_username?: string; upn?: string };

/**
 * Vérifie les claims d'un id_token et en extrait l'email (minuscules), ou null si invalide.
 * Pas de vérification de signature : le token vient directement du token endpoint en TLS avec
 * notre client_secret, ce qu'OIDC Core §3.1.3.7 accepte à la place de la signature.
 */
export function emailFromIdToken(idToken: string, expected: { issuer: string; clientId: string; nonce: string }, now = Date.now()): string | null {
	let c: IdClaims;
	try {
		c = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
	if (c.iss !== expected.issuer || !aud.includes(expected.clientId) || c.nonce !== expected.nonce) return null;
	if (!c.exp || c.exp * 1000 < now) return null;
	// Entra ne renvoie pas toujours `email` : preferred_username/upn y portent l'adresse du compte.
	const email = c.email ?? c.preferred_username ?? c.upn;
	return email && email.includes('@') ? email.trim().toLowerCase() : null;
}

/** Échange le code contre un id_token et renvoie l'email authentifié, ou null. */
export async function exchangeCode(code: string, pending: OidcPending): Promise<string | null> {
	const d = await getDiscovery();
	const res = await fetch(d.token_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri(),
			client_id: config.oidcClientId,
			client_secret: config.oidcClientSecret,
			code_verifier: pending.verifier
		})
	});
	if (!res.ok) throw new Error(`OIDC token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const { id_token } = (await res.json()) as { id_token?: string };
	if (!id_token) return null;
	return emailFromIdToken(id_token, { issuer: d.issuer, clientId: config.oidcClientId, nonce: pending.nonce });
}
