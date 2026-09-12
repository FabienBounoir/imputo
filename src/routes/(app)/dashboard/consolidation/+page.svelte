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

<div class="topbar">
	<h1>
		Consolidation<small>Charges et économie, périmètre par périmètre — état courant.</small>
	</h1>
	<div class="spacer"></div>
	<label class="toggle">
		<input
			type="checkbox"
			checked={data.includeTransverse}
			onchange={(e) => navigateWith({ transverse: e.currentTarget.checked })}
		/>
		<span>Inclure les chantiers transverses</span>
	</label>
</div>

<div class="content">
	{#if data.consolidation.partial}
		<section class="card block banner">
			<div>
				<b>Vue partielle</b> — elle ne couvre que les périmètres que vous pilotez : les colonnes
				d'argent des autres sont masquées, et aucun total d'argent n'est affiché tant que c'est le cas.
			</div>
		</section>
	{/if}

	{#if data.perimeters.length > 1}
		<section class="card block filters">
			<span class="filters-label">Périmètres</span>
			<div class="chips">
				{#each data.perimeters as p (p.id)}
					<button
						type="button"
						class="chip"
						class:on={data.selectedPerimeterIds.includes(p.id)}
						style="--perim:{p.color ?? 'var(--text-mute)'}"
						onclick={() => togglePerimeter(p.id)}
					>
						<span class="dot"></span>
						{p.name}{p.transverse ? ' (transverse)' : ''}
					</button>
				{/each}
				{#if data.selectedPerimeterIds.length > 0}
					<button type="button" class="chip chip-reset" onclick={() => navigateWith({ perimeters: [] })}>
						Tout afficher
					</button>
				{/if}
			</div>
		</section>
	{/if}

	<section class="card block">
		<h3>Charges et économie</h3>
		<p class="hint">
			Les <strong>charges</strong> se ventilent par le périmètre du ticket ; le
			<strong>budget SSP</strong> par celui du code — un code partagé entre plusieurs périmètres tombe
			dans la ligne « Partagé » plutôt que d'être réparti au hasard. Pas de filtre de période : le détail
			mois par mois vit dans le Suivi annuel.
		</p>

		<!-- Beaucoup de colonnes dès que l'argent est visible : c'est le tableau qui défile, jamais la
		     page — et la colonne des périmètres reste collée à gauche pour qu'on sache toujours quelle
		     ligne on lit. -->
		<div class="scroll">
			<table class="cons">
				<thead>
					<tr class="groups">
						<th></th>
						<th colspan="6">Charges (jours)</th>
						{#if showMoney}
							<th class="sep" colspan="3">Économie — tickets</th>
							<th class="sep" colspan="3">Économie — codes SSP</th>
						{/if}
					</tr>
					<tr>
						<th class="left">Périmètre</th>
						<th class="num">Tickets</th>
						<th class="num">Estimé</th>
						<th class="num">Consommé</th>
						<th class="num">RAE</th>
						<th class="num">Écart d'exécution</th>
						<th class="num">Avancement</th>
						{#if showMoney}
							<th class="num sep">Enveloppe</th>
							<th class="num">PPR</th>
							<th class="num">TNF budget</th>
							<th class="num sep">Budget SSP</th>
							<th class="num">Prod</th>
							<th class="num">TNF</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.perimeterId ?? 'shared')}
						<tr class:muted-row={r.transverse || r.perimeterId === null}>
							<td class="left">
								<span class="dot" style="--perim:{r.color ?? 'var(--text-mute)'}"></span>
								{r.name}
								{#if r.transverse}<span class="pill">transverse</span>{/if}
								{#if r.perimeterId === null}
									<span class="pill" title="Codes SSP rattachés à aucun périmètre">partagé</span>
								{/if}
							</td>
							<td class="num tabnum">{dash(r.ticketCount)}</td>
							<td class="num tabnum">{dash(r.estTotal)}</td>
							<td class="num tabnum">{dash(r.consumedTotal)}</td>
							<td class="num tabnum">{dash(r.raeTotal)}</td>
							<td class="num tabnum" class:gap-pos={r.ecartVsEstimeTotal > 0} class:gap-neg={r.ecartVsEstimeTotal < 0}>
								<!-- Une ligne sans ticket n'a pas un écart « nul », elle n'en a pas. -->
								{r.ticketCount ? signed(r.ecartVsEstimeTotal) : '—'}
							</td>
							<td class="num tabnum">
								{#if r.ticketCount}
									{pct(r.avancement)} %
									<!-- La barre double le chiffre, elle ne le remplace pas : elle sert à comparer les
									     lignes d'un coup d'œil, le pourcentage reste la valeur lisible. -->
									<span class="prog" aria-hidden="true"><span style="width:{Math.min(100, Math.max(0, pct(r.avancement)))}%"></span></span>
								{:else}
									—
								{/if}
							</td>
							{#if showMoney}
								<td class="num tabnum sep">{fmt(r.enveloppeTotal)}</td>
								<td class="num tabnum">{fmt(r.pprTotal)}</td>
								<td class="num tabnum" class:gap-pos={(r.ecartVsBudgetTotal ?? 0) > 0} class:gap-neg={(r.ecartVsBudgetTotal ?? 0) < 0}>
									{signed(r.ecartVsBudgetTotal)}
								</td>
								<td class="num tabnum sep">{fmt(r.budgetTotal)}</td>
								<td class="num tabnum">{fmt(r.prodTotal)}</td>
								<td class="num tabnum">{signed(r.tnfTotal)}</td>
							{/if}
						</tr>
					{/each}
					{#if rows.length === 0}
						<tr>
							<td class="left empty" colspan={showMoney ? 13 : 7}>
								Aucun périmètre à consolider avec ces filtres.
							</td>
						</tr>
					{/if}
				</tbody>
				{#if rows.length > 1}
					<tfoot>
						<tr>
							<td class="left">Total</td>
							<td class="num tabnum">{total.ticketCount}</td>
							<td class="num tabnum">{total.estTotal}</td>
							<td class="num tabnum">{total.consumedTotal}</td>
							<td class="num tabnum">{total.raeTotal}</td>
							<td class="num tabnum" class:gap-pos={total.ecartVsEstimeTotal > 0} class:gap-neg={total.ecartVsEstimeTotal < 0}>
								{signed(total.ecartVsEstimeTotal)}
							</td>
							<td class="num tabnum">{pct(total.avancement)} %</td>
							{#if showMoney}
								<td class="num tabnum sep">{fmt(total.enveloppeTotal)}</td>
								<td class="num tabnum">{fmt(total.pprTotal)}</td>
								<td class="num tabnum">{signed(total.ecartVsBudgetTotal)}</td>
								<td class="num tabnum sep">{fmt(total.budgetTotal)}</td>
								<td class="num tabnum">{fmt(total.prodTotal)}</td>
								<td class="num tabnum">{signed(total.tnfTotal)}</td>
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
	/* .card ne porte aucun padding dans app.css : chaque page pose le sien, 22px comme /admin. */
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	.block h3 {
		margin: 0 0 4px;
	}
	.hint {
		margin: 0 0 14px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-mute);
		max-width: 78ch;
	}
	.banner {
		font-size: 13px;
		border-color: var(--error-border);
		background: var(--error-bg);
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--text-soft);
		white-space: nowrap;
	}

	/* ---------- Filtre par périmètre ---------- */
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.filters-label {
		font-size: 11.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		padding: 5px 11px;
		border-radius: 30px;
		cursor: pointer;
		color: var(--text-soft);
		background: var(--surface-2);
		border: 1px solid var(--border);
		transition: border-color 0.15s, background 0.15s;
	}
	.chip:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	/* Le périmètre sélectionné garde sa couleur de pastille : c'est le même repère que partout
	   ailleurs (ligne de ticket, en-tête de section d'imputation). */
	.chip.on {
		background: color-mix(in srgb, var(--perim, var(--accent)) 16%, var(--surface));
		border-color: color-mix(in srgb, var(--perim, var(--accent)) 55%, transparent);
		color: var(--text);
		font-weight: 600;
	}
	.chip-reset {
		border-style: dashed;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 30px;
		background: var(--perim, var(--text-mute));
		flex: none;
	}
	td .dot {
		margin-right: 8px;
	}

	/* ---------- Tableau ---------- */
	.scroll {
		overflow-x: auto;
	}
	table.cons {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	table.cons th,
	table.cons td {
		padding: 8px 12px;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--border);
	}
	table.cons th {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-mute);
	}
	table.cons .num {
		text-align: right;
	}
	/* En-tête de groupe : dit à quoi se rapportent les colonnes (jours vs argent, ticket vs code SSP)
	   — 13 colonnes alignées sans ça se lisaient comme une seule série. */
	.groups th {
		font-size: 10.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-align: center;
		color: var(--text-mute);
		border-bottom: 1px solid var(--border);
		padding-bottom: 4px;
	}
	.groups th:empty {
		border-bottom: none;
	}
	/* La colonne des périmètres reste lisible pendant le défilement horizontal. */
	table.cons th:first-child,
	table.cons td:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
	}
	table.cons tbody tr:hover td {
		background: var(--surface-2);
	}
	/* Séparation des trois familles de colonnes, plus marquée que la grille des lignes. */
	.sep {
		border-left: 1px solid var(--border-strong);
	}
	.tabnum {
		font-variant-numeric: tabular-nums;
	}
	tfoot td {
		font-weight: 700;
		border-top: 2px solid var(--border-strong);
		border-bottom: none;
		background: var(--surface-2);
	}
	.muted-row td {
		color: var(--text-mute);
	}
	.empty {
		color: var(--text-mute);
		padding: 26px 12px;
	}
	/* Même code couleur que les écarts de la liste des tickets et de la modale : dépassement en
	   `--warn`, marge en `--success`, et jamais la couleur seule — le signe + / − porte l'info. */
	.gap-pos {
		color: var(--warn);
		font-weight: 700;
	}
	.gap-neg {
		color: var(--success);
		font-weight: 700;
	}
	.prog {
		display: block;
		height: 3px;
		margin-top: 5px;
		border-radius: 30px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.prog span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.legend {
		margin: 14px 0 0;
	}
</style>
