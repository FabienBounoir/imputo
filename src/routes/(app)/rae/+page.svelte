<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	let { data } = $props();
	type Pair = (typeof data.pairs)[number];

	// Une carte par ticket ; le serveur trie déjà par ancienneté, donc chaque ticket arrive à la place
	// de sa ligne la plus ancienne.
	const groups = $derived.by(() => {
		const byTicket = new Map<string, { ticketId: string; key: string; title: string; lines: Pair[] }>();
		for (const p of data.pairs) {
			let g = byTicket.get(p.ticketId);
			if (!g) byTicket.set(p.ticketId, (g = { ticketId: p.ticketId, key: p.ticketKey, title: p.ticketTitle, lines: [] }));
			g.lines.push(p);
		}
		return [...byTicket.values()];
	});

	const fmt = (n: number) => String(n).replace('.', ',');
	const dateFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

	// Même endpoint que la colonne RAE de Mon imputation. Renvoyer la valeur inchangée repousse le
	// rappel (updated_at de la paire) sans ligne d'historique : c'est tout « Toujours bon ».
	async function save(p: Pair, value: number, done: string) {
		const res = await fetch(`/api/tickets/${p.ticketId}/activity-rae`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activityId: p.activityId, field: 'raeReal', value })
		});
		if (!res.ok) {
			toast.error((await res.json().catch(() => null))?.message ?? 'Enregistrement impossible.');
			return;
		}
		toast.success(done);
		await invalidateAll(); // la ligne quitte la liste et la pastille du menu se met à jour
	}

	// Anti-rafale du champ (spinner/molette), comme dans Mon imputation.
	const pending = new Map<string, ReturnType<typeof setTimeout>>();
	function onRaeChange(p: Pair, value: number) {
		const k = `${p.ticketId}:${p.activityId}`;
		clearTimeout(pending.get(k));
		pending.set(
			k,
			setTimeout(() => {
				pending.delete(k);
				save(p, value, value === 0 ? 'RAE passé à 0 : ligne terminée' : `RAE passé à ${fmt(value)} j`);
			}, 600)
		);
	}
</script>

<div class="topbar">
	<h1>
		RAE à revoir<small
			>{data.pairs.length
				? `${data.pairs.length} ligne${data.pairs.length > 1 ? 's' : ''} sans mise à jour depuis ${data.staleDays} jours`
				: 'Tout est à jour'}</small
		>
	</h1>
</div>

<div class="content">
	{#if groups.length === 0}
		<p class="card empty">Tous tes RAE sont à jour.</p>
	{:else}
		<p class="hint">
			Corrige la valeur, ou confirme qu'elle est toujours bonne : le rappel repart pour {data.staleDays} jours.
		</p>
		<div class="groups">
			{#each groups as g (g.ticketId)}
				<section class="card group">
					<header>
						<span class="key">{g.key}</span>
						<span class="title">{g.title}</span>
					</header>
					{#each g.lines as p (p.activityId)}
						<div class="line">
							<div class="who">
								<span class="act">{p.activityLabel}</span>
								<span class="imputed">{fmt(p.imputed)} j imputés</span>
							</div>
							<span class="age rae-age-{p.step}" title="Dernière mise à jour le {dateFr.format(p.updatedAt)}">{p.days} j</span>
							<label class="rae">
								<input
									class="rae-input rae-age-{p.step}"
									type="number"
									step="0.25"
									min="0"
									value={p.raeReal}
									aria-label="RAE {p.activityLabel}, {g.key}"
									onchange={(e) => onRaeChange(p, Number(e.currentTarget.value) || 0)}
								/>
								j
							</label>
							<button
								type="button"
								class="ok"
								onclick={() => save(p, p.raeReal, `Confirmé : prochain rappel dans ${data.staleDays} jours si rien ne bouge`)}
							>
								Toujours bon
							</button>
						</div>
					{/each}
				</section>
			{/each}
		</div>
	{/if}
</div>

<style>
	.hint {
		margin: 0 0 14px;
		color: var(--text-soft);
		font-size: 14px;
	}
	.empty {
		max-width: 880px;
		margin: 0;
		padding: 22px 24px;
		color: var(--text-soft);
	}
	.groups {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 880px;
	}
	.group {
		overflow: hidden;
		box-shadow: var(--shadow-sm);
	}
	.group header {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		padding: 12px 18px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.key {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
	}
	.title {
		min-width: 0;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.line {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: 14px;
		padding: 10px 18px;
	}
	.line + .line {
		border-top: 1px solid var(--border);
	}
	.who {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		min-width: 0;
	}
	.act {
		font-size: 12px;
		font-weight: 600;
		padding: 1px 9px;
		border-radius: 20px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		color: var(--text-soft);
	}
	.imputed {
		font-size: 12.5px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	/* --rae-age-* posées par la classe globale rae-age-N (app.css) : même contour que Mon imputation. */
	.age {
		font-size: 12px;
		font-weight: 600;
		padding: 1px 9px;
		border-radius: 20px;
		border: 1.5px solid var(--rae-age-border, var(--border));
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.rae {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.rae-input {
		width: 64px;
		padding: 5px 6px;
		border-radius: 8px;
		border: 1px solid var(--rae-age-border, var(--border));
		box-shadow: var(--rae-age-ring, none);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.rae-input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.ok {
		padding: 6px 12px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-soft);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.ok:hover {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-tint-2);
	}
	@media (max-width: 640px) {
		.line {
			grid-template-columns: 1fr auto auto;
		}
		.who {
			grid-column: 1 / -1;
		}
	}
</style>
