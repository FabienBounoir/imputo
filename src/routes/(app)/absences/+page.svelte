<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		ABSENCE_TYPES,
		ABSENCE_PERIODS,
		ABSENCE_SPANS,
		ABSENCE_SPAN_LABELS,
		ABSENCE_TYPE_LABELS,
		ABSENCE_PERIOD_LABELS,
		ABSENCE_TYPE_COLORS,
		type AbsenceType,
		type AbsencePeriod
	} from '$lib/absenceTypes';
	import { parseISODate, formatDayRange } from '$lib/utils/date';

	let { data, form } = $props();

	let startDate = $state(data.todayISO);
	let endDate = $state(data.todayISO);
	let type = $state<AbsenceType>('CONGE_VALIDE');
	let period = $state<AbsencePeriod>('FULL');
	let subject = $state('me');
	let extName = $state('');
	let showExtModal = $state(false);
	const sameDay = $derived(startDate === endDate);

	function resetForm() {
		startDate = data.todayISO;
		endDate = data.todayISO;
		type = 'CONGE_VALIDE';
		period = 'FULL';
		subject = 'me';
	}

	function isWeekend(dayISO: string) {
		const dow = parseISODate(dayISO).getUTCDay();
		return dow === 0 || dow === 6;
	}

	function cellStyle(cell: { type: AbsenceType; period: AbsencePeriod } | undefined) {
		if (!cell) return '';
		const color = ABSENCE_TYPE_COLORS[cell.type];
		if (cell.period === 'FULL') return `background:${color};`;
		return `background:linear-gradient(135deg, transparent 0 50%, ${color} 50% 100%);`;
	}
</script>

<div class="topbar">
	<h1>Absences<small>Congés, formations et hors-projet</small></h1>
</div>

<div class="content abs">
	{#if form?.error}<div class="flash error">{form.error}</div>{/if}
	{#if form?.ok}<div class="flash ok">Mis à jour ✓</div>{/if}

	<section class="card block">
		<h3>Déclarer une absence</h3>
		<form
			method="POST"
			action="?/create"
			class="abs-form"
			use:enhance={() => async ({ update }) => {
				await update();
				resetForm();
			}}
		>
			{#if data.canManageOthers && data.externalMembers.length > 0}
				<div class="field">
					<label for="subject">Pour</label>
					<select id="subject" name="subject" bind:value={subject}>
						<option value="me">Moi-même</option>
						{#each data.externalMembers as em (em.id)}
							<option value="ext:{em.id}">{em.displayName} (externe)</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="field">
				<label for="startDate">Date de début</label>
				<input id="startDate" type="date" name="startDate" bind:value={startDate} required />
			</div>
			<div class="field">
				<label for="endDate">Date de fin</label>
				<input id="endDate" type="date" name="endDate" bind:value={endDate} min={startDate} required />
			</div>
			<div class="field">
				<label for="type">Type</label>
				<select id="type" name="type" bind:value={type}>
					{#each ABSENCE_TYPES as t (t)}
						<option value={t}>{ABSENCE_TYPE_LABELS[t]}</option>
					{/each}
				</select>
			</div>
			<input type="hidden" name="period" value={sameDay ? period : 'FULL'} />
			{#if sameDay}
				<div class="field period-field">
					<span>Durée</span>
					<div class="period-pick">
						{#each ABSENCE_PERIODS as p (p)}
							<label class="period-opt" class:active={period === p}>
								<input type="radio" bind:group={period} value={p} />
								{ABSENCE_PERIOD_LABELS[p]}
							</label>
						{/each}
					</div>
				</div>
			{/if}
			<button class="btn btn-primary" type="submit">+ Déclarer</button>
		</form>
	</section>

	<section class="card block">
		<div class="synth-head">
			<h3>Synthèse équipe — {data.rangeLabel}</h3>
			<div class="spacer"></div>
			{#if data.canManageOthers}
				<button type="button" class="btn btn-ghost" onclick={() => (showExtModal = true)}>
					<span class="ext-dot" style="margin-left:0;"></span> Membres externes
				</button>
			{/if}
			<div class="span-pick">
				{#each ABSENCE_SPANS as s (s)}
					<a class="span-btn" class:active={data.span === s} href="?m={data.anchorISO}&span={s}">{ABSENCE_SPAN_LABELS[s]}</a>
				{/each}
			</div>
			<div class="wknav">
				<a class="wkbtn" href="?m={data.prevAnchor}&span={data.span}" aria-label="Période précédente">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
				</a>
				<a class="wkbtn" href="?m={data.nextAnchor}&span={data.span}" aria-label="Période suivante">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
				</a>
			</div>
			<a class="btn btn-ghost" href="/absences/export?m={data.anchorISO}&span={data.span}">⬇ Exporter</a>
		</div>
		{#if data.rows.length === 0}
			<p class="hint" style="margin:0;">Aucun membre actif.</p>
		{:else}
			<div class="grid-wrap">
				<table class="grid">
					<colgroup>
						<col class="name-col-w" />
						{#each data.days as d (d)}<col class="day-col-w" />{/each}
					</colgroup>
					<thead>
						<tr>
							<th class="name-col" rowspan="2">Membre</th>
							{#each data.monthGroups as g (g.label)}
								<th colspan={g.count} class="month-hdr">{g.label}</th>
							{/each}
						</tr>
						<tr>
							{#each data.days as d (d)}
								<th class:weekend={isWeekend(d)} class:today={d === data.todayISO}>{parseISODate(d).getUTCDate()}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.rows as m (m.id)}
							<tr class:external-row={m.external}>
								<td class="name-col">{m.displayName}{#if m.external}<span class="ext-dot" title="Membre externe"></span>{/if}</td>
								{#each data.days as d (d)}
									{@const cell = data.grid[m.id]?.[d]}
									<td
										class:weekend={isWeekend(d)}
										class:today={d === data.todayISO}
										style={cellStyle(cell)}
										title={cell ? `${m.displayName} — ${ABSENCE_TYPE_LABELS[cell.type]}${cell.period !== 'FULL' ? ' (' + ABSENCE_PERIOD_LABELS[cell.period] + ')' : ''}` : ''}
									></td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="legend">
				{#each ABSENCE_TYPES as t (t)}
					<span class="legend-item"><span class="swatch" style="background:{ABSENCE_TYPE_COLORS[t]};"></span>{ABSENCE_TYPE_LABELS[t]}</span>
					<span class="legend-item"><span class="swatch" style="background:linear-gradient(135deg, transparent 0 50%, {ABSENCE_TYPE_COLORS[t]} 50% 100%);"></span>{ABSENCE_TYPE_LABELS[t]} (demi-journée)</span>
				{/each}
			</div>
		{/if}
	</section>

	<section class="card block">
		<h3>Mes absences</h3>
		{#if data.myAbsences.length === 0}
			<p class="hint" style="margin:0;">Aucune absence déclarée.</p>
		{:else}
			<div class="abs-list">
				{#each data.myAbsences as a (a.id)}
					<div class="abs-item">
						<span class="swatch" style={cellStyle({ type: a.type, period: a.period })}></span>
						<span class="abs-range">{formatDayRange(a.startDate, a.endDate)}</span>
						<span class="pill">{ABSENCE_TYPE_LABELS[a.type]}</span>
						{#if a.period !== 'FULL'}<span class="pill">{ABSENCE_PERIOD_LABELS[a.period]}</span>{/if}
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={a.id} />
							<button class="ref-btn ref-btn-danger" type="submit">🗑 Retirer</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (showExtModal = false)} />

{#if showExtModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (showExtModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Membres externes</h3>
			<p class="hint">Personnes suivies pour leurs congés sans compte sur l'espace (client, prestataire…). Choisis-les ensuite dans « Pour » du formulaire de déclaration.</p>
			<form
				method="POST"
				action="?/addExternal"
				class="ext-add"
				use:enhance={() => async ({ update }) => {
					await update();
					extName = '';
				}}
			>
				<input name="displayName" bind:value={extName} placeholder="Nom (ex. Client Acme)…" required />
				<button class="btn btn-ghost" type="submit">+ Ajouter</button>
			</form>
			{#if data.externalMembers.length > 0}
				<div class="abs-list">
					{#each data.externalMembers as em (em.id)}
						<div class="abs-item">
							<span class="ext-dot"></span>
							<span class="abs-range">{em.displayName}</span>
							<form method="POST" action="?/removeExternal" use:enhance>
								<input type="hidden" name="id" value={em.id} />
								<button class="ref-btn ref-btn-danger" type="submit">🗑 Retirer</button>
							</form>
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint" style="margin:0;">Aucun membre externe pour l'instant.</p>
			{/if}
			<div class="modal-actions">
				<button class="btn btn-ghost" type="button" onclick={() => (showExtModal = false)}>Fermer</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.abs {
		max-width: 1180px;
	}
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	.block h3 {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 14px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
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
	.synth-head {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	.synth-head h3 {
		margin-bottom: 0;
	}
	.span-pick {
		display: flex;
		gap: 2px;
		background: var(--surface-sunk);
		border-radius: var(--r-md);
		padding: 3px;
	}
	.span-btn {
		padding: 6px 11px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
	}
	.span-btn.active {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	.abs-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 12px;
	}
	.abs-form .field {
		margin-bottom: 0;
		min-width: 160px;
	}
	.period-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.period-field span {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.period-pick {
		display: flex;
		gap: 6px;
	}
	.period-opt {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		font-size: 13px;
		white-space: nowrap;
		cursor: pointer;
	}
	.period-opt.active {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-tint);
	}
	.period-opt input {
		accent-color: var(--accent);
	}

	.ext-add {
		display: flex;
		gap: 8px;
		margin-bottom: 14px;
	}
	.ext-add input {
		flex: 1;
		min-width: 0;
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13.5px;
	}
	.ext-add input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.ext-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #94a3b8;
		margin-left: 7px;
		vertical-align: middle;
	}

	.abs-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.abs-item {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
	}
	.abs-range {
		flex: 1;
	}
	.ref-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-soft);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		white-space: nowrap;
		transition: border-color 0.15s, color 0.15s;
	}
	.ref-btn-danger:hover {
		border-color: #c0392b;
		color: #c0392b;
	}

	.swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.grid-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
	}
	.grid {
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 12px;
	}
	.name-col-w {
		width: 160px;
	}
	.day-col-w {
		width: 26px;
	}
	.grid th,
	.grid td {
		border: 1px solid var(--border);
		text-align: center;
		height: 26px;
		padding: 0;
		overflow: hidden;
	}
	/* `<col>` widths seuls ne suffisent pas à contraindre les colonnes du corps du tableau une fois
	   qu'un en-tête à colspan (bandeau mois) est présent — on fixe donc aussi la largeur sur les
	   cellules elles-mêmes pour que chaque jour garde exactement la même largeur (1 ou 2 chiffres). */
	.grid th:not(.name-col):not(.month-hdr),
	.grid td:not(.name-col) {
		width: 26px;
		min-width: 26px;
		max-width: 26px;
	}
	.grid th.name-col,
	.grid td.name-col {
		width: 160px;
		min-width: 160px;
		max-width: 160px;
	}
	.grid th {
		background: var(--surface-sunk);
		color: var(--text-soft);
		font-weight: 600;
		position: sticky;
	}
	.grid thead tr:first-child th {
		top: 0;
	}
	.grid thead tr:last-child th {
		top: 27px;
	}
	.grid .month-hdr {
		border-left-width: 2px;
	}
	.grid .name-col {
		text-align: left;
		padding: 0 10px;
		white-space: nowrap;
		text-overflow: ellipsis;
		position: sticky;
		left: 0;
		background: var(--surface);
		z-index: 1;
	}
	.grid th.name-col {
		background: var(--surface-sunk);
		z-index: 2;
	}
	.grid td.weekend,
	.grid th.weekend {
		background: var(--surface-sunk);
	}
	.grid td.today,
	.grid th.today {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	/* Ligne d'un membre externe : teinte très légère, distincte des couleurs de type d'absence. */
	.grid tr.external-row td,
	.grid tr.external-row td.weekend,
	.grid tr.external-row td.name-col {
		background: rgba(148, 163, 184, 0.12);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		margin-top: 14px;
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
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
		max-width: 440px;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.modal .ext-add {
		margin-top: 16px;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 18px;
	}
</style>
