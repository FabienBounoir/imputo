import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// AES-256-GCM pour des secrets réversibles (ex. PAT Jira) — distinct de tokens.ts (hash à sens
// unique, sessions/invites) et de password.ts (argon2, mots de passe). Format : base64(iv[12] +
// authTag[16] + ciphertext). La clé est toujours passée en paramètre, jamais lue depuis l'env ici
// (les appelants doivent rester $env-libres, voir services/jiraSync.ts).
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function decodeKey(keyBase64: string): Buffer {
	const key = Buffer.from(keyBase64, 'base64');
	if (key.length !== KEY_LENGTH) {
		throw new Error(`Clé de chiffrement invalide : ${key.length} octets (${KEY_LENGTH} attendus).`);
	}
	return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
	const key = decodeKey(keyBase64);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptSecret(ciphertext: string, keyBase64: string): string {
	const key = decodeKey(keyBase64);
	const raw = Buffer.from(ciphertext, 'base64');
	const iv = raw.subarray(0, IV_LENGTH);
	const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const data = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
