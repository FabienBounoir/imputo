<script lang="ts">
	import { dayName, dayNum, parseISODate, toISODate } from '$lib/utils/date';
	import { onMount, tick } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import ExportModal from '$lib/components/ExportModal.svelte';

	let { data } = $props();

	type Row = {
		rowKey: string;
		targetType: 'TICKET' | 'CATEGORY';
		targetId: string;
		activityId: string | null;
		label: string;
		sublabel: string;
		emoji: string | null;
		nonProductive: boolean;
		amounts: Record<string, number>;
	};

	const CYCLE = [0, 0.25, 0.5, 0.75, 1];

	let rows = $state<Row[]>([]);
	let currentMonday = $state('');

	// (Re)synchronise les lignes quand la semaine change.
	$effect(() => {
		if (data.week.mondayISO !== currentMonday) {
			currentMonday = data.week.mondayISO;
			rows = data.week.rows.map((r) => ({ ...r, amounts: { ...r.amounts } }));
		}
	});

	const today = toISODate(new Date());

	let dayTotals = $derived.by(() => {
		const t: Record<string, number> = Object.fromEntries(data.week.days.map((d) => [d, 0]));
		for (const r of rows) for (const d of data.week.days) t[d] = round(t[d] + (r.amounts[d] ?? 0));
		return t;
	});
	let weekTotal = $derived(round(Object.values(dayTotals).reduce((a, b) => a + b, 0)));
	let productive = $derived.by(() => {
		let s = 0;
		for (const r of rows) if (!r.nonProductive) for (const d of data.week.days) s += r.amounts[d] ?? 0;
		return round(s);
	});

	function round(n: number) {
		return Math.round((n + Number.EPSILON) * 100) / 100;
	}
	function fmt(n: number | undefined) {
		if (!n) return '·';
		return n === 1 ? '1' : String(n).replace(/^0/, '');
	}

	async function setAmount(row: Row, day: string, value: number) {
		row.amounts[day] = value; // optimiste
		const body = new FormData();
		body.set('targetType', row.targetType);
		body.set('targetId', row.targetId);
		if (row.activityId) body.set('activityId', row.activityId);
		body.set('day', day);
		body.set('amount', String(value));
		await fetch('?/setCell', { method: 'POST', body });
	}

	function cycle(row: Row, day: string) {
		const cur = row.amounts[day] ?? 0;
		const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
		setAmount(row, day, next);
	}

	// --- Saisie clavier ---
	const KEYMAP: Record<string, number> = { '1': 0.25, '2': 0.5, '3': 0.75, '4': 1, '0': 0 };
	const MOVES: Record<string, [number, number]> = {
		ArrowRight: [0, 1],
		ArrowLeft: [0, -1],
		ArrowDown: [1, 0],
		ArrowUp: [-1, 0]
	};
	function focusCell(ri: number, di: number, preventScroll = false) {
		if (ri < 0 || ri >= rows.length || di < 0 || di >= data.week.days.length) return;
		document.querySelector<HTMLElement>(`[data-cell="${ri}-${di}"]`)?.focus({ preventScroll });
	}

	// Au chargement, place le focus sur la colonne du jour courant pour activer
	// la navigation aux flèches sans avoir à cliquer (sans faire défiler la page).
	onMount(() => {
		if (data.readOnly || rows.length === 0) return;
		const di = data.week.days.indexOf(today);
		focusCell(0, di >= 0 ? di : 0, true);
	});

	// Préserve le membre consulté (?u=) lors de la navigation entre semaines.
	const uSuffix = $derived(data.readOnly ? `&u=${data.viewedId}` : '');
	function viewMember(id: string) {
		goto(id === data.selfId ? `?w=${data.week.mondayISO}` : `?w=${data.week.mondayISO}&u=${id}`);
	}
	function onCellKey(e: KeyboardEvent, ri: number, di: number, row: Row, day: string) {
		if (e.key in KEYMAP) {
			e.preventDefault();
			setAmount(row, day, KEYMAP[e.key]);
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			setAmount(row, day, 0);
		} else if (e.key === 'ArrowLeft' && di === 0) {
			e.preventDefault();
			changeWeek('prev', ri);
		} else if (e.key === 'ArrowRight' && di === data.week.days.length - 1) {
			e.preventDefault();
			changeWeek('next', ri);
		} else if (e.key in MOVES) {
			e.preventDefault();
			const [dr, dc] = MOVES[e.key];
			focusCell(ri + dr, di + dc);
		}
	}

	// Navigation clavier entre semaines : on garde la ligne et on vise le bord opposé.
	let pendingFocus: { ri: number; side: 'first' | 'last' } | null = null;
	function changeWeek(dir: 'prev' | 'next', ri: number) {
		pendingFocus = { ri, side: dir === 'prev' ? 'last' : 'first' };
		const w = dir === 'prev' ? data.prevWeek : data.nextWeek;
		goto(`?w=${w}${uSuffix}`, { keepFocus: true, noScroll: true });
	}
	afterNavigate(async () => {
		if (!pendingFocus) return;
		const { ri, side } = pendingFocus;
		pendingFocus = null;
		await tick(); // attendre la resynchro des lignes + le rendu
		if (rows.length === 0) return;
		const di = side === 'last' ? data.week.days.length - 1 : 0;
		focusCell(Math.min(Math.max(0, ri), rows.length - 1), di, true);
	});

	// --- Ajout de ligne ---
	let pickTarget = $state('');
	let pickActivity = $state('');

	function addRow() {
		if (!pickTarget) return;
		const [targetType, targetId] = pickTarget.split('::') as ['TICKET' | 'CATEGORY', string];
		const activityId = pickActivity || null;
		const rowKey = `${targetType}:${targetId}:${activityId ?? ''}`;
		if (rows.some((r) => r.rowKey === rowKey)) {
			pickTarget = '';
			return;
		}
		let label = '';
		let sublabel = '';
		let emoji = '🎫';
		let nonProductive = false;
		if (targetType === 'TICKET') {
			const t = data.tickets.find((x) => x.id === targetId);
			label = t?.title ?? '—';
			sublabel = t?.key ?? '';
		} else {
			const c = data.categories.find((x) => x.id === targetId);
			label = c?.label ?? '—';
			nonProductive = c?.kind === 'NON_PRODUCTIVE';
			emoji = nonProductive ? '🌴' : '🛟';
			sublabel = 'Catégorie';
		}
		const act = data.activities.find((a) => a.id === activityId);
		if (act) sublabel += ` · ${act.label}`;
		rows = [...rows, { rowKey, targetType, targetId, activityId, label, sublabel, emoji, nonProductive, amounts: {} }];
		pickTarget = '';
		pickActivity = '';
	}
</script>

<div class="topbar">
	<h1>{data.readOnly ? 'Imputation' : 'Mon imputation'}<small>Semaine {data.weekNumber} · {data.weekLabel}</small></h1>
	<div class="spacer"></div>
	{#if data.isAdmin}
		<select class="member-pick" value={data.viewedId} onchange={(e) => viewMember(e.currentTarget.value)} aria-label="Voir l'imputation de">
			<option value={data.selfId}>Mon imputation</option>
			{#each data.members.filter((m) => m.id !== data.selfId) as m (m.id)}
				<option value={m.id}>{m.displayName}</option>
			{/each}
		</select>
		<ExportModal label="Exporter Excel" buttonClass="btn btn-ghost" />
	{/if}
	<div class="wknav">
		<a class="wkbtn" href="?w={data.prevWeek}{uSuffix}" aria-label="Semaine précédente">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
		</a>
		<span class="cur">S{data.weekNumber}</span>
		<a class="wkbtn" href="?w={data.nextWeek}{uSuffix}" aria-label="Semaine suivante">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
		</a>
	</div>
</div>

<div class="content">
	{#if data.readOnly}
		<div class="ro-banner">👁 Imputation de <b>{data.viewedName}</b> — lecture seule</div>
	{/if}
	<div class="summary">
		<div class="card stat">
			<div class="k">Saisi cette semaine</div>
			<div class="v tabnum">{weekTotal} <small>j</small></div>
		</div>
		<div class="card stat">
			<div class="k">Productif (projet)</div>
			<div class="v tabnum">{productive} <small>j</small></div>
		</div>
		<div class="card stat">
			<div class="k">Capacité / jour</div>
			<div class="v tabnum">{data.capacity} <small>j</small></div>
		</div>
	</div>

	<div class="card grid-card">
		<table class="imp">
			<colgroup>
				<col />
				{#each data.week.days as d (d)}<col class="col-day" />{/each}
				<col class="col-sum" />
			</colgroup>
			<thead>
				<tr>
					<th class="task-h">Tâche / catégorie</th>
					{#each data.week.days as d (d)}
						<th class:today={d === today}>{dayName(parseISODate(d))}<span class="dnum">{dayNum(parseISODate(d))}</span></th>
					{/each}
					<th>Σ</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, ri (row.rowKey)}
					<tr>
						<td class="task">
							<div class="task-cell">
								<span class="pill">{row.emoji}</span>
								<div class="tt"><b>{row.label}</b><span>{row.sublabel}</span></div>
							</div>
						</td>
						{#each data.week.days as d, di (d)}
							<td class="day" class:today={d === today}>
								{#if data.readOnly}
									<span class="cell ro" class:val={(row.amounts[d] ?? 0) > 0} class:empty={!(row.amounts[d] ?? 0)}>{fmt(row.amounts[d])}</span>
								{:else}
									<button
										class="cell"
										class:val={(row.amounts[d] ?? 0) > 0}
										class:empty={!(row.amounts[d] ?? 0)}
										data-cell="{ri}-{di}"
										onclick={() => cycle(row, d)}
										onkeydown={(e) => onCellKey(e, ri, di, row, d)}
									>{fmt(row.amounts[d])}</button>
								{/if}
							</td>
						{/each}
						<td class="sum tabnum">{round(data.week.days.reduce((a, d) => a + (row.amounts[d] ?? 0), 0))}</td>
					</tr>
				{/each}
				{#if rows.length === 0}
					<tr><td colspan={data.week.days.length + 2} class="empty-row">{data.readOnly ? 'Aucune imputation cette semaine.' : 'Aucune ligne — ajoutez un ticket ou une catégorie ci-dessous.'}</td></tr>
				{/if}
			</tbody>
			<tfoot>
				<tr>
					<td class="task foot-lab">Total / jour</td>
					{#each data.week.days as d (d)}
						<td><span class="day-tot tabnum" class:over={dayTotals[d] > data.capacity} class:ok={dayTotals[d] > 0 && dayTotals[d] <= data.capacity}>{fmt(dayTotals[d])}</span></td>
					{/each}
					<td class="sum tabnum">{weekTotal}</td>
				</tr>
			</tfoot>
		</table>

		{#if !data.readOnly}
		<div class="addrow">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
			<select bind:value={pickTarget} aria-label="Choisir une cible">
				<option value="">Ajouter un ticket ou une catégorie…</option>
				<optgroup label="Tickets">
					{#each data.tickets as t (t.id)}<option value="TICKET::{t.id}">{t.key} — {t.title}</option>{/each}
				</optgroup>
				<optgroup label="Catégories">
					{#each data.categories as c (c.id)}<option value="CATEGORY::{c.id}">{c.label}</option>{/each}
				</optgroup>
			</select>
			<select bind:value={pickActivity} aria-label="Activité (optionnel)">
				<option value="">Activité (option)</option>
				{#each data.activities as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
			</select>
			<button class="btn btn-ghost" onclick={addRow}>Ajouter</button>
		</div>
		{/if}
	</div>

	<div class="legend">
		{#if !data.readOnly}
			<span class="kbd">Clique pour faire défiler <b>·</b> → .25 → .5 → .75 → 1</span>
			<span class="kbd">Clavier : <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> → .25 / .5 / .75 / 1 · <kbd>0</kbd>/<kbd>Suppr</kbd> vide · <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> naviguer · <kbd>←</kbd>/<kbd>→</kbd> en bord = semaine ±</span>
		{/if}
	</div>
</div>

<style>
	.summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.stat {
		padding: 16px 18px;
	}
	.stat .k {
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.stat .v {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}
	.stat .v small {
		font-size: 14px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
	}

	.member-pick {
		padding: 8px 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
		box-shadow: var(--shadow-sm);
		max-width: 220px;
	}
	.member-pick:focus {
		outline: none;
		border-color: var(--accent);
	}
	.ro-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 16px;
		margin-bottom: 16px;
		border-radius: var(--r-md);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 13.5px;
		font-weight: 500;
	}

	.wknav {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 4px;
		box-shadow: var(--shadow-sm);
	}
	.wkbtn {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		color: var(--text-soft);
		transition: background 0.15s;
	}
	.wkbtn:hover {
		background: var(--surface-sunk);
	}
	.cur {
		padding: 0 12px;
		font-weight: 600;
		font-size: 13.5px;
	}

	.grid-card {
		padding: 6px;
		overflow: hidden;
	}
	table.imp {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed; /* largeurs de colonnes fixes : les chiffres ne décalent plus rien */
	}
	.col-day {
		width: 68px;
	}
	.col-sum {
		width: 72px;
	}
	.imp thead th {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 14px 8px 12px;
		text-align: center;
	}
	.imp thead th.task-h {
		text-align: left;
		padding-left: 18px;
	}
	.imp thead th .dnum {
		display: block;
		font-family: var(--font-display);
		font-size: 15px;
		color: var(--text);
		text-transform: none;
		font-weight: 600;
	}
	.imp thead th.today,
	.imp thead th.today .dnum {
		color: var(--accent);
	}
	.imp tbody tr:hover {
		background: var(--surface-2);
	}
	.imp td.task {
		padding: 11px 14px 11px 18px;
		border-top: 1px solid var(--border);
	}
	.imp tbody tr:first-child td {
		border-top: none;
	}
	.task-cell {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.task-cell .tt b {
		font-size: 14px;
		font-weight: 600;
		display: block;
		letter-spacing: -0.01em;
	}
	.task-cell .tt span {
		font-size: 11.5px;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.imp td.day {
		border-top: 1px solid var(--border);
		text-align: center;
	}
	.cell {
		width: 46px;
		height: 38px;
		margin: 4px auto;
		border-radius: 10px;
		display: grid;
		place-items: center;
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		border: 1.5px solid transparent;
		transition: all 0.15s;
		color: var(--text);
	}
	.cell.val {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 28%, transparent);
		color: var(--accent-ink);
	}
	:global([data-theme='dark']) .cell.val {
		color: color-mix(in srgb, var(--accent) 80%, #fff);
	}
	.cell.empty {
		color: var(--text-mute);
		opacity: 0.5;
		font-weight: 500;
	}
	button.cell:hover {
		border-color: var(--accent);
		background: var(--accent-tint-2);
		transform: translateY(-1px);
	}
	.cell.ro {
		cursor: default;
	}
	td.day.today {
		background: color-mix(in srgb, var(--accent) 5%, transparent);
	}
	.imp td.sum {
		border-top: 1px solid var(--border);
		text-align: center;
		font-weight: 700;
		font-size: 14px;
		color: var(--text-soft);
		padding-right: 14px;
	}
	.empty-row {
		text-align: center;
		color: var(--text-mute);
		padding: 28px;
		font-size: 13.5px;
	}
	.imp tfoot td {
		border-top: 1.5px solid var(--border-strong);
		padding: 13px 8px;
		text-align: center;
		font-weight: 700;
		font-size: 13.5px;
	}
	.imp tfoot td.foot-lab {
		text-align: left;
		padding-left: 18px;
		color: var(--text-soft);
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 0.06em;
	}
	.day-tot {
		display: inline-grid;
		place-items: center;
		min-width: 34px;
		padding: 3px 6px;
		border-radius: 8px;
	}
	.day-tot.ok {
		color: var(--accent-ink);
		background: var(--accent-tint);
	}
	:global([data-theme='dark']) .day-tot.ok {
		color: color-mix(in srgb, var(--accent) 75%, #fff);
	}
	.day-tot.over {
		color: var(--warn);
		background: var(--warn-tint);
	}

	.addrow {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 13px 18px;
		border-top: 1px dashed var(--border-strong);
		color: var(--text-mute);
	}
	.addrow select {
		padding: 8px 11px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
	}
	.addrow select:first-of-type {
		flex: 1;
	}

	.legend {
		display: flex;
		gap: 18px;
		align-items: center;
		margin: 16px 4px 0;
		flex-wrap: wrap;
		font-size: 12px;
		color: var(--text-mute);
	}
	.legend .warn {
		margin-left: auto;
		color: var(--warn);
	}
	.legend kbd {
		display: inline-block;
		min-width: 16px;
		padding: 1px 5px;
		border-radius: 5px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-soft);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 600;
		line-height: 1.4;
		text-align: center;
	}
</style>
