<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import TargetPicker from '$lib/components/TargetPicker.svelte';
	import { downloadSvgAsPng } from '$lib/utils/svgToPng';

	let { data, form } = $props();

	// Un seul champ pour "assigner un ticket" ou "créer une tâche personnalisée" : la recherche qui
	// ne trouve aucun ticket propose de créer une tâche avec le texte tapé (cf. TargetPicker,
	// prop allowCustom) — évite deux formulaires séparés pour ce qui est le même geste.
	let pickTarget = $state('');
	let pickTicketActivity = $state('');
	let imgBusy = $state(false);

	const pickedKind = $derived(pickTarget.startsWith('CUSTOM::') ? 'CUSTOM' : 'TICKET');
	const pickedTicketId = $derived(pickTarget.startsWith('TICKET::') ? pickTarget.slice(8) : '');
	const pickedLabel = $derived(pickTarget.startsWith('CUSTOM::') ? pickTarget.slice(8) : '');

	function selectUser(id: string) {
		goto(`?w=${data.weekMondayISO}&u=${id}`);
	}

	async function downloadObjectivesPng() {
		imgBusy = true;
		try {
			const res = await fetch(`/admin/objectifs/export-image?w=${data.weekMondayISO}`);
			if (!res.ok) return;
			const svgText = await res.text();
			await downloadSvgAsPng(svgText, `objectifs-semaine-${data.weekNumber}.png`);
		} finally {
			imgBusy = false;
		}
	}
</script>

<div class="topbar">
	<h1>Objectifs de la semaine<small>Semaine {data.weekNumber} · {data.weekLabel}</small></h1>
	<div class="spacer"></div>
	<div class="wknav">
		<a class="wkbtn" href="?w={data.prevWeek}&u={data.selectedUserId}" aria-label="Semaine précédente">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
		</a>
		<span class="cur">S{data.weekNumber}</span>
		<a class="wkbtn" href="?w={data.nextWeek}&u={data.selectedUserId}" aria-label="Semaine suivante">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
		</a>
	</div>
</div>

<div class="content admin">
	{#if data.members.length === 0}
		<section class="card block"><p class="hint" style="margin:0;">Aucun membre actif dans cet espace.</p></section>
	{:else}
		<section class="card block">
			<h3>Attribuer pour la semaine</h3>
			<p class="hint">Choisis une personne, puis cherche un ticket à assigner — si la recherche ne trouve rien, tu peux créer une tâche personnalisée avec le texte tapé. Ces éléments seront épinglés en tête de sa page « Mon imputation ».</p>
			{#if form?.error}<div class="flash error">{form.error}</div>{/if}
			{#if form?.objOk}<div class="flash ok">Mis à jour ✓</div>{/if}

			<div class="person-row">
				<select class="member-pick" value={data.selectedUserId} onchange={(e) => selectUser(e.currentTarget.value)} aria-label="Personne">
					{#each data.members as m (m.id)}
						<option value={m.id}>{m.displayName}</option>
					{/each}
				</select>
				<form method="POST" action="?/toggleVacation" use:enhance>
					<input type="hidden" name="userId" value={data.selectedUserId} />
					<input type="hidden" name="weekMondayISO" value={data.weekMondayISO} />
					<input type="hidden" name="onVacation" value={String(!data.selectedOnVacation)} />
					<button class="btn {data.selectedOnVacation ? 'btn-primary' : 'btn-ghost'}" type="submit">
						{data.selectedOnVacation ? '🏖 En vacances — retirer' : '🏖 Marquer en vacances'}
					</button>
				</form>
			</div>

			<div class="ref-list">
				{#each data.objectives as o, i (o.id)}
					<div class="ref-item">
						<span class="obj-order">
							<form method="POST" action="?/moveObjective" use:enhance>
								<input type="hidden" name="id" value={o.id} />
								<input type="hidden" name="dir" value="up" />
								<button class="obj-order-btn" type="submit" disabled={i === 0} aria-label="Monter">↑</button>
							</form>
							<span class="obj-order-num">{i + 1}</span>
							<form method="POST" action="?/moveObjective" use:enhance>
								<input type="hidden" name="id" value={o.id} />
								<input type="hidden" name="dir" value="down" />
								<button class="obj-order-btn" type="submit" disabled={i === data.objectives.length - 1} aria-label="Descendre">↓</button>
							</form>
						</span>
						<span class="obj-label">
							{#if o.kind === 'TICKET'}
								<span class="pill-ico">🎫</span><b>{o.ticketKey}</b> {o.ticketTitle}
							{:else}
								<span class="pill-ico">📝</span>{o.label}
							{/if}
							{#if o.activityLabel}<span class="tag-activity">{o.activityLabel}</span>{/if}
						</span>
						<form method="POST" action="?/removeObjective" use:enhance>
							<input type="hidden" name="id" value={o.id} />
							<button class="ref-btn ref-btn-danger" type="submit">🗑 Retirer</button>
						</form>
					</div>
				{/each}
				{#if data.objectives.length === 0}<p class="hint" style="margin:0;">Aucun objectif pour cette personne cette semaine.</p>{/if}
			</div>

			{#if data.selectedOnVacation}
				<p class="hint vac-hint">🏖 Cette personne est marquée en vacances cette semaine — aucun objectif ne peut lui être attribué tant que ce n'est pas retiré ci-dessus.</p>
			{:else}
				<div class="add-objective">
					<form
						method="POST"
						action="?/addObjective"
						use:enhance={() => async ({ update }) => { pickTarget = ''; pickTicketActivity = ''; await update(); }}
						class="add-ticket"
					>
						<input type="hidden" name="userId" value={data.selectedUserId} />
						<input type="hidden" name="weekMondayISO" value={data.weekMondayISO} />
						<input type="hidden" name="kind" value={pickedKind} />
						<input type="hidden" name="ticketId" value={pickedTicketId} />
						<input type="hidden" name="label" value={pickedLabel} />
						<TargetPicker
							bind:value={pickTarget}
							tickets={data.tickets}
							categories={[]}
							recentTicketIds={[]}
							allowCustom
							placeholder="Rechercher un ticket, ou taper un nom pour créer une tâche…"
						/>
						<select class="activity-pick" name="activityId" bind:value={pickTicketActivity} aria-label="Type d'activité (optionnel)">
							<option value="">Type d'activité (option)</option>
							{#each data.activities as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
						</select>
						<button class="btn btn-ghost" type="submit" disabled={!pickTarget}>+ {pickedKind === 'CUSTOM' ? 'Créer' : 'Assigner'}</button>
					</form>
				</div>
			{/if}
		</section>
	{/if}

	<section class="card block">
		<div class="block-head">
			<div>
				<h3>Vue globale — Semaine {data.weekNumber}</h3>
				<p class="hint">Ce que chaque membre a comme objectif cette semaine.</p>
			</div>
			<button class="btn btn-ghost" type="button" disabled={imgBusy} onclick={downloadObjectivesPng}>
				{imgBusy ? 'Génération…' : '⬇ Exporter en image (PNG)'}
			</button>
		</div>
		<div class="ref-grid">
			{#each data.members as m (m.id)}
				{@const mine = data.globalObjectives.filter((o) => o.userId === m.id)}
				{@const onVac = data.vacations.includes(m.id)}
				<section
					class="card block person-card"
					class:on-vac={onVac}
					class:selected={m.id === data.selectedUserId}
					role="button"
					tabindex="0"
					title="Sélectionner {m.displayName} dans « Attribuer pour la semaine »"
					onclick={() => selectUser(m.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectUser(m.id);
						}
					}}
				>
					<div class="person-card-head">
						<h3>{m.displayName}</h3>
						{#if !onVac && mine.length > 0}<span class="obj-count">{mine.length}</span>{/if}
					</div>
					{#if onVac}
						<span class="tag-vac">🏖 En vacances</span>
					{:else if mine.length === 0}
						<p class="hint" style="margin:0;">Aucun objectif.</p>
					{:else}
						<ul class="person-tasks">
							{#each mine as o (o.id)}
								<li>
									<span class="task-text">{o.kind === 'TICKET' ? `🎫 ${o.ticketKey} — ${o.ticketTitle}` : `📝 ${o.label}`}</span>
									{#if o.activityLabel}<span class="tag-activity">{o.activityLabel}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		</div>
	</section>
</div>

<style>
	.admin {
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
		margin-bottom: 4px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		margin-bottom: 16px;
	}
	.vac-hint {
		background: var(--accent-tint);
		color: var(--accent-ink);
		padding: 10px 12px;
		border-radius: var(--r-md);
		margin-bottom: 0;
	}
	.spacer {
		flex: 1;
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
	.person-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 16px;
	}
	.member-pick {
		padding: 8px 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
		box-shadow: var(--shadow-sm);
		max-width: 260px;
	}
	.member-pick:focus {
		outline: none;
		border-color: var(--accent);
	}
	.ref-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}
	.ref-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.obj-order {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}
	.obj-order-btn {
		width: 20px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--text-mute);
		font-size: 11px;
		line-height: 1;
	}
	.obj-order-btn:hover:not(:disabled) {
		background: var(--surface-sunk);
		color: var(--text);
	}
	.obj-order-btn:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.obj-order-num {
		text-align: center;
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-mute);
		line-height: 1;
	}
	.obj-label {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.pill-ico {
		flex-shrink: 0;
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
	.add-objective {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.add-ticket {
		display: flex;
		gap: 8px;
	}
	.add-ticket .btn {
		white-space: nowrap;
		flex-shrink: 0;
	}
	.block-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.block-head .btn {
		white-space: nowrap;
		flex-shrink: 0;
	}
	.ref-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 18px;
	}
	.ref-grid .block {
		margin-bottom: 0;
	}
	.person-card h3 {
		font-size: 14px;
		margin-bottom: 0;
	}
	.person-card {
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
	}
	.person-card:hover {
		border-color: var(--border-strong);
	}
	.person-card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.person-card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.person-card-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	.person-card-head h3 {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.obj-count {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 2px 8px;
		border-radius: 20px;
		flex-shrink: 0;
	}
	.person-card.on-vac {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
	}
	.person-tasks {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 12.5px;
		padding-left: 18px;
		color: var(--text-soft);
	}
	.person-tasks li {
		word-break: break-word;
	}
	.task-text {
		word-break: break-word;
	}
	.tag-vac {
		display: inline-block;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 3px 9px;
		border-radius: 20px;
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
	.activity-pick {
		padding: 9px 11px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-size: 13px;
		flex-shrink: 0;
		max-width: 190px;
	}
	@media (max-width: 860px) {
		.ref-grid {
			grid-template-columns: 1fr;
		}
	}

	/* < 640px : le sélecteur de personne + le bouton vacances, et la recherche de ticket + le
	   select d'activité + le bouton, ne rentrent plus sur une ligne sans wrap -> ça débordait. */
	@media (max-width: 640px) {
		.person-row {
			flex-wrap: wrap;
		}
		.add-ticket {
			flex-wrap: wrap;
		}
		.add-ticket :global(.tp-root) {
			flex-basis: 100%;
		}
		.activity-pick {
			flex: 1;
			max-width: none;
		}
	}
</style>
