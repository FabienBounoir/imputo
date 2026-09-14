<script lang="ts">
	// Fiche d'un badge : les cinq paliers d'un coup d'œil, franchis ou non, et de quoi rejouer
	// l'animation de déblocage. Même ossature que ConfirmDialog (backdrop + carte centrée) pour que
	// ça se comporte comme les autres modales de l'app.
	import { petForTier } from '$lib/pets';
	import BadgeMedal from './BadgeMedal.svelte';

	type BadgeView = {
		id: string;
		name: string;
		unit: string;
		how: string;
		thresholds: readonly number[];
		tierNames: readonly string[];
		value: number;
		tier: number;
		tierAt: Date | string | null;
	};

	let { badge, onclose, onreplay }: { badge: BadgeView; onclose: () => void; onreplay: () => void } = $props();

	const locked = $derived(badge.tier === 0);
	const dateLabel = $derived(
		badge.tierAt ? new Date(badge.tierAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bd-backdrop" onclick={onclose}>
	<div
		class="bd-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="bd-title"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<button type="button" class="bd-close" onclick={onclose} aria-label="Fermer">✕</button>

		<div class="bd-head">
			<BadgeMedal badgeId={badge.id} tier={badge.tier} letter={badge.name[0]} size={140} {locked} interactive />
			<div>
				<h3 id="bd-title">{badge.name}</h3>
				{#if locked}
					<p class="bd-state">Pas encore décroché</p>
				{:else}
					<p class="bd-state">{badge.tierNames[badge.tier - 1]} · palier {badge.tier}/5</p>
					{#if dateLabel}<p class="bd-date">Dernier palier obtenu le {dateLabel}</p>{/if}
				{/if}
				<p class="bd-how">{badge.how}</p>
			</div>
		</div>

		<!-- Les cinq paliers, y compris ceux à venir : c'est l'intérêt de la fiche, savoir ce qui reste
		     à faire et jusqu'où ça monte. Les seuils sont publics même badge verrouillé — seul le
		     dessin se mérite. -->
		<ol class="bd-tiers">
			{#each badge.thresholds as threshold, i (i)}
				{@const done = badge.tier > i}
				{@const current = badge.tier === i}
				{@const pet = petForTier(badge.id, i + 1)}
				<li class:done class:current>
					<span class="bd-num">{done ? '✓' : i + 1}</span>
					<span class="bd-name">
						{badge.tierNames[i]}
						<!-- Annoncé même si le palier n'est pas atteint : savoir ce qu'on va gagner est
						     précisément ce qu'on vient chercher ici. Seul le dessin se mérite. -->
						{#if pet}<em class="bd-pet">🐾 {pet.name}</em>{/if}
					</span>
					<span class="bd-goal">
						{#if current}
							{badge.value} / {threshold}
						{:else}
							{threshold}
						{/if}
					</span>
				</li>
			{/each}
		</ol>
		<p class="bd-unit">Compté en {badge.unit}.</p>

		{#if !locked}
			<button type="button" class="btn btn-ghost bd-replay" onclick={onreplay}>Rejouer l’animation</button>
		{/if}
	</div>
</div>

<style>
	.bd-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 100;
		overflow-y: auto;
	}
	.bd-modal {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 24px;
		width: 100%;
		max-width: 460px;
	}
	.bd-close {
		position: absolute;
		top: 10px;
		right: 12px;
		background: none;
		border: 0;
		font-size: 15px;
		color: var(--text-mute);
		cursor: pointer;
		padding: 4px 6px;
	}

	.bd-head {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}
	.bd-head h3 {
		margin: 4px 0 2px;
		font-family: var(--font-display);
		font-size: 18px;
	}
	.bd-state {
		margin: 0;
		font-size: 13px;
		color: var(--text-mute);
	}
	.bd-date {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--text-mute);
		opacity: 0.8;
	}
	.bd-how {
		margin: 8px 0 0;
		font-size: 12.5px;
		line-height: 1.4;
	}

	.bd-tiers {
		list-style: none;
		margin: 18px 0 6px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bd-tiers li {
		display: grid;
		grid-template-columns: 24px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--text-mute);
	}
	.bd-tiers li.done {
		color: var(--text);
	}
	/* Le palier en cours est celui qu'on vient chercher sur cette fiche : il porte la valeur
	   courante, donc il doit se repérer sans lire toute la liste. */
	.bd-tiers li.current {
		background: var(--accent-tint-2, rgba(0, 0, 0, 0.05));
		color: var(--text);
		font-weight: 600;
	}
	.bd-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid var(--border);
		font-size: 11px;
	}
	.bd-tiers li.done .bd-num {
		border-color: transparent;
		background: var(--accent);
		color: #fff;
	}
	.bd-pet {
		font-style: normal;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--accent);
		white-space: nowrap;
	}
	.bd-goal {
		font-variant-numeric: tabular-nums;
		font-size: 12.5px;
	}
	.bd-unit {
		margin: 0;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.bd-replay {
		margin-top: 16px;
		width: 100%;
		justify-content: center;
	}

	@media (max-width: 480px) {
		.bd-head {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}
	}
</style>
