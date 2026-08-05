<script lang="ts">
	import { goto } from '$app/navigation';
	import { parseISODate, toISODate, addDays, dayName, dayNum, formatRange, isPublicHolidayFR } from '$lib/utils/date';
	let { data } = $props();

	// Synthèse hebdo : bascule % de capacité (vue compacte) / détail jour par jour (5 jours ouvrés).
	let weeklyMode = $state<'pct' | 'daily'>('pct');
	const d = $derived(data.dashboard);
	const isAll = $derived(data.scope === 'all');

	const pct = (x: number) => Math.round(x * 100);
	// circonférence de l'anneau d'avancement (r=26)
	const C = 2 * Math.PI * 26;
	const dash = $derived(`${d.kpis.avancement * C} ${C}`);

	const maxPerson = $derived(Math.max(1, ...d.byPerson.map((p) => p.total)));
	const maxActivity = $derived(Math.max(1, ...d.byActivity.map((a) => a.total)));
	const maxState = $derived(Math.max(1, ...d.byState.map((s) => s.count)));
	const prodTotal = $derived(d.productiveVsNot.productive + d.productiveVsNot.nonProductive);
	const prodPct = $derived(prodTotal > 0 ? d.productiveVsNot.productive / prodTotal : 0);

	// Synthèse hebdo par personne : pivot (semaine × personne) depuis la liste plate du serveur.
	const weekCols = $derived(
		[...new Map(data.weeklySynthesis.map((r) => [r.mondayISO, r.isoWeek])).entries()].sort((a, b) => a[0].localeCompare(b[0]))
	);
	const weeklyPersons = $derived([...new Set(data.weeklySynthesis.map((r) => r.name))].sort((a, b) => a.localeCompare(b)));
	const weeklyCell = $derived.by(() => {
		const m = new Map<string, (typeof data.weeklySynthesis)[number]>();
		for (const r of data.weeklySynthesis) m.set(`${r.name}:${r.mondayISO}`, r);
		return m;
	});
	const pctInt = (x: number) => Math.round(x * 100);

	// Tooltip sur les en-têtes "S27" (etc) : premier → dernier jour de la semaine.
	const weekRangeLabel = (mondayISO: string) => formatRange(parseISODate(mondayISO));
	// Vue détaillée : les 5 jours ouvrés (lun→ven) de chaque semaine, pour l'en-tête et les cellules.
	const weekdays = (mondayISO: string) => {
		const m = parseISODate(mondayISO);
		return Array.from({ length: 5 }, (_, i) => toISODate(addDays(m, i)));
	};
	const dayHead = (iso: string) => `${dayName(parseISODate(iso))} ${dayNum(parseISODate(iso))}`;
</script>

<div class="topbar">
	<h1>Synthèse<small>{isAll ? "Vue d'ensemble de l'espace" : 'Imputations du mois'}</small></h1>
	<div class="spacer"></div>
	<select class="periodsel" value={data.scope} onchange={(e) => goto(`?month=${e.currentTarget.value}`, { keepFocus: true })} aria-label="Période des statistiques">
		{#each data.months as m (m.value)}
			<option value={m.value}>{m.label}</option>
		{/each}
		<option value="all">Tout l'espace</option>
	</select>
</div>

<div class="content">
	<!-- KPIs -->
	<div class="kpis">
		{#if isAll}
			<div class="card kpi">
				<div class="k">Estimé total</div>
				<div class="v tabnum">{d.kpis.estTotal}<small>j</small></div>
			</div>
		{/if}
		<div class="card kpi">
			<div class="k">Consommé{isAll ? ' total' : ' (mois)'}</div>
			<div class="v tabnum">{d.kpis.consumedTotal}<small>j</small></div>
		</div>
		{#if isAll}
			<div class="card kpi">
				<div class="k">RAE global</div>
				<div class="v tabnum">{d.kpis.raeTotal}<small>j</small></div>
			</div>
			<div class="card kpi ring-card">
				<div>
					<div class="k">Avancement global</div>
					<div class="v tabnum">{pct(d.kpis.avancement)}<small>%</small></div>
					<div class="sub">{d.kpis.ticketCount} tickets</div>
				</div>
				<svg viewBox="0 0 64 64" class="ring">
					<circle cx="32" cy="32" r="26" fill="none" stroke="var(--surface-sunk)" stroke-width="8" />
					<circle cx="32" cy="32" r="26" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray={dash} transform="rotate(-90 32 32)" />
				</svg>
			</div>
		{/if}
	</div>

	{#snippet groupPanel(title: string, groups: typeof d.byProject)}
		<div class="card panel">
			<h3>{title}</h3>
			{#if groups.length === 0}
				<p class="empty">Aucun ticket.</p>
			{:else}
				<div class="grouplist">
					{#each groups as g (g.name)}
						<div class="grouprow">
							<div class="grouphead">
								<span class="lbl" title={g.name}>{g.name}</span>
								<span class="pctbadge tabnum">{pct(g.avancement)}%</span>
							</div>
							<div class="track">
								<i class:over={g.est > 0 && g.consumed > g.est} style="width:{g.est > 0 ? Math.min(100, (g.consumed / g.est) * 100) : 0}%"></i>
							</div>
							<div class="groupmeta">
								<span class="tabnum">{g.consumed}</span> / <span class="tabnum">{g.est}</span> j consommé
								· RAE <span class="tabnum">{g.rae}</span> j
								· {g.ticketCount} ticket{g.ticketCount > 1 ? 's' : ''}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}

	<div class="grid">
		{#if isAll}
			{@render groupPanel('Avancement par projet', d.byProject)}
			{@render groupPanel('Avancement par sprint', d.bySprint)}
			{#if d.byVersion.some((g) => g.name !== 'Sans version')}
				{@render groupPanel('Avancement par version', d.byVersion)}
			{/if}
			{#if d.byGroup.length > 0}
				{@render groupPanel('Avancement par groupe de tickets', d.byGroup)}
			{/if}

			<!-- Répartition par état -->
			<div class="card panel">
				<h3>Tickets par état</h3>
				{#if d.byState.length === 0}
					<p class="empty">Aucun ticket.</p>
				{:else}
					<div class="barlist">
						{#each d.byState as s (s.label)}
							<div class="barrow">
								<span class="lbl"><span>{s.emoji ?? ''}</span> {s.label}</span>
								<div class="track"><i style="width:{(s.count / maxState) * 100}%;background:{s.color ?? 'var(--accent)'}"></i></div>
								<span class="val tabnum">{s.count}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Productif vs non productif -->
		<div class="card panel">
			<h3>Productif vs non productif</h3>
			{#if prodTotal === 0}
				<p class="empty">Aucune imputation.</p>
			{:else}
				<div class="split">
					<div class="split-bar">
						<div class="prod" style="width:{prodPct * 100}%"></div>
						<div class="nonprod" style="width:{(1 - prodPct) * 100}%"></div>
					</div>
					<div class="split-legend">
						<span><i class="dot prod"></i> Productif <b class="tabnum">{d.productiveVsNot.productive} j</b></span>
						<span><i class="dot nonprod"></i> Non productif <b class="tabnum">{d.productiveVsNot.nonProductive} j</b></span>
					</div>
				</div>
			{/if}
		</div>

		<!-- Charge par personne -->
		<div class="card panel">
			<h3>Charge par personne</h3>
			{#if d.byPerson.length === 0}
				<p class="empty">Aucune imputation.</p>
			{:else}
				<div class="barlist">
					{#each d.byPerson as p (p.name)}
						<div class="barrow">
							<span class="lbl">{p.name}</span>
							<div class="track stacked">
								<i class="prod" style="width:{(p.productive / maxPerson) * 100}%"></i>
								<i class="nonprod" style="width:{(p.nonProductive / maxPerson) * 100}%"></i>
							</div>
							<span class="val tabnum">{p.total}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Par activité -->
		<div class="card panel">
			<h3>Répartition par activité</h3>
			{#if d.byActivity.length === 0}
				<p class="empty">Aucune imputation.</p>
			{:else}
				<div class="barlist">
					{#each d.byActivity as a (a.label)}
						<div class="barrow">
							<span class="lbl">{a.label}</span>
							<div class="track"><i style="width:{(a.total / maxActivity) * 100}%"></i></div>
							<span class="val tabnum">{a.total}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Synthèse hebdo par personne (% de capacité, validation d'imputation) -->
	<div class="card panel weekly-synth">
		<div class="weekly-head">
			<h3>Synthèse hebdo par personne</h3>
			<div class="seg2">
				<button type="button" class:on={weeklyMode === 'pct'} onclick={() => (weeklyMode = 'pct')}>% de capacité</button>
				<button type="button" class:on={weeklyMode === 'daily'} onclick={() => (weeklyMode = 'daily')}>Détail par jour</button>
			</div>
		</div>
		{#if weeklyPersons.length === 0}
			<p class="empty">Aucune imputation sur la période.</p>
		{:else if weeklyMode === 'pct'}
			<div class="weekly-table-wrap">
				<table class="weekly-table">
					<thead>
						<tr>
							<th>Personne</th>
							{#each weekCols as [monday, week] (monday)}<th class="num" title={weekRangeLabel(monday)}>S{week}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each weeklyPersons as name (name)}
							<tr>
								<td>{name}</td>
								{#each weekCols as [monday] (monday)}
									{@const cell = weeklyCell.get(`${name}:${monday}`)}
									<td class="num tabnum" class:over={cell?.overCapacity}>
										{#if cell}{pctInt(cell.pct)}%{:else}·{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="weekly-table-wrap">
				<table class="weekly-table weekly-daily">
					<thead>
						<tr>
							<th rowspan="2">Personne</th>
							{#each weekCols as [monday, week] (monday)}
								<th colspan="5" class="week-sep" title={weekRangeLabel(monday)}>S{week}</th>
							{/each}
						</tr>
						<tr>
							{#each weekCols as [monday] (monday)}
								{#each weekdays(monday) as iso (iso)}
									<th class="num day-col" class:holiday={isPublicHolidayFR(iso)} title={isPublicHolidayFR(iso) ? 'Jour férié' : ''}>{dayHead(iso)}</th>
								{/each}
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each weeklyPersons as name (name)}
							<tr>
								<td>{name}</td>
								{#each weekCols as [monday] (monday)}
									{@const cell = weeklyCell.get(`${name}:${monday}`)}
									{#each weekdays(monday) as iso (iso)}
										{@const v = cell?.days[iso] ?? 0}
										<td class="num tabnum day-col" class:over={cell && v > cell.capacityPerDay}>
											{v || '·'}
										</td>
									{/each}
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.periodsel {
		appearance: none;
		padding: 9px 34px 9px 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
		font-weight: 500;
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		/* chevron */
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.periodsel:hover {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
	}
	.periodsel:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}

	.kpis {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
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
		font-size: 32px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}
	.kpi .v small {
		font-size: 15px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
		margin-left: 3px;
	}
	.ring-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.ring-card .sub {
		font-size: 12px;
		color: var(--text-mute);
		margin-top: 4px;
	}
	.ring {
		width: 70px;
		height: 70px;
		flex-shrink: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.panel {
		padding: 20px 22px;
	}
	.panel h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 16px;
	}
	.empty {
		color: var(--text-mute);
		font-size: 13px;
	}

	.barlist {
		display: flex;
		flex-direction: column;
		gap: 11px;
	}
	.barrow {
		display: grid;
		grid-template-columns: 160px 1fr 42px;
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
		display: flex;
	}
	.track i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: var(--accent);
		min-width: 2px;
	}
	.track.stacked i {
		border-radius: 0;
	}
	.track.stacked i:first-child {
		border-radius: 20px 0 0 20px;
	}
	.barrow .val {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-soft);
		text-align: right;
	}

	.grouplist {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.grouprow {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.grouphead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.grouphead .lbl {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pctbadge {
		font-size: 13px;
		font-weight: 700;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 1px 8px;
		border-radius: 20px;
		flex-shrink: 0;
	}
	.track i.over {
		background: color-mix(in srgb, var(--warn, #e11d48) 75%, var(--accent));
	}
	.groupmeta {
		font-size: 12px;
		color: var(--text-mute);
	}

	.split-bar {
		display: flex;
		height: 16px;
		border-radius: 20px;
		overflow: hidden;
		background: var(--surface-sunk);
		margin-bottom: 14px;
	}
	.split-bar .prod,
	.dot.prod,
	.track .prod {
		background: var(--accent);
	}
	.split-bar .nonprod,
	.dot.nonprod,
	.track .nonprod {
		background: color-mix(in srgb, var(--accent) 5%, var(--text-mute));
	}
	.split-legend {
		display: flex;
		gap: 24px;
		font-size: 13px;
		color: var(--text-soft);
	}
	.split-legend b {
		margin-left: 5px;
	}
	.dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		margin-right: 4px;
	}

	.weekly-synth {
		margin-top: 20px;
	}
	.weekly-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-bottom: 16px;
	}
	.weekly-head h3 {
		margin-bottom: 0;
	}
	.seg2 {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		flex-shrink: 0;
	}
	.seg2 button {
		padding: 6px 14px;
		border-radius: 30px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		transition: background 0.15s, color 0.15s;
	}
	.seg2 button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.weekly-table-wrap {
		overflow-x: auto;
	}
	.weekly-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.weekly-table th,
	.weekly-table td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	.weekly-table th.num,
	.weekly-table td.num {
		text-align: right;
	}
	.weekly-table td.over {
		color: #c0392b;
		font-weight: 700;
	}
	.weekly-daily th.week-sep {
		text-align: center;
		border-left: 1px solid var(--border-strong);
		cursor: default;
	}
	.weekly-daily th.day-col {
		font-size: 11px;
		color: var(--text-mute);
		font-weight: 500;
	}
	.weekly-daily td.day-col,
	.weekly-daily th.day-col {
		padding: 6px 9px;
	}
	.weekly-daily th.day-col.holiday {
		color: var(--danger, #c0392b);
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
