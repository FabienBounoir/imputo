<script lang="ts">
	import { goto } from '$app/navigation';

	function round2(n: number) {
		return Math.round((n + Number.EPSILON) * 100) / 100;
	}

	type SprintDashboard = {
		sprintId: string;
		sprintName: string;
		kind: 'SPRINT' | 'VERSION';
		kpis: {
			estTotal: number;
			consumedTotal: number;
			raeTotal: number;
			avancement: number;
			ecartExecutionTotal: number;
			/** Admin only — null pour un USER standard. */
			tnfBudgetTotal: number | null;
			ticketCount: number;
		};
		byActivity: { label: string; raeReal: number; raeTest: number }[];
		byPerson: { name: string; consumed: number }[];
		history: { date: string; consumed: number; rae: number }[];
		tickets: {
			id: string;
			key: string;
			title: string;
			stateLabel: string | null;
			stateEmoji: string | null;
			stateColor: string | null;
			estTotal: number;
			raeTotal: number;
			consumed: number;
			ecartExecution: number;
			avancement: number;
		}[];
	};

	let {
		title,
		baseHref,
		options,
		selectedId,
		dashboard,
		emptyLabel
	}: {
		title: string;
		baseHref: string;
		options: { id: string; name: string }[];
		selectedId: string | null;
		dashboard: SprintDashboard | null;
		emptyLabel: string;
	} = $props();

	const pct = (x: number) => Math.round(x * 100);
	const maxActivity = $derived(Math.max(1, ...(dashboard?.byActivity.map((a) => a.raeReal + a.raeTest) ?? [1])));
	const maxPerson = $derived(Math.max(1, ...(dashboard?.byPerson.map((p) => p.consumed) ?? [1])));

	// Courbe conso/RAE : petit line chart SVG, 2 séries à couleur fixe (identité, pas de rang).
	// Grille Y graduée + aire remplie + axe X à dates régulières, pour que le graphe garde du
	// "corps" même avec peu de points (retour utilisateur : "juste des points sans rien").
	const CHART_W = 600;
	const CHART_H = 180;
	const PAD_T = 10;
	const PAD_B = 22;
	const PAD_L = 34;
	const PAD_R = 10;

	/** Pas "rond" (1/2/5 × 10^n) pour ~`targetCount` graduations entre 0 et maxVal. */
	function niceStep(maxVal: number, targetCount = 4): number {
		if (maxVal <= 0) return 1;
		const raw = maxVal / targetCount;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
		return mult * mag;
	}
	function fmtShortDate(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	const points = $derived.by(() => {
		const h = dashboard?.history ?? [];
		if (h.length === 0) return null;
		const rawMax = Math.max(1, ...h.map((p) => Math.max(p.consumed, p.rae)));
		const step = niceStep(rawMax);
		const topVal = Math.ceil(rawMax / step) * step;

		const innerW = CHART_W - PAD_L - PAD_R;
		const innerH = CHART_H - PAD_T - PAD_B;
		const stepX = h.length > 1 ? innerW / (h.length - 1) : 0;
		const x = (i: number) => PAD_L + i * stepX;
		const y = (v: number) => PAD_T + innerH - (v / topVal) * innerH;
		const baseline = PAD_T + innerH;

		const consumedPath = h.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.consumed)}`).join(' ');
		const raePath = h.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.rae)}`).join(' ');
		// Aire remplie : referme la ligne sur la baseline. Rien à fermer à 0-1 point (pas de ligne).
		const area = (path: string) => (h.length > 1 ? `${path} L ${x(h.length - 1)} ${baseline} L ${x(0)} ${baseline} Z` : null);

		const yTicks: { v: number; y: number }[] = [];
		for (let v = 0; v <= topVal + step * 0.001; v += step) yTicks.push({ v: round2(v), y: y(v) });

		// ~5 ticks X répartis uniformément sur les index (jamais plus que de points).
		const n = Math.min(5, h.length);
		const idx = n <= 1 ? [0] : [...new Set(Array.from({ length: n }, (_, k) => Math.round((k * (h.length - 1)) / (n - 1))))];
		const xTicks = idx.map((i, k) => ({
			x: x(i),
			label: fmtShortDate(h[i].date),
			anchor: k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle'
		}));

		return {
			consumedPath,
			raePath,
			consumedArea: area(consumedPath),
			raeArea: area(raePath),
			dots: h.map((p, i) => ({ x: x(i), yc: y(p.consumed), yr: y(p.rae), date: p.date, consumed: p.consumed, rae: p.rae })),
			yTicks,
			xTicks
		};
	});
</script>

<div class="topbar">
	<h1>{title}{#if dashboard}<small>{dashboard.sprintName}</small>{/if}</h1>
	<div class="spacer"></div>
	{#if options.length > 0}
		<select
			class="periodsel"
			value={selectedId}
			onchange={(e) => goto(`${baseHref}?id=${e.currentTarget.value}`, { keepFocus: true })}
			aria-label="Sélectionner"
		>
			{#each options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
		</select>
	{/if}
</div>

<div class="content">
	{#if !dashboard}
		<p class="empty">{emptyLabel}</p>
	{:else}
		<div class="kpis">
			<div class="card kpi">
				<div class="k">Avancement</div>
				<div class="v tabnum">{pct(dashboard.kpis.avancement)}<small>%</small></div>
				<div class="sub">{dashboard.kpis.ticketCount} tickets</div>
			</div>
			<div class="card kpi">
				<div class="k">Estimé / Consommé</div>
				<div class="v tabnum">{dashboard.kpis.estTotal}<small>/ {dashboard.kpis.consumedTotal} j</small></div>
			</div>
			<div class="card kpi">
				<div class="k">RAE global</div>
				<div class="v tabnum">{dashboard.kpis.raeTotal}<small>j</small></div>
			</div>
			<div class="card kpi" class:warn={dashboard.kpis.ecartExecutionTotal > 0}>
				<div class="k">Écart d'exécution</div>
				<div class="v tabnum">{dashboard.kpis.ecartExecutionTotal > 0 ? '+' : ''}{dashboard.kpis.ecartExecutionTotal}<small>j</small></div>
			</div>
			{#if dashboard.kpis.tnfBudgetTotal !== null}
				<div class="card kpi" class:warn={dashboard.kpis.tnfBudgetTotal < 0}>
					<div class="k">TNF budget</div>
					<div class="v tabnum">{dashboard.kpis.tnfBudgetTotal}<small>j</small></div>
				</div>
			{/if}
		</div>

		<div class="card panel">
			<h3>Évolution conso / RAE</h3>
			{#if !points}
				<p class="empty">Pas encore d'historique — alimenté par le snapshot quotidien.</p>
			{:else}
				<svg viewBox="0 0 {CHART_W} {CHART_H}" class="history-chart" role="img" aria-label="Courbe consommé et RAE dans le temps">
					{#each points.yTicks as t (t.v)}
						<line x1={PAD_L} y1={t.y} x2={CHART_W - PAD_R} y2={t.y} class="grid-line" />
						<text x={PAD_L - 6} y={t.y} text-anchor="end" dominant-baseline="middle" class="axis-label">{t.v}</text>
					{/each}
					{#if points.consumedArea}<path d={points.consumedArea} class="area area-consumed" />{/if}
					{#if points.raeArea}<path d={points.raeArea} class="area area-rae" />{/if}
					<path d={points.consumedPath} fill="none" stroke="var(--accent)" stroke-width="2" />
					<path d={points.raePath} fill="none" stroke="color-mix(in srgb, var(--accent) 30%, var(--text-mute))" stroke-width="2" />
					{#each points.dots as d (d.date)}
						<circle cx={d.x} cy={d.yc} r="3" fill="var(--accent)"><title>{d.date} — Consommé {d.consumed} j</title></circle>
						<circle cx={d.x} cy={d.yr} r="3" fill="color-mix(in srgb, var(--accent) 30%, var(--text-mute))"><title>{d.date} — RAE {d.rae} j</title></circle>
					{/each}
					{#each points.xTicks as t (t.x)}
						<text x={t.x} y={CHART_H - 6} text-anchor={t.anchor} class="axis-label">{t.label}</text>
					{/each}
				</svg>
				<div class="chart-axis">
					<span class="chart-legend"><i class="dot prod"></i> Consommé <i class="dot nonprod"></i> RAE</span>
				</div>
			{/if}
		</div>

		<div class="grid">
			<div class="card panel">
				<h3>RAE par activité</h3>
				{#if dashboard.byActivity.length === 0}
					<p class="empty">Aucune donnée.</p>
				{:else}
					<div class="rae-activity-wrap">
						<div class="barlist">
							{#each dashboard.byActivity as a (a.label)}
								<div class="barrow">
									<span class="lbl">{a.label}</span>
									<div class="track"><i style="width:{((a.raeReal + a.raeTest) / maxActivity) * 100}%"></i></div>
									<span class="val tabnum">{round2(a.raeReal + a.raeTest)}</span>
								</div>
							{/each}
						</div>
						{#if dashboard.kpis.raeTotal === 0}
							<div class="rae-zero-overlay">
								<p>Rien à engager — le RAE de ce sprint est à zéro.</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="card panel">
				<h3>Répartition par personne</h3>
				{#if dashboard.byPerson.length === 0}
					<p class="empty">Aucune imputation.</p>
				{:else}
					<div class="barlist">
						{#each dashboard.byPerson as p (p.name)}
							<div class="barrow">
								<span class="lbl">{p.name}</span>
								<div class="track"><i style="width:{(p.consumed / maxPerson) * 100}%"></i></div>
								<span class="val tabnum">{p.consumed}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="card panel tickets-panel">
			<h3>{dashboard.kind === 'VERSION' ? 'Tickets de la version' : 'Tickets du sprint'}</h3>
			{#if dashboard.tickets.length === 0}
				<p class="empty">Aucun ticket.</p>
			{:else}
				<div class="us-table-wrap">
					<table class="us-table">
						<thead>
							<tr>
								<th>État</th><th>Ticket</th>
								<th class="num">Estimé</th><th class="num">RAE</th><th class="num">Consommé</th>
								<th class="num">Écart d'exéc.</th><th class="num">Avancement</th>
							</tr>
						</thead>
						<tbody>
							{#each dashboard.tickets as t (t.id)}
								<tr
									class="us-row"
									tabindex="0"
									role="link"
									onclick={() => goto(`/tickets?ticket=${encodeURIComponent(t.key)}`)}
									onkeydown={(e) => {
										if (e.key === 'Enter') goto(`/tickets?ticket=${encodeURIComponent(t.key)}`);
									}}
								>
									<td>
										<span
											class="state-pill"
											style={t.stateColor ? `background:color-mix(in srgb, ${t.stateColor} 18%, transparent); color:${t.stateColor};` : ''}
										>{t.stateEmoji ?? ''} {t.stateLabel ?? '—'}</span>
									</td>
									<td class="ttl">
										<span class="key tabnum">{t.key}</span>
										<span class="title">{t.title}</span>
									</td>
									<td class="num tabnum">{t.estTotal}</td>
									<td class="num tabnum">{t.raeTotal}</td>
									<td class="num tabnum">{t.consumed || '—'}</td>
									<td class="num tabnum" class:over={t.ecartExecution > 0}>{t.ecartExecution > 0 ? '+' : ''}{t.ecartExecution || 0}</td>
									<td>
										<div class="prog">
											<div class="bar"><i style="width:{pct(t.avancement)}%"></i></div>
											<span class="pct tabnum">{pct(t.avancement)}%</span>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 18px;
	}
	.topbar h1 {
		display: flex;
		flex-direction: column;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		margin: 0;
	}
	.topbar h1 small {
		font-family: var(--font-ui);
		font-size: 13px;
		font-weight: 500;
		color: var(--text-mute);
	}
	.spacer {
		flex: 1;
	}
	.periodsel {
		appearance: none;
		padding: 9px 34px 9px 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.empty {
		color: var(--text-mute);
		font-size: 13px;
	}
	/* RAE par activité à 0 partout : la barlist reste dessous, ce message flotte par-dessus et
	   s'efface au survol pour la laisser consultable plutôt que la cacher. */
	.rae-activity-wrap {
		position: relative;
	}
	.rae-zero-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 12px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(2px);
		border-radius: var(--r-md);
		transition: opacity 0.15s ease;
	}
	.rae-zero-overlay p {
		color: var(--text-mute);
		font-size: 13px;
		margin: 0;
	}
	.rae-activity-wrap:hover .rae-zero-overlay {
		opacity: 0;
		pointer-events: none;
	}
	.kpis {
		display: grid;
		/* auto-fit et non repeat(5) : la carte TNF budget est masquée hors ADMIN/MANAGER, une
		   grille figée à 5 colonnes laisserait alors un trou. */
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
		margin-bottom: 18px;
	}
	.kpi {
		padding: 16px 18px;
	}
	.kpi.warn {
		border-color: #c0392b;
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
	.kpi .v small {
		font-size: 13px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
	}
	.kpi .sub {
		margin-top: 2px;
		font-size: 12px;
		color: var(--text-mute);
	}
	.panel {
		padding: 18px 20px;
	}
	.panel h3 {
		margin: 0 0 14px;
		font-size: 14px;
		font-weight: 700;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}
	.history-chart {
		width: 100%;
		height: 180px;
	}
	.grid-line {
		stroke: var(--border);
		stroke-width: 1;
	}
	.axis-label {
		font-size: 9px;
		fill: var(--text-mute);
	}
	.area-consumed {
		fill: var(--accent);
		opacity: 0.12;
	}
	.area-rae {
		fill: color-mix(in srgb, var(--accent) 30%, var(--text-mute));
		opacity: 0.12;
	}
	.chart-axis {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 6px;
		font-size: 11px;
		color: var(--text-mute);
	}
	.chart-legend {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.dot.prod {
		background: var(--accent);
	}
	.dot.nonprod {
		background: color-mix(in srgb, var(--accent) 30%, var(--text-mute));
		margin-left: 8px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.barrow {
		display: grid;
		grid-template-columns: 110px 1fr 50px;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-soft);
	}
	.track {
		height: 8px;
		border-radius: 4px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 4px;
	}
	.val {
		text-align: right;
		font-weight: 600;
	}

	.tickets-panel {
		margin-top: 16px;
	}
	.us-table-wrap {
		overflow-x: auto;
	}
	.us-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.us-table th {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-mute);
		padding: 8px 10px;
		text-align: left;
		white-space: nowrap;
	}
	.us-table th.num,
	.us-table td.num {
		text-align: right;
	}
	.us-table td {
		padding: 8px 10px;
		border-top: 1px solid var(--border);
		vertical-align: middle;
	}
	.us-row {
		cursor: pointer;
	}
	.us-row:hover {
		background: var(--surface-2);
	}
	.us-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.us-table .ttl {
		display: flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	.us-table .key {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.us-table .title {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.state-pill {
		display: inline-block;
		padding: 3px 9px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.us-table td.over {
		color: var(--warn);
		font-weight: 700;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: flex-end;
	}
	.prog .bar {
		width: 60px;
		height: 6px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.prog .bar i {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 20px;
	}
	.prog .pct {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 32px;
		text-align: right;
	}

	@media (max-width: 1000px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
