import { env } from '$env/dynamic/private';
import { parseDuration } from './auth/tokens';

export const config = {
	magicLinkTtlMs: parseDuration(env.MAGIC_LINK_TTL ?? '7d', 7 * 86400000),
	archiveRetentionMs: parseDuration(env.ARCHIVE_RETENTION ?? '30d', 30 * 86400000),
	publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
	cronSecret: env.CRON_SECRET ?? '',
	// Web Push (VAPID). La clé publique est transmise au client via le load de /settings.
	vapidPublic: env.VAPID_PUBLIC_KEY ?? '',
	vapidPrivate: env.VAPID_PRIVATE_KEY ?? '',
	vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@imputo.app',
	raeStaleDays: Number(env.NOTIF_RAE_STALE_DAYS ?? '7') || 7,
	// Chute d'humeur moyenne (sur 5) entre deux plages Team mood consécutives déclenchant le récap admin.
	moodDropThreshold: Number(env.NOTIF_MOOD_DROP_THRESHOLD ?? '0.5') || 0.5
};

export function emailDomain(email: string): string {
	return email.trim().toLowerCase().split('@')[1] ?? '';
}
