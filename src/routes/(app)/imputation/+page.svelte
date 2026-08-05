<script lang="ts">
	import { dayName, dayNum, parseISODate, toISODate, isPublicHolidayFR } from '$lib/utils/date';
	import { onMount, tick } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import ExportModal from '$lib/components/ExportModal.svelte';
	import TargetPicker from '$lib/components/TargetPicker.svelte';

	let { data } = $props();

	type Row = {
		rowKey: string;
		targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE';
		targetId: string;
		activityId: string | null;
		label: string;
		sublabel: string;
		emoji: string | null;
		nonProductive: boolean;
		amounts: Record<string, number>;
	};

	// Pas de saisie (§7 admin) : ex. 0.25 → [0, .25, .5, .75, 1] ; 0.5 → [0, .5, 1]. Jamais
	// figé sur .25, sinon un espace qui règle un autre pas ne change rien à la saisie réelle.
	function round(n: number) {
		return Math.round((n + Number.EPSILON) * 100) / 100;
	}
	let CYCLE = $derived.by(() => {
		const step = data.imputationStep > 0 ? data.imputationStep : 0.25;
		const n = Math.max(1, Math.round(1 / step));
		return Array.from({ length: n + 1 }, (_, i) => round(i * step));
	});
	let KEYMAP = $derived.by(() => {
		const map: Record<string, number> = { '0': 0 };
		CYCLE.filter((v) => v > 0).forEach((v, i) => {
			if (i < 9) map[String(i + 1)] = v;
		});
		return map;
	});

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
	// Capacité hebdo attendue = capacité/jour × jours ouvrés non fériés de la semaine (miroir de
	// calc.ts:weeklyCapacity/capacityPct côté serveur — dupliqué ici car $lib/server n'est pas
	// importable côté client, cf. le même motif pour totalEst/ecartExecution dans tickets/+page.svelte).
	let weekWorkdays = $derived(data.week.days.filter((d) => !isPublicHolidayFR(d)).length);
	let weeklyCapacity = $derived(round(data.capacity * weekWorkdays));
	let capacityPct = $derived(weeklyCapacity > 0 ? round(weekTotal / weeklyCapacity) : 0);
	let overCapacity = $derived(capacityPct > 1);
	let productive = $derived.by(() => {
		let s = 0;
		for (const r of rows) if (!r.nonProductive) for (const d of data.week.days) s += r.amounts[d] ?? 0;
		return round(s);
	});

	function fmt(n: number | undefined) {
		if (!n) return '·';
		return String(n);
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
	let confirmDelete = $state<Row | null>(null);

	async function doDeleteRow() {
		const row = confirmDelete;
		if (!row) return;
		confirmDelete = null;
		rows = rows.filter((r) => r.rowKey !== row.rowKey); // optimiste
		const body = new FormData();
		body.set('targetType', row.targetType);
		body.set('targetId', row.targetId);
		if (row.activityId) body.set('activityId', row.activityId);
		body.set('mondayISO', data.week.mondayISO);
		await fetch('?/deleteRow', { method: 'POST', body });
	}

	function buildRow(targetType: 'TICKET' | 'CATEGORY' | 'OBJECTIVE', targetId: string, activityId: string | null): Row {
		const rowKey = `${targetType}:${targetId}:${activityId ?? ''}`;
		let label = '';
		let sublabel = '';
		let emoji = '🎫';
		let nonProductive = false;
		if (targetType === 'TICKET') {
			const t = data.tickets.find((x) => x.id === targetId);
			label = t?.title ?? '—';
			sublabel = t?.key ?? '';
		} else if (targetType === 'CATEGORY') {
			const c = data.categories.find((x) => x.id === targetId);
			label = c?.label ?? '—';
			nonProductive = c?.kind === 'NON_PRODUCTIVE';
			emoji = nonProductive ? '🌴' : '🛟';
			sublabel = 'Catégorie';
		} else {
			const o = data.weeklyObjectives.find((x) => x.id === targetId);
			label = o?.label ?? '—';
			emoji = '📝';
			sublabel = 'Tâche assignée';
		}
		const act = data.activities.find((a) => a.id === activityId);
		if (act) sublabel += ` · ${act.label}`;
		return { rowKey, targetType, targetId, activityId, label, sublabel, emoji, nonProductive, amounts: {} };
	}

	function addRow() {
		if (!pickTarget) return;
		const [targetType, targetId] = pickTarget.split('::') as ['TICKET' | 'CATEGORY' | 'OBJECTIVE', string];
		const activityId = pickActivity || null;
		const rowKey = `${targetType}:${targetId}:${activityId ?? ''}`;
		if (rows.some((r) => r.rowKey === rowKey)) {
			pickTarget = '';
			return;
		}
		rows = [...rows, buildRow(targetType, targetId, activityId)];
		pickTarget = '';
		pickActivity = '';
	}

	// Ajout en un clic depuis le bandeau de rappel (contourne le picker).
	function quickAddObjective(o: (typeof data.weeklyObjectives)[number]) {
		const targetType: 'TICKET' | 'OBJECTIVE' = o.kind === 'TICKET' ? 'TICKET' : 'OBJECTIVE';
		const targetId = o.kind === 'TICKET' ? (o.ticketId ?? '') : o.id;
		if (!targetId || rows.some((r) => r.targetType === targetType && r.targetId === targetId)) return;
		rows = [...rows, buildRow(targetType, targetId, o.activityId ?? null)];
	}
</script>

<div class="topbar">
	<h1>{data.readOnly ? 'Imputation' : 'Mon imputation'}<small>Semaine {data.weekNumber} · {data.weekLabel}</small></h1>
	{#if data.onVacation}<span class="vac-badge">🏖 En vacances cette semaine</span>{/if}
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
		<div class="card stat" class:warn-stat={overCapacity}>
			<div class="k">% de capacité (semaine)</div>
			<div class="v tabnum">{Math.round(capacityPct * 100)} <small>%</small></div>
			{#if overCapacity}<div class="cap-warn">⚠ Dépassement — reste possible</div>{/if}
		</div>
	</div>

	{#if data.weeklyObjectives.length > 0}
		<div class="card reminder-card">
			<div class="reminder-head">🎯 Attribué pour cette semaine — pour ne pas les oublier</div>
			<div class="reminder-list">
				{#each data.weeklyObjectives as o (o.id)}
					{@const targetType = o.kind === 'TICKET' ? 'TICKET' : 'OBJECTIVE'}
					{@const targetId = o.kind === 'TICKET' ? o.ticketId : o.id}
					{@const already = rows.some((r) => r.targetType === targetType && r.targetId === targetId)}
					<div class="reminder-item" class:done={already}>
						<span class="reminder-label">
							{o.kind === 'TICKET' ? '🎫' : '📝'}
							{o.kind === 'TICKET' ? `${o.ticketKey} — ${o.ticketTitle}` : o.label}
							{#if o.activityLabel}<span class="tag-activity">{o.activityLabel}</span>{/if}
						</span>
						{#if !data.readOnly}
							{#if already}
								<span class="reminder-ok">✓ ajouté</span>
							{:else}
								<button class="btn btn-ghost reminder-add" onclick={() => quickAddObjective(o)}>+ Ajouter</button>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

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
						<th class:today={d === today} class:holiday={isPublicHolidayFR(d)} title={isPublicHolidayFR(d) ? 'Jour férié' : ''}>{dayName(parseISODate(d))}<span class="dnum">{dayNum(parseISODate(d))}</span></th>
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
								{#if !data.readOnly}
									<button class="row-del" onclick={() => (confirmDelete = row)} aria-label="Supprimer la ligne">
										<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
									</button>
								{/if}
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
			<TargetPicker
				bind:value={pickTarget}
				tickets={data.tickets}
				categories={data.categories}
				recentTicketIds={data.recentTicketIds}
				objectives={data.weeklyObjectives}
			/>
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
			{@const keyEntries = Object.entries(KEYMAP).filter(([k]) => k !== '0')}
			<span class="kbd">Clique pour faire défiler <b>·</b> → {CYCLE.slice(1).map((v) => fmt(v)).join(' → ')}</span>
			<span class="kbd">Clavier : {#each keyEntries as [k] (k)}<kbd>{k}</kbd> {/each}→ {keyEntries.map(([, v]) => fmt(v)).join(' / ')} · <kbd>0</kbd>/<kbd>Suppr</kbd> vide · <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> naviguer · <kbd>←</kbd>/<kbd>→</kbd> en bord = semaine ±</span>
		{/if}
	</div>
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (confirmDelete = null)} />

{#if confirmDelete}
	{@const row = confirmDelete}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (confirmDelete = null)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Supprimer cette ligne ?</h3>
			<p class="hint">
				{row.emoji} <b>{row.label}</b>{row.sublabel ? ` — ${row.sublabel}` : ''} — toutes les heures saisies cette semaine sur cette ligne seront supprimées.
			</p>
			<div class="modal-actions">
				<button class="btn btn-ghost" onclick={() => (confirmDelete = null)}>Annuler</button>
				<button class="btn btn-danger" onclick={doDeleteRow}>🗑 Supprimer</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.stat {
		padding: 16px 18px;
	}
	.warn-stat {
		border-color: #c0392b;
	}
	.cap-warn {
		margin-top: 4px;
		font-size: 11px;
		font-weight: 600;
		color: #c0392b;
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
	.vac-badge {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 4px 10px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.reminder-card {
		padding: 14px 18px;
		margin-bottom: 16px;
	}
	.reminder-head {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 10px;
	}
	.reminder-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.reminder-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 4px;
	}
	.reminder-item.done {
		opacity: 0.55;
	}
	.reminder-label {
		font-size: 13.5px;
		display: flex;
		align-items: baseline;
		gap: 7px;
		min-width: 0;
	}
	.tag-activity {
		display: inline-block;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface-sunk);
		padding: 2px 8px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.reminder-ok {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent-ink);
		flex-shrink: 0;
	}
	.reminder-add {
		flex-shrink: 0;
		padding: 5px 11px;
		font-size: 12px;
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
	.imp thead th.holiday,
	.imp thead th.holiday .dnum {
		color: var(--danger, #c0392b);
	}
	.imp thead th.holiday::after {
		content: '';
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--danger, #c0392b);
		margin-left: 4px;
		vertical-align: middle;
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
	.task-cell .tt {
		flex: 1;
		min-width: 0;
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
	.row-del {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-mute);
		opacity: 0;
		transition: opacity 0.15s, background 0.15s, color 0.15s;
	}
	.imp tbody tr:hover .row-del {
		opacity: 1;
	}
	.row-del:hover,
	.row-del:focus-visible {
		background: color-mix(in srgb, var(--danger, #c0392b) 12%, transparent);
		color: var(--danger, #c0392b);
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

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 24px;
		width: 100%;
		max-width: 420px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 10px;
	}
	.modal .hint {
		color: var(--text-mute);
		font-size: 13px;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
	}
	.btn-danger {
		background: var(--danger, #c0392b);
		color: #fff;
	}
	.btn-danger:hover {
		background: color-mix(in srgb, var(--danger, #c0392b) 88%, black);
	}
</style>
