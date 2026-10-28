<script lang="ts">
	import { onMount } from 'svelte';
	import { Confetti } from 'svelte-confetti';

	const KEY = 'imputo-birthday-seen';
	const AGE = new Date().getFullYear() - 2000;

	let visible = $state(false);
	let leaving = $state(false);

	onMount(() => {
		const today = new Date();
		if (today.getMonth() !== 9 || today.getDate() !== 30) return;
		const todayStr = today.toISOString().slice(0, 10);
		try {
			if (localStorage.getItem(KEY) === todayStr) return;
		} catch {}
		visible = true;
	});

	function dismiss() {
		leaving = true;
		try {
			localStorage.setItem(KEY, new Date().toISOString().slice(0, 10));
		} catch {}
		setTimeout(() => (visible = false), 320);
	}
</script>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop" class:leaving onclick={dismiss} role="button" tabindex="-1" aria-label="Fermer">
		<!-- Party poppers gauche et droite, tir vers le haut -->
		<div class="popper popper-l" aria-hidden="true">
			<Confetti
				x={[0, 1.2]}
				y={[0.5, 1]}
				amount={35}
				noGravity
				duration={2200}
				delay={[0, 400]}
				colorArray={['#f97316', '#fb923c', '#fde68a', '#ea580c', '#fed7aa', '#1e1b2e']}
				disableForReducedMotion
			/>
		</div>
		<div class="popper popper-r" aria-hidden="true">
			<Confetti
				x={[-1.2, 0]}
				y={[0.5, 1]}
				amount={35}
				noGravity
				duration={2200}
				delay={[0, 400]}
				colorArray={['#f97316', '#fb923c', '#fde68a', '#ea580c', '#fed7aa', '#1e1b2e']}
				disableForReducedMotion
			/>
		</div>

		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="card" onclick={(e) => e.stopPropagation()}>
			<div class="mark" aria-hidden="true">
				<svg viewBox="108 84 296 296" fill="#fff" xmlns="http://www.w3.org/2000/svg">
					<rect x="132" y="284" width="64" height="96" rx="30" />
					<rect x="224" y="230" width="64" height="150" rx="30" />
					<rect x="316" y="170" width="64" height="210" rx="30" />
					<circle cx="348" cy="116" r="32" />
				</svg>
				<span class="hat">🎃</span>
			</div>

			<p class="eyebrow">Le créateur d'Imputo</p>

			<div class="hero">
				<span class="age">{AGE}</span>
				<span class="age-label">ans</span>
			</div>

			<h2 class="name">Fabien Bounoir</h2>

			<p class="message">
				C'est son anniversaire aujourd'hui.
				Si tu le croises, dis-lui un mot. 🕯️
			</p>

			<button class="btn-close" onclick={dismiss}>C'est noté !</button>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		backdrop-filter: blur(4px);
		animation: fade-in 0.3s ease;
	}
	.backdrop.leaving {
		animation: fade-out 0.3s ease forwards;
	}

	.popper {
		position: absolute;
		bottom: 30%;
		pointer-events: none;
	}
	.popper-l { left: 10%; }
	.popper-r { right: 10%; }

	.card {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 380px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		padding: 32px 28px 24px;
		text-align: center;
		animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.mark {
		width: 44px;
		height: 44px;
		border-radius: 13px;
		background: linear-gradient(150deg, #f97316, #1e1b2e);
		display: grid;
		place-items: center;
		transform: rotate(-4deg);
		box-shadow: 0 6px 16px color-mix(in srgb, #f97316 40%, transparent);
		margin: 0 auto 20px;
		position: relative;
	}
	.mark svg {
		width: 62%;
		height: 62%;
		display: block;
	}
	.hat {
		position: absolute;
		top: -9px;
		right: -8px;
		font-size: 14px;
		transform: rotate(15deg);
	}

	.eyebrow {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #f97316;
		margin-bottom: 12px;
	}

	/* Grand chiffre de l'âge — pièce maîtresse */
	.hero {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 6px;
		margin-bottom: 6px;
		line-height: 1;
	}
	.age {
		font-family: var(--font-display);
		font-size: clamp(4rem, 18vw, 5.5rem);
		font-weight: 800;
		letter-spacing: -0.04em;
		color: #f97316;
	}
	.age-label {
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 600;
		color: var(--text-mute);
		letter-spacing: -0.01em;
	}

	.name {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		margin-bottom: 14px;
	}

	.message {
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text-soft);
		margin-bottom: 22px;
	}

	.btn-close {
		display: inline-flex;
		align-items: center;
		padding: 9px 22px;
		border-radius: var(--r-md);
		font-size: 13.5px;
		font-weight: 600;
		font-family: var(--font-ui);
		background: #f97316;
		color: #fff;
		box-shadow: 0 6px 16px color-mix(in srgb, #f97316 38%, transparent);
		cursor: pointer;
		border: none;
		transition: box-shadow 0.2s, transform 0.12s;
	}
	.btn-close:hover {
		box-shadow: 0 8px 22px color-mix(in srgb, #f97316 50%, transparent);
	}
	.btn-close:active {
		transform: translateY(1px);
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
	@keyframes fade-out {
		from { opacity: 1; }
		to   { opacity: 0; }
	}
	@keyframes slide-up {
		from { opacity: 0; transform: translateY(24px) scale(0.96); }
		to   { opacity: 1; transform: none; }
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop, .card { animation: none; }
	}
</style>
