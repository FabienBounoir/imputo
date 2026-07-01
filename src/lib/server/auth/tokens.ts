import { randomBytes, createHash } from 'node:crypto';

/** Génère un token brut (à transmettre) et son hash (à stocker). */
export function generateToken(bytes = 32): { token: string; hash: string } {
	const token = randomBytes(bytes).toString('base64url');
	return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Convertit une durée type `7d`, `30d`, `12h`, `45m` en millisecondes. */
export function parseDuration(input: string, fallbackMs: number): number {
	const m = input?.trim().match(/^(\d+)\s*(d|h|m|s)$/i);
	if (!m) return fallbackMs;
	const n = Number(m[1]);
	const unit = m[2].toLowerCase();
	const mult = unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000;
	return n * mult;
}
