<script lang="ts">
	// Premier jour du printemps : des fleurs poussent en bas de l'écran. La tige se dessine
	// (stroke-dashoffset), les deux feuilles s'ouvrent depuis la tige, puis les pétales se
	// déplient un par un et le cœur s'allume — ensuite la fleur respire doucement.
	// Aucun élément ne tombe ni ne traverse : c'est le seul effet de la série qui pousse.
	const PETALS = 7;
	const MAX = 6;

	// La tige part du bas et monte : le tracé commence en bas, donc le dash se dévoile vers le haut.
	const STEM = 'M30 120C28.5 96 31.5 74 30 44';
	const LEAF_L = 'M29 86C20 84 13 76 13 67c9 1 16 9 16 19z';
	const LEAF_R = 'M31 74c9-2 16-10 16-19-9 1-16 9-16 19z';

	let nextId = 0;
	function makeFlower() {
		const grow = 1.5 + Math.random() * 0.6;
		return {
			id: nextId++,
			fading: false,
			left: 2 + Math.random() * 92,
			// Discrètes : la plus haute d'aujourd'hui fait la taille de la plus basse d'avant.
			height: 38 + Math.random() * 34,
			tone: 1 + Math.floor(Math.random() * 5),
			grow,
			lean: (Math.random() - 0.5) * 10, // inclinaison au repos
			sway: 3.8 + Math.random() * 2.6,
			petals: Array.from({ length: PETALS }, (_, i) => ({
				angle: (i * 360) / PETALS + (Math.random() - 0.5) * 8,
				delay: grow + 0.1 + i * 0.07
			})),
			bloom: grow + 0.1 + PETALS * 0.07
		};
	}

	type Flower = ReturnType<typeof makeFlower>;
	let flowers = $state<Flower[]>([]);

	/**
	 * Cueillir une fleur qui gêne. Même flétrissement que la relève automatique plutôt qu'une
	 * disparition sèche — et elle cesse d'intercepter le clic dès la première pression, sans
	 * attendre la fin de l'animation.
	 */
	function pickFlower(f: Flower) {
		if (f.fading) return;
		f.fading = true;
		setTimeout(() => (flowers = flowers.filter((x) => x.id !== f.id)), 2200);
	}

	$effect(() => {
		// Un premier massif, décalé pour que les fleurs ne sortent pas toutes ensemble.
		flowers = Array.from({ length: 4 }, makeFlower);
		let t = setTimeout(function sprout() {
			flowers.push(makeFlower());
			// au-delà de MAX, la plus ancienne se fane et laisse la place
			if (flowers.length > MAX) {
				const old = flowers[0];
				old.fading = true;
				setTimeout(() => (flowers = flowers.filter((f) => f.id !== old.id)), 2200);
			}
			t = setTimeout(sprout, 22000 + Math.random() * 20000);
		}, 9000 + Math.random() * 8000);
		return () => clearTimeout(t);
	});
</script>

<div class="spring" aria-hidden="true">
	{#each flowers as f (f.id)}
		<!-- Couche décorative (aria-hidden) : le clic n'est qu'une échappatoire pour dégager une
		     fleur gênante, il n'y a rien à atteindre au clavier ici. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="flower"
			class:fading={f.fading}
			onclick={() => pickFlower(f)}
			style="left:{f.left}%; height:{f.height}px; width:{f.height / 2}px; --lean:{f.lean}deg; --sway:{f.sway}s; --bloom:{f.bloom}s; --c:var(--petal-{f.tone});"
		>
			<svg viewBox="0 0 60 120" width="100%" height="100%" preserveAspectRatio="none">
				<path
					class="stem"
					d={STEM}
					style="animation-duration:{f.grow}s;"
					fill="none"
					stroke="var(--stem)"
					stroke-width="3.4"
					stroke-linecap="round"
				/>
				<path class="leaf" d={LEAF_L} fill="var(--stem)" style="animation-delay:{f.grow * 0.55}s;" />
				<path class="leaf right" d={LEAF_R} fill="var(--stem)" style="animation-delay:{f.grow * 0.75}s;" />
				{#each f.petals as p, i (i)}
					<ellipse
						class="petal"
						cx="30"
						cy="19"
						rx="6.4"
						ry="11.5"
						fill="var(--c)"
						style="--a:{p.angle}deg; animation-delay:{p.delay}s;"
					/>
				{/each}
				<circle class="heart" cx="30" cy="34" r="5.4" fill="var(--heart)" style="animation-delay:{f.bloom}s;" />
			</svg>
		</div>
	{/each}
</div>

<style>
	.spring {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
		/* Pétales plus soutenus sur fond clair, plus tendres sur fond sombre. */
		--petal-1: #ef7fa8;
		--petal-2: #f0b429;
		--petal-3: #a879dd;
		--petal-4: #f2836a;
		--petal-5: #e8619a;
		--stem: #5f9e5c;
		--heart: #f7c948;
	}
	:global([data-theme='dark']) .spring {
		--petal-1: #ffa8c7;
		--petal-2: #ffd36b;
		--petal-3: #c9a6f0;
		--petal-4: #ffab8f;
		--petal-5: #ff8fb8;
		--stem: #79c07a;
		--heart: #ffe08a;
	}
	/* Le rectangle de la fleur est surtout du vide, et cette couche recouvre TOUTE l'app : seules les
	   formes réellement peintes acceptent le clic, sinon chaque fleur avalerait les clics de la page
	   en dessous. Un parent en pointer-events:none laisse passer l'événement de ses enfants. */
	.flower :is(.stem, .leaf, .petal, .heart) {
		pointer-events: auto;
		cursor: pointer;
	}
	/* Cueillie : elle ne capte plus rien pendant ses deux secondes de flétrissement. */
	.flower.fading :is(.stem, .leaf, .petal, .heart) {
		pointer-events: none;
	}
	.flower {
		position: absolute;
		bottom: 0;
		transform-origin: bottom center;
		/* la fleur s'incline au repos, puis respire : deux animations sur le même élément, la
		   seconde ne démarre qu'une fois la floraison finie */
		rotate: var(--lean);
		animation: breathe var(--sway) ease-in-out var(--bloom) infinite alternate;
	}
	.flower.fading {
		animation:
			breathe var(--sway) ease-in-out var(--bloom) infinite alternate,
			wilt 2.2s ease-in forwards;
	}
	/* La tige se dessine du bas vers le haut : 120 couvre la longueur du tracé. */
	.stem {
		stroke-dasharray: 120;
		stroke-dashoffset: 120;
		animation-name: draw;
		animation-timing-function: ease-out;
		animation-fill-mode: forwards;
	}
	.leaf {
		transform-box: view-box;
		transform-origin: 30px 80px; /* attache côté tige : la feuille s'ouvre, elle n'apparaît pas */
		scale: 0;
		animation: unfurl 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) forwards;
	}
	.leaf.right {
		transform-origin: 30px 68px;
	}
	.petal {
		transform-box: view-box;
		transform-origin: 30px 34px;
		transform: rotate(var(--a)) scale(0);
		animation: open 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3) forwards;
	}
	.heart {
		transform-box: view-box;
		transform-origin: 30px 34px;
		scale: 0;
		animation: pop 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.4) forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes unfurl {
		to {
			scale: 1;
		}
	}
	@keyframes open {
		to {
			transform: rotate(var(--a)) scale(1);
		}
	}
	@keyframes pop {
		to {
			scale: 1;
		}
	}
	@keyframes breathe {
		to {
			rotate: calc(var(--lean) + 2.2deg);
		}
	}
	@keyframes wilt {
		to {
			opacity: 0;
			translate: 0 14px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spring {
			display: none;
		}
	}
</style>
