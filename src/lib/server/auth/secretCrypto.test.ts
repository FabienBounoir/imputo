import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './secretCrypto';

const key = randomBytes(32).toString('base64');
const otherKey = randomBytes(32).toString('base64');

describe('secretCrypto', () => {
	it('round-trip: déchiffre exactement ce qui a été chiffré', () => {
		const plaintext = 'jira-pat-abc123';
		expect(decryptSecret(encryptSecret(plaintext, key), key)).toBe(plaintext);
	});

	it('round-trip: chaîne vide et caractères spéciaux', () => {
		const plaintext = 'éàü/ç 你好 🔒';
		expect(decryptSecret(encryptSecret(plaintext, key), key)).toBe(plaintext);
	});

	it('deux chiffrements du même texte produisent des ciphertexts différents (IV aléatoire)', () => {
		const plaintext = 'jira-pat-abc123';
		expect(encryptSecret(plaintext, key)).not.toBe(encryptSecret(plaintext, key));
	});

	it('mauvaise clé au déchiffrement lève une erreur', () => {
		const ciphertext = encryptSecret('jira-pat-abc123', key);
		expect(() => decryptSecret(ciphertext, otherKey)).toThrow();
	});

	it('ciphertext altéré lève une erreur (détection GCM)', () => {
		const ciphertext = encryptSecret('jira-pat-abc123', key);
		const raw = Buffer.from(ciphertext, 'base64');
		raw[raw.length - 1] ^= 0xff; // flip un octet de la fin du ciphertext
		expect(() => decryptSecret(raw.toString('base64'), key)).toThrow();
	});

	it('clé de mauvaise longueur lève une erreur claire', () => {
		expect(() => encryptSecret('x', Buffer.from('trop-courte').toString('base64'))).toThrow(
			/Clé de chiffrement invalide/
		);
	});
});
