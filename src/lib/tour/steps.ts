export type TourRole = 'USER' | 'MANAGER' | 'ADMIN';

export type TourStep = {
	id: string;
	path: string;
	/** Rôles concernés par cette étape. Absent = tout le monde. */
	roles?: TourRole[];
	/** N'affiche l'étape que si ce flag (issu du load du layout) est vrai. */
	visibleIf?: 'moodEnabled' | 'wrappedAvailable';
	/** Sélecteur CSS de l'élément mis en évidence. Absent = popover centré (présentation de page). */
	element?: string;
	title: string;
	description: string;
};

// Tronc commun (tous rôles) → bonus contributeur → palier MANAGER → palier ADMIN.
// Chaque palier s'ajoute au précédent selon le rôle courant (cf. tourStepsFor).
export const TOUR_STEPS: TourStep[] = [
	{
		id: 'welcome',
		path: '/imputation',
		title: 'Bienvenue sur Imputo 👋',
		description: "Ton outil pour le chiffrage et le suivi du temps sur le projet. Un tour rapide de l'essentiel, en 2 minutes."
	},
	{
		id: 'imputation-add',
		path: '/imputation',
		element: '[data-tour="imputation-add"]',
		title: 'Imputer ton temps',
		description:
			"Ajoute un ticket ou une catégorie, puis saisis tes heures par jour. L'écran que tu utiliseras le plus souvent."
	},
	{
		id: 'tickets',
		path: '/tickets',
		title: 'Tickets & chiffrage',
		description: 'La liste des tickets du projet : statut, RAE (reste à faire), estimation. Filtre par sprint / version ou priorité.'
	},
	{
		id: 'tickets-new',
		path: '/tickets',
		element: '[data-tour="tickets-new"]',
		title: 'Créer un ticket',
		description: "N'importe quel membre peut créer un ticket : clé, titre, sprint, estimation."
	},
	{
		id: 'absences',
		path: '/absences',
		element: '[data-tour="absences-add"]',
		title: 'Déclarer une absence',
		description: 'Congé, formation ou hors-projet : déclare-le ici, ça apparaît dans le calendrier de l’équipe.'
	},
	{
		id: 'dashboard',
		path: '/dashboard',
		title: 'Ta synthèse',
		description: 'Vue d’ensemble de tes imputations du mois : total par activité, évolution.'
	},
	{
		id: 'user-menu',
		path: '/dashboard',
		element: '[data-tour="user-menu"]',
		title: 'Ton profil',
		description: 'Clique sur ton avatar en bas du menu pour ouvrir tes préférences personnelles.'
	},
	// Bonus contributeur — optionnel, pas bloquant.
	{
		id: 'support',
		path: '/support',
		title: 'Support',
		description: 'Qui est de permanence pour regarder les tickets entrants.'
	},
	{
		id: 'mood',
		path: '/mood',
		visibleIf: 'moodEnabled',
		title: 'Team mood',
		description: "Un vote anonyme, à intervalle régulier, pour donner la météo de l'équipe."
	},

	// Palier MANAGER (+ ADMIN). Un manager n'a pas plus de droits qu'un membre lambda sur les
	// absences des vrais membres (ni validation, ni congé validé direct) et pas d'accès au mood —
	// cf. absences/+page.server.ts et admin/mood/+page.server.ts. Il ne gère que les membres externes.
	{
		id: 'objectifs',
		path: '/admin/objectifs',
		roles: ['MANAGER', 'ADMIN'],
		title: 'Objectifs de la semaine',
		description: "Fixe les priorités de la semaine pour l'équipe."
	},

	// Palier ADMIN.
	{
		id: 'admin',
		path: '/admin',
		roles: ['ADMIN'],
		title: 'Paramètres & membres',
		description: "Inviter des membres, gérer les rôles, configurer la synchro Jira tout est ici."
	},
	{
		id: 'absences-validate',
		path: '/absences',
		roles: ['ADMIN'],
		title: 'Valider les absences',
		description: "Un panneau « À valider » apparaît en haut dès qu'un membre de l'équipe attend ta validation."
	},
	{
		id: 'mood-results',
		path: '/admin/mood',
		roles: ['ADMIN'],
		visibleIf: 'moodEnabled',
		title: 'Résultats du mood',
		description: "Vue agrégée et anonymisée des votes de l'équipe."
	},
	{
		id: 'admin-cloture',
		path: '/admin/cloture',
		roles: ['ADMIN'],
		title: 'Clôture mensuelle',
		description: 'Fige les chiffres du mois pour le reporting management.'
	},
	{
		id: 'admin-suivi-annuel',
		path: '/admin/suivi-annuel',
		roles: ['ADMIN'],
		title: 'Suivi annuel',
		description: 'RAE, consommé et production par SSP, sur 12 mois glissants.'
	}
];

export function tourStepsFor(
	role: TourRole | null,
	flags: { moodEnabled: boolean; wrappedAvailable: boolean }
): TourStep[] {
	return TOUR_STEPS.filter((s) => {
		if (s.roles && (!role || !s.roles.includes(role))) return false;
		if (s.visibleIf === 'moodEnabled' && !flags.moodEnabled) return false;
		if (s.visibleIf === 'wrappedAvailable' && !flags.wrappedAvailable) return false;
		return true;
	});
}
