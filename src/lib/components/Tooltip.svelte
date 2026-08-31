<script lang="ts">
	// Bulle custom au survol (CSS pur, pas de JS de positionnement) — remplace le title natif du
	// navigateur là où son rendu générique détonne (ex. avatar d'assigné, tableau/kanban tickets).
	import type { Snippet } from 'svelte';

	let { text, children }: { text: string; children: Snippet } = $props();
</script>

<span class="tt-wrap">
	{@render children()}
	{#if text}
		<span class="tt-bubble" role="tooltip">{text}</span>
	{/if}
</span>

<style>
	.tt-wrap {
		position: relative;
		display: inline-flex;
	}
	.tt-bubble {
		position: absolute;
		bottom: 100%;
		left: 50%;
		margin-bottom: 7px;
		transform: translateX(-50%) translateY(2px);
		opacity: 0;
		pointer-events: none;
		white-space: nowrap;
		background: var(--text);
		color: var(--surface);
		font-size: 11.5px;
		font-weight: 600;
		padding: 5px 9px;
		border-radius: var(--r-sm);
		box-shadow: var(--shadow-md);
		transition: opacity 0.12s ease, transform 0.12s ease;
		transition-delay: 0.05s;
		z-index: 40;
	}
	.tt-bubble::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 5px solid transparent;
		border-top-color: var(--text);
	}
	.tt-wrap:hover .tt-bubble,
	.tt-wrap:focus-within .tt-bubble {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}
</style>
