import { describe, it, expect } from 'vitest';
import { emailFromIdToken } from './oidc';

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const expected = { issuer: 'https://idp.example/v2.0', clientId: 'client-1', nonce: 'n1' };
const now = 1_800_000_000_000;
const valid = { iss: expected.issuer, aud: 'client-1', nonce: 'n1', exp: now / 1000 + 60, email: 'Jane.Doe@Example.com' };

describe('emailFromIdToken', () => {
	it('renvoie l\'email en minuscules pour un token valide, avec repli sur preferred_username', () => {
		expect(emailFromIdToken(jwt(valid), expected, now)).toBe('jane.doe@example.com');
		expect(emailFromIdToken(jwt({ ...valid, email: undefined, preferred_username: 'x@example.com' }), expected, now)).toBe('x@example.com');
		expect(emailFromIdToken(jwt({ ...valid, aud: ['other', 'client-1'] }), expected, now)).toBe('jane.doe@example.com');
	});

	it('rejette mauvais émetteur, audience, nonce, token expiré, email absent ou token illisible', () => {
		expect(emailFromIdToken(jwt({ ...valid, iss: 'https://evil.example' }), expected, now)).toBeNull();
		expect(emailFromIdToken(jwt({ ...valid, aud: 'other' }), expected, now)).toBeNull();
		expect(emailFromIdToken(jwt({ ...valid, nonce: 'replay' }), expected, now)).toBeNull();
		expect(emailFromIdToken(jwt({ ...valid, exp: now / 1000 - 1 }), expected, now)).toBeNull();
		expect(emailFromIdToken(jwt({ ...valid, email: undefined }), expected, now)).toBeNull();
		expect(emailFromIdToken('pas-un-jwt', expected, now)).toBeNull();
	});
});
