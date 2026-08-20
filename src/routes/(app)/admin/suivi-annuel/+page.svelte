<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatMonthLabel, formatMonthShortLabel } from '$lib/utils/date';
	import type { AnnualTrackingMonthCell, AnnualTrackingSspRow } from '$lib/server/services/sspAnnualTracking';

	let { data, form } = $props();

	const view = $derived(data.view);

	// Deux mises en page pour les mêmes données : « Par SSP » (un bloc par code, les 4 indicateurs
	// dessous — pratique pour lire l'année d'un seul code) et « Par indicateur » (4 tableaux façon
	// Excel, un par indicateur, tous les codes en lignes — pratique pour comparer les codes entre
	// eux sur un même indicateur). Mémorisé comme le reste des interrupteurs de la page.
	const VIEW_STORAGE_KEY = 'imputo-suivi-annuel-view-mode';
	// null tant qu'on n'a pas lu le localStorage : le serveur ne le connaît pas, donc un défaut
	// "ssp" au rendu SSR se ferait remplacer par "indicator" à l'hydratation si c'est le mode
	// mémorisé — un vrai changement de mise en page visible à l'écran, pas juste un style de bouton.
	// Tant que c'est null on n'affiche aucun des deux tableaux plutôt que d'en montrer un qui va
	// changer une fraction de seconde plus tard.
	let viewMode = $state<'ssp' | 'indicator' | null>(null);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const stored = localStorage.getItem(VIEW_STORAGE_KEY);
		viewMode = stored === 'indicator' ? 'indicator' : 'ssp';
	});
	function setViewMode(v: 'ssp' | 'indicator') {
		viewMode = v;
		if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_STORAGE_KEY, v);
	}

	// Repli des cartes — même motif que /admin/cloture (localStorage, sinon tout se rouvrirait à
	// chaque saisie puisque le formulaire recharge les données). Clés préfixées pour distinguer les
	// blocs SSP (uuid) des blocs indicateur (« ind-rae » etc.), sans risque de collision.
	const COLLAPSE_STORAGE_KEY = 'imputo-suivi-annuel-collapsed';
	let collapsed = $state<Record<string, boolean>>({});
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			collapsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? '{}');
		} catch {
			/* entrée corrompue : on repart tout déplié */
		}
	});
	function toggleBlock(blockKey: string) {
		collapsed = { ...collapsed, [blockKey]: !collapsed[blockKey] };
		if (typeof localStorage !== 'undefined')
			localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
	}

	/** Copie locale des saisies : l'affichage est optimiste, pas d'aller-retour serveur par case. */
	let prodEdits = $state<Record<string, number | null>>({});
	let raeEdits = $state<Record<string, number | null>>({});
	let saveError = $state('');
	const key = (sspId: string, month: string) => `${sspId}:${month}`;

	$effect(() => {
		const nextProd: Record<string, number | null> = {};
		const nextRae: Record<string, number | null> = {};
		for (const row of view.rows) {
			for (const c of row.cells) {
				nextProd[key(row.sspId, c.month)] = c.prod;
				nextRae[key(row.sspId, c.month)] = c.raeOverridden ? c.rae : null;
			}
		}
		prodEdits = nextProd;
		raeEdits = nextRae;
	});

	// Le RAE est une chaîne récursive (RAE(M) = RAE(M-1) - Prod(M)) et le TNF en dépend : une saisie
	// peut faire bouger des cellules bien au-delà de celle éditée. Pas de recalcul client de la
	// chaîne (dupliquer computeRaeChain c'est le bug qui diverge un jour) — on recharge la vue
	// serveur après chaque saisie réussie ; le $effect ci-dessus re-synchronise ensuite les copies
	// locales depuis la donnée fraîche.
	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body });
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			saveError = (result.data?.error as string) ?? 'Erreur lors de l\'enregistrement.';
			return;
		}
		saveError = '';
		await invalidateAll();
	}

	function onProd(sspId: string, month: string, raw: string) {
		const t = raw.trim();
		const v = t === '' ? null : Number(t.replace(',', '.'));
		if (v !== null && !Number.isFinite(v)) return;
		prodEdits[key(sspId, month)] = v;
		post('setProd', { sspId, month, value: t });
	}

	function onRae(sspId: string, month: string, raw: string) {
		const t = raw.trim();
		const v = t === '' ? null : Number(t.replace(',', '.'));
		if (v !== null && !Number.isFinite(v)) return;
		raeEdits[key(sspId, month)] = v;
		post('setRaeOverride', { sspId, month, value: t });
	}

	// Le mois en cours est toujours la dernière colonne : on ouvre chaque tableau scrollé à fond à
	// droite plutôt que sur sept.2025, sinon c'est un scroll horizontal à refaire à chaque fois pour
	// voir la seule colonne éditable. Une action plutôt qu'un $effect : elle se redéclenche aussi
	// quand une carte repliée se rouvre (le tableau vient d'apparaître dans le DOM), pas seulement
	// au premier rendu de la page.
	function scrollToEnd(node: HTMLElement) {
		node.scrollLeft = node.scrollWidth;
	}

	const fmt = (n: number | null) => (n === null ? '—' : String(n));
</script>

<svelte:head><title>Suivi annuel — Imputo</title></svelte:head>

{#snippet cardHead(blockKey: string, title: string)}
	<button type="button" class="card-head" aria-expanded={!collapsed[blockKey]} onclick={() => toggleBlock(blockKey)}>
		<svg
			class="chev"
			class:closed={collapsed[blockKey]}
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"><path d="m6 9 6 6 6-6" /></svg
		>
		<h3>{title}</h3>
	</button>
{/snippet}

{#snippet monthHeadRow(firstLabel: string)}
	<tr>
		<th>{firstLabel}</th>
		{#each view.windowMonths as m (m)}
			<th class="num" class:current-month={m === view.cursorMonth}>{formatMonthShortLabel(m)}</th>
		{/each}
	</tr>
{/snippet}

{#snippet raeCell(row: AnnualTrackingSspRow, c: AnnualTrackingMonthCell)}
	<td class="num" class:current-month={c.month === view.cursorMonth}>
		{#if c.raeEditable}
			<input
				class="grid-input tabnum"
				type="number"
				step="0.25"
				value={raeEdits[key(row.sspId, c.month)] ?? ''}
				placeholder={c.rae === null ? '—' : String(c.rae)}
				onchange={(e) => onRae(row.sspId, c.month, e.currentTarget.value)}
			/>
		{:else}
			<span class="tabnum">{fmt(c.rae)}</span>
		{/if}
	</td>
{/snippet}

{#snippet consoCell(c: AnnualTrackingMonthCell)}
	<td class="num tabnum computed" class:current-month={c.month === view.cursorMonth}>{c.conso}</td>
{/snippet}

{#snippet prodCell(row: AnnualTrackingSspRow, c: AnnualTrackingMonthCell)}
	<td class="num" class:computed={!c.prodEditable} class:current-month={c.month === view.cursorMonth}>
		{#if c.prodEditable}
			<input
				class="grid-input tabnum"
				type="number"
				step="0.25"
				value={prodEdits[key(row.sspId, c.month)] ?? ''}
				placeholder="—"
				onchange={(e) => onProd(row.sspId, c.month, e.currentTarget.value)}
			/>
		{:else}
			<span class="tabnum">{fmt(c.prod)}</span>
		{/if}
	</td>
{/snippet}

{#snippet tnfCell(c: AnnualTrackingMonthCell)}
	<td
		class="num tabnum computed"
		class:current-month={c.month === view.cursorMonth}
		class:warn={c.tnf !== null && c.tnf < 0}
		class:ok-cell={c.tnf !== null && c.tnf > 0}>{fmt(c.tnf)}</td
	>
{/snippet}

{#snippet sspLabelCell(row: AnnualTrackingSspRow)}
	<td title="{row.code} — {row.label}"
		><b>{row.code}</b> — {row.label}{#if row.archived}<span class="tag-arch">archivé</span>{/if}</td
	>
{/snippet}

<div class="topbar">
	<h1>
		Suivi annuel<small>
			Budget, consommation, production et TNF par code SSP — fenêtre glissante de 12 mois.
		</small>
	</h1>
	<div class="spacer"></div>
	<div class="head-actions">
		<span class="wd-calc">Mois en cours : <b>{formatMonthLabel(view.cursorMonth)}</b></span>
		<div class="seg" role="group" aria-label="Mise en page">
			<button type="button" class:on={viewMode === 'ssp'} onclick={() => setViewMode('ssp')}>Par SSP</button>
			<button type="button" class:on={viewMode === 'indicator'} onclick={() => setViewMode('indicator')}
				>Par indicateur</button
			>
		</div>
		<form
			method="POST"
			action="?/nextMonth"
			use:enhance={async ({ cancel }) => {
				const ok = await confirmDialog(
					`Passer au mois suivant ? La production de ${formatMonthLabel(view.cursorMonth)} deviendra définitive (lecture seule).`
				);
				if (!ok) cancel();
			}}
		>
			<button class="btn btn-primary" type="submit">Mois suivant →</button>
		</form>
	</div>
</div>

<div class="content">
	{#if form?.error}<div class="flash error">{form.error}</div>{/if}
	{#if saveError}<div class="flash error">{saveError}</div>{/if}

	{#if view.rows.length === 0}
		<section class="card block empty">
			<p>Aucun code SSP avec du budget, de la consommation ou de la production sur cette fenêtre.</p>
		</section>
	{:else if viewMode === null}
		<!-- Mode pas encore connu (localStorage lu côté client uniquement) : rien plutôt qu'une mise
		     en page qui changerait de forme une fraction de seconde plus tard. -->
	{:else if viewMode === 'ssp'}
		{#each view.rows as row (row.sspId)}
			<section class="card block ssp-block">
				{@render cardHead(row.sspId, `${row.code} — ${row.label}`)}
				{#if !collapsed[row.sspId]}
					<div class="scroll" use:scrollToEnd>
						<table class="weekly-table annual-table">
							<thead>
								{@render monthHeadRow('Indicateur')}
							</thead>
							<tbody>
								<tr>
									<td>RAE</td>
									{#each row.cells as c (c.month)}{@render raeCell(row, c)}{/each}
								</tr>
								<tr>
									<td>Conso</td>
									{#each row.cells as c (c.month)}{@render consoCell(c)}{/each}
								</tr>
								<tr>
									<td>Prod</td>
									{#each row.cells as c (c.month)}{@render prodCell(row, c)}{/each}
								</tr>
								<tr>
									<td>TNF</td>
									{#each row.cells as c (c.month)}{@render tnfCell(c)}{/each}
								</tr>
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/each}
	{:else}
		<!-- Mise en page façon Excel : un tableau par indicateur, tous les codes SSP en lignes. -->
		<section class="card block">
			{@render cardHead('ind-rae', 'Budget — RAE mensuel')}
			{#if !collapsed['ind-rae']}
				<div class="scroll" use:scrollToEnd>
					<table class="weekly-table annual-table by-indicator">
						<thead>{@render monthHeadRow('Code SSP')}</thead>
						<tbody>
							{#each view.rows as row (row.sspId)}
								<tr>
									{@render sspLabelCell(row)}
									{#each row.cells as c (c.month)}{@render raeCell(row, c)}{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card block">
			{@render cardHead('ind-conso', 'Conso')}
			{#if !collapsed['ind-conso']}
				<div class="scroll" use:scrollToEnd>
					<table class="weekly-table annual-table by-indicator">
						<thead>{@render monthHeadRow('Code SSP')}</thead>
						<tbody>
							{#each view.rows as row (row.sspId)}
								<tr>
									{@render sspLabelCell(row)}
									{#each row.cells as c (c.month)}{@render consoCell(c)}{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card block">
			{@render cardHead('ind-prod', 'Prod')}
			{#if !collapsed['ind-prod']}
				<div class="scroll" use:scrollToEnd>
					<table class="weekly-table annual-table by-indicator">
						<thead>{@render monthHeadRow('Code SSP')}</thead>
						<tbody>
							{#each view.rows as row (row.sspId)}
								<tr>
									{@render sspLabelCell(row)}
									{#each row.cells as c (c.month)}{@render prodCell(row, c)}{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card block">
			{@render cardHead('ind-tnf', 'TNF')}
			{#if !collapsed['ind-tnf']}
				<div class="scroll" use:scrollToEnd>
					<table class="weekly-table annual-table by-indicator">
						<thead>{@render monthHeadRow('Code SSP')}</thead>
						<tbody>
							{#each view.rows as row (row.sspId)}
								<tr>
									{@render sspLabelCell(row)}
									{#each row.cells as c (c.month)}{@render tnfCell(c)}{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.head-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
	}
	.wd-calc {
		color: var(--text-mute);
		font-size: 13px;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--r-sm, 8px);
		overflow: hidden;
	}
	.seg button {
		padding: 7px 12px;
		font-size: 12.5px;
		color: var(--text-mute);
		background: var(--surface-2, var(--surface));
	}
	.seg button + button {
		border-left: 1px solid var(--border);
	}
	.seg button.on {
		background: var(--accent-tint, var(--surface));
		color: var(--text);
		font-weight: 600;
	}
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	.block h3 {
		margin: 0;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0;
		color: var(--text);
		text-align: left;
	}
	.card-head .chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.15s ease;
	}
	.card-head .chev.closed {
		transform: rotate(-90deg);
	}
	.card-head:hover .chev {
		color: var(--accent);
	}
	.tag-arch {
		margin-left: 5px;
		font-size: 10px;
		font-weight: 500;
		color: var(--warn);
	}
	.empty {
		display: flex;
		align-items: center;
	}
	.empty p {
		margin: 0;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 14px;
	}
	.weekly-table {
		table-layout: fixed;
		width: max-content;
		border-collapse: collapse;
		font-size: 13px;
	}
	.weekly-table th,
	.weekly-table td {
		width: 96px;
	}
	.weekly-table th:first-child,
	.weekly-table td:first-child {
		width: 90px;
	}
	/* Mise en page « Par indicateur » : la 1ère colonne porte un code + libellé, plus large que
	   « Indicateur » (RAE/Conso/Prod/TNF) de la mise en page « Par SSP ». */
	.weekly-table.by-indicator th:first-child,
	.weekly-table.by-indicator td:first-child {
		width: 220px;
	}
	.weekly-table th,
	.weekly-table td {
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
		text-align: left;
		white-space: nowrap;
	}
	.weekly-table th:first-child,
	.weekly-table td:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.weekly-table th {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.weekly-table th:first-child,
	.weekly-table td:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
	}
	.weekly-table .num {
		text-align: right;
	}
	.weekly-table tbody tr:last-child td {
		border-bottom: none;
	}
	/* Mois en cours : seule colonne où Prod se saisit — mise en évidence sur toute la hauteur du bloc. */
	.current-month {
		background: var(--accent-tint);
	}
	.weekly-table th:first-child.current-month,
	.weekly-table td:first-child.current-month {
		background: color-mix(in srgb, var(--accent-tint) 100%, var(--surface));
	}
	/* Cellule dérivée (Conso, TNF, RAE/Prod hors saisie) : distincte visuellement des <input> éditables. */
	.computed {
		font-style: italic;
		color: var(--text-mute);
	}
	.warn {
		color: var(--warn);
		font-weight: 600;
	}
	.ok-cell {
		color: var(--success);
		font-weight: 600;
	}
	.grid-input {
		width: 100%;
		padding: 4px 6px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
		text-align: right;
	}
</style>
