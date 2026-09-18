<script lang="ts">
	// Feuilles d'automne : une bourrasque de 3-4 feuilles toutes les ~30 s (un peu aléatoire),
	// réparties sur la largeur de l'écran. Chacune descend en tournoyant de gauche à droite, reste
	// au sol (animation-fill-mode: forwards) une grosse minute, puis se fane et disparaît — ou part
	// avant si la souris passe dessus.
	// Dessin à plat : aplat de couleur, pas de contour ni de dégradé.

	const COLORS = ['#E07A2F', '#C1502E', '#D9A441', '#8C9A47', '#A8431F', '#E0A33E'];

	// Éclaircir / assombrir une couleur de la palette (revers d'une feuille roulée, graine
	// d'une samare) : évite de gérer une seconde palette en parallèle.
	function mix(a: string, b: string, t: number) {
		const p = (i: number) => {
			const x = parseInt(a.slice(i, i + 2), 16);
			const y = parseInt(b.slice(i, i + 2), 16);
			return Math.round(x + (y - x) * t)
				.toString(16)
				.padStart(2, '0');
		};
		return `#${p(1)}${p(3)}${p(5)}`;
	}

	// Contour lobé échantillonné depuis une fonction polaire : c'est le seul moyen d'avoir des
	// lobes réguliers qui se referment proprement, et les lobes restent réglables au chiffre près.
	function lobedPath(n: number, base: number, amp: number, sharp: number, R: number, cy: number, ry: number) {
		let d = '';
		for (let i = 0; i < 140; i++) {
			const t = -Math.PI / 2 + (i / 140) * Math.PI * 2;
			const r = (base + amp * ((1 + Math.cos(n * (t + Math.PI / 2))) / 2) ** sharp) * R;
			d += (i ? 'L' : 'M') + (12 + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t) * ry).toFixed(2);
		}
		return d + 'Z';
	}

	type Part = { d: string; rot?: number; shade?: number; tint?: number };
	const TREFOIL = 'M12 17.5C9.8 15.2 9.4 11.4 11 9.4c.6-.8 1.4-.8 2 0 1.6 2 1.2 5.8-1 8.1z';

	const SHAPES: { parts: Part[]; vein?: string }[] = [
		// érable : cinq lobes arrondis + tige
		{ parts: [{ d: lobedPath(5, 0.44, 0.56, 0.5, 10.8, 11.2, 1.05) }], vein: 'M12 14v8' },
		// trèfle : trois folioles écartées sur une tige
		{
			parts: [{ d: TREFOIL, rot: -70 }, { d: TREFOIL }, { d: TREFOIL, rot: 70 }],
			vein: 'M12 17v5.5'
		},
		// roulée : vue de trois quarts, le bord retourné montre le revers plus clair.
		// La tige part du bas de la feuille (7.8/19.4), là où les deux faces se rejoignent.
		{
			parts: [
				{ d: 'M12.6 2.8c5.4 3.6 6.6 10 3 14.6-1.9 2.4-5.2 3.2-7.8 2 3.4-1.4 5.2-4.2 5.4-7.8.2-3.3-.1-6.2-.6-8.8z' },
				{ d: 'M7.8 19.4c-2.1-1.2-2.7-3.8-1.5-5.9 1.5-2.6 4.4-4.2 7.4-4.1-.2 4.3-2.2 8-5.9 10z', tint: 0.45 }
			],
			vein: 'M8.2 19c-.8 1.2-1.5 2.2-2 3.4'
		}
	];

	const MAX = 20;
	const FADE = 2.5; // durée du fondu, en secondes
	type Leaf = ReturnType<typeof makeLeaf>;
	let nextId = 0;

	// `i` sur `n` : une feuille par tranche de largeur, pour que la bourrasque soit dispatchée
	// sur tout l'écran au lieu de tomber en paquet au même endroit.
	function makeLeaf(i: number, n: number) {
		const dir = Math.random() < 0.5 ? 1 : -1;
		return {
			id: nextId++,
			delay: Math.random() * 2.5, // les feuilles d'une même bourrasque ne partent pas ensemble
			shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
			color: COLORS[Math.floor(Math.random() * COLORS.length)],
			left: ((i + 0.15 + Math.random() * 0.7) * 100) / n,
			size: 22 + Math.random() * 16,
			sway: dir * (30 + Math.random() * 60), // amplitude du balancement gauche/droite
			spin: dir * (180 + Math.random() * 540), // tours pendant la chute
			rest: 60 + Math.random() * 60, // à plat au sol, pas debout
			// De combien le bas de la feuille dépasse le bas de l'écran : négatif = elle s'arrête
			// juste au-dessus, positif = elle mord dedans (le calque est en overflow: hidden).
			// Signe géré ici plutôt que dans le calc(), qui n'aime pas « - -8px ».
			end: (() => {
				const sink = -2 + Math.random() * 20;
				return `calc(100vh ${sink < 0 ? '-' : '+'} ${Math.abs(sink).toFixed(1)}px)`;
			})(),
			duration: 11 + Math.random() * 8,
			linger: 45 + Math.random() * 45 // temps passé au sol avant de se faner
		};
	}

	const veinColor = (color: string) => mix(color, '#241A12', 0.35);

	function fill(part: Part, color: string) {
		if (part.tint) return mix(color, '#FFF8EC', part.tint);
		if (part.shade) return mix(color, '#241A12', part.shade);
		return color;
	}

	let leaves = $state<Leaf[]>([]);

	$effect(() => {
		// setTimeout ré-armé plutôt qu'un setInterval : le délai change à chaque feuille.
		let t = setTimeout(function drop() {
			const n = 3 + Math.floor(Math.random() * 2);
			for (let i = 0; i < n && leaves.length < MAX; i++) {
				const l = makeLeaf(i, n);
				leaves.push(l);
				// Chaque feuille se ramasse toute seule : le tas ne s'accumule pas sur la journée.
				setTimeout(() => sweep(l.id), (l.delay + l.duration + l.linger + FADE) * 1000);
			}
			t = setTimeout(drop, 20000 + Math.random() * 25000);
		}, 2000 + Math.random() * 6000);
		return () => clearTimeout(t);
	});

	function sweep(id: number) {
		leaves = leaves.filter((l) => l.id !== id);
	}
</script>

<div class="leaves" aria-hidden="true">
	{#each leaves as l (l.id)}
		<svg
			class="leaf"
			viewBox="0 0 24 24"
			width={l.size}
			height={l.size}
			onpointerenter={() => sweep(l.id)}
			style="
				left:{l.left}%; top:{-l.size}px;
				animation-duration:{l.duration}s, {FADE}s;
				animation-delay:{l.delay}s, {l.delay + l.duration + l.linger}s;
				--sway:{l.sway}px; --spin:{l.spin}deg; --rest:{l.rest}deg;
				--end-y:{l.end};
			"
		>
			{#each l.shape.parts as p, i (i)}
				<path d={p.d} fill={fill(p, l.color)} transform={p.rot ? `rotate(${p.rot} 12 17.5)` : undefined} />
			{/each}
			{#if l.shape.vein}
				<path d={l.shape.vein} stroke={veinColor(l.color)} stroke-width="1.2" stroke-linecap="round" fill="none" />
			{/if}
		</svg>
	{/each}
</div>

<style>
	.leaves {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
	}
	.leaf {
		position: absolute;
		/* seul élément cliquable du calque : le survol balaie la feuille, le reste de l'écran
		   reste transparent aux clics */
		pointer-events: auto;
		/* deux animations en parallèle : la chute (transform) puis le fondu (opacity), chacune
		   avec sa durée et son délai posés en style inline */
		animation-name: leaf-fall, leaf-fade;
		animation-timing-function: ease-in-out, ease-in;
		animation-fill-mode: forwards, forwards;
		will-change: transform;
	}
	/* Chute alternée gauche/droite plutôt qu'un plan incliné : la feuille glisse d'un côté,
	   décroche, repart de l'autre, et finit à plat au sol. */
	@keyframes leaf-fall {
		0% {
			transform: translate3d(0, 0, 0) rotate(0deg);
		}
		25% {
			transform: translate3d(var(--sway), 25vh, 0) rotate(calc(var(--spin) * 0.25));
		}
		50% {
			transform: translate3d(calc(var(--sway) * -0.9), 50vh, 0) rotate(calc(var(--spin) * 0.5));
		}
		75% {
			transform: translate3d(calc(var(--sway) * 0.6), 75vh, 0) rotate(calc(var(--spin) * 0.75));
		}
		100% {
			transform: translate3d(calc(var(--sway) * -0.3), var(--end-y), 0) rotate(var(--rest));
		}
	}
	@keyframes leaf-fade {
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.leaves {
			display: none;
		}
	}
</style>
