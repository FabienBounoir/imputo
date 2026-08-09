// Génération de positions/timings aléatoires pour les effets "particules qui tombent"
// (neige, cœurs...). Partagé pour éviter de dupliquer le calcul entre effets.

export type Particle = {
	left: number;
	delay: number;
	duration: number;
	size: number;
	drift: number;
	opacity: number;
};

export function randomParticles(count: number, sizeRange: [number, number] = [6, 16]): Particle[] {
	return Array.from({ length: count }, () => ({
		left: Math.random() * 100,
		delay: Math.random() * 10,
		duration: 8 + Math.random() * 10,
		size: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
		drift: Math.round((Math.random() - 0.5) * 60),
		opacity: 0.4 + Math.random() * 0.5
	}));
}
