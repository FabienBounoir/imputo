import { z } from 'zod';

export const registerSchema = z.object({
	displayName: z.string().trim().min(1, 'Nom requis').max(80),
	workspaceName: z.string().trim().min(1, "Nom de l'espace requis").max(80),
	email: z.string().trim().toLowerCase().email('Email invalide'),
	password: z.string().min(8, 'Mot de passe : 8 caractères minimum').max(200)
});

export const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email('Email invalide'),
	password: z.string().min(1, 'Mot de passe requis')
});

export const setPasswordSchema = z
	.object({
		password: z.string().min(8, 'Mot de passe : 8 caractères minimum').max(200),
		confirm: z.string()
	})
	.refine((d) => d.password === d.confirm, {
		message: 'Les mots de passe ne correspondent pas',
		path: ['confirm']
	});

export const inviteSchema = z.object({
	displayName: z.string().trim().min(1, 'Nom requis').max(80),
	email: z.string().trim().toLowerCase().email('Email invalide'),
	role: z.enum(['USER', 'ADMIN', 'MANAGER'])
});
