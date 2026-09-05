<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const rows = $derived(data.consolidation.rows);
	const total = $derived(data.consolidation.total);
	/** Au moins une ligne visible porte-t-elle des chiffres d'argent ? Sinon on masque ces colonnes. */
	const showMoney = $derived(rows.some((r) => r.lead));

	function navigateWith(partial: { perimeters?: string[]; transverse?: boolean }) {
		const p = new URLSearchParams();
		const ids = partial.perimeters ?? data.selectedPerimeterIds;
		const transverse = partial.transverse ?? data.includeTransverse;
		if (ids.length > 0) p.set('perimeters', ids.join(','));
		if (!transverse) p.set('transverse', '0');
		goto(p.size > 0 ? `?${p}` : '?', { keepFocus: true, noScroll: true });
	}
	function togglePerimeter(id: string) {
		const next = data.selectedPerimeterIds.includes(id)
			? data.selectedPerimeterIds.filter((x) => x !== id)
			: [...data.selectedPerimeterIds, id];
		navigateWith({ perimeters: next });
	}

	// Sur les colonnes d'argent, « — » veut dire MASQUÉ (périmètre non piloté) et jamais zéro : un
	// budget réellement à 0 est une information, la confondre avec un chiffre caché serait trompeur.
	// Les colonnes de charge, elles, gardent « — » pour 0 (une ligne sans ticket n'a rien à dire).
	const fmt = (n: number | null) => (n === null ? '—' : String(n));
	const dash = (n: number) => (n ? String(n) : '—');
	const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}`);
	const pct = (n: number) => Math.round(n * 100);
</script>

<svelte:head><title>Consolidation — Imputo</title></svelte:head>

<div class="page">
	<header class="page-head">
		<div>
			<h2>Consolidation par périmètre</h2>
			<p class="hint">
				Charges et économie, périmètre par périmètre. Les <strong>charges</strong> se ventilent par le
				périmètre du ticket ; le <strong>budget SSP</strong> par celui du code — un code partagé entre
				plusieurs périmètres tombe dans la ligne « Partagé » plutôt que d'être réparti au hasard.
				État courant, pas de filtre de période : le détail mois par mois vit dans le Suivi annuel.
			</p>
		</div>
	</header>

	<section class="card filters">
		<div class="chips">
			{#each data.perimeters as p (p.id)}
				<button
					type="button"
					class="chip"
					class:on={data.selectedPerimeterIds.includes(p.id)}
					style="--perim:{p.color ?? 'var(--muted)'}"
					onclick={() => togglePerimeter(p.id)}
				>
					{p.name}{p.transverse ? ' (transverse)' : ''}
				</button>
			{/each}
			{#if data.selectedPerimeterIds.length > 0}
				<button type="button" class="chip chip-reset" onclick={() => navigateWith({ perimeters: [] })}>
					Tous
				</button>
			{/if}
		</div>
		<label class="toggle">
			<input
				type="checkbox"
				checked={data.includeTransverse}
				onchange={(e) => navigateWith({ transverse: e.currentTarget.checked })}
			/>
			<span>Inclure les chantiers transverses</span>
		</label>
	</section>

	{#if data.consolidation.partial}
		<p class="hint warn">
			Cette vue ne couvre que les périmètres que vous pilotez ; les colonnes budget des autres sont
			masquées, et aucun total d'argent n'est affiché tant que c'est le cas.
		</p>
	{/if}

	<section class="card">
		<div class="table-scroll">
			<table class="cons">
				<thead>
					<tr>
						<th class="left">Périmètre</th>
						<th>Tickets</th>
						<th>Estimé</th>
						<th>Consommé</th>
						<th>RAE</th>
						<th>Écart d'exécution</th>
						<th>Avancement</th>
						{#if showMoney}
							<th class="sep">Enveloppe</th>
							<th>PPR</th>
							<th>TNF budget</th>
							<th class="sep">Budget SSP</th>
							<th>Prod</th>
							<th>TNF</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.perimeterId ?? 'shared')}
						<tr class:transverse={r.transverse} class:shared={r.perimeterId === null}>
							<td class="left">
								<span class="dot" style="--perim:{r.color ?? 'var(--muted)'}"></span>
								{r.name}
								{#if r.transverse}<span class="tag">transverse</span>{/if}
								{#if r.perimeterId === null}<span class="tag" title="Codes SSP rattachés à aucun périmètre">partagé</span>{/if}
							</td>
							<td class="tabnum">{dash(r.ticketCount)}</td>
							<td class="tabnum">{dash(r.estTotal)}</td>
							<td class="tabnum">{dash(r.consumedTotal)}</td>
							<td class="tabnum">{dash(r.raeTotal)}</td>
							<td class="tabnum" class:gap-pos={r.ecartVsEstimeTotal > 0} class:gap-neg={r.ecartVsEstimeTotal < 0}>
								<!-- Une ligne sans ticket n'a pas un écart « nul », elle n'en a pas. -->
								{r.ticketCount ? signed(r.ecartVsEstimeTotal) : '—'}
							</td>
							<td class="tabnum">{r.ticketCount ? `${pct(r.avancement)} %` : '—'}</td>
							{#if showMoney}
								<td class="tabnum sep">{fmt(r.enveloppeTotal)}</td>
								<td class="tabnum">{fmt(r.pprTotal)}</td>
								<td class="tabnum" class:gap-pos={(r.ecartVsBudgetTotal ?? 0) > 0} class:gap-neg={(r.ecartVsBudgetTotal ?? 0) < 0}>
									{signed(r.ecartVsBudgetTotal)}
								</td>
								<td class="tabnum sep">{fmt(r.budgetTotal)}</td>
								<td class="tabnum">{fmt(r.prodTotal)}</td>
								<td class="tabnum">{signed(r.tnfTotal)}</td>
							{/if}
						</tr>
					{/each}
					{#if rows.length === 0}
						<tr><td class="left empty" colspan={showMoney ? 13 : 7}>Aucun périmètre à consolider avec ces filtres.</td></tr>
					{/if}
				</tbody>
				{#if rows.length > 1}
					<tfoot>
						<tr>
							<td class="left">Total</td>
							<td class="tabnum">{total.ticketCount}</td>
							<td class="tabnum">{total.estTotal}</td>
							<td class="tabnum">{total.consumedTotal}</td>
							<td class="tabnum">{total.raeTotal}</td>
							<td class="tabnum" class:gap-pos={total.ecartVsEstimeTotal > 0} class:gap-neg={total.ecartVsEstimeTotal < 0}>
								{signed(total.ecartVsEstimeTotal)}
							</td>
							<td class="tabnum">{pct(total.avancement)} %</td>
							{#if showMoney}
								<td class="tabnum sep">{fmt(total.enveloppeTotal)}</td>
								<td class="tabnum">{fmt(total.pprTotal)}</td>
								<td class="tabnum">{signed(total.ecartVsBudgetTotal)}</td>
								<td class="tabnum sep">{fmt(total.budgetTotal)}</td>
								<td class="tabnum">{fmt(total.prodTotal)}</td>
								<td class="tabnum">{signed(total.tnfTotal)}</td>
							{/if}
						</tr>
					</tfoot>
				{/if}
			</table>
		</div>
		<p class="hint legend">
			<b>Écart d'exécution</b> = (RAE + consommé) − estimé. <b>TNF budget</b> = (RAE + consommé) −
			enveloppe du ticket. <b>TNF</b> = consommé − prod déclarée, cumulé depuis l'origine (même
			définition que le Suivi annuel).
			{#if !data.testPhase}Phase Test désactivée : les colonnes Estimé/RAE ne comptent que le réel.{/if}
		</p>
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.page-head h2 {
		margin: 0 0 0.25rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
	.hint.warn {
		padding: 0.6rem 0.8rem;
		border-radius: 0.6rem;
		background: color-mix(in srgb, #f59e0b 12%, transparent);
		border: 1px solid color-mix(in srgb, #f59e0b 32%, transparent);
	}
	.card {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 0.9rem;
		padding: 1rem;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		cursor: pointer;
		color: var(--text);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--perim, var(--muted)) 45%, transparent);
	}
	.chip.on {
		background: color-mix(in srgb, var(--perim, var(--accent)) 22%, transparent);
		font-weight: 600;
	}
	.chip-reset {
		border-style: dashed;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--muted);
		white-space: nowrap;
	}
	/* Beaucoup de colonnes dès que l'argent est visible : c'est le tableau qui défile, jamais la page. */
	.table-scroll {
		overflow-x: auto;
	}
	table.cons {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	table.cons th,
	table.cons td {
		padding: 0.45rem 0.6rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--border);
	}
	table.cons th {
		font-weight: 600;
		color: var(--muted);
		font-size: 0.78rem;
	}
	/* `table.cons th/td` a une spécificité supérieure à `.left` seul : sans le préfixe, la colonne
	   des noms restait alignée à droite comme les colonnes de chiffres. */
	table.cons .left {
		text-align: left;
	}
	.sep {
		border-left: 1px solid var(--border);
	}
	.tabnum {
		font-variant-numeric: tabular-nums;
	}
	tfoot td {
		font-weight: 700;
		border-top: 2px solid var(--border);
		border-bottom: none;
	}
	tr.transverse td,
	tr.shared td {
		color: var(--muted);
	}
	.dot {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		margin-right: 0.4rem;
		background: var(--perim);
	}
	.tag {
		font-size: 0.68rem;
		padding: 0 0.35rem;
		margin-left: 0.35rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--muted);
	}
	.gap-pos {
		color: #dc2626;
	}
	.gap-neg {
		color: #16a34a;
	}
	.empty {
		color: var(--muted);
	}
	.legend {
		margin-top: 0.75rem;
	}
</style>
