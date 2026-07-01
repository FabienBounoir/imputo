import { env } from '$env/dynamic/private';
import { parseDuration } from './auth/tokens';

export const config = {
	allowPublicEmailDomains: env.ALLOW_PUBLIC_EMAIL_DOMAINS === 'true',
	allowedSignupDomains: (env.ALLOWED_SIGNUP_DOMAINS ?? '')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean),
	magicLinkTtlMs: parseDuration(env.MAGIC_LINK_TTL ?? '7d', 7 * 86400000),
	archiveRetentionMs: parseDuration(env.ARCHIVE_RETENTION ?? '30d', 30 * 86400000),
	publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
	cronSecret: env.CRON_SECRET ?? '',
	// Web Push (VAPID). La clé publique est transmise au client via le load de /settings.
	vapidPublic: env.VAPID_PUBLIC_KEY ?? '',
	vapidPrivate: env.VAPID_PRIVATE_KEY ?? '',
	vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@imputo.app',
	raeStaleDays: Number(env.NOTIF_RAE_STALE_DAYS ?? '7') || 7
};

// Fournisseurs grand public (liste maintenue) bloqués si allowPublicEmailDomains = false.
export const PUBLIC_EMAIL_PROVIDERS = new Set([
	'gmail.com',
	'googlemail.com',
	'outlook.com',
	'outlook.fr',
	'hotmail.com',
	'hotmail.fr',
	'live.com',
	'live.fr',
	'yahoo.com',
	'yahoo.fr',
	'icloud.com',
	'me.com',
	'proton.me',
	'protonmail.com',
	'gmx.com',
	'orange.fr',
	'free.fr',
	'wanadoo.fr',
	'laposte.net'
]);

export function emailDomain(email: string): string {
	return email.trim().toLowerCase().split('@')[1] ?? '';
}

/** Valide qu'un email a le droit de CRÉER un espace (auto-inscription). */
export function canSignup(email: string): { ok: true } | { ok: false; reason: string } {
	const domain = emailDomain(email);
	if (!domain) return { ok: false, reason: 'Adresse email invalide.' };
	if (config.allowedSignupDomains.length > 0) {
		if (!config.allowedSignupDomains.includes(domain))
			return {
				ok: false,
				reason: `Seuls les domaines autorisés peuvent créer un espace (${config.allowedSignupDomains.join(', ')}).`
			};
		return { ok: true };
	}
	if (!config.allowPublicEmailDomains && PUBLIC_EMAIL_PROVIDERS.has(domain))
		return { ok: false, reason: 'Les adresses email grand public ne sont pas autorisées.' };
	return { ok: true };
}
