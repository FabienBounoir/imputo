<script lang="ts">
	import { confirmState, answerConfirm } from '$lib/confirm.svelte';
	const pending = $derived(confirmState.pending);
</script>

<svelte:window onkeydown={(e) => pending && e.key === 'Escape' && answerConfirm(false)} />

{#if pending}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cd-backdrop" onclick={() => answerConfirm(false)}>
		<div class="cd-modal" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="cd-icon">⚠️</div>
			<h3 id="cd-title">{pending.title ?? 'Attention'}</h3>
			<p>{pending.message}</p>
			<div class="cd-actions">
				<button type="button" class="btn btn-ghost cd-danger" onclick={() => answerConfirm(true)}>
					{pending.confirmLabel ?? 'Confirmer'}
				</button>
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="btn btn-primary" onclick={() => answerConfirm(false)} autofocus>
					{pending.cancelLabel ?? 'Annuler'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cd-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 100;
	}
	.cd-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 26px;
		width: 100%;
		max-width: 400px;
		text-align: center;
	}
	.cd-icon {
		font-size: 28px;
		margin-bottom: 8px;
	}
	.cd-modal h3 {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		color: var(--warn);
		margin-bottom: 8px;
	}
	.cd-modal p {
		font-size: 13.5px;
		color: var(--text-soft);
		line-height: 1.5;
		margin-bottom: 22px;
	}
	.cd-actions {
		display: flex;
		gap: 10px;
	}
	.cd-actions .btn {
		flex: 1;
		justify-content: center;
	}
	.cd-danger {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
	}
	.cd-danger:hover {
		background: var(--warn-tint);
		border-color: var(--warn);
	}
</style>
