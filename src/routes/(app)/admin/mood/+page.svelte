<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const EMOJI: Record<number, string> = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };
	// Palette fixe rouge → orange → jaune → vert clair → vert : seulement 5 valeurs possibles (1..5),
	// une échelle figée se lit plus vite qu'un dégradé calculé et reste stable d'un thème à l'autre.
	const SCORE_COLOR: Record<number, string> = {
		1: '#B82323',
		2: '#f97316',
		3: '#eab308',
		4: '#89BF39',
		5: '#22C55E'
	};
	const SCORES = [1, 2, 3, 4, 5] as const;

	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
			new Date(iso + 'T00:00:00Z')
		);
	const fmtShort = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00Z'));

	function confirmReset(voteCount: number) {
		return confirm(
			`Réinitialiser la plage en cours ? ${voteCount} vote${voteCount > 1 ? 's' : ''} seront supprimés définitivement (impossible à annuler, et l'anonymat empêche toute restauration ciblée).`
		);
	}

	// Plage en cours dépliée par défaut (c'est celle qu'on vient consulter/réinitialiser le plus
	// souvent) — repliable comme les autres si on veut la sortir de la vue.
	let expanded = $state<Set<string>>(new Set(data.currentPeriodStart ? [data.currentPeriodStart] : []));
	function toggle(periodStart: string) {
		const next = new Set(expanded);
		if (next.has(periodStart)) next.delete(periodStart);
		else next.add(periodStart);
		expanded = next;
	}

	// ---------- Tendance : moyenne par semaine, chronologique (plus ancien → plus récent) ----------
	const chrono = $derived([...data.periods].reverse());
	const SPARK_W = 640;
	const SPARK_H = 180; // = hauteur CSS du <svg> (1:1) : un mismatch entre les deux écrase la courbe verticalement
	const SPARK_PAD_LEFT = 30; // réserve la place des labels d'axe (émojis)
	const SPARK_PAD_RIGHT = 10;
	const SPARK_PAD_Y = 16;
	function sparkX(i: number, n: number) {
		if (n <= 1) return (SPARK_PAD_LEFT + SPARK_W - SPARK_PAD_RIGHT) / 2;
		return SPARK_PAD_LEFT + (i / (n - 1)) * (SPARK_W - SPARK_PAD_LEFT - SPARK_PAD_RIGHT);
	}
	function sparkY(avg: number) {
		const usable = SPARK_H - SPARK_PAD_Y * 2;
		return SPARK_H - SPARK_PAD_Y - ((avg - 1) / 4) * usable;
	}
	const sparkPoints = $derived(chrono.map((p, i) => ({ x: sparkX(i, chrono.length), y: sparkY(p.avgScore), p })));
	const sparkLine = $derived(sparkPoints.map((pt) => `${pt.x},${pt.y}`).join(' '));
	const overallAvg = $derived.by(() => {
		let sum = 0;
		let n = 0;
		for (const p of data.periods) for (const s of SCORES) { sum += s * p.distribution[s]; n += p.distribution[s]; }
		return n > 0 ? Math.round((sum / n) * 100) / 100 : 0;
	});

	// ---------- Répartition globale (donut) : toutes semaines confondues ----------
	const globalDistribution = $derived.by(() => {
		const d: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
		for (const p of data.periods) for (const s of SCORES) d[s] += p.distribution[s];
		return d;
	});
	const totalVotes = $derived(data.periods.reduce((sum, p) => sum + p.voteCount, 0));
	const DONUT_R = 26;
	const DONUT_C = 2 * Math.PI * DONUT_R;
	// Segments empilés dans l'ordre 5→1 (le plus positif en premier) : cumul du dash-offset au fil
	// des scores pour dessiner chaque part du camembert sur le même cercle.
	const donutSegments = $derived.by(() => {
		let cumulative = 0;
		const segs: { score: 1 | 2 | 3 | 4 | 5; dash: number; offset: number }[] = [];
		for (const score of [5, 4, 3, 2, 1] as const) {
			const count = globalDistribution[score];
			if (count === 0) continue;
			const dash = (count / Math.max(1, totalVotes)) * DONUT_C;
			segs.push({ score, dash, offset: -cumulative });
			cumulative += dash;
		}
		return segs;
	});

	// ---------- Meilleure / moins bonne semaine (par moyenne) ----------
	const bestWeek = $derived.by(() =>
		data.periods.reduce((best, p) => (p.avgScore > best.avgScore ? p : best), data.periods[0])
	);
	const worstWeek = $derived.by(() =>
		data.periods.reduce((worst, p) => (p.avgScore < worst.avgScore ? p : worst), data.periods[0])
	);

	// ---------- Export CSV : une ligne par semaine, résultats agrégés (jamais de message —
	// l'export doit rester aussi anonyme que l'écran). ----------
	function exportCsv() {
		const header = ['Debut', 'Fin', 'Moyenne', 'Votes', 'Score_5', 'Score_4', 'Score_3', 'Score_2', 'Score_1'];
		const rows = chrono.map((p) => [
			p.periodStart,
			p.periodEnd,
			p.avgScore.toFixed(2),
			String(p.voteCount),
			String(p.distribution[5]),
			String(p.distribution[4]),
			String(p.distribution[3]),
			String(p.distribution[2]),
			String(p.distribution[1])
		]);
		// BOM + point-virgule : Excel FR n'ouvre proprement un CSV qu'avec ces deux conventions.
		const csv = '﻿' + [header, ...rows].map((r) => r.join(';')).join('\n');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'team-mood-resultats.csv';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="topbar">
	<h1>Team mood — Résultats<small>Vue admin, votes anonymes</small></h1>
</div>

{#if form?.resetOk}<div class="content" style="padding-bottom:0;"><div class="flash ok">Plage en cours réinitialisée ✓</div></div>{/if}

<div class="page-grid">
<div class="content">
	{#if data.periods.length === 0}
		<section class="card block">
			<p class="hint" style="margin:0;">Aucun vote enregistré pour l'instant.</p>
		</section>
	{:else}
		{#if chrono.length > 1}
			<section class="card block spark-card">
				<div class="spark-head">
					<h3>Tendance</h3>
					<span class="spark-overall">{EMOJI[Math.round(overallAvg)] ?? '—'} {overallAvg.toFixed(2)} de moyenne sur {chrono.length} semaines</span>
				</div>
				<svg class="spark" viewBox="0 0 {SPARK_W} {SPARK_H}" preserveAspectRatio="none">
					<!-- Grille + légende d'axe : un repère à chaque score, sinon la courbe ne veut rien dire seule. -->
					{#each SCORES as score (score)}
						<line x1={SPARK_PAD_LEFT} x2={SPARK_W - SPARK_PAD_RIGHT} y1={sparkY(score)} y2={sparkY(score)} class="spark-grid" />
						<text x={SPARK_PAD_LEFT - 8} y={sparkY(score)} class="spark-axis-label" text-anchor="end" dominant-baseline="central">{EMOJI[score]}</text>
					{/each}
					<polyline points={sparkLine} class="spark-line" />
					{#each sparkPoints as pt (pt.p.periodStart)}
						<circle cx={pt.x} cy={pt.y} r="5" fill={SCORE_COLOR[Math.round(pt.p.avgScore) as 1 | 2 | 3 | 4 | 5]} stroke="var(--surface)" stroke-width="2">
							<title>{fmt(pt.p.periodStart)} → {fmt(pt.p.periodEnd)} : {pt.p.avgScore.toFixed(2)} ({pt.p.voteCount} vote{pt.p.voteCount > 1 ? 's' : ''})</title>
						</circle>
						<text x={pt.x} y={pt.y - 12} class="spark-value" text-anchor="middle">{pt.p.avgScore.toFixed(1)}</text>
					{/each}
				</svg>
				<div class="spark-axis">
					<span>{fmtShort(chrono[0].periodStart)}</span>
					<span>{fmtShort(chrono[chrono.length - 1].periodStart)}</span>
				</div>
			</section>
		{/if}

		<div class="periods">
			{#each data.periods as p (p.periodStart)}
				{@const isCurrent = p.periodStart === data.currentPeriodStart}
				{@const isOpen = expanded.has(p.periodStart)}
				<section class="prow card" class:current={isCurrent}>
					<button type="button" class="prow-main clickable" onclick={() => toggle(p.periodStart)} aria-expanded={isOpen}>
						<span class="prow-date">
							{fmt(p.periodStart)} → {fmt(p.periodEnd)}
							{#if isCurrent}<span class="pill current">En cours</span>{/if}
						</span>
						<div class="stackbar" title="Répartition des votes">
							{#each SCORES as score (score)}
								{#if p.distribution[score] > 0}
									<span
										class="seg"
										style="width:{(p.distribution[score] / p.voteCount) * 100}%; background:{SCORE_COLOR[score]};"
										title="{EMOJI[score]} × {p.distribution[score]}"
									></span>
								{/if}
							{/each}
						</div>
						<span class="prow-avg">{EMOJI[Math.round(p.avgScore)] ?? '—'} {p.avgScore.toFixed(2)}</span>
						<span class="prow-count">{p.voteCount} vote{p.voteCount > 1 ? 's' : ''}</span>
						<svg class="chev" class:open={isOpen} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
					</button>

					{#if isOpen}
						<div class="expand">
							{#if isCurrent}
								<form
									method="POST"
									action="?/resetCurrentPeriod"
									class="prow-reset"
									use:enhance={({ cancel }) => {
										if (!confirmReset(p.voteCount)) cancel();
									}}
								>
									<button class="btn btn-ghost danger btn-sm" type="submit">Réinitialiser</button>
								</form>
							{/if}
							<div class="barlist">
								{#each [5, 4, 3, 2, 1] as score (score)}
									<div class="barrow">
										<span class="lbl">{EMOJI[score]}</span>
										<div class="track">
											<i style="width:{(p.distribution[score as 1 | 2 | 3 | 4 | 5] / p.voteCount) * 100}%; background:{SCORE_COLOR[score]};"></i>
										</div>
										<span class="val">{p.distribution[score as 1 | 2 | 3 | 4 | 5]}</span>
									</div>
								{/each}
							</div>
							{#if p.messages.length > 0}
								<div class="messages">
									<ul>
										{#each p.messages as msg, i (i)}
											<li>{msg}</li>
										{/each}
									</ul>
								</div>
							{:else}
								<p class="hint no-msg">Aucun commentaire pour cette période.</p>
							{/if}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>

{#if data.periods.length > 0}
	<aside class="side">
		<section class="card block side-card">
			<h3>Répartition globale</h3>
			<div class="donut-row">
				<svg viewBox="0 0 64 64" class="donut">
					<circle cx="32" cy="32" r={DONUT_R} fill="none" stroke="var(--surface-sunk)" stroke-width="10" />
					{#each donutSegments as seg (seg.score)}
						<circle
							cx="32"
							cy="32"
							r={DONUT_R}
							fill="none"
							stroke={SCORE_COLOR[seg.score]}
							stroke-width="10"
							stroke-dasharray="{seg.dash} {DONUT_C - seg.dash}"
							stroke-dashoffset={seg.offset}
							transform="rotate(-90 32 32)"
						>
							<title>{EMOJI[seg.score]} × {globalDistribution[seg.score]}</title>
						</circle>
					{/each}
				</svg>
				<ul class="donut-legend">
					{#each [5, 4, 3, 2, 1] as score (score)}
						<li>
							<span class="dot" style="background:{SCORE_COLOR[score as 1 | 2 | 3 | 4 | 5]};"></span>
							{EMOJI[score]}
							<b class="tabnum">{globalDistribution[score as 1 | 2 | 3 | 4 | 5]}</b>
						</li>
					{/each}
				</ul>
			</div>
			<p class="side-note">{totalVotes} vote{totalVotes > 1 ? 's' : ''} au total</p>
		</section>

		<section class="card block side-card">
			<h3>Meilleure / moins bonne semaine</h3>
			<div class="weekcard best">
				<span class="wk-label">🏆 Meilleure</span>
				<span class="wk-date">{fmt(bestWeek.periodStart)} → {fmt(bestWeek.periodEnd)}</span>
				<span class="wk-score">{EMOJI[Math.round(bestWeek.avgScore)] ?? '—'} {bestWeek.avgScore.toFixed(2)}</span>
			</div>
			{#if worstWeek.periodStart !== bestWeek.periodStart}
				<div class="weekcard worst">
					<span class="wk-label">📉 Moins bonne</span>
					<span class="wk-date">{fmt(worstWeek.periodStart)} → {fmt(worstWeek.periodEnd)}</span>
					<span class="wk-score">{EMOJI[Math.round(worstWeek.avgScore)] ?? '—'} {worstWeek.avgScore.toFixed(2)}</span>
				</div>
			{/if}
		</section>

		<section class="card block side-card">
			<h3>Export</h3>
			<p class="hint">Résultats agrégés par semaine, au format CSV (jamais les commentaires).</p>
			<button type="button" class="btn btn-ghost" onclick={exportCsv}>Exporter en CSV</button>
		</section>
	</aside>
{/if}
</div>

<style>
	.page-grid {
		display: flex;
		align-items: flex-start;
		gap: 24px;
		flex-wrap: wrap;
	}
	.content {
		max-width: 900px;
		flex: 1 1 480px;
	}
	.side {
		flex: 0 0 260px;
		width: 260px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		/* .main (le scroller de la page, cf. app.css) contient aussi la topbar : elle défile avec le
		   reste, donc rien au-dessus du sticky ne reste fixe — un simple top suffit, pas d'offset topbar. */
		position: sticky;
		top: 20px;
		max-height: calc(100vh - 40px);
		overflow-y: auto;
	}
	.side-card {
		padding: 18px 20px;
	}
	.side-card h3 {
		margin: 0 0 12px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 15px;
	}
	.side-note {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--text-mute);
		text-align: center;
	}
	.donut-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.donut {
		width: 84px;
		height: 84px;
		flex-shrink: 0;
	}
	.donut-legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}
	.donut-legend li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.donut-legend b {
		margin-left: auto;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.weekcard {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--surface-sunk);
	}
	.weekcard + .weekcard {
		margin-top: 8px;
	}
	.wk-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-mute);
	}
	.wk-date {
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.wk-score {
		font-size: 14px;
		font-weight: 700;
	}
	.block {
		padding: 24px 26px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
	}

	/* ---------- Tendance ---------- */
	.spark-card {
		padding: 18px 26px;
		margin-bottom: 18px;
	}
	.spark-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		margin-bottom: 8px;
	}
	.spark-head h3 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 16px;
	}
	.spark-overall {
		font-size: 13px;
		color: var(--text-soft);
		font-weight: 600;
	}
	.spark {
		width: 100%;
		height: 180px;
		display: block;
	}
	.spark-grid {
		stroke: var(--border);
		stroke-width: 1;
	}
	.spark-axis-label {
		font-size: 13px;
	}
	.spark-value {
		font-size: 11px;
		font-weight: 700;
		fill: var(--text-soft);
	}
	.spark-line {
		fill: none;
		stroke: var(--text-mute);
		stroke-width: 2.5;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.spark-axis {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--text-mute);
	}

	/* ---------- Lignes semaine ---------- */
	.periods {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.prow {
		padding: 0;
		/* Le hover de .prow-main est un simple rectangle plein largeur : sans ça il déborde tout droit
		   sur les coins arrondis de la card et les fait paraître carrés au survol. */
		overflow: hidden;
	}
	.prow.current {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}
	.prow-main {
		width: 100%;
		display: grid;
		grid-template-columns: minmax(180px, auto) 1fr auto auto 14px;
		align-items: center;
		gap: 14px;
		padding: 12px 16px;
		text-align: left;
		font: inherit;
		color: inherit;
	}
	.prow-main.clickable {
		cursor: pointer;
	}
	.prow-main.clickable:hover {
		background: var(--accent-tint-2);
	}
	.prow-date {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
	}
	.stackbar {
		display: flex;
		height: 10px;
		border-radius: 20px;
		overflow: hidden;
		background: var(--surface-sunk);
		min-width: 80px;
	}
	.seg {
		height: 100%;
	}
	.prow-avg {
		font-size: 13.5px;
		font-weight: 700;
		white-space: nowrap;
	}
	.prow-count {
		font-size: 12.5px;
		color: var(--text-mute);
		white-space: nowrap;
	}
	.chev {
		color: var(--text-mute);
		transition: transform 0.15s;
	}
	.chev.open {
		transform: rotate(180deg);
	}
	/* Repose dans le padding de .expand (visible seulement déplié) plutôt que sa propre ligne pleine
	   largeur : un bouton qui ne prend qu'une fraction de la largeur n'a pas besoin d'une rangée dédiée. */
	.prow-reset {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 10px;
	}
	.btn-sm {
		padding: 4px 10px;
		font-size: 12px;
	}
	.btn-ghost.danger {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
	}
	.btn-ghost.danger:hover {
		background: var(--warn-tint);
		border-color: var(--warn);
	}
	.pill.current {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 2px 8px;
		border-radius: 20px;
	}
	.expand {
		padding: 14px 16px 16px;
		border-top: 1px solid var(--border);
		margin: 0 16px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.barrow {
		display: grid;
		grid-template-columns: 24px 1fr 24px;
		align-items: center;
		gap: 10px;
	}
	.barrow .lbl {
		font-size: 15px;
		text-align: center;
	}
	.track {
		height: 8px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		border-radius: 20px;
		min-width: 2px;
	}
	.barrow .val {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
		text-align: right;
	}
	.hint.no-msg {
		margin: 12px 0 0;
	}
	.messages {
		margin-top: 12px;
	}
	.messages ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.messages li {
		background: var(--surface-sunk);
		border-radius: var(--r-sm);
		padding: 10px 12px;
		font-size: 13.5px;
		white-space: pre-wrap;
	}
</style>
