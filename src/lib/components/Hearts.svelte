<script lang="ts">
	// Saint-Valentin : rien ne tombe. Les cœurs éclosent dans le sillage du curseur — un tous les
	// ~80 px parcourus — et par petite gerbe au clic. C'est le seul effet saisonnier qui répond à
	// ce que fait l'utilisateur au lieu de tourner en fond, et sans souris (mobile) il ne reste que
	// les gerbes au tap, ce qui est le bon niveau de discrétion.
	const HEART =
		'M12 21C7.5 17.2 3 13.7 3 9.2 3 6.3 5.2 4 8 4c1.7 0 3.2.8 4 2.1C12.8 4.8 14.3 4 16 4c2.8 0 5 2.3 5 5.2 0 4.5-4.5 8-9 11.8z';
	const STEP = 150; // px parcourus avant de retenter un cœur
	const ODDS = 0.45; // ... et il n'éclot même pas une fois sur deux : le sillage reste clairsemé
	const MIN_GAP = 110; // ms mini entre deux cœurs, si la souris fonce
	const LIFE = 1500; // ms avant retrait du DOM (doit couvrir l'animation)
	const MAX = 16;

	type Heart = ReturnType<typeof makeHeart>;
	let hearts = $state<Heart[]>([]);
	let nextId = 0;

	function makeHeart(x: number, y: number, spread = 10) {
		const dir = Math.random() < 0.5 ? 1 : -1;
		return {
			id: nextId++,
			x: x + (Math.random() - 0.5) * spread * 2,
			y: y + (Math.random() - 0.5) * spread * 2,
			size: 13 + Math.random() * 11,
			tone: Math.floor(Math.random() * 4),
			dx: dir * (8 + Math.random() * 26),
			dy: -(28 + Math.random() * 34),
			rot: (Math.random() - 0.5) * 30,
			rot2: dir * (14 + Math.random() * 26),
			duration: 1.1 + Math.random() * 0.35
		};
	}

	function bloom(x: number, y: number, n = 1, spread = 10) {
		for (let i = 0; i < n; i++) {
			if (hearts.length >= MAX) break;
			const h = makeHeart(x, y, spread);
			hearts.push(h);
			setTimeout(() => (hearts = hearts.filter((o) => o.id !== h.id)), LIFE);
		}
	}

	$effect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		let lastX: number | null = null;
		let lastY = 0;
		let lastAt = 0;

		// Distance parcourue plutôt que temps écoulé : la densité de cœurs suit le geste, pas
		// la fréquence des events (qui dépend de la machine).
		const onMove = (e: PointerEvent) => {
			if (lastX === null) {
				lastX = e.clientX;
				lastY = e.clientY;
				return;
			}
			const d = Math.hypot(e.clientX - lastX, e.clientY - lastY);
			if (d < STEP || e.timeStamp - lastAt < MIN_GAP) return;
			lastX = e.clientX;
			lastY = e.clientY;
			lastAt = e.timeStamp;
			if (Math.random() < ODDS) bloom(e.clientX, e.clientY);
		};
		// Le clic donne 1 ou 2 cœurs la plupart du temps ; la vraie gerbe reste une surprise.
		const onDown = (e: PointerEvent) => {
			const n = Math.random() < 0.2 ? 3 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
			bloom(e.clientX, e.clientY, n, n > 2 ? 18 : 10);
		};

		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('pointerdown', onDown, { passive: true });
		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerdown', onDown);
		};
	});
</script>

<div class="hearts" aria-hidden="true">
	{#each hearts as h (h.id)}
		<svg
			class="heart tone-{h.tone}"
			viewBox="0 0 24 24"
			width={h.size}
			height={h.size}
			style="
				left:{h.x}px; top:{h.y}px;
				animation-duration:{h.duration}s;
				--dx:{h.dx}px; --dy:{h.dy}px; --rot:{h.rot}deg; --rot2:{h.rot2}deg;
			"
		>
			<path d={HEART} fill="currentColor" />
		</svg>
	{/each}
</div>

<style>
	.hearts {
		position: fixed;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 60;
	}
	.heart {
		position: absolute;
		/* left/top donnent la position du curseur ; translate recentre le cœur dessus sans
		   consommer le transform, que l'animation utilise. */
		translate: -50% -50%;
		animation-name: bloom;
		animation-timing-function: cubic-bezier(0.22, 0.8, 0.3, 1);
		animation-fill-mode: forwards;
		will-change: transform, opacity;
	}
	/* Quatre tons par thème : plus soutenus sur fond clair, plus tendres sur fond sombre. */
	.tone-0 {
		color: #e0245e;
	}
	.tone-1 {
		color: #d6336c;
	}
	.tone-2 {
		color: #f06595;
	}
	.tone-3 {
		color: #c2255c;
	}
	:global([data-theme='dark']) .tone-0 {
		color: #ff6b9a;
	}
	:global([data-theme='dark']) .tone-1 {
		color: #ff8fb1;
	}
	:global([data-theme='dark']) .tone-2 {
		color: #f783ac;
	}
	:global([data-theme='dark']) .tone-3 {
		color: #ffa8c5;
	}
	/* Éclosion : le cœur gonfle d'un coup, dépasse sa taille, puis s'élève en s'effaçant. */
	@keyframes bloom {
		0% {
			transform: translate3d(0, 0, 0) scale(0.3) rotate(var(--rot));
			opacity: 0;
		}
		20% {
			transform: translate3d(calc(var(--dx) * 0.15), calc(var(--dy) * 0.12), 0) scale(1.15) rotate(var(--rot));
			opacity: 1;
		}
		45% {
			transform: translate3d(calc(var(--dx) * 0.45), calc(var(--dy) * 0.4), 0) scale(1) rotate(var(--rot2));
			opacity: 0.95;
		}
		100% {
			transform: translate3d(var(--dx), var(--dy), 0) scale(0.8) rotate(var(--rot2));
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hearts {
			display: none;
		}
	}
</style>
