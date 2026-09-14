/**
 * Catalogue des badges — partagé client/serveur.
 *
 * Un badge = un compteur + cinq paliers. Les seuils vivent ici, pas en base : les retoucher ne
 * demande aucune migration, et la valeur stockée reste brute (le palier se recalcule à l'affichage
 * comme au déblocage, cf. tierFor).
 *
 * Deux familles de compteurs, pour une raison de fond :
 *   • CUMUL   — un total qui ne redescend jamais (votes, tickets, tours de garde).
 *   • RECORD  — le meilleur résultat jamais atteint (série de jours, semaines sans RAE périmé).
 *     On stocke le record et JAMAIS la série en cours : une série cassée ne doit pas reprendre un
 *     palier déjà gagné. Un badge qu'on peut perdre est une punition, et sur l'imputation ça
 *     pousserait à saisir pendant ses congés.
 *
 * Aucun compteur ne porte sur un volume d'heures : ça récompenserait le surbooking et pourrirait
 * la donnée. On compte des actes (un jour saisi à l'heure, un ticket bien estimé), jamais des heures.
 */

export type BadgeKind = 'CUMUL' | 'RECORD';

export type BadgeDef = {
	id: string;
	/** Nom du badge, stable : c'est lui qui identifie la collection. */
	name: string;
	/** Ce que compte la valeur, à la première personne, pour l'affichage sur la fiche. */
	unit: string;
	kind: BadgeKind;
	/** Cinq seuils croissants. Le 5e est volontairement hors de portée à court terme. */
	thresholds: [number, number, number, number, number];
	/** Un nom par palier — c'est ce qui donne envie du suivant, pas « bronze/argent/or ». */
	tierNames: [string, string, string, string, string];
	/** Réservé aux ADMIN : jamais listé ni calculé pour un membre standard. */
	adminOnly?: boolean;
};

export const BADGES: BadgeDef[] = [
	{
		id: 'assidu',
		name: 'Assidu',
		unit: 'jours ouvrés consécutifs imputés à temps',
		kind: 'RECORD',
		thresholds: [5, 20, 50, 120, 250],
		tierNames: ['Présent', 'Régulier', 'Métronome', 'Increvable', 'Machine']
	},
	{
		id: 'ponctuel',
		name: 'Ponctuel',
		unit: 'jours saisis le jour même',
		kind: 'CUMUL',
		thresholds: [10, 50, 200, 500, 1000],
		tierNames: ['À l’heure', 'Sans retard', 'Horloge', 'Pendule suisse', 'Temps atomique']
	},
	{
		// Cumul et pas record de série : rien en base ne garde l'historique des RAE périmés
		// (listStaleRaePairs ne connaît que l'instant présent), donc ce compteur ne peut pas être
		// rétroactif — il avance d'une semaine à chaque passage où la personne n'a aucune paire
		// périmée. Le compter en série obligerait à stocker un état de plus pour un badge qui
		// démarrerait à zéro pour tout le monde de toute façon.
		id: 'rae-frais',
		name: 'RAE frais',
		unit: 'semaines sans aucun RAE périmé',
		kind: 'CUMUL',
		thresholds: [2, 6, 12, 26, 52],
		tierNames: ['Propre', 'Nickel', 'Impeccable', 'Stérile', 'Bloc opératoire']
	},
	{
		id: 'chiffreur',
		name: 'Chiffreur',
		unit: 'tickets estimés',
		kind: 'CUMUL',
		thresholds: [5, 25, 100, 300, 750],
		tierNames: ['Estimateur', 'Jaugeur', 'Arpenteur', 'Géomètre', 'Cartographe']
	},
	{
		id: 'dans-le-mille',
		name: 'Dans le mille',
		unit: 'tickets terminés à ±10 % de l’estimation',
		kind: 'CUMUL',
		thresholds: [1, 5, 20, 50, 100],
		tierNames: ['Chanceux', 'Bon nez', 'Devin', 'Oracle', 'Madame Irma']
	},
	{
		id: 'voix-du-peuple',
		name: 'Voix du peuple',
		unit: 'votes au team mood',
		kind: 'CUMUL',
		thresholds: [5, 15, 40, 100, 250],
		tierNames: ['Sondé', 'Votant', 'Habitué', 'Porte-parole', 'Tribun']
	},
	{
		id: 'parole-tenue',
		name: 'Parole tenue',
		unit: 'semaines à 100 % d’objectifs',
		kind: 'CUMUL',
		thresholds: [1, 5, 15, 40, 100],
		tierNames: ['Promesse', 'Engagement', 'Parole d’honneur', 'Contrat', 'Serment']
	},
	{
		id: 'de-garde',
		name: 'De garde',
		unit: 'tours de support assurés',
		kind: 'CUMUL',
		thresholds: [1, 5, 15, 40, 100],
		tierNames: ['Piquet', 'Sentinelle', 'Vigie', 'Gardien', 'Veilleur de nuit']
	},
	{
		id: 'pompier',
		name: 'Pompier',
		unit: 'interventions de support',
		kind: 'CUMUL',
		thresholds: [5, 25, 100, 300, 750],
		tierNames: ['Extincteur', 'Lance à incendie', 'Caserne', 'Canadair', 'Colonel']
	},
	{
		id: 'prevoyant',
		name: 'Prévoyant',
		unit: 'absences posées plus de 3 semaines à l’avance',
		kind: 'CUMUL',
		thresholds: [1, 5, 15, 40, 100],
		tierNames: ['Anticipé', 'Planifié', 'Prévoyant', 'Stratège', 'Voyant']
	},
	{
		id: 'binome',
		name: 'Binôme',
		unit: 'tickets en commun avec la même personne',
		kind: 'RECORD',
		thresholds: [3, 10, 25, 60, 150],
		tierNames: ['Collègue', 'Équipier', 'Binôme', 'Tandem', 'Âme sœur']
	},
	{
		id: 'explorateur',
		name: 'Explorateur',
		unit: 'recoins de l’outil découverts',
		kind: 'CUMUL',
		thresholds: [1, 3, 5, 7, 9],
		tierNames: ['Curieux', 'Fouineur', 'Explorateur', 'Spéléologue', 'Indiana']
	},
	{
		id: 'comptable',
		name: 'Comptable',
		unit: 'clôtures mensuelles intégrées',
		kind: 'CUMUL',
		thresholds: [1, 3, 6, 12, 24],
		tierNames: ['Première clôture', 'Comptable', 'Trésorier', 'Commissaire', 'Grand argentier'],
		adminOnly: true
	}
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/**
 * Comment décrocher le badge, à l'impératif.
 *
 * Séparé du catalogue plutôt qu'ajouté à chaque entrée : c'est du texte d'interface, il bougera
 * bien plus souvent que les seuils, et le garder à part évite de rouvrir les treize définitions à
 * chaque reformulation. L'exhaustivité est vérifiée par le test du catalogue, pas par le typage —
 * TypeScript ne peut pas l'assurer sans figer les ids en union.
 */
export const BADGE_HOW: Record<string, string> = {
	assidu: 'Impute chaque jour ouvré, le jour même ou le lendemain — sans trou dans la série.',
	ponctuel: 'Saisis ta journée le jour même, plutôt qu’en rattrapage en fin de mois.',
	'rae-frais': 'Termine la semaine sans aucune ligne de RAE périmée.',
	chiffreur: 'Renseigne l’estimation des tickets qui n’en ont pas encore.',
	'dans-le-mille': 'Termine un ticket dont le consommé tombe à ±10 % de l’estimation.',
	'voix-du-peuple': 'Donne ton humeur à chaque Team mood.',
	'parole-tenue': 'Coche tous tes objectifs de la semaine, sans en laisser un seul.',
	'de-garde': 'Assure tes tours d’astreinte support.',
	pompier: 'Note le temps passé sur les demandes de support que tu traites.',
	prevoyant: 'Pose tes congés plus de trois semaines avant le départ.',
	binome: 'Travaille sur les mêmes tickets qu’un collègue.',
	explorateur: 'Fouille les recoins de l’app : tutoriel, palette de commandes, exports, notifications…',
	comptable: 'Intègre les clôtures mensuelles.'
};

/** Les neuf découvertes qui alimentent le badge « Explorateur » (un seul badge plutôt que neuf morts). */
export const DISCOVERIES = [
	'tour', // visite guidée terminée
	'konami', // code Konami
	'palette', // command palette utilisée
	'push', // notifications activées
	'export', // premier export
	'wrapped', // Wrapped ouvert
	'disco', // accent RGB/DISCO
	'invite', // invitation envoyée
	'ticket' // premier ticket créé
] as const;
export type Discovery = (typeof DISCOVERIES)[number];

/** Palier atteint pour une valeur : 0 = pas encore décroché, 5 = palier max. */
export function tierFor(value: number, thresholds: readonly number[]): number {
	let tier = 0;
	for (const t of thresholds) if (value >= t) tier += 1;
	return tier;
}

/** Ce qu'il reste à faire pour le palier suivant — null une fois le dernier palier atteint. */
export function nextStep(
	value: number,
	thresholds: readonly number[]
): { tier: number; target: number; remaining: number } | null {
	const tier = tierFor(value, thresholds);
	if (tier >= thresholds.length) return null;
	const target = thresholds[tier];
	return { tier: tier + 1, target, remaining: Math.max(0, target - value) };
}
