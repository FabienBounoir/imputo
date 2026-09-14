/**
 * Catalogue des compagnons — partagé client/serveur.
 *
 * Un compagnon ne compte RIEN de nouveau : c'est une récompense cosmétique posée sur un palier de
 * badge qui existe déjà (cf. badges.ts). Pas de table, pas de compteur, pas de trigger — juste une
 * condition lue au moment du choix.
 *
 * Les conditions vivent ici et pas en base, pour la même raison que les seuils de badges : les
 * retoucher ne demande aucune migration. Le dessin, lui, est dans petArt.ts.
 *
 * Aucun compagnon n'est adossé à un badge réservé aux admins : un membre standard doit pouvoir
 * décrocher les huit.
 */
import { BADGE_BY_ID } from './badges';

export type PetDef = {
	id: string;
	name: string;
	/** Espèce, en un mot : c'est ce qui distingue deux compagnons dans la grille. */
	species: string;
	/** Son comportement à l'écran, une phrase — affichée même quand il est encore verrouillé. */
	trait: string;
	/** Le palier qui l'ouvre. Palier 1 pour le premier, 2 pour les autres : un compagnon doit se mériter. */
	unlock: { badgeId: string; tier: number };
};

export const PETS: PetDef[] = [
	{
		id: 'minou',
		name: 'Minou',
		species: 'Chaton',
		trait: 'Avance par petits bonds et s’endort dès qu’on l’oublie.',
		unlock: { badgeId: 'assidu', tier: 1 }
	},
	{
		id: 'louki',
		name: 'Louki',
		species: 'Louveteau',
		trait: 'Suit le curseur du regard, oreilles dressées.',
		unlock: { badgeId: 'ponctuel', tier: 2 }
	},
	{
		id: 'renard',
		name: 'Renard',
		species: 'Renardeau',
		trait: 'Grande queue, réveil facile, retombe toujours sur ses pattes.',
		unlock: { badgeId: 'dans-le-mille', tier: 2 }
	},
	{
		id: 'nounours',
		name: 'Nounours',
		species: 'Ourson',
		trait: 'Massif et pataud : il encaisse les murs sans broncher.',
		unlock: { badgeId: 'binome', tier: 2 }
	},
	{
		id: 'meduse',
		name: 'Méduse',
		species: 'Flottante',
		trait: 'Ne touche jamais le sol, ses filaments ondulent en continu.',
		unlock: { badgeId: 'rae-frais', tier: 2 }
	},
	{
		id: 'brin',
		name: 'Brin',
		species: 'Pousse',
		trait: 'Une tige, deux appuis, et une feuille qui bat la mesure.',
		unlock: { badgeId: 'parole-tenue', tier: 2 }
	},
	{
		id: 'champi',
		name: 'Champi',
		species: 'Champignon',
		trait: 'Chapeau large qui amortit tout ce qui lui tombe dessus.',
		unlock: { badgeId: 'explorateur', tier: 2 }
	},
	{
		id: 'pico',
		name: 'Pico',
		species: 'Automate',
		trait: 'Antenne frémissante, démarche mécanique, jamais fatigué.',
		unlock: { badgeId: 'pompier', tier: 2 }
	}
];

export const PET_BY_ID = new Map(PETS.map((p) => [p.id, p]));

/** Ce qu'il faut décrocher, en clair — affiché sur la carte verrouillée. */
export function petRequirement(pet: PetDef): string {
	const badge = BADGE_BY_ID.get(pet.unlock.badgeId);
	if (!badge) return '';
	return `${badge.name} — palier ${pet.unlock.tier} « ${badge.tierNames[pet.unlock.tier - 1]} »`;
}

/**
 * Le compagnon ouvert par CE palier précis, s'il y en a un.
 *
 * C'est ce qui relie les deux moitiés : le badge est le chemin, le compagnon est le prix. Comme la
 * correspondance se déduit du catalogue partagé, l'animation de déblocage et la fiche la retrouvent
 * seules — rien à faire transiter depuis le serveur.
 */
export function petForTier(badgeId: string, tier: number): PetDef | null {
	return PETS.find((p) => p.unlock.badgeId === badgeId && p.unlock.tier === tier) ?? null;
}

/** Le compagnon adossé à ce badge, quel que soit le palier. Au plus un (cf. le test du catalogue). */
export function petForBadge(badgeId: string): PetDef | null {
	return PETS.find((p) => p.unlock.badgeId === badgeId) ?? null;
}

/** Ouvert ou non, au vu des paliers déjà atteints. */
export function isPetUnlocked(pet: PetDef, tiers: ReadonlyMap<string, number>): boolean {
	return (tiers.get(pet.unlock.badgeId) ?? 0) >= pet.unlock.tier;
}
