<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { formatDuration } from '$lib/supportDuration';
	import ExportModal from '$lib/components/ExportModal.svelte';

	let { data } = $props();

	const SUPPORT_SHEETS = [
		{ key: 'synthese', label: 'Synthèse' },
		{ key: 'detail', label: 'Détail (brut)' },
		{ key: 'personne', label: 'Par personne' },
		{ key: 'ticket', label: 'Par ticket' }
	];

	// Date locale en YYYY-MM-DD, même motif que ExportModal (pas toISOString : décale d'un jour aux
	// fuseaux à l'est de Greenwich).
	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

	let preset = $state(data.preset);
	let fromInput = $state(data.filter.from);
	let toInput = $state(data.filter.to);
	let personId = $state(data.filter.userId);
	// Resynchronise les copies locales après chaque rechargement serveur (changement de filtre) —
	// même motif que /admin/suivi-annuel.
	$effect(() => {
		preset = data.preset;
		fromInput = data.filter.from;
		toInput = data.filter.to;
		personId = data.filter.userId;
	});

	function applyFilter(next: { preset?: string; from?: string; to?: string; userId?: string }) {
		const p = next.preset ?? preset;
		const f = next.from ?? fromInput;
		const t = next.to ?? toInput;
		const uid = next.userId ?? personId;
		const params = new URLSearchParams({ preset: p });
		if (p !== 'all') {
			if (f) params.set('from', f);
			if (t) params.set('to', t);
		}
		if (uid) params.set('userId', uid);
		goto(`?${params}`, { keepFocus: true, noScroll: true });
	}
	function setPreset(p: string) {
		const now = new Date();
		if (p === 'month') {
			fromInput = iso(new Date(now.getFullYear(), now.getMonth(), 1));
			toInput = iso(now);
		} else if (p === 'year') {
			fromInput = iso(new Date(now.getFullYear(), 0, 1));
			toInput = iso(now);
		} else if (p === 'all') {
			fromInput = '';
			toInput = '';
		}
		preset = p;
		applyFilter({ preset: p, from: fromInput, to: toInput });
	}
	function setPerson(uid: string) {
		personId = uid;
		applyFilter({ userId: uid });
	}

	// Scroll infini paginé par curseur (day, createdAt, id) : seule la liste "Détail" grandit sans
	// borne sur plusieurs années, les agrégats (stats) viennent déjà du serveur pour le filtre actif.
	let entries = $state(data.entries);
	let nextCursor = $state(data.nextCursor);
	let loadingMore = $state(false);
	let sentinel: HTMLElement | undefined = $state();
	$effect(() => {
		entries = data.entries;
		nextCursor = data.nextCursor;
	});
	async function loadMore() {
		if (loadingMore || !nextCursor) return;
		loadingMore = true;
		const params = new URLSearchParams();
		if (data.filter.from) params.set('from', data.filter.from);
		if (data.filter.to) params.set('to', data.filter.to);
		if (data.filter.userId) params.set('userId', data.filter.userId);
		params.set('cursorDay', nextCursor.day);
		params.set('cursorCreatedAt', nextCursor.createdAt);
		params.set('cursorId', nextCursor.id);
		try {
			const res = await fetch(`/api/support-time/history?${params}`);
			if (!res.ok) return;
			const page: { entries: typeof entries; nextCursor: typeof nextCursor } = await res.json();
			entries = [...entries, ...page.entries];
			nextCursor = page.nextCursor;
		} finally {
			loadingMore = false;
		}
	}
	$effect(() => {
		if (!sentinel) return;
		const obs = new IntersectionObserver((es) => {
			if (es[0].isIntersecting) loadMore();
		});
		obs.observe(sentinel);
		return () => obs.disconnect();
	});

	const fmtDay = (d: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00Z'));

	const periodLabel = $derived(preset === 'all' ? 'Toutes les dates' : data.filter.from && data.filter.to ? `${data.filter.from} → ${data.filter.to}` : '');
	const maxPersonMinutes = $derived(Math.max(1, ...data.stats.byPerson.map((p) => p.minutes)));
</script>

<div class="topbar">
	<h1>Historique support<small>{periodLabel}</small></h1>
	<div class="spacer"></div>
	{#if navigating.to}<span class="loading-hint">Chargement…</span>{/if}
	<a class="btn btn-ghost" href="/support">← Support</a>
	<ExportModal
		label="Exporter Excel"
		buttonClass="btn btn-primary"
		endpoint="/support/export"
		sheets={SUPPORT_SHEETS}
		title="Exporter le temps support"
		hint="Le tableau ci-dessous ne montre qu'un aperçu — choisis ici la période complète à exporter."
		presets={['month', 'year', 'all']}
		defaultPreset="year"
		extraParams={personId ? { userId: personId } : {}}
	/>
</div>

<div class="content">
	<div class="filters-row">
		<div class="seg">
			<button type="button" class:on={preset === 'month'} onclick={() => setPreset('month')}>Mois en cours</button>
			<button type="button" class:on={preset === 'year'} onclick={() => setPreset('year')}>Cette année</button>
			<button type="button" class:on={preset === 'all'} onclick={() => setPreset('all')}>Tout</button>
			<button type="button" class:on={preset === 'custom'} onclick={() => setPreset('custom')}>Personnalisé</button>
		</div>
		{#if preset === 'custom'}
			<div class="custom-dates">
				<label class="ex-field">Du<input type="date" bind:value={fromInput} max={toInput} onchange={() => applyFilter({ preset: 'custom' })} /></label>
				<label class="ex-field">Au<input type="date" bind:value={toInput} min={fromInput} onchange={() => applyFilter({ preset: 'custom' })} /></label>
			</div>
		{/if}
		<select class="periodsel" value={personId} onchange={(e) => setPerson(e.currentTarget.value)} aria-label="Filtrer par personne">
			<option value="">Toutes les personnes</option>
			{#each data.people as p (p.userId)}
				<option value={p.userId}>{p.name}</option>
			{/each}
		</select>
	</div>

	<div class="kpis">
		<div class="card kpi">
			<div class="k">Temps total</div>
			<div class="v">{formatDuration(data.stats.totalMinutes)}</div>
		</div>
		<div class="card kpi">
			<div class="k">Saisies</div>
			<div class="v tabnum">{data.stats.entryCount}</div>
		</div>
		<div class="card kpi">
			<div class="k">Tickets distincts</div>
			<div class="v tabnum">{data.stats.distinctTickets}</div>
		</div>
		<div class="card kpi">
			<div class="k">Personnes</div>
			<div class="v tabnum">{data.stats.distinctPeople}</div>
		</div>
	</div>

	<div class="card panel">
		<h3>Par personne</h3>
		{#if data.stats.byPerson.length === 0}
			<p class="empty">Aucune saisie sur cette période.</p>
		{:else}
			<div class="barlist">
				{#each data.stats.byPerson as p (p.userId)}
					<div class="barrow">
						<span class="lbl" title={p.name}>{p.name}</span>
						<div class="track"><i style="width:{(p.minutes / maxPersonMinutes) * 100}%"></i></div>
						<span class="val tabnum">{formatDuration(p.minutes)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- "Par ticket" n'existe qu'à l'export Excel (cf. ExportModal ci-dessus) : sur des années de
	     saisies, le nombre de tickets distincts n'a pas de plafond naturel comme les personnes, pas
	     question de calculer/afficher cette répartition à chaque chargement de page. -->

	<section class="card block detail-card">
		<h3>Détail</h3>
		{#if entries.length === 0}
			<p class="empty">Aucune saisie sur cette période.</p>
		{:else}
			<div class="time-table-wrap">
				<table class="time-table">
					<thead><tr><th>Jour</th><th>Personne</th><th>Ticket</th><th class="num">Durée</th></tr></thead>
					<tbody>
						{#each entries as e (e.id)}
							<tr>
								<td>{fmtDay(e.day)}</td>
								<td>{e.userDisplayName}</td>
								<td>{e.ticketRef}</td>
								<td class="num tabnum">{formatDuration(e.minutes)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if nextCursor}
				<div bind:this={sentinel} class="sentinel">{loadingMore ? 'Chargement…' : ''}</div>
			{:else}
				<p class="sentinel">Fin de la période.</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.content {
		max-width: 1080px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.loading-hint {
		font-size: 12px;
		color: var(--text-mute);
	}
	.empty {
		color: var(--text-mute);
		font-size: 13px;
	}

	/* ---------- Filtres ---------- */
	.filters-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.seg {
		display: flex;
		gap: 8px;
	}
	.seg button {
		padding: 8px 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-soft);
		font-size: 13px;
		font-weight: 500;
		transition: border-color 0.15s, background 0.15s, color 0.15s;
	}
	.seg button:hover {
		border-color: var(--border-strong);
	}
	.seg button.on {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-weight: 600;
	}
	.custom-dates {
		display: flex;
		gap: 10px;
	}
	.ex-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ex-field input {
		padding: 7px 9px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.periodsel {
		margin-left: auto;
		padding: 8px 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-soft);
		font-size: 13px;
		font-weight: 500;
	}
	.periodsel:focus {
		outline: none;
		border-color: var(--accent);
	}

	/* ---------- KPIs ---------- */
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
	}
	.kpi {
		padding: 18px 20px;
	}
	.kpi .k {
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.kpi .v {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}

	/* ---------- Par personne ---------- */
	.panel {
		padding: 20px 22px;
	}
	.panel h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 16px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 11px;
		max-height: 420px;
		overflow-y: auto;
	}
	.barrow {
		display: grid;
		grid-template-columns: 140px 1fr 64px;
		align-items: center;
		gap: 12px;
	}
	.barrow .lbl {
		font-size: 13px;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	/* ---------- Détail (scroll infini) ---------- */
	.detail-card {
		padding: 22px;
	}
	.detail-card h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 16px;
	}
	.time-table-wrap {
		overflow-x: auto;
	}
	.time-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
	}
	.time-table th {
		text-align: left;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		padding: 0 10px 8px;
		white-space: nowrap;
	}
	.time-table td {
		padding: 9px 10px;
		border-top: 1px solid var(--border);
		white-space: nowrap;
	}
	.time-table .num {
		text-align: right;
	}
	.sentinel {
		text-align: center;
		padding: 14px 0 2px;
		font-size: 12.5px;
		color: var(--text-mute);
	}
</style>
