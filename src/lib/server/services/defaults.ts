// Référentiels pré-remplis à la création d'un espace.

export const DEFAULT_STATES: { label: string; emoji: string; color: string }[] = [
	{ label: 'A macro-chiffrer', emoji: '🔢', color: '#94A3B8' },
	{ label: 'DA à faire / à revoir', emoji: '📜', color: '#A78BFA' },
	{ label: 'A déposer', emoji: '📨', color: '#818CF8' },
	{ label: 'En attente validation Région', emoji: '⌛', color: '#FBBF24' },
	{ label: 'Réalisation à faire', emoji: '▶️', color: '#64748B' },
	{ label: 'En cours de dev', emoji: '🚧', color: '#E8973A' },
	{ label: 'En MR', emoji: '👀', color: '#3B82F6' },
	{ label: 'A mettre en qualif', emoji: '🦄', color: '#C084FC' },
	{ label: 'En qualif', emoji: '🛠️', color: '#8B5CF6' },
	{ label: 'Defect', emoji: '💢', color: '#EF4444' },
	{ label: 'Retour recette', emoji: '🚨', color: '#F97316' },
	{ label: 'A mettre en préprod', emoji: '🦊', color: '#14B8A6' },
	{ label: 'En recette métier', emoji: '🕰️', color: '#0EA5E9' },
	{ label: 'A mettre en production', emoji: '🐦‍🔥', color: '#22C55E' },
	{ label: 'En production', emoji: '✅', color: '#16A34A' }
];

export const DEFAULT_ACTIVITIES: string[] = [
	'Dev',
	'TU',
	'TNR',
	'Analyse',
	'DA',
	'Relecture',
	'Infra',
	'Gatling',
	'Support',
	'Aide'
];

export const DEFAULT_CATEGORIES: { label: string; kind: 'PRODUCTIVE' | 'NON_PRODUCTIVE' }[] = [
	{ label: 'MCO', kind: 'PRODUCTIVE' },
	{ label: 'Hors-projet', kind: 'PRODUCTIVE' },
	{ label: 'Congé', kind: 'NON_PRODUCTIVE' },
	{ label: 'Jour férié', kind: 'NON_PRODUCTIVE' },
	{ label: 'Formation', kind: 'NON_PRODUCTIVE' }
];
