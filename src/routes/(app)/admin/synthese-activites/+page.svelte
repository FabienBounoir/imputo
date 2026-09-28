<script lang="ts">
	import { goto } from '$app/navigation';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { formatMonthLabel } from '$lib/utils/date';

	let { data } = $props();
	const view = $derived(data.view);
	const ref = $derived(data.ref);

	type FilterKey = 'project' | 'sprint' | 'version' | 'ssp' | 'group';
	const current = $derived<Record<FilterKey, string>>({
		project: data.filters.projectId ?? '',
		sprint: data.filters.sprintId ?? '',
		version: data.filters.versionId ?? '',
		ssp: data.filters.sspId ?? '',
		group: data.filters.groupId ?? ''
	});
	const activeCount = $derived(Object.values(current).filter(Boolean).length);

	function navigateWith(partial: Partial<Record<FilterKey, string>>) {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries({ ...current, ...partial })) if (v) p.set(k, v);
		goto(`?${p.toString()}`, { keepFocus: true, noScroll: true });
	}

	const round2 = (n: number) => Math.round(n * 100) / 100;
	const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

	// Mois vides en tête de fenêtre masqués : sur un espace récent, 8 colonnes vides sur 12 noyaient
	// les seuls mois qui ont quelque chose à dire. Les mois vides AU MILIEU restent (un trou est une info).
	const monthTotals = $derived(
		view.windowMonths.map((m, i) => round2(view.rows.reduce((s, r) => s + (r.cells[i]?.total ?? 0), 0)))
	);
	const firstIdx = $derived.by(() => {
		const i = monthTotals.findIndex((t) => t > 0);
		return i === -1 ? 0 : i;
	});
	const months = $derived(view.windowMonths.slice(firstIdx));
	const lastMonth = $derived(view.windowMonths[view.windowMonths.length - 1]);

	const grandTotal = $derived(round2(view.rows.reduce((s, r) => s + r.total, 0)));
	// Échelle de la heatmap : max des cases ACTIVITÉ. Les lignes personne en sont des parts : sur la
	// même échelle elles restent plus claires, et on lit d'un coup d'œil qui pèse dans l'activité.
	const maxCell = $derived(Math.max(1, ...view.rows.flatMap((r) => r.cells.map((c) => c.total))));
	// Plafond à 55 % d'accent : au-delà, le texte sombre perd en contraste, et le blanc n'en a jamais
	// assez sur les verts moyens — on garde donc un seul texte sombre et une rampe bornée.
	const heat = (v: number) => (v > 0 ? Math.round(10 + 45 * (v / maxCell)) : 0);

	const sortedRows = $derived([...view.rows].sort((a, b) => b.total - a.total));
	const top = $derived(sortedRows[0]);
	const curTotal = $derived(monthTotals[monthTotals.length - 1] ?? 0);
	const prevTotal = $derived(monthTotals[monthTotals.length - 2] ?? 0);
	const contributors = $derived(
		new Set(view.rows.flatMap((r) => r.cells.flatMap((c) => c.byUser.map((u) => u.userId)))).size
	);

	type Row = (typeof view.rows)[number];
	function people(row: Row) {
		const acc = new Map<string, { displayName: string; total: number; byMonth: Record<string, number> }>();
		for (const c of row.cells)
			for (const u of c.byUser) {
				const p = acc.get(u.userId) ?? { displayName: u.displayName, total: 0, byMonth: {} };
				p.total = round2(p.total + u.total);
				p.byMonth[c.month] = u.total;
				acc.set(u.userId, p);
			}
		return [...acc.entries()].map(([userId, p]) => ({ userId, ...p })).sort((a, b) => b.total - a.total);
	}

	/** Mini-courbe de tendance sur les mois affichés, échelle propre à la ligne (c'est la forme qui compte). */
	function spark(row: Row) {
		const vals = months.map((m) => row.cells.find((c) => c.month === m)?.total ?? 0);
		const max = Math.max(1, ...vals);
		const w = 64;
		const h = 22;
		const step = vals.length > 1 ? w / (vals.length - 1) : 0;
		const pts = vals.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
		const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
		return { line, area: `0,${h} ${line} ${w},${h}`, last: pts[pts.length - 1], w, h };
	}

	let expanded = $state<Record<string, boolean>>({});
	const allOpen = $derived(view.rows.length > 0 && view.rows.every((r) => expanded[r.activityId]));
	function toggle(id: string) {
		expanded = { ...expanded, [id]: !expanded[id] };
	}
	function toggleAll() {
		const open = !allOpen;
		expanded = Object.fromEntries(view.rows.map((r) => [r.activityId, open]));
	}

	const monthShort = (m: string) => {
		const s = new Date(`${m}T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
		return s.charAt(0).toUpperCase() + s.slice(1);
	};
</script>

<svelte:head><title>Synthèse par activité — Imputo</title></svelte:head>

{#snippet filterSelect(key: FilterKey, label: string, all: string, options: { id: string; text: string }[])}
	<label class="fsel" class:on={!!current[key]}>
		<span class="fsel-k">{label}</span>
		<select value={current[key]} onchange={(e) => navigateWith({ [key]: e.currentTarget.value })} aria-label="Filtrer par {label.toLowerCase()}">
			<option value="">{all}</option>
			{#each options as o (o.id)}<option value={o.id}>{o.text}</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet tile(v: number, small: boolean = false)}
	{#if v}
		<span class="tile tabnum" class:sm={small} style:--h="{heat(v)}%">{fmt(v)}</span>
	{:else}
		<span class="tile empty-tile" class:sm={small}>–</span>
	{/if}
{/snippet}

<div class="topbar">
	<h1>
		Synthèse par activité<small>Où part le temps de l'équipe, mois par mois — 12 derniers mois, détail par personne.</small>
	</h1>
</div>

<div class="content">
	<div class="kpis">
		<div class="card kpi">
			<div class="k">Consommé sur la période</div>
			<div class="v tabnum">{fmt(grandTotal)}<small>j</small></div>
			<div class="sub">{formatMonthLabel(months[0])} → {formatMonthLabel(lastMonth)}</div>
		</div>
		<div class="card kpi">
			<div class="k">{formatMonthLabel(lastMonth)} <span class="live">en cours</span></div>
			<div class="v tabnum">{fmt(curTotal)}<small>j</small></div>
			<div class="sub">Mois précédent : <b class="tabnum">{fmt(prevTotal)} j</b></div>
		</div>
		<div class="card kpi">
			<div class="k">Activité principale</div>
			<div class="v v-text">{top?.label ?? '—'}</div>
			<div class="sub">{top && grandTotal ? `${Math.round((top.total / grandTotal) * 100)} % du total · ${fmt(top.total)} j` : 'Aucune conso'}</div>
		</div>
		<div class="card kpi">
			<div class="k">Contributeurs</div>
			<div class="v tabnum">{contributors}<small>{contributors > 1 ? 'personnes' : 'personne'}</small></div>
			<div class="sub">{view.rows.length} activité{view.rows.length > 1 ? 's' : ''} consommée{view.rows.length > 1 ? 's' : ''}</div>
		</div>
	</div>

	<section class="card filters">
		<div class="filters-row">
			<span class="filters-title">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
				Filtres
				{#if activeCount}<span class="count">{activeCount}</span>{/if}
			</span>
			{@render filterSelect('version', 'Version', 'Toutes', ref.versions.map((v) => ({ id: v.id, text: v.name })))}
			{@render filterSelect('project', 'Projet', 'Tous', ref.projects.map((p) => ({ id: p.id, text: p.name })))}
			{@render filterSelect('sprint', 'Sprint', 'Tous', ref.sprints.map((s) => ({ id: s.id, text: s.name })))}
			{@render filterSelect('ssp', 'Code SSP', 'Tous', ref.ssps.map((s) => ({ id: s.id, text: `${s.code} — ${s.label}` })))}
			{@render filterSelect('group', 'Groupe', 'Tous', ref.ticketGroups.map((g) => ({ id: g.id, text: g.label })))}
			{#if activeCount}
				<button type="button" class="reset" onclick={() => navigateWith({ project: '', sprint: '', version: '', ssp: '', group: '' })}>
					Tout effacer
				</button>
			{/if}
		</div>
		{#if activeCount}
			<p class="filters-hint">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M12 11v5" /></svg>
				Les tâches libres (sans ticket) n'ont ni version, ni projet, ni sprint, ni SSP, ni groupe : elles sont exclues tant qu'un filtre est actif.
			</p>
		{/if}
	</section>

	{#if view.rows.length === 0}
		<section class="card empty">
			<div class="empty-ic">∅</div>
			<p><b>Aucune consommation</b> sur les 12 derniers mois{activeCount ? ' avec ces filtres' : ''}.</p>
		</section>
	{:else}
		<section class="card table-card">
			<header class="table-head">
				<div>
					<h2>Répartition mensuelle</h2>
					<p class="muted">
						{sortedRows.length} activités, de la plus à la moins consommée{#if firstIdx}{' · '}mois sans conso avant {formatMonthLabel(months[0])} masqués{/if}
					</p>
				</div>
				<div class="table-tools">
					<span class="legend" aria-hidden="true">Moins <i class="ramp"></i> Plus</span>
					<button type="button" class="btn-ghost" onclick={toggleAll}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d={allOpen ? 'm7 15 5-5 5 5' : 'm7 10 5 5 5-5'} /></svg>
						{allOpen ? 'Tout replier' : 'Détail par personne'}
					</button>
				</div>
			</header>

			<div class="scroll">
				<table class="synth">
					<thead>
						<tr>
							<th class="c-act">Activité</th>
							{#each months as m (m)}
								<th class="c-m" class:cur={m === lastMonth}>
									<span class="mm">{monthShort(m)}</span>
									<span class="yy">{m === lastMonth ? 'en cours' : m.slice(0, 4)}</span>
								</th>
							{/each}
							<th class="c-tot" aria-sort="descending">Cumul ↓</th>
						</tr>
					</thead>
					<tbody>
						{#each sortedRows as row, ri (row.activityId)}
							{@const share = grandTotal ? row.total / grandTotal : 0}
							{@const open = !!expanded[row.activityId]}
							{@const sp = spark(row)}
							{#if ri > 0}<tr class="gap" aria-hidden="true"><td colspan={months.length + 2}></td></tr>{/if}
							<tr class="r-act" class:open>
								<th class="c-act" scope="row">
									<button type="button" class="act" onclick={() => toggle(row.activityId)} aria-expanded={open} aria-label="{open ? 'Replier' : 'Déplier'} {row.label}">
										<span class="badge" aria-hidden="true">{row.label.charAt(0).toUpperCase()}</span>
										<span class="act-body">
											<span class="act-label">{row.label}{#if row.archived}<span class="arch">archivée</span>{/if}</span>
											<span class="act-meta">{Math.round(share * 100)} % du temps</span>
										</span>
										<svg class="spark" width={sp.w} height={sp.h} viewBox="0 0 {sp.w} {sp.h}" aria-hidden="true">
											<polygon points={sp.area} />
											<polyline points={sp.line} />
											<circle cx={sp.last[0]} cy={sp.last[1]} r="2.6" />
										</svg>
										<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6" /></svg>
									</button>
								</th>
								{#each months as m (m)}
									<td class="c-m">{@render tile(row.cells.find((c) => c.month === m)?.total ?? 0)}</td>
								{/each}
								<td class="c-tot"><b class="tot tabnum">{fmt(row.total)}</b></td>
							</tr>
							{#if open}
								{@const ps = people(row)}
								{#each ps as p, i (p.userId)}
									<tr class="r-person" class:last={i === ps.length - 1}>
										<th class="c-act" scope="row">
											<span class="person">
												<UserAvatar userId={p.userId} name={p.displayName} size={24} />
												<span class="person-name">{p.displayName}</span>
												<span class="person-pct tabnum">{row.total ? Math.round((p.total / row.total) * 100) : 0} %</span>
											</span>
										</th>
										{#each months as m (m)}
											<td class="c-m">{@render tile(p.byMonth[m] ?? 0, true)}</td>
										{/each}
										<td class="c-tot"><span class="tot-person tabnum">{fmt(p.total)}</span></td>
									</tr>
								{/each}
							{/if}
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<th class="c-act" scope="row">Total équipe</th>
							{#each months as m, i (m)}
								<td class="c-m tabnum">{fmt(monthTotals[firstIdx + i])}</td>
							{/each}
							<td class="c-tot tabnum">{fmt(grandTotal)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</section>
	{/if}
</div>

<style>
	/* ---------- KPIs (même gabarit que le dashboard) ---------- */
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.kpi {
		padding: 16px 20px;
		min-width: 0;
	}
	.kpi .k {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.kpi .v {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kpi .v small {
		font-size: 14px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
		margin-left: 4px;
	}
	.kpi .v-text {
		font-size: 24px;
		line-height: 36px;
	}
	.kpi .sub {
		font-size: 12px;
		color: var(--text-mute);
		margin-top: 4px;
	}
	.kpi .sub b {
		color: var(--text-soft);
	}
	.live {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent-ink, var(--accent));
		background: var(--accent-tint);
		padding: 2px 7px;
		border-radius: 20px;
	}

	/* ---------- Filtres ---------- */
	/* Marge franche sous les filtres : collés au tableau, ils se lisaient comme sa première ligne. */
	.filters {
		padding: 12px 14px;
		margin-bottom: 28px;
	}
	.filters-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.filters-title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
		margin-right: 4px;
	}
	.count {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-size: 11px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.fsel {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px 0 12px;
		border: 1px solid var(--border);
		border-radius: 30px;
		background: var(--surface);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.fsel:hover {
		border-color: var(--border-strong);
	}
	.fsel:focus-within {
		border-color: var(--accent);
	}
	.fsel.on {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.fsel-k {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.fsel.on .fsel-k {
		color: var(--accent-ink, var(--accent));
	}
	.fsel select {
		border: none;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		padding: 7px 6px;
		max-width: 180px;
		cursor: pointer;
		outline: none;
	}
	.reset {
		border: none;
		background: none;
		color: var(--text-mute);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		padding: 6px 8px;
		border-radius: 8px;
	}
	.reset:hover {
		color: var(--text);
		background: var(--surface-sunk);
	}
	.filters-hint {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 10px 2px 0;
		font-size: 12px;
		color: var(--text-mute);
	}

	/* ---------- Vide ---------- */
	.empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-soft);
	}
	.empty-ic {
		font-size: 28px;
		color: var(--text-mute);
		margin-bottom: 6px;
	}
	.empty p {
		margin: 0;
	}

	/* ---------- Tableau ---------- */
	.table-card {
		padding: 6px 10px 12px;
		overflow: hidden;
	}
	.table-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 14px 10px 10px;
	}
	.table-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.muted {
		margin: 3px 0 0;
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.table-tools {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.ramp {
		width: 72px;
		height: 8px;
		border-radius: 4px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--accent) 10%, var(--surface)),
			color-mix(in srgb, var(--accent) 55%, var(--surface))
		);
	}
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-soft);
		font-size: 12.5px;
		font-weight: 600;
		padding: 7px 12px;
		border-radius: 999px;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
	}
	.btn-ghost:hover {
		border-color: var(--accent);
		color: var(--accent-ink, var(--accent));
	}
	.scroll {
		overflow-x: auto;
		padding: 0 4px 4px;
	}

	/* Lignes en « cartes » : pas de quadrillage, un interligne de 6px et des bords arrondis sur la
	   première/dernière case. separate (pas collapse) : c'est aussi ce qui garde la 1re colonne
	   sticky avec son fond et ses coins. */
	.synth {
		border-collapse: separate;
		border-spacing: 0;
		width: 100%;
		font-size: 13px;
	}
	/* Interligne entre activités par une ligne vide plutôt que border-spacing : le bloc des personnes
	   doit rester accolé à son activité, ce que border-spacing (global) interdit. */
	.gap td {
		height: 8px;
		padding: 0;
	}
	.synth thead th {
		padding-bottom: 8px;
	}
	.synth th,
	.synth td {
		padding: 0 5px;
		white-space: nowrap;
	}
	.synth thead th {
		padding: 4px 5px 10px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
		text-align: center;
	}
	.synth thead .c-act {
		text-align: left;
		padding-left: 14px;
	}
	.mm {
		display: block;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
	}
	.yy {
		display: block;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--text-mute);
	}
	thead .cur .yy {
		display: inline-block;
		margin-top: 2px;
		padding: 0 7px;
		border-radius: 10px;
		background: var(--accent-tint);
		color: var(--accent-ink, var(--accent));
		font-weight: 700;
	}

	.c-act {
		position: sticky;
		left: 0;
		z-index: 2;
		min-width: 300px;
		width: 300px;
		text-align: left;
	}
	.c-m {
		min-width: 88px;
	}
	.c-tot {
		min-width: 90px;
		width: 100px;
		text-align: right;
	}

	.r-act th,
	.r-act td {
		background: var(--surface-2);
		height: 58px;
		transition: background 0.15s;
	}
	.r-act .c-act {
		border-radius: 14px 0 0 14px;
		padding-left: 10px;
	}
	.r-act .c-tot {
		border-radius: 0 14px 14px 0;
		padding-right: 14px;
	}
	.r-act:hover th,
	.r-act:hover td {
		background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
	}
	/* Ligne dépliée : ses coins du bas se ferment sur le bloc des personnes, qui la prolonge. */
	.r-act.open .c-act {
		border-radius: 14px 0 0 0;
	}
	.r-act.open .c-tot {
		border-radius: 0 14px 0 0;
	}

	.act {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.badge {
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: var(--accent-tint);
		color: var(--accent-ink, var(--accent));
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 700;
	}
	.act-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.act-label {
		font-weight: 650;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.act-meta {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.arch {
		margin-left: 6px;
		font-size: 10px;
		font-weight: 600;
		color: var(--warn);
	}
	.spark {
		flex-shrink: 0;
		overflow: visible;
	}
	.spark polygon {
		fill: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.spark polyline {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.8;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.spark circle {
		fill: var(--accent);
	}
	.chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.2s ease;
	}
	.open .chev {
		transform: rotate(180deg);
		color: var(--accent);
	}

	/* Tuiles de heatmap : une seule teinte (l'accent), intensité = volume. Lisible sans distinguer de
	   couleurs (un membre de l'équipe est daltonien) — la valeur reste écrite, la teinte hiérarchise. */
	.tile {
		display: grid;
		place-items: center;
		height: 40px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent) var(--h, 0%), var(--surface));
		color: var(--text);
		font-weight: 650;
		font-size: 13px;
	}
	.tile.sm {
		height: 30px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 600;
	}
	.empty-tile {
		background: transparent;
		border: 1px dashed var(--border);
		color: var(--text-mute);
		font-weight: 400;
	}

	.tot {
		display: block;
		text-align: right;
		font-size: 15px;
	}

	/* Détail par personne : bloc accolé sous son activité (interligne annulé), fond blanc bordé, qui
	   se referme en arrondi sur la dernière personne. */
	.r-person th,
	.r-person td {
		background: var(--surface);
		height: 40px;
		border-top: 1px solid var(--border);
	}
	.r-person th:first-child {
		border-left: 1px solid var(--border);
	}
	.r-person td:last-child {
		border-right: 1px solid var(--border);
	}
	.r-person.last th,
	.r-person.last td {
		border-bottom: 1px solid var(--border);
	}
	.r-person.last .c-act {
		border-radius: 0 0 0 14px;
	}
	.r-person.last .c-tot {
		border-radius: 0 0 14px 0;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-left: 22px;
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.person-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.person-pct {
		font-size: 11.5px;
		color: var(--text-mute);
		padding-right: 8px;
	}
	.tot-person {
		display: block;
		text-align: right;
		padding-right: 14px;
		font-weight: 600;
		color: var(--text-soft);
	}

	tfoot tr:first-child th,
	tfoot tr:first-child td {
		padding-top: 6px;
	}
	tfoot th,
	tfoot td {
		height: 46px;
		font-weight: 700;
		text-align: center;
		border-top: 2px dashed var(--border);
	}
	tfoot .c-act {
		text-align: left;
		padding-left: 14px;
		background: var(--surface);
	}
	tfoot .c-tot {
		text-align: right;
		padding-right: 14px;
		font-size: 15px;
	}

	@media (max-width: 1100px) {
		.spark {
			display: none;
		}
		.c-act {
			min-width: 230px;
			width: 230px;
		}
	}
	@media (max-width: 980px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.legend {
			display: none;
		}
	}
</style>
