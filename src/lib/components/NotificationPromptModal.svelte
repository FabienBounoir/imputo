<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Confetti } from 'svelte-confetti';
	import { pushSupported, subscribePush } from '$lib/push';

	let { vapidPublicKey }: { vapidPublicKey: string } = $props();

	const DISMISS_KEY = 'imputo-notif-prompt-dismissed';
	// Le temps de laisser voir les confettis avant de refermer (cf. enable()) — même intention que
	// CONFETTI_DURATION côté imputation/+page.svelte, en plus court : ici c'est un aperçu, pas une célébration qui dure.
	const CELEBRATE_MS = 1400;
	let show = $state(false);
	let busy = $state(false);
	let celebrate = $state(false);

	onMount(() => {
		if (!vapidPublicKey || !pushSupported()) return;
		if (Notification.permission !== 'default') return;
		if (localStorage.getItem(DISMISS_KEY)) return;
		// Un petit temps de respiration après le chargement de la page plutôt qu'une popup qui
		// saute au visage dès le premier rendu — c'est ce délai qui fait la différence "propre".
		const t = setTimeout(() => (show = true), 1500);
		return () => clearTimeout(t);
	});

	function dismiss() {
		localStorage.setItem(DISMISS_KEY, '1');
		show = false;
	}

	async function enable() {
		busy = true;
		const ok = await subscribePush(vapidPublicKey);
		busy = false;
		// Acceptée ou refusée par le navigateur, la question ne se repose plus sur cet appareil —
		// `Notification.permission` ne redeviendra jamais "default" pour lui redonner une chance.
		if (ok && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			celebrate = true;
			setTimeout(dismiss, CELEBRATE_MS);
		} else {
			dismiss();
		}
	}
</script>

<svelte:window onkeydown={(e) => show && e.key === 'Escape' && dismiss()} />

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="np-backdrop" transition:fade={{ duration: 180 }} onclick={dismiss}>
		<div
			class="np-modal"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="np-title"
			tabindex="-1"
			transition:fly={{ y: 16, duration: 260, easing: cubicOut }}
			onclick={(e) => e.stopPropagation()}
		>
			<div class="np-badge">{celebrate ? '🎉' : '🔔'}</div>
			<h3 id="np-title">{celebrate ? 'Notifications activées !' : 'Ne ratez plus rien'}</h3>
			<p>
				{#if celebrate}
					Tu seras prévenu en temps réel, plus rien ne t'échappera.
				{:else}
					Active les notifications pour être prévenu en temps réel : rappels d'imputation, vote de l'humeur
					d'équipe, tour de garde support...
				{/if}
			</p>
			{#if !celebrate}
				<div class="np-actions">
					<button type="button" class="btn btn-ghost" onclick={dismiss} disabled={busy}>Plus tard</button>
					<button type="button" class="btn btn-primary" onclick={enable} disabled={busy}>
						{#if busy}<span class="np-spinner" aria-hidden="true"></span>{:else}Activer les notifications{/if}
					</button>
				</div>
			{/if}
		</div>
		{#if celebrate}
			<div class="np-confetti" aria-hidden="true">
				<Confetti
					x={[-1, 1]}
					y={[0, 0.5]}
					delay={[0, 200]}
					amount={80}
					duration={CELEBRATE_MS}
					rounded
					colorArray={[
						'var(--accent)',
						'var(--accent-ink)',
						'color-mix(in srgb, var(--accent) 55%, white)',
						'color-mix(in srgb, var(--accent) 75%, black)'
					]}
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	.np-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 100;
	}
	.np-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 20px);
		box-shadow: var(--shadow-lg);
		padding: 28px;
		width: 100%;
		max-width: 360px;
		text-align: center;
	}
	.np-badge {
		width: 60px;
		height: 60px;
		margin: 0 auto 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 28px;
		border-radius: 50%;
		background: radial-gradient(circle at 30% 30%, var(--accent-tint), var(--accent-tint-2));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.np-modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 8px;
	}
	.np-modal p {
		font-size: 13.5px;
		color: var(--text-soft);
		line-height: 1.5;
		margin-bottom: 22px;
	}
	.np-actions {
		display: flex;
		gap: 10px;
	}
	.np-actions .btn {
		flex: 1;
		justify-content: center;
	}
	.np-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: np-spin 0.7s linear infinite;
	}
	@keyframes np-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.np-confetti {
		position: fixed;
		inset: 0;
		display: flex;
		justify-content: center;
		overflow: hidden;
		pointer-events: none;
	}
</style>
