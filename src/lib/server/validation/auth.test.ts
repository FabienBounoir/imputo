import { describe, it, expect } from 'vitest';
import { changePasswordSchema } from './auth';

describe('changePasswordSchema', () => {
	it('accepte un mot de passe et sa confirmation identiques (8+ caractères)', () => {
		const res = changePasswordSchema.safeParse({
			currentPassword: 'old-password',
			password: 'newpassword123',
			confirm: 'newpassword123'
		});
		expect(res.success).toBe(true);
	});

	it('rejette quand la confirmation ne correspond pas', () => {
		const res = changePasswordSchema.safeParse({
			currentPassword: 'old-password',
			password: 'newpassword123',
			confirm: 'autrechose123'
		});
		expect(res.success).toBe(false);
		if (!res.success) expect(res.error.issues[0].path).toEqual(['confirm']);
	});

	it('rejette un nouveau mot de passe trop court', () => {
		const res = changePasswordSchema.safeParse({
			currentPassword: 'old-password',
			password: 'short',
			confirm: 'short'
		});
		expect(res.success).toBe(false);
	});

	it('rejette un mot de passe actuel vide', () => {
		const res = changePasswordSchema.safeParse({
			currentPassword: '',
			password: 'newpassword123',
			confirm: 'newpassword123'
		});
		expect(res.success).toBe(false);
	});
});
