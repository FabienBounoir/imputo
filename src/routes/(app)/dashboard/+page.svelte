<script lang="ts">
	let { data } = $props();
	const d = $derived(data.dashboard);

	const pct = (x: number) => Math.round(x * 100);
	// circonférence de l'anneau d'avancement (r=26)
	const C = 2 * Math.PI * 26;
	const dash = $derived(`${d.kpis.avancement * C} ${C}`);

	const maxPerson = $derived(Math.max(1, ...d.byPerson.map((p) => p.total)));
	const maxActivity = $derived(Math.max(1, ...d.byActivity.map((a) => a.total)));
	const maxState = $derived(Math.max(1, ...d.byState.map((s) => s.count)));
	const prodTotal = $derived(d.productiveVsNot.productive + d.productiveVsNot.nonProductive);
	const prodPct = $derived(prodTotal > 0 ? d.productiveVsNot.productive / prodTotal : 0);
</script>

<div class="topbar">
	<h1>Synthèse<small>Vue d'ensemble de l'espace</small></h1>
</div>

<div class="content">
	<!-- KPIs -->
	<div class="kpis">
		<div class="card kpi">
			<div class="k">Estimé total</div>
			<div class="v tabnum">{d.kpis.estTotal}<small>j</small></div>
		</div>
		<div class="card kpi">
			<div class="k">Consommé total</div>
			<div class="v tabnum">{d.kpis.consumedTotal}<small>j</small></div>
		</div>
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
		{@render groupPanel('Avancement par projet', d.byProject)}
		{@render groupPanel('Avancement par sprint', d.bySprint)}
		{#if d.byVersion.some((g) => g.name !== 'Sans version')}
			{@render groupPanel('Avancement par version', d.byVersion)}
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
</div>

<style>
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
		background: color-mix(in srgb, var(--accent) 30%, var(--text-mute));
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

	@media (max-width: 1000px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
