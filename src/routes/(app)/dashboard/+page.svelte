<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { parseISODate, toISODate, addDays, dayName, dayNum, formatRange, isPublicHolidayFR, mondayOf, isoWeek } from '$lib/utils/date';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
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
	// Répartition par activité : exclu par défaut (une catégorie non productive, ex. Congé, peut
	// être taguée avec une activité sans que rien ne l'en empêche à la saisie — sans ce filtre, son
	// temps se mélange silencieusement au travail productif du même libellé). Mémorisé en
	// localStorage (pas une préférence de compte comme sortActivitiesAlpha/etc. — cf. le motif déjà
	// utilisé pour le thème, $lib/theme.ts) : départ à `false` pour un rendu serveur cohérent, puis
	// hydraté depuis localStorage juste après le montage (le flash est ici sans conséquence, ça ne
	// change qu'un mode d'affichage sur des données déjà chargées, pas comme dashboardPrefs.ts/
	// imputationPrefs.ts qui pilotent quelles données le serveur charge — eux utilisent des cookies
	// exprès pour éviter un flash sur le mauvais jeu de données).
	const ACTIVITY_STORAGE_KEY = 'imputo-dashboard-include-nonprod-activity';
	let includeNonProductiveActivity = $state(false);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		includeNonProductiveActivity = localStorage.getItem(ACTIVITY_STORAGE_KEY) === 'true';
	});
	function setIncludeNonProductiveActivity(v: boolean) {
		includeNonProductiveActivity = v;
		if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVITY_STORAGE_KEY, String(v));
	}
	const activityRows = $derived(
		d.byActivity
			.map((a) => ({
				label: a.label,
				productive: a.productive,
				nonProductive: a.nonProductive,
				value: includeNonProductiveActivity ? a.total : a.productive
			}))
			.filter((a) => a.value > 0)
			.sort((a, b) => b.value - a.value)
	);
	const maxActivity = $derived(Math.max(1, ...activityRows.map((a) => a.value)));
	const maxState = $derived(Math.max(1, ...d.byState.map((s) => s.count)));
	const prodTotal = $derived(d.productiveVsNot.productive + d.productiveVsNot.nonProductive);
	const prodPct = $derived(prodTotal > 0 ? d.productiveVsNot.productive / prodTotal : 0);

	// Synthèse hebdo par personne : pivot (semaine × personne). Colonnes = toutes les semaines de la
	// période (même sans aucune saisie), pas seulement celles qui ont des lignes côté serveur —
	// sinon une semaine à zéro imputation disparaît silencieusement du tableau.
	const weekCols = $derived.by(() => {
		const cols: [string, number][] = [];
		const from = parseISODate(data.weekRange.from);
		const last = mondayOf(parseISODate(data.weekRange.to));
		for (let m = mondayOf(from); m <= last; m = addDays(m, 7)) {
			// Ignore la semaine si son vendredi (dernier jour ouvré affiché) tombe avant le début de la
			// période — arrive quand le 1er du mois tombe un week-end : mondayOf() remonte alors sur la
			// semaine précédente, dont les 5 jours ouvrés (lun-ven) sont tous hors période.
			if (addDays(m, 4) < from) continue;
			cols.push([toISODate(m), isoWeek(m)]);
		}
		return cols;
	});
	const weeklyPersons = $derived([...new Set(data.weeklySynthesis.map((r) => r.name))].sort((a, b) => a.localeCompare(b)));
	const weeklyUserIdByName = $derived.by(() => {
		const m = new Map<string, string>();
		for (const r of data.weeklySynthesis) m.set(r.name, r.userId);
		return m;
	});
	const weeklyCell = $derived.by(() => {
		const m = new Map<string, (typeof data.weeklySynthesis)[number]>();
		for (const r of data.weeklySynthesis) m.set(`${r.name}:${r.mondayISO}`, r);
		return m;
	});
	const pctInt = (x: number) => Math.round(x * 100);

	// Détail par SSP (mensuel) : même motif que la synthèse hebdo ci-dessus — le serveur renvoie des
	// lignes plates (personne × ssp), le tableau croisé (lignes/colonnes/cellules/totaux) se
	// construit ici. Pas de ré-arrondi client, même choix que prodTotal plus haut dans ce fichier.
	const sspCell = $derived(new Map(d.bySsp.map((r) => [`${r.personName}:${r.ssp}`, r.total])));
	const sspPersonTotal = $derived.by(() => {
		const m = new Map<string, number>();
		for (const r of d.bySsp) m.set(r.personName, (m.get(r.personName) ?? 0) + r.total);
		return m;
	});
	const sspColTotal = $derived.by(() => {
		const m = new Map<string, number>();
		for (const r of d.bySsp) m.set(r.ssp, (m.get(r.ssp) ?? 0) + r.total);
		return m;
	});
	const sspPersons = $derived([...sspPersonTotal.keys()].sort((a, b) => (sspPersonTotal.get(b) ?? 0) - (sspPersonTotal.get(a) ?? 0)));
	const sspCols = $derived([...sspColTotal.keys()].sort((a, b) => (sspColTotal.get(b) ?? 0) - (sspColTotal.get(a) ?? 0)));
	const sspGrandTotal = $derived([...sspColTotal.values()].reduce((a, b) => a + b, 0));

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
	{#if navigating.to}<span class="loading-hint">Chargement…</span>{/if}
	<select
		class="periodsel"
		value={data.scope}
		disabled={!!navigating.to}
		onchange={(e) => goto(`?month=${e.currentTarget.value}`, { keepFocus: true })}
		aria-label="Période des statistiques"
	>
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
		{:else}
			<!-- TNF/Produit (mois) : cartes vides pour l'instant, le calcul mensuel reste à définir
			     (contrairement à enveloppeTotale/TNF déjà suivi par ticket, jamais borné à une période). -->
			<div class="card kpi">
				<div class="k">TNF (mois)</div>
				<div class="v tabnum">—</div>
				<div class="sub">Calcul à définir</div>
			</div>
			<div class="card kpi">
				<div class="k">Produit (mois)</div>
				<div class="v tabnum">—</div>
				<div class="sub">Calcul à définir</div>
			</div>
			<!-- Productif vs non productif : déplacé ici depuis .grid (même contenu, juste un autre
			     conteneur parent) pour rejoindre la ligne de KPIs mensuels. -->
			<div class="card kpi panel">
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

			<!-- Productif vs non productif : mode "Tout l'espace" seul — en mode mensuel cette même carte
			     vit désormais dans .kpis (cf. plus haut), pas ici. -->
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
		{/if}

		<!-- Par activité -->
		<div class="card panel">
			<div class="weekly-head">
				<h3>Répartition par activité</h3>
				<div class="seg2">
					<button type="button" class:on={!includeNonProductiveActivity} onclick={() => setIncludeNonProductiveActivity(false)}>Productif seul</button>
					<button type="button" class:on={includeNonProductiveActivity} onclick={() => setIncludeNonProductiveActivity(true)}>Tout inclure</button>
				</div>
			</div>
			{#if activityRows.length === 0}
				<p class="empty">Aucune imputation.</p>
			{:else}
				<div class="barlist">
					{#each activityRows as a (a.label)}
						<div class="barrow">
							<span class="lbl">{a.label}</span>
							{#if includeNonProductiveActivity}
								<div class="track stacked">
									<i class="prod" style="width:{(a.productive / maxActivity) * 100}%"></i>
									<i class="nonprod" style="width:{(a.nonProductive / maxActivity) * 100}%"></i>
								</div>
							{:else}
								<div class="track"><i style="width:{(a.value / maxActivity) * 100}%"></i></div>
							{/if}
							<span class="val tabnum">{a.value}</span>
						</div>
					{/each}
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
							<Tooltip text="{p.productive} j productif · {p.nonProductive} j non productif">
								<div class="track stacked">
									<i class="prod" style="width:{(p.productive / maxPerson) * 100}%"></i>
									<i class="nonprod" style="width:{(p.nonProductive / maxPerson) * 100}%"></i>
								</div>
							</Tooltip>
							<span class="val tabnum">{p.total}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Synthèse hebdo par personne (% de capacité, validation d'imputation) : snippet pour pouvoir
	     la rendre soit seule pleine-largeur (Tout l'espace, inchangé), soit à côté du détail par SSP
	     (mensuel) sans dupliquer ~70 lignes de tableau. -->
	{#snippet weeklySynthCard()}
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
									<td class="weekly-name"><UserAvatar userId={weeklyUserIdByName.get(name)} name={name} size={20} />{name}</td>
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
									<td class="weekly-name"><UserAvatar userId={weeklyUserIdByName.get(name)} name={name} size={20} />{name}</td>
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
	{/snippet}

	{@render weeklySynthCard()}

	{#if !isAll && data.isAdmin}
		<!-- Détail par SSP : toujours sur sa propre ligne pleine largeur (jamais à côté de la
		     synthèse hebdo) — le nombre de codes SSP rencontrés dans un espace n'est pas borné,
		     la partager avec une autre carte finit immanquablement par déborder. Réservé à un rôle
		     ADMIN — budget/financier, pas une info de suivi d'équipe. -->
		<div class="card panel ssp-detail">
			<h3>Détail par SSP</h3>
			{#if sspPersons.length === 0}
				<p class="empty">Aucune imputation sur ticket avec code SSP ce mois-ci.</p>
			{:else}
				<div class="weekly-table-wrap">
					<table class="weekly-table">
						<thead>
							<tr>
								<th>Personne</th>
								{#each sspCols as ssp (ssp)}<th class="num">{ssp}</th>{/each}
								<th class="num">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each sspPersons as name (name)}
								<tr>
									<td class="weekly-name"><UserAvatar userId={weeklyUserIdByName.get(name)} name={name} size={20} />{name}</td>
									{#each sspCols as ssp (ssp)}
										<td class="num tabnum">{sspCell.get(`${name}:${ssp}`) || '·'}</td>
									{/each}
									<td class="num tabnum"><b>{sspPersonTotal.get(name)}</b></td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td>Total</td>
								{#each sspCols as ssp (ssp)}<td class="num tabnum"><b>{sspColTotal.get(ssp)}</b></td>{/each}
								<td class="num tabnum"><b>{sspGrandTotal}</b></td>
							</tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</div>
	{/if}
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
	.periodsel:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.loading-hint {
		font-size: 12px;
		color: var(--text-mute);
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
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
	}
	.ssp-detail {
		margin-top: 20px;
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
	.barrow :global(.tt-wrap) {
		width: 100%;
	}
	.barrow .lbl {
		font-size: 13px;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.track {
		width: 100%;
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
	.weekly-table td.weekly-name {
		display: flex;
		align-items: center;
		gap: 8px;
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
