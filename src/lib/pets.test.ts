import { describe, it, expect } from 'vitest';
import { PETS, PET_BY_ID, isPetUnlocked, petRequirement, petForTier, petForBadge } from './pets';
import { BADGE_BY_ID } from './badges';
import { PET_ART, analyse, frameAt } from './petArt';

describe('catalogue des compagnons', () => {
	it('a des identifiants uniques', () => {
		expect(new Set(PETS.map((p) => p.id)).size).toBe(PETS.length);
	});

	it('adosse chaque compagnon à un badge existant, à un palier atteignable', () => {
		for (const pet of PETS) {
			const badge = BADGE_BY_ID.get(pet.unlock.badgeId);
			expect(badge, `badge inconnu pour ${pet.id}`).toBeDefined();
			expect(pet.unlock.tier).toBeGreaterThanOrEqual(1);
			expect(pet.unlock.tier).toBeLessThanOrEqual(badge!.thresholds.length);
		}
	});

	// Un compagnon adossé à un badge admin serait hors de portée d'un membre standard : il
	// resterait verrouillé à vie sans que rien ne l'explique.
	it("n'adosse aucun compagnon à un badge réservé aux admins", () => {
		for (const pet of PETS) {
			expect(BADGE_BY_ID.get(pet.unlock.badgeId)?.adminOnly, pet.id).toBeFalsy();
		}
	});

	it('décrit la condition avec le nom du palier', () => {
		const minou = PET_BY_ID.get('minou')!;
		expect(petRequirement(minou)).toContain('Assidu');
		expect(petRequirement(minou)).toContain('Présent');
	});

	// petForBadge ne renvoie qu'un compagnon : deux compagnons sur le même badge rendraient
	// ambigus le texte de la carte de badge et le marqueur de la fiche.
	it("n'adosse jamais deux compagnons au même badge", () => {
		const badges = PETS.map((p) => p.unlock.badgeId);
		expect(new Set(badges).size).toBe(badges.length);
	});

	it('retrouve le compagnon ouvert par un palier précis, et seulement celui-là', () => {
		expect(petForTier('assidu', 1)?.id).toBe('minou');
		expect(petForTier('assidu', 2)).toBeNull(); // un autre palier du même badge ne donne rien
		expect(petForTier('ponctuel', 2)?.id).toBe('louki');
		expect(petForTier('comptable', 1)).toBeNull(); // badge admin : aucun compagnon
		expect(petForBadge('assidu')?.id).toBe('minou');
		expect(petForBadge('comptable')).toBeNull();
	});

	it('ouvre au palier requis, pas avant', () => {
		const louki = PET_BY_ID.get('louki')!; // ponctuel, palier 2
		expect(isPetUnlocked(louki, new Map([['ponctuel', 1]]))).toBe(false);
		expect(isPetUnlocked(louki, new Map([['ponctuel', 2]]))).toBe(true);
		expect(isPetUnlocked(louki, new Map([['ponctuel', 5]]))).toBe(true);
		expect(isPetUnlocked(louki, new Map())).toBe(false);
	});
});

describe('dessin des compagnons', () => {
	it('fournit les six poses de chaque compagnon', () => {
		for (const pet of PETS) {
			const art = PET_ART[pet.id];
			expect(art, `dessin manquant pour ${pet.id}`).toBeDefined();
			for (const pose of ['idle', 'up', 'down', 'fall', 'impact', 'splat'] as const) {
				expect(art.poses[pose].length, `${pet.id}.${pose}`).toBeGreaterThan(0);
			}
		}
	});

	// Ces trois invariants sont ce qui permet de composer les couches sans rien déclarer à la main :
	// une matrice au mauvais gabarit décale tout, une couleur absente de la palette peint du
	// « undefined », et une orbite unique colle les deux pupilles au même endroit.
	it('tient le gabarit, la palette et les deux orbites sur toutes les images', () => {
		for (const pet of PETS) {
			const art = PET_ART[pet.id];
			for (const [name, frames] of Object.entries(art.poses)) {
				for (const [i, f] of frames.entries()) {
					const tag = `${pet.id}.${name}[${i}]`;
					expect(f.px.length, tag).toBe(16);
					for (const row of f.px) {
						expect(row.length, tag).toBe(16);
						for (const ch of row) if (ch !== '.') expect(art.pal[ch], `${tag} « ${ch} »`).toBeDefined();
					}
					expect(f.meta.sockets.length, tag).toBe(2);
					expect(f.meta.sockets[0].x1, tag).toBeLessThan(f.meta.sockets[1].x0);
				}
			}
		}
	});

	it('lit les orbites dans le dessin', () => {
		const meta = analyse([
			'................', '..yy......yy....', '..yy......yy....', '....ssssss......',
			'................', '................', '................', '................',
			'................', '................', '................', '................',
			'................', '................', '................', '................'
		]);
		expect(meta.sockets).toEqual([
			{ x0: 2, x1: 3, y0: 1, y1: 2 },
			{ x0: 10, x1: 11, y0: 1, y1: 2 }
		]);
		expect(meta.top).toBe(1);
		expect(meta.low).toBe(3);
	});

	it('choisit l’image selon les durées, pas un pas fixe', () => {
		const frames = PET_ART.minou.poses.idle;
		expect(frameAt(frames, 0)).toBe(0);
		expect(frameAt(frames, frames[0].ms + 10)).toBe(1);
		// Boucle : au-delà du cycle complet, on revient à la première.
		expect(frameAt(frames, frames[0].ms + frames[1].ms + 10)).toBe(0);
	});
});
