/**
 * Dessin des compagnons — matrices de pixels et rendu canvas.
 *
 * Séparé de pets.ts comme badgeArt.ts l'est de badges.ts : les règles de déblocage et le texte
 * d'interface bougent souvent, ces matrices quasiment jamais.
 *
 * Trois partis pris repris du « chat pet » de VS Code, parce qu'ils évitent chacun une famille de
 * bugs :
 *
 *   • Les ANCRAGES sont lus dans le dessin, jamais déclarés à la main (cf. analyse). Les orbites
 *     sont les pixels « y » ; le bas du corps est le dernier pixel non vide. Une pose redessinée ne
 *     peut donc pas désynchroniser les pupilles ou l'ombre — il n'y a rien à tenir à jour.
 *   • Le CORPS change de pose, les yeux et les décorations sont des COUCHES composées au rendu.
 *     Écrire les cœurs une fois les rend disponibles pour les huit compagnons.
 *   • Tout est arrondi au pixel écran au moment de peindre (cf. snap). Sans ça, un décalage
 *     fractionnaire — flottement, saut — place les rectangles entre deux pixels et le canvas les
 *     antialiase : on voit des lignes claires qui traversent le corps.
 */

export type PetMeta = {
	/** Les deux orbites, lues dans le dessin — c'est là que se posent pupilles, paupières, lunettes. */
	sockets: { x0: number; x1: number; y0: number; y1: number }[];
	/** Dernière ligne non vide : sert à poser l'ombre au sol. */
	low: number;
	/** Première ligne non vide : sert à poser ce qui flotte au-dessus de la tête. */
	top: number;
};

export type PetFrame = { px: readonly string[]; ms: number; meta: PetMeta };
export type PetPoseKey = 'idle' | 'up' | 'down' | 'fall' | 'impact' | 'splat';
export type PetPalette = Record<string, string>;
export type PetArt = {
	pal: PetPalette;
	/** Flotte en continu (pas d'appuis au sol). */
	float: boolean;
	/** Se déplace par bonds plutôt qu'en glissant. */
	hop: boolean;
	poses: Record<PetPoseKey, PetFrame[]>;
};

/** Côté de la matrice de dessin. */
export const PET_GRID = 16;
/** Hauteur du canvas en cellules : 4 de rab au-dessus, sinon un saut coupe la tête. */
export const PET_ROWS = 20;
/** Décalage vertical du corps dans le canvas, qui laisse la place au saut. */
const BASE = 2;

const LID = '#1b1a17';
/** Palette « lisse » : deux tons de corps. */
const P = (s: string, S: string): PetPalette => ({ s, S, y: '#f7f9fc', o: '#e2571f', p: LID });
/** Palette « animal » : deux tons de corps, un ventre (w) et un museau (m). */
const A = (s: string, S: string, w: string, m: string): PetPalette => ({
	s,
	S,
	w,
	m,
	y: '#ffffff',
	o: s,
	p: LID
});

type RawPet = {
	pal: PetPalette;
	float?: boolean;
	hop?: boolean;
	idle: { ms: number; px: string[] }[];
	up: string[];
	down: string[];
	fall: string[];
	impact: string[];
	splat: string[];
};

/**
 * Les six poses de chaque compagnon.
 *   idle   — deux images : la longue au repos, la brève qui la ponctue (respiration, clignement
 *            d'oreille). Les durées font l'animation autant que les dessins.
 *   up     — élan : ce qu'il fait quand il célèbre.
 *   down   — abattu : sommeil, inquiétude, étourdissement.
 *   fall   — en vol : appendices tirés vers le haut.
 *   impact — contre un mur : comprimé DANS le sens du choc, donc horizontalement. Dessiné côté
 *            droit ; le moteur miroite pour le mur de gauche.
 *   splat  — écrasé : atterrissage brutal, ou coup de curseur reçu en plein vol.
 */
const RAW: Record<string, RawPet> = {
	minou: {
		pal: A('#3a3f4a', '#8b93a0', '#e8ecf2', '#d4736b'),
		hop: true,
		idle: [
			{
				ms: 2200,
				px: [
					'................', '..ss........ss..', '.sSSs......sSSs.', '.sSSSssssssSSSs.',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwmmwwSSSSs', '.sSSSwwwwwwSSSs.', '..sSSSSSSSSSSs..', '...ssSSSSSSss...',
					'.....ssssss.....', '....ss....ss....', '................', '................'
				]
			},
			{
				ms: 320,
				px: [
					'................', '................', '..ss........ss..', '.sSSssssssssSSs.',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwmmwwSSSSs', '.sSSSwwwwwwSSSs.', '..sSSSSSSSSSSs..', '...ssSSSSSSss...',
					'.....ssssss.....', '...ss......ss...', '................', '................'
				]
			}
		],
		up: [
			'................', '.ss..........ss.', '.sSs........sSs.', '.sSSssssssssSSs.',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwmmwwSSSSs', '.sSSSwwwwwwSSSs.', '..sSSSSSSSSSSs..', '...ssSSSSSSss...',
			'.....ssssss.....', '..ss........ss..', '................', '................'
		],
		down: [
			'................', '................', '.sss......sss...', '.sSSsssssssSSs..',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwmmwwSSSSs', '.sSSSwwwwwwSSSs.', '..sSSSSSSSSSSs..', '..sssSSSSSSsss..',
			'....ssssssss....', '.....ss..ss.....', '................', '................'
		],
		fall: [
			'..ss........ss..', '.sSSs......sSSs.', '.sSSSssssssSSSs.', 'sSSSSSSSSSSSSSSs',
			'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs', 'sSSSSwwmmwwSSSSs',
			'.sSSSwwwwwwSSSs.', '..sSSSSSSSSSSs..', '...ssSSSSSSss...', '....ssssssss....',
			'...ss......ss...', '..ss........ss..', '................', '................'
		],
		impact: [
			'................', '....ss......ss..', '...sSSs....sSSs.', '...sSSSssssSSSs.',
			'..sSSSSSSSSSSSSs', '..sSSyySSSSyySSs', '..sSSyySSSSyySSs', '..sSSSSwwwwSSSSs',
			'..sSSSwwmmwwSSSs', '...sSSSwwwwSSSs.', '...sSSSSSSSSSs..', '....ssSSSSSss...',
			'......ssssss....', '.....ss...ss....', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', '................', '..ss........ss..', 'sSSSSSSSSSSSSSSs',
			'sSyySSSSSSSSyySs', 'sSSSSwwmmwwSSSSs', 'sSSSSSSSSSSSSSSs', '.ssssssssssssss.',
			'................', '................', '................', '................'
		]
	},
	louki: {
		pal: A('#2f3947', '#6e7c8c', '#dfe6ee', '#1b1a17'),
		hop: true,
		idle: [
			{
				ms: 2400,
				px: [
					'................', '.ss........ss...', '.sSs......sSs...', '.sSSsssssssSSs..',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwwwwwSSSSs', '.sSSSwwmmwwSSSs.', '..sSSwwwwwwSSs..', '...ssSSSSSSss...',
					'.....ssssss.....', '....ss....ss....', '................', '................'
				]
			},
			{
				ms: 320,
				px: [
					'................', '................', '.ss........ss...', '.sSssssssssSSs..',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwwwwwSSSSs', '.sSSSwwmmwwSSSs.', '..sSSwwwwwwSSs..', '...ssSSSSSSss...',
					'.....ssssss.....', '...ss......ss...', '................', '................'
				]
			}
		],
		up: [
			'ss..........ss..', '.ss........ss...', '.sSs......sSs...', '.sSSsssssssSSs..',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwwwwwSSSSs', '.sSSSwwmmwwSSSs.', '..sSSwwwwwwSSs..', '...ssSSSSSSss...',
			'.....ssssss.....', '..ss........ss..', '................', '................'
		],
		down: [
			'................', '................', '..ss......ss....', '.sSSsssssssSSs..',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwwwwwSSSSs', '.sSSSwwmmwwSSSs.', '..sSSwwwwwwSSs..', '..sssSSSSSSsss..',
			'....ssssssss....', '.....ss..ss.....', '................', '................'
		],
		fall: [
			'.ss........ss...', '.sSs......sSs...', '.sSSsssssssSSs..', 'sSSSSSSSSSSSSSSs',
			'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs', 'sSSSSwwwwwwSSSSs',
			'.sSSSwwmmwwSSSs.', '..sSSwwwwwwSSs..', '...ssSSSSSSss...', '....ssssssss....',
			'...ss......ss...', '..ss........ss..', '................', '................'
		],
		impact: [
			'................', '...ss.......ss..', '...sSs.....sSs..', '...sSSssssssSSs.',
			'..sSSSSSSSSSSSSs', '..sSSyySSSSyySSs', '..sSSyySSSSyySSs', '..sSSSSwwwwSSSSs',
			'..sSSSwwwwwwSSSs', '...sSSwwmmwwSSs.', '...sSSSwwwwSSSs.', '....ssSSSSSss...',
			'......ssssss....', '.....ss...ss....', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', '................', '.ss........ss...', 'sSSSSSSSSSSSSSSs',
			'sSyySSSSSSSSyySs', 'sSSSwwmmwwwSSSSs', 'sSSSSSSSSSSSSSSs', '.ssssssssssssss.',
			'................', '................', '................', '................'
		]
	},
	nounours: {
		pal: A('#4a3325', '#a87a52', '#f0dcc4', '#2a1c12'),
		hop: true,
		idle: [
			{
				ms: 2500,
				px: [
					'................', '.sss......sss...', 'sSSSs....sSSSs..', 'sSSSSssssSSSSs..',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwmmwwSSSSs', 'sSSSSwwwwwwSSSSs', '.sSSSSSSSSSSSSs.', '..sssSSSSSSsss..',
					'.....ssssss.....', '....ss....ss....', '................', '................'
				]
			},
			{
				ms: 340,
				px: [
					'................', '................', '.sss......sss...', 'sSSSssssssSSSs..',
					'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
					'sSSSSwwmmwwSSSSs', 'sSSSSwwwwwwSSSSs', '.sSSSSSSSSSSSSs.', '..sssSSSSSSsss..',
					'.....ssssss.....', '...ss......ss...', '................', '................'
				]
			}
		],
		up: [
			'.sss......sss...', 'sSSSs....sSSSs..', 'sSSSSssssSSSSs..', 'sSSSSSSSSSSSSSSs',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwmmwwSSSSs', 'sSSSSwwwwwwSSSSs', '.sSSSSSSSSSSSSs.', '..sssSSSSSSsss..',
			'.....ssssss.....', '..ss........ss..', '................', '................'
		],
		down: [
			'................', '................', '.sss......sss...', 'sSSSssssssSSSs..',
			'sSSSSSSSSSSSSSSs', 'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs',
			'sSSSSwwmmwwSSSSs', 'sSSSSwwwwwwSSSSs', 'sSSSSSSSSSSSSSSs', '.sssSSSSSSSSsss.',
			'...ssssssssss...', '.....ss..ss.....', '................', '................'
		],
		fall: [
			'.sss......sss...', 'sSSSs....sSSSs..', 'sSSSSssssSSSSs..', 'sSSSSSSSSSSSSSSs',
			'sSSyySSSSSSyySSs', 'sSSyySSSSSSyySSs', 'sSSSSSwwwwSSSSSs', 'sSSSSwwmmwwSSSSs',
			'sSSSSwwwwwwSSSSs', '.sSSSSSSSSSSSSs.', '..sssSSSSSSsss..', '....ssssssss....',
			'...ss......ss...', '..ss........ss..', '................', '................'
		],
		impact: [
			'................', '...sss......sss.', '..sSSSs....sSSSs', '..sSSSSssssSSSSs',
			'..sSSSSSSSSSSSSs', '..sSSyySSSSyySSs', '..sSSyySSSSyySSs', '..sSSSSwwwwSSSSs',
			'..sSSSwwmmwwSSSs', '..sSSSwwwwwwSSSs', '...sSSSSSSSSSSs.', '....sssSSSSsss..',
			'......ssssss....', '.....ss...ss....', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', '.sss......sss...', 'sSSSsssssssSSSSs', 'sSSSSSSSSSSSSSSs',
			'sSyySSSSSSSSyySs', 'sSSSSwwmmwwSSSSs', 'sSSSSSSSSSSSSSSs', '.ssssssssssssss.',
			'................', '................', '................', '................'
		]
	},
	renard: {
		pal: A('#7a3a14', '#d4762e', '#f7ead6', '#2a1c12'),
		hop: true,
		idle: [
			{
				ms: 2300,
				px: [
					'................', 'ss..........ss..', 'sSs........sSs..', 'sSSs......sSSs..',
					'sSSSssssssSSSSs.', 'sSSyySSSSSSyySs.', 'sSSyySSSSSSyySs.', 'sSSSSwwwwwwSSSs.',
					'.sSSwwwmmwwwSSs.', '..sSwwwwwwwwSs..', '...sSSwwwwSSs...', '....ssSSSSss....',
					'.....ssssss.....', '....ss....ss....', '................', '................'
				]
			},
			{
				ms: 320,
				px: [
					'................', '................', 'ss..........ss..', 'sSs........sSs..',
					'sSSSssssssSSSSs.', 'sSSyySSSSSSyySs.', 'sSSyySSSSSSyySs.', 'sSSSSwwwwwwSSSs.',
					'.sSSwwwmmwwwSSs.', '..sSwwwwwwwwSs..', '...sSSwwwwSSs...', '....ssSSSSss....',
					'.....ssssss.....', '...ss......ss...', '................', '................'
				]
			}
		],
		up: [
			's............s..', 'ss..........ss..', 'sSs........sSs..', 'sSSs......sSSs..',
			'sSSSssssssSSSSs.', 'sSSyySSSSSSyySs.', 'sSSyySSSSSSyySs.', 'sSSSSwwwwwwSSSs.',
			'.sSSwwwmmwwwSSs.', '..sSwwwwwwwwSs..', '...sSSwwwwSSs...', '....ssSSSSss....',
			'.....ssssss.....', '..ss........ss..', '................', '................'
		],
		down: [
			'................', '................', '.ss........ss...', 'sSSs......sSSs..',
			'sSSSssssssSSSSs.', 'sSSyySSSSSSyySs.', 'sSSyySSSSSSyySs.', 'sSSSSwwwwwwSSSs.',
			'.sSSwwwmmwwwSSs.', '..sSwwwwwwwwSs..', '...sSSwwwwSSs...', '...sssSSSSsss...',
			'....ssssssss....', '.....ss..ss.....', '................', '................'
		],
		fall: [
			'ss..........ss..', 'sSs........sSs..', 'sSSs......sSSs..', 'sSSSssssssSSSSs.',
			'sSSyySSSSSSyySs.', 'sSSyySSSSSSyySs.', 'sSSSSwwwwwwSSSs.', '.sSSwwwmmwwwSSs.',
			'..sSwwwwwwwwSs..', '...sSSwwwwSSs...', '....ssSSSSss....', '....ssssssss....',
			'...ss......ss...', '..ss........ss..', '................', '................'
		],
		impact: [
			'................', '..ss........ss..', '..sSs......sSs..', '..sSSs....sSSs..',
			'..sSSSssssSSSSs.', '..sSSyySSSSyySs.', '..sSSyySSSSyySs.', '..sSSSwwwwwwSSs.',
			'...sSSwwwmmwwSs.', '....sSwwwwwwSs..', '....sSSwwwwSSs..', '.....ssSSSSss...',
			'......ssssss....', '.....ss...ss....', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', 'ss..........ss..', 'sSssssssssssSSs.', 'sSSSSSSSSSSSSSSs',
			'sSyySSSSSSSSyySs', 'sSSSwwwmmwwwSSSs', 'sSSSSSSSSSSSSSSs', '.ssssssssssssss.',
			'................', '................', '................', '................'
		]
	},
	meduse: {
		pal: P('#5a2340', '#b0567f'),
		float: true,
		idle: [
			{
				ms: 360,
				px: [
					'................', '................', '.....ssssss.....', '...ssSSSSSSss...',
					'..sSSSSSSSSSSs..', '..sSyySSSSyySs..', '..sSyySSSSyySs..', '..sSSSSSSSSSSs..',
					'...ssssssssss...', '...s.s.s..s.s...', '...s.s.s..s.s...', '....s.s....s....',
					'................', '................', '................', '................'
				]
			},
			{
				ms: 360,
				px: [
					'................', '................', '.....ssssss.....', '...ssSSSSSSss...',
					'..sSSSSSSSSSSs..', '..sSyySSSSyySs..', '..sSyySSSSyySs..', '..sSSSSSSSSSSs..',
					'...ssssssssss...', '...s.s.s..s.s...', '....s.s..s.s....', '.....s.....s....',
					'................', '................', '................', '................'
				]
			}
		],
		up: [
			'................', '.....ssssss.....', '...ssSSSSSSss...', '..sSSSSSSSSSSs..',
			'.sSSSSSSSSSSSSs.', '.sSyySSSSSSyySs.', '.sSyySSSSSSyySs.', '.sSSSSSSSSSSSSs.',
			'..ssssssssssss..', '....s.s..s.s....', '.....s....s.....', '................',
			'................', '................', '................', '................'
		],
		down: [
			'................', '................', '................', '....ssssssss....',
			'..sSSSSSSSSSSs..', '..sSyySSSSyySs..', '..sSyySSSSyySs..', '..sSSSSSSSSSSs..',
			'...ssssssssss...', '...s..s..s..s...', '...s..s..s..s...', '...s..s..s..s...',
			'................', '................', '................', '................'
		],
		fall: [
			'................', '.....ssssss.....', '...ssSSSSSSss...', '..sSSSSSSSSSSs..',
			'..sSyySSSSyySs..', '..sSyySSSSyySs..', '..sSSSSSSSSSSs..', '...ssssssssss...',
			'...s.s.s..s.s...', '...s.s.s..s.s...', '...s.s.s..s.s...', '....s.s....s....',
			'.....s.......s..', '................', '................', '................'
		],
		impact: [
			'................', '................', '......ssssss....', '....ssSSSSSSss..',
			'....sSSSSSSSSSs.', '....sSyySSyySSs.', '....sSyySSyySSs.', '....sSSSSSSSSSs.',
			'.....sssssssss..', '.....s.s.s.s.s..', '.....s.s.s.s.s..', '......s.s.s.s...',
			'................', '................', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', '................', '..ssssssssssss..', '.sSSSSSSSSSSSSs.',
			'.sSyySSSSSSyySs.', '.sSSSSSSSSSSSSs.', '..ssssssssssss..', '..s.s.s..s.s.s..',
			'................', '................', '................', '................'
		]
	},
	brin: {
		pal: P('#43307a', '#7b63c4'),
		idle: [
			{
				ms: 2300,
				px: [
					'................', '......ss........', '.....ss.........', '.....ssssss.....',
					'....sSSSSSSs....', '....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSs....',
					'....sSSSSSSs....', '....sSSSSSSs....', '....sSSSSSSs....', '.....ssssss.....',
					'.....oo..oo.....', '................', '................', '................'
				]
			},
			{
				ms: 300,
				px: [
					'................', '.......ss.......', '......ss........', '.....ssssss.....',
					'....sSSSSSSs....', '....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSs....',
					'....sSSSSSSs....', '....sSSSSSSs....', '....sSSSSSSs....', '.....ssssss.....',
					'....oo......oo..', '................', '................', '................'
				]
			}
		],
		up: [
			'........ss......', '.......ss.......', '......ss........', '.....ssssss.....',
			'....sSSSSSSs....', '....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSs....',
			'....sSSSSSSs....', '....sSSSSSSs....', '....sSSSSSSs....', '.....ssssss.....',
			'....oo......oo..', '................', '................', '................'
		],
		down: [
			'................', '................', '....ss..........', '.....ssssss.....',
			'....sSSSSSSs....', '....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSs....',
			'....sSSSSSSs....', '....sSSSSSSs....', '...ssSSSSSSss...', '...ssssssssss...',
			'.....oo..oo.....', '................', '................', '................'
		],
		fall: [
			'.......ss.......', '.......ss.......', '.....ssssss.....', '....sSSSSSSs....',
			'....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSs....', '....sSSSSSSs....',
			'....sSSSSSSs....', '....sSSSSSSs....', '.....ssssss.....', '.....oo..oo.....',
			'....oo......oo..', '................', '................', '................'
		],
		impact: [
			'................', '..........ss....', '.........ss.....', '......ssssss....',
			'.....sSSSSSSs...', '.....sSyySyySs..', '.....sSyySyySs..', '.....sSSSSSSs...',
			'.....sSSSSSSs...', '.....sSSSSSSs...', '......ssssss....', '......oo..oo....',
			'................', '................', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'................', '................', '...ss...........', '.ssssssssssss...',
			'.sSyySSSSyySSs..', '.sSSSSSSSSSSSs..', '.ssssssssssss...', '...oo......oo...',
			'................', '................', '................', '................'
		]
	},
	champi: {
		pal: P('#6b2434', '#c05a6a'),
		idle: [
			{
				ms: 2400,
				px: [
					'................', '....ssssssss....', '..ssSSSSSSSSss..', '.sSSSSSSSSSSSSs.',
					'.sSSSSSSSSSSSSs.', '..ssssssssssss..', '....sSyySyySs...', '....sSyySyySs...',
					'....sSSSSSSSs...', '....sSSSSSSSs...', '.....ssssss.....', '.....oo..oo.....',
					'................', '................', '................', '................'
				]
			},
			{
				ms: 310,
				px: [
					'................', '................', '....ssssssss....', '..ssSSSSSSSSss..',
					'.sSSSSSSSSSSSSs.', '..ssssssssssss..', '....sSyySyySs...', '....sSyySyySs...',
					'....sSSSSSSSs...', '....sSSSSSSSs...', '.....ssssss.....', '....oo....oo....',
					'................', '................', '................', '................'
				]
			}
		],
		up: [
			'...ssssssssss...', '..ssSSSSSSSSss..', '.sSSSSSSSSSSSSs.', '.sSSSSSSSSSSSSs.',
			'.sSSSSSSSSSSSSs.', '..ssssssssssss..', '....sSyySyySs...', '....sSyySyySs...',
			'....sSSSSSSSs...', '....sSSSSSSSs...', '.....ssssss.....', '....oo....oo....',
			'................', '................', '................', '................'
		],
		down: [
			'................', '................', '.....ssssss.....', '...ssSSSSSSss...',
			'..sSSSSSSSSSSs..', '..ssssssssssss..', '....sSyySyySs...', '....sSyySyySs...',
			'....sSSSSSSSs...', '...ssSSSSSSSss..', '....ssssssss....', '.....oo..oo.....',
			'................', '................', '................', '................'
		],
		fall: [
			'....ssssssss....', '..ssSSSSSSSSss..', '.sSSSSSSSSSSSSs.', '.sSSSSSSSSSSSSs.',
			'..ssssssssssss..', '....sSyySyySs...', '....sSyySyySs...', '....sSSSSSSSs...',
			'....sSSSSSSSs...', '.....ssssss.....', '.....oo..oo.....', '....oo......oo..',
			'...oo........oo.', '................', '................', '................'
		],
		impact: [
			'................', '......ssssssss..', '....ssSSSSSSSSss', '...sSSSSSSSSSSSS',
			'...sSSSSSSSSSSSS', '....ssssssssssss', '......sSyySyySs.', '......sSyySyySs.',
			'......sSSSSSSSs.', '......sSSSSSSSs.', '.......ssssss...', '.......oo..oo...',
			'................', '................', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'..ssssssssssss..', '.sSSSSSSSSSSSSs.', '.ssssssssssssss.', '...sSyySyySs....',
			'...sSyySyySs....', '...sSSSSSSSs....', '....ssssssss....', '....oo....oo....',
			'................', '................', '................', '................'
		]
	},
	pico: {
		pal: P('#33383f', '#79838f'),
		idle: [
			{
				ms: 2400,
				px: [
					'................', '.......s........', '.......s........', '...ssssssssss...',
					'...sSSSSSSSSSs..', '...sSyySSyySSs..', '...sSyySSyySSs..', '...sSSSSSSSSSs..',
					'...sSSSSSSSSSs..', '...ssssssssss...', '....s......s....', '...ooo....ooo...',
					'................', '................', '................', '................'
				]
			},
			{
				ms: 300,
				px: [
					'................', '.......s........', '......ss........', '...ssssssssss...',
					'...sSSSSSSSSSs..', '...sSyySSyySSs..', '...sSyySSyySSs..', '...sSSSSSSSSSs..',
					'...sSSSSSSSSSs..', '...ssssssssss...', '....s......s....', '..ooo......ooo..',
					'................', '................', '................', '................'
				]
			}
		],
		up: [
			'.......s........', '......sss.......', '.......s........', '...ssssssssss...',
			'...sSSSSSSSSSs..', '...sSyySSyySSs..', '...sSyySSyySSs..', '...sSSSSSSSSSs..',
			'...sSSSSSSSSSs..', '...ssssssssss...', '....s......s....', '..ooo......ooo..',
			'................', '................', '................', '................'
		],
		down: [
			'................', '................', '.....s..........', '...ssssssssss...',
			'...sSSSSSSSSSs..', '...sSyySSyySSs..', '...sSyySSyySSs..', '...sSSSSSSSSSs..',
			'...sSSSSSSSSSs..', '..ssssssssssss..', '...s........s...', '...ooo....ooo...',
			'................', '................', '................', '................'
		],
		fall: [
			'.......s........', '.......s........', '...ssssssssss...', '...sSSSSSSSSSs..',
			'...sSyySSyySSs..', '...sSyySSyySSs..', '...sSSSSSSSSSs..', '...sSSSSSSSSSs..',
			'...ssssssssss...', '....s......s....', '...ooo....ooo...', '..oo........oo..',
			'.oo..........oo.', '................', '................', '................'
		],
		impact: [
			'................', '..........s.....', '..........s.....', '....ssssssssss..',
			'....sSSSSSSSSSs.', '....sSyySSyySSs.', '....sSyySSyySSs.', '....sSSSSSSSSSs.',
			'....sSSSSSSSSSs.', '....ssssssssss..', '.....s......s...', '....ooo....ooo..',
			'................', '................', '................', '................'
		],
		splat: [
			'................', '................', '................', '................',
			'.....s..........', '..ssssssssssss..', '..sSSSSSSSSSSs..', '..sSyySSyySSSs..',
			'..sSyySSyySSSs..', '..sSSSSSSSSSSs..', '..ssssssssssss..', '..ooo......ooo..',
			'................', '................', '................', '................'
		]
	}
};

/**
 * Orbites et extrémités du corps, lues dans le dessin.
 *
 * Les colonnes contenant un « y » sont triées, puis coupées au premier trou : ce qui précède est
 * l'orbite gauche, ce qui suit l'orbite droite. C'est pour ça que deux pixels d'œil ne doivent
 * jamais se toucher d'une orbite à l'autre — sinon les deux pupilles se posent au même endroit.
 */
export function analyse(px: readonly string[]): PetMeta {
	const eyes: [number, number][] = [];
	for (let y = 0; y < px.length; y++) {
		for (let x = 0; x < px[y].length; x++) if (px[y][x] === 'y') eyes.push([x, y]);
	}
	const cols = [...new Set(eyes.map((e) => e[0]))].sort((a, b) => a - b);
	let cut = cols.length;
	for (let i = 1; i < cols.length; i++)
		if (cols[i] - cols[i - 1] > 1) {
			cut = i;
			break;
		}
	const box = (set: number[]) => {
		const pts = eyes.filter((e) => set.includes(e[0]));
		if (!pts.length) return null;
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
	};
	let low = 0;
	let top = px.length - 1;
	for (let y = 0; y < px.length; y++) {
		if (px[y].replace(/\./g, '').length) {
			low = y;
			if (y < top) top = y;
		}
	}
	return {
		sockets: [box(cols.slice(0, cut)), box(cols.slice(cut))].filter((b) => b !== null),
		low,
		top
	};
}

const still = (px: string[]): PetFrame[] => [{ px, ms: 9999, meta: analyse(px) }];

export const PET_ART: Record<string, PetArt> = Object.fromEntries(
	Object.entries(RAW).map(([id, r]) => [
		id,
		{
			pal: r.pal,
			float: Boolean(r.float),
			hop: Boolean(r.hop),
			poses: {
				idle: r.idle.map((f) => ({ px: f.px, ms: f.ms, meta: analyse(f.px) })),
				up: still(r.up),
				down: still(r.down),
				fall: still(r.fall),
				impact: still(r.impact),
				splat: still(r.splat)
			}
		}
	])
);

/** Image courante d'une pose, au temps écoulé — les durées sont dans les images elles-mêmes. */
export function frameAt(frames: readonly PetFrame[], elapsed: number): number {
	const total = frames.reduce((sum, f) => sum + f.ms, 0);
	let t = elapsed % total;
	for (let i = 0; i < frames.length; i++) {
		if (t < frames[i].ms) return i;
		t -= frames[i].ms;
	}
	return frames.length - 1;
}

export type DecoKind = 'sparks' | 'hearts' | 'note' | 'dots' | 'sweat' | 'zzz' | 'stars';
export type EyeMode = 'gaze' | 'shut' | 'shades' | 'cross';

function drawDeco(
	ctx: CanvasRenderingContext2D,
	kind: DecoKind,
	meta: PetMeta,
	scale: number,
	offY: number,
	t: number
) {
	const snap = (v: number) => Math.round(v * scale);
	const top = meta.top + offY;
	if (kind === 'sparks') {
		const p = (t % 1200) / 1200;
		ctx.fillStyle = '#ffd34d';
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2;
			const d = p * 7;
			ctx.globalAlpha = 1 - p;
			ctx.fillRect(snap(8 + Math.cos(a) * d), snap(top + 5 + Math.sin(a) * d), scale, scale);
		}
		ctx.globalAlpha = 1;
	} else if (kind === 'hearts') {
		ctx.fillStyle = '#e2497a';
		for (let i = 0; i < 3; i++) {
			const p = (t / 1400 + i / 3) % 1;
			const hx = 3 + i * 5;
			const hy = top - 1 - p * 4;
			ctx.globalAlpha = 1 - p;
			ctx.fillRect(snap(hx), snap(hy), scale, scale);
			ctx.fillRect(snap(hx + 1), snap(hy), scale, scale);
			ctx.fillRect(snap(hx + 0.5), snap(hy + 1), scale, scale);
		}
		ctx.globalAlpha = 1;
	} else if (kind === 'note') {
		const p = (t % 1600) / 1600;
		ctx.globalAlpha = 1 - p;
		ctx.fillStyle = '#3d4f86';
		const nx = 12;
		const ny = top + 1 - p * 5;
		ctx.fillRect(snap(nx), snap(ny + 1), scale * 2, scale);
		ctx.fillRect(snap(nx + 1.5), snap(ny - 1), scale, scale * 2);
		ctx.globalAlpha = 1;
	} else if (kind === 'dots') {
		ctx.fillStyle = '#8e96b8';
		const n = Math.floor((t % 1500) / 500) + 1;
		for (let i = 0; i < n; i++) ctx.fillRect(snap(11 + i * 1.6), snap(top), scale, scale);
	} else if (kind === 'sweat') {
		ctx.fillStyle = '#6fb6e8';
		ctx.fillRect(snap(13), snap(top + 2 + ((t / 280) % 4)), scale, Math.round(scale * 1.4));
	} else if (kind === 'zzz') {
		const phase = (t % 2600) / 2600;
		for (let i = 0; i < 3; i++) {
			const p = (phase + i / 3) % 1;
			ctx.globalAlpha = Math.max(0, 1 - p) * 0.8;
			ctx.fillStyle = '#8e96b8';
			const s = scale * (0.6 + p * 1.1);
			ctx.fillRect(snap(12 + p * 2.5), snap(top + 1 - p * 3), s, s);
		}
		ctx.globalAlpha = 1;
	} else if (kind === 'stars') {
		ctx.fillStyle = '#ffd34d';
		for (let i = 0; i < 3; i++) {
			const a = t / 260 + (i / 3) * Math.PI * 2;
			ctx.fillRect(snap(8 + Math.cos(a) * 5), snap(top + 1 + Math.sin(a) * 1.6), scale, scale);
		}
	}
}

/** Yeux : pupilles qui suivent, paupières closes, lunettes ou croix — posés sur les orbites lues. */
function drawEyes(
	ctx: CanvasRenderingContext2D,
	pal: PetPalette,
	meta: PetMeta,
	scale: number,
	offY: number,
	gx: number,
	gy: number,
	mode: EyeMode
) {
	const snap = (v: number) => Math.round(v * scale);
	for (const s of meta.sockets) {
		const w = s.x1 - s.x0 + 1;
		if (mode === 'shut') {
			ctx.fillStyle = pal.p;
			ctx.fillRect(snap(s.x0), snap(s.y1 + offY), snap(w), Math.max(1, Math.round(scale * 0.8)));
		} else if (mode === 'shades') {
			ctx.fillStyle = '#1b1a17';
			ctx.fillRect(snap(s.x0 - 0.5), snap(s.y0 + offY), snap(w + 1), snap(s.y1 - s.y0 + 1));
		} else if (mode === 'cross') {
			ctx.fillStyle = pal.p;
			ctx.fillRect(snap(s.x0), snap(s.y0 + offY), scale, scale);
			ctx.fillRect(snap(s.x1), snap(s.y1 + offY), scale, scale);
			ctx.fillRect(snap(s.x1), snap(s.y0 + offY), scale, scale);
			ctx.fillRect(snap(s.x0), snap(s.y1 + offY), scale, scale);
		} else {
			ctx.fillStyle = pal.p;
			const x = gx > 0.3 ? s.x1 : gx < -0.3 ? s.x0 : Math.round((s.x0 + s.x1) / 2);
			const y = gy > 0.3 ? s.y1 : s.y0;
			ctx.fillRect(snap(x), snap(y + offY), scale, scale);
		}
	}
	// Branche des lunettes : sans elle on lit deux rectangles noirs, pas une paire.
	if (mode === 'shades' && meta.sockets.length === 2) {
		const a = meta.sockets[0];
		const b = meta.sockets[1];
		ctx.fillStyle = '#1b1a17';
		ctx.fillRect(
			snap(a.x1 + 1),
			snap(a.y0 + offY),
			snap(b.x0 - a.x1 - 1),
			Math.max(1, Math.round(scale * 0.6))
		);
	}
}

export type DrawOpts = {
	scale: number;
	flip?: boolean;
	gazeX?: number;
	gazeY?: number;
	eyeMode?: EyeMode;
	deco?: DecoKind | null;
	/** Hauteur de flottement/saut, en cellules. `null` = en vol : pas d'ombre au sol. */
	lift?: number | null;
	/** Horloge de l'animation, en ms. */
	t?: number;
};

/** Peint une image du compagnon. Tout est arrondi au pixel écran : cf. l'en-tête du fichier. */
export function drawPet(
	ctx: CanvasRenderingContext2D,
	art: PetArt,
	frame: PetFrame,
	opts: DrawOpts
) {
	const { scale, flip = false, gazeX = 0, gazeY = 0, eyeMode = 'gaze', deco = null, lift = 0, t = 0 } = opts;
	const meta = frame.meta;
	const snap = (v: number) => Math.round(v * scale);
	const offY = BASE - Math.max(0, lift ?? 0);

	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.save();
	if (flip) {
		ctx.translate(ctx.canvas.width, 0);
		ctx.scale(-1, 1);
	}

	// Ombre : seulement pour ce qui ne touche pas le sol en permanence, et jamais en vol.
	if ((art.float || art.hop) && lift !== null) {
		const w = Math.max(3, 8 - Math.max(0, lift) * 1.6);
		ctx.fillStyle = 'rgba(20,26,38,0.16)';
		ctx.fillRect(snap(8 - w / 2), snap(meta.low + 4.4), snap(w), Math.max(1, Math.round(scale * 0.7)));
	}

	for (let y = 0; y < frame.px.length; y++) {
		for (let x = 0; x < frame.px[y].length; x++) {
			const ch = frame.px[y][x];
			if (ch === '.') continue;
			ctx.fillStyle = art.pal[ch];
			ctx.fillRect(snap(x), snap(y + offY), scale, scale);
		}
	}

	drawEyes(ctx, art.pal, meta, scale, offY, gazeX, gazeY, eyeMode);
	if (deco) drawDeco(ctx, deco, meta, scale, offY, t);
	ctx.restore();
}
