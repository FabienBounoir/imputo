<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const EMOJI: Record<number, string> = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };

	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
			new Date(iso + 'T00:00:00Z')
		);

	function confirmReset(voteCount: number) {
		return confirm(
			`Réinitialiser la plage en cours ? ${voteCount} vote${voteCount > 1 ? 's' : ''} seront supprimés définitivement (impossible à annuler, et l'anonymat empêche toute restauration ciblée).`
		);
	}
</script>

<div class="topbar">
	<h1>Team mood — Résultats<small>Vue admin, votes anonymes</small></h1>
</div>

{#if form?.resetOk}<div class="content" style="padding-bottom:0;"><div class="flash ok">Plage en cours réinitialisée ✓</div></div>{/if}

<div class="content">
	{#if data.periods.length === 0}
		<section class="card block">
			<p class="hint" style="margin:0;">Aucun vote enregistré pour l'instant.</p>
		</section>
	{:else}
		<div class="periods">
			{#each data.periods as p (p.periodStart)}
				{@const max = Math.max(1, ...Object.values(p.distribution))}
				<section class="card block">
					<div class="phead">
						<h3>
							{fmt(p.periodStart)} → {fmt(p.periodEnd)}
							{#if p.periodStart === data.currentPeriodStart}<span class="pill current">Plage en cours</span>{/if}
						</h3>
						<div class="stats">
							<span class="avg">{EMOJI[Math.round(p.avgScore)] ?? '—'} {p.avgScore.toFixed(2)}</span>
							<span class="count">{p.voteCount} vote{p.voteCount > 1 ? 's' : ''}</span>
							{#if p.periodStart === data.currentPeriodStart}
								<form
									method="POST"
									action="?/resetCurrentPeriod"
									use:enhance={({ cancel }) => {
										if (!confirmReset(p.voteCount)) cancel();
									}}
								>
									<button class="btn btn-ghost danger" type="submit">Réinitialiser</button>
								</form>
							{/if}
						</div>
					</div>

					<div class="barlist">
						{#each [5, 4, 3, 2, 1] as score (score)}
							<div class="barrow">
								<span class="lbl">{EMOJI[score]}</span>
								<div class="track">
									<i style="width:{(p.distribution[score as 1 | 2 | 3 | 4 | 5] / max) * 100}%"></i>
								</div>
								<span class="val">{p.distribution[score as 1 | 2 | 3 | 4 | 5]}</span>
							</div>
						{/each}
					</div>

					{#if p.messages.length > 0}
						<div class="messages">
							<h4>Messages ({p.messages.length})</h4>
							<ul>
								{#each p.messages as msg, i (i)}
									<li>{msg}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.content {
		max-width: 900px;
	}
	.block {
		padding: 24px 26px;
	}
	.block h3 {
		font-family: var(--font-display);
		font-weight: 600;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.periods {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.phead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-bottom: 14px;
	}
	.phead h3 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.stats {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 14px;
	}
	.stats form {
		margin-left: 4px;
	}
	.btn-ghost.danger {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
	}
	.btn-ghost.danger:hover {
		background: var(--warn-tint);
		border-color: var(--warn);
	}
	.avg {
		font-weight: 700;
	}
	.count {
		color: var(--text-mute);
		font-size: 13px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.barrow {
		display: grid;
		grid-template-columns: 28px 1fr 28px;
		align-items: center;
		gap: 12px;
	}
	.barrow .lbl {
		font-size: 18px;
		text-align: center;
	}
	.track {
		height: 10px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: var(--accent);
		min-width: 2px;
	}
	.barrow .val {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-soft);
		text-align: right;
	}
	.messages {
		margin-top: 18px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
	}
	.messages h4 {
		margin: 0 0 10px;
		font-size: 13px;
		color: var(--text-soft);
	}
	.messages ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.messages li {
		background: var(--surface-sunk);
		border-radius: var(--r-sm);
		padding: 10px 12px;
		font-size: 13.5px;
		white-space: pre-wrap;
	}
</style>
