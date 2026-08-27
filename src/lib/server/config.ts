import { env } from '$env/dynamic/private';
import { parseDuration } from './auth/tokens';

export const config = {
	magicLinkTtlMs: parseDuration(env.MAGIC_LINK_TTL ?? '7d', 7 * 86400000),
	archiveRetentionMs: parseDuration(env.ARCHIVE_RETENTION ?? '30d', 30 * 86400000),
	publicBaseUrl: env.BASE_URL ?? 'http://localhost:5173',
	cronSecret: env.CRON_SECRET ?? '',
	// Web Push (VAPID). La clé publique est transmise au client via le load de /settings.
	vapidPublic: env.VAPID_PUBLIC_KEY ?? '',
	vapidPrivate: env.VAPID_PRIVATE_KEY ?? '',
	vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@imputo.app',
	raeStaleDays: Number(env.NOTIF_RAE_STALE_DAYS ?? '7') || 7,
	// Chute d'humeur moyenne (sur 5) entre deux plages Team mood consécutives déclenchant le récap admin.
	moodDropThreshold: Number(env.NOTIF_MOOD_DROP_THRESHOLD ?? '0.5') || 0.5,
	// Synchronisation Jira — credentials Azure globales (client_credentials), PAT lui-même stocké
	// chiffré par espace (workspace.jiraPatEncrypted). Tenant/base URL ont un défaut car non
	// secrets ; client id/secret et la clé de chiffrement vides par défaut, comme cronSecret.
	azureTenantId: env.AZURE_TENANT_ID ?? '8b87af7d-8647-4dc7-8df4-5f69a2011bb5',
	azureClientId: env.AZURE_CLIENT_ID ?? '',
	azureClientSecret: env.AZURE_CLIENT_SECRET ?? '',
	jiraBaseUrl: env.JIRA_BASE_URL ?? 'https://jira.constellation.soprasteria.com',
	jiraPatEncryptionKey: env.JIRA_PAT_ENCRYPTION_KEY ?? '',
	// Force le wrapped visible/accessible à tout le monde toute l'année (démo, QA) — jamais mis en
	// préprod/prod, absent de l'env par défaut donc la fenêtre du 1 déc → 5 jan s'applique normalement.
	wrappedForceOpen: env.WRAPPED_FORCE_OPEN === '1'
};

export function emailDomain(email: string): string {
	return email.trim().toLowerCase().split('@')[1] ?? '';
}
