<script lang="ts">
	let {
		color = $bindable(),
		rgbMode = $bindable(),
		presets
	}: { color: string; rgbMode: boolean; presets: string[] } = $props();
</script>

<div class="swatches">
	{#each presets as c (c)}
		<button
			type="button"
			class="sw"
			class:sel={!rgbMode && color.toLowerCase() === c.toLowerCase()}
			style="background:{c}"
			onclick={() => {
				rgbMode = false;
				color = c;
			}}
			aria-label={c}
		></button>
	{/each}
	<button
		type="button"
		class="sw rgb-sw"
		class:sel={rgbMode}
		onclick={() => (rgbMode = !rgbMode)}
		aria-label="RGB (couleur défilante)"
		title="RGB (couleur défilante)"
	>🌈</button>
	<input class="hex" type="color" bind:value={color} disabled={rgbMode} aria-label="Couleur personnalisée" />
</div>

<style>
	.swatches {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.sw {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		cursor: pointer;
		outline: 2px solid transparent;
		outline-offset: 2px;
		transition: transform 0.12s;
	}
	.sw:hover {
		transform: scale(1.1);
	}
	.sw.sel {
		outline-color: var(--text-soft);
	}
	.hex {
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}
	.hex:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.rgb-sw {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: 15px;
	}
</style>
