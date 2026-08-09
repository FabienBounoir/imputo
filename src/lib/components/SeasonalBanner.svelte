<script lang="ts">
	// Bannière de vœux discrète, fermable (le choix reste mémorisé pour cette saison).
	let { id, message }: { id: string; message: string } = $props();

	const key = `imputo-seasonal-banner-dismissed-${id}`;
	let dismissed = $state(typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1');

	function dismiss() {
		dismissed = true;
		localStorage.setItem(key, '1');
	}
</script>

{#if !dismissed}
	<div class="sb">
		<span>{message}</span>
		<button type="button" class="sb-close" onclick={dismiss} aria-label="Fermer">✕</button>
	</div>
{/if}

<style>
	.sb {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 9px 30px;
		font-size: 13px;
		font-weight: 500;
		text-align: center;
		color: var(--accent-ink);
		background: var(--accent-tint);
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.sb-close {
		color: var(--accent-ink);
		opacity: 0.6;
		font-size: 12px;
		line-height: 1;
		padding: 2px;
	}
	.sb-close:hover {
		opacity: 1;
	}
</style>
