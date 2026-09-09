<script lang="ts">
	import { enhance } from '$app/forms';
	import { navigating } from '$app/state';
	import { toast } from 'svelte-sonner';
	import ObjectivePalette from '$lib/components/ObjectivePalette.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { downloadSvgAsPng } from '$lib/utils/svgToPng';

	let { data, form } = $props();
	$effect(() => {
		if (form?.error) toast.error(form.error);
		else if (form?.objOk) toast.success('Mis à jour ✓');
	});

	let imgBusy = $state(false);
	let palette: ObjectivePalette | undefined = $state();

	// Cochage optimiste : la case doit répondre au clic, pas au retour du serveur. L'entrée est
	// retirée dès que `update()` a rapatrié la vérité (ou tout de suite en cas d'échec), pour ne pas
	// masquer indéfiniment ce que dit la base — notamment quand quelqu'un d'autre coche la même ligne.
	let doneOverride = $state<Record<string, boolean>>({});
	const isDone = (o: { id: string; doneAt: Date | null }) => doneOverride[o.id] ?? !!o.doneAt;

	const isNavigating = $derived(!!navigating.to);
	const onVacation = $derived(new Set(data.vacations));

	/** Chacun coche les siennes ; un admin/manager coche pour tout le monde (revérifié serveur). */
	const canCheck = (userId: string) => data.canManage || userId === data.selfId;

	const withObjectives = $derived(
		data.members.map((m) => ({ ...m, objectives: data.objectives.filter((o) => o.userId === m.id) }))
	);
	// Les personnes en congés n'ont rien à montrer : leur donner une carte pleine taille gâche de la
	// place, elles passent dans une bande compacte en bas.
	const activeMembers = $derived(
		withObjectives
			.filter((m) => !onVacation.has(m.id))
			.sort((a, b) => {
				// Un membre vient d'abord voir ce qu'on attend de LUI : sa carte passe en tête. Pour un
				// manager, qui lit la semaine de toute l'équipe, l'ordre reste le plus chargé d'abord.
				if (!data.canManage) {
					if (a.id === data.selfId) return -1;
					if (b.id === data.selfId) return 1;
				}
				return b.objectives.length - a.objectives.length;
			})
	);
	const vacationMembers = $derived(data.members.filter((m) => onVacation.has(m.id)));
	/** Personnes attribuables dans la palette — jamais quelqu'un en congés, addObjective le refuse. */
	const assignable = $derived(activeMembers.map((m) => ({ id: m.id, displayName: m.displayName })));

	// Un manager suit l'avancement de l'équipe entière, un membre le sien : c'est la seule part sur
	// laquelle il peut agir.
	const tracked = $derived(data.canManage ? data.objectives : data.objectives.filter((o) => o.userId === data.selfId));
	const doneCount = $derived(tracked.filter((o) => isDone(o)).length);

	const isCurrentWeek = $derived(data.weekMondayISO === data.currentWeekMondayISO);

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

	// La palette envoie ses ajouts/retraits en POST direct (pas de <form> à elle) puis on recharge —
	// elle reste ouverte, seule la grille derrière et sa propre liste doivent suivre.
	async function post(action: string, body: Record<string, string>) {
		const fd = new FormData();
		for (const [k, v] of Object.entries(body)) fd.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body: fd });
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
		if (!res.ok) toast.error('Erreur lors de la mise à jour.');
	}
</script>

{#snippet ticketIcon()}
	<svg class="ic-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
		<path d="M13 6v2M13 11v2M13 16v2" />
	</svg>
{/snippet}

{#snippet taskIcon()}
	<svg class="ic-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<rect x="5" y="4" width="14" height="16" rx="2" />
		<path d="M9 9h6M9 13h6M9 17h3" />
	</svg>
{/snippet}

{#snippet vacationIcon()}
	<svg class="ic-inline" viewBox="0 0 32 32" fill="currentColor">
		<path d="M14.5,24c-5.2,0-10.1,2.3-13.3,6.4c-0.2,0.3-0.3,0.7-0.1,1.1S1.6,32,2,32h25c0.4,0,0.7-0.2,0.9-0.6s0.1-0.8-0.1-1.1C24.6,26.3,19.7,24,14.5,24z" />
		<path d="M30.1,5.7c-3-1.7-6.2-1.8-9-0.4c-1.5,0.8-2.7,1.9-3.6,3.4c-0.3-2.1-1.2-3.9-2.7-5.3c-2.3-2.1-5.6-2.8-9-1.8C5.5,1.7,5.2,1.9,5.1,2.3c-0.1,0.4,0,0.7,0.3,1l2.6,2.4c0.1,0.1,0.3,0.2,0.4,0.2l0.7,0.2c0,0.1,0,0.2,0,0.2c0,0.3,0.1,0.5,0.3,0.7l1.1,1c-0.2,0-0.4,0-0.7,0c-3.1,0-5.9,1.6-7.8,4.4c-0.2,0.3-0.2,0.7,0,1C2.3,13.8,2.6,14,3,14h3.6c0.2,0,0.3,0,0.4-0.1l0.7-0.4C7.9,13.8,8.2,14,8.6,14h6.7c0.7,2.7,0.5,5.5-0.7,8c2.4,0,4.8,0.5,7,1.4c0.4-3.2-0.2-6.5-1.9-9.4l-0.6-1l1.6-0.8c0.1-0.1,0.3-0.2,0.3-0.3l0.5-0.6c0.3,0.2,0.6,0.2,1,0L30,7.5c0.3-0.2,0.5-0.5,0.5-0.9C30.6,6.2,30.4,5.9,30.1,5.7z" />
	</svg>
{/snippet}

{#snippet objectiveLabel(o: (typeof data.objectives)[number])}
	{#if o.kind === 'TICKET'}
		<!-- Même règle que l'export PNG (objectivesSvg.objectiveLine) et Mon imputation
		     (`row.objectiveNote || row.label`) : une note posée sur un objectif TICKET remplace le titre
		     du ticket, la clé reste toujours visible. Elle dit ce qu'on attend cette semaine — plus
		     précis que le titre, donc c'est elle qu'on lit, pas une bulle accrochée derrière. -->
		<span class="task-ico">{@render ticketIcon()}</span> <b>{o.ticketKey}</b> — {o.label || o.ticketTitle}
	{:else}
		<span class="task-ico">{@render taskIcon()}</span> {o.label}
	{/if}
	{#if o.activityLabel}<span class="tag-activity">{o.activityLabel}</span>{/if}
{/snippet}

<div class="topbar">
	<h1>Objectifs de la semaine<small>Semaine {data.weekNumber} · {data.weekLabel}</small></h1>
	<div class="spacer"></div>
	{#if isNavigating}<span class="loading-hint">Chargement…</span>{/if}
	<div class="wknav" class:disabled={isNavigating}>
		<a class="wkbtn" href="?w={data.prevWeek}" aria-label="Semaine précédente" aria-disabled={isNavigating} onclick={(e) => { if (isNavigating) e.preventDefault(); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
		</a>
		<span class="cur">S{data.weekNumber}</span>
		<a class="wkbtn" href="?w={data.nextWeek}" aria-label="Semaine suivante" aria-disabled={isNavigating} onclick={(e) => { if (isNavigating) e.preventDefault(); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6"/></svg>
		</a>
	</div>
	<!-- La préparation de la semaine suivante ne concerne que le vendredi : un bouton, pas le défaut
	     de la page (qui coûtait un aller-retour les quatre autres jours). -->
	{#if data.canManage && isCurrentWeek}
		<a class="next-week" href="?w={data.nextWeek}">Préparer <b>S{data.nextWeekNumber}</b></a>
	{/if}
</div>

<div class="content admin">
	{#if data.isPastWeek}
		<div class="page-banner past">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
			Semaine {data.weekNumber}, terminée — {doneCount} / {tracked.length} objectif{tracked.length > 1 ? 's' : ''} fait{doneCount > 1 ? 's' : ''}.
		</div>
	{:else if !data.canManage}
		<div class="page-banner">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>
			Coche tes objectifs au fil de la semaine. L'attribution est faite par ton manager.
		</div>
	{/if}

	{#if data.members.length === 0}
		<section class="card block"><p class="hint" style="margin:0;">Aucun membre actif dans cet espace.</p></section>
	{:else}
		<section class="card block">
			<div class="block-head">
				<div>
					<h3>Vue globale — Semaine {data.weekNumber}</h3>
					<p class="hint">Ce que chaque membre a comme objectif cette semaine.</p>
				</div>
				<div class="head-tools">
					{#if tracked.length > 0}
						<span class="progress" title={data.canManage ? "Avancement de l'équipe" : 'Ton avancement'}>
							{doneCount} / {tracked.length} fait{doneCount > 1 ? 's' : ''}
							<span class="bar"><span style="width:{(doneCount / tracked.length) * 100}%"></span></span>
						</span>
					{/if}
					{#if data.canManage}
						<button class="btn btn-ghost" type="button" disabled={imgBusy} onclick={downloadObjectivesPng}>
							{imgBusy ? 'Génération…' : '⬇ Exporter en image (PNG)'}
						</button>
					{/if}
				</div>
			</div>

			<div class="ref-grid">
				{#each activeMembers as m (m.id)}
					{@const mine = m.objectives}
					{@const allDone = mine.length > 0 && mine.every((o) => isDone(o))}
					<section class="card block person-card" class:me={m.id === data.selfId} class:all-done={allDone}>
						<div class="person-card-head">
							<UserAvatar userId={m.id} name={m.displayName} size={26} />
							<h3>{m.displayName}</h3>
							{#if m.id === data.selfId}<span class="you">Vous</span>{/if}
							{#if data.canManage}
								<form method="POST" action="?/toggleVacation" use:enhance>
									<input type="hidden" name="userId" value={m.id} />
									<input type="hidden" name="weekMondayISO" value={data.weekMondayISO} />
									<input type="hidden" name="onVacation" value="true" />
									<button class="icon-btn" type="submit" title="Marquer en congés cette semaine" aria-label="Marquer {m.displayName} en congés">
										{@render vacationIcon()}
									</button>
								</form>
							{/if}
							{#if mine.length > 0}
								<span class="obj-count" class:full={allDone}>{allDone ? `${mine.length} / ${mine.length}` : mine.length}</span>
							{/if}
						</div>

						{#if mine.length === 0}
							<p class="hint" style="margin:0;">Aucun objectif cette semaine.</p>
						{:else}
							<ul class="person-tasks">
								{#each mine as o, i (o.id)}
									{@const done = isDone(o)}
									<li class="task-row" class:done>
										<!-- Un <button role="checkbox"> et pas un <input> : la case est un vrai submit, donc
										     elle fonctionne aussi sans JavaScript, comme le reste de la page. -->
										<form
											method="POST"
											action="?/toggleDone"
											use:enhance={() => {
												doneOverride[o.id] = !done;
												return async ({ result, update }) => {
													if (result.type === 'failure') delete doneOverride[o.id];
													await update({ reset: false });
													delete doneOverride[o.id];
												};
											}}
										>
											<input type="hidden" name="id" value={o.id} />
											<input type="hidden" name="done" value={String(!done)} />
											<button
												class="obj-check"
												type="submit"
												role="checkbox"
												aria-checked={done}
												disabled={!canCheck(m.id)}
												title={canCheck(m.id) ? (done ? 'Marquer comme non fait' : 'Marquer comme fait') : `Seul·e ${m.displayName} peut cocher cet objectif.`}
												aria-label="{done ? 'Marquer comme non fait' : 'Marquer comme fait'} : {o.kind === 'TICKET' ? o.ticketKey : o.label}"
											>
												{#if done}
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6" /></svg>
												{/if}
											</button>
										</form>
										<span class="task-text">{@render objectiveLabel(o)}</span>
										{#if data.canManage}
											<span class="row-ctl">
												<form method="POST" action="?/moveObjective" use:enhance>
													<input type="hidden" name="id" value={o.id} />
													<input type="hidden" name="dir" value="up" />
													<button class="ctl-btn" type="submit" disabled={i === 0} aria-label="Monter">↑</button>
												</form>
												<form method="POST" action="?/moveObjective" use:enhance>
													<input type="hidden" name="id" value={o.id} />
													<input type="hidden" name="dir" value="down" />
													<button class="ctl-btn" type="submit" disabled={i === mine.length - 1} aria-label="Descendre">↓</button>
												</form>
												<form method="POST" action="?/removeObjective" use:enhance>
													<input type="hidden" name="id" value={o.id} />
													<button class="ctl-btn ctl-danger" type="submit" aria-label="Retirer cet objectif">✕</button>
												</form>
											</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if data.canManage}
							<button class="add-row" type="button" onclick={() => palette?.show(m.id)}>
								<!-- Croix dessinée, pas le caractère "+" : le glyphe s'assoit sur l'axe mathématique de
								     la police, plus haut que le centre optique de sa pastille, et aucun centrage CSS ne
								     rattrape ça. Un SVG a la géométrie exacte. -->
								<span class="plus" aria-hidden="true">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
								</span>
								Ajouter un objectif
							</button>
						{/if}
					</section>
				{/each}
			</div>

			{#if vacationMembers.length > 0}
				<div class="vac-strip">
					{#each vacationMembers as m (m.id)}
						{#if data.canManage}
							<form method="POST" action="?/toggleVacation" use:enhance>
								<input type="hidden" name="userId" value={m.id} />
								<input type="hidden" name="weekMondayISO" value={data.weekMondayISO} />
								<input type="hidden" name="onVacation" value="false" />
								<button type="submit" class="vac-chip" title="Remettre {m.displayName} dans la grille">
									<UserAvatar userId={m.id} name={m.displayName} size={16} />
									{@render vacationIcon()} {m.displayName}
								</button>
							</form>
						{:else}
							<span class="vac-chip">
								<UserAvatar userId={m.id} name={m.displayName} size={16} />
								{@render vacationIcon()} {m.displayName}
							</span>
						{/if}
					{/each}
					<span class="hint" style="margin:0 0 0 4px;">en congés cette semaine</span>
				</div>
			{/if}
		</section>
	{/if}
</div>

{#if data.canManage}
	<ObjectivePalette
		bind:this={palette}
		tickets={data.tickets}
		activities={data.activities}
		members={assignable}
		objectives={data.objectives}
		weekNumber={data.weekNumber}
		onadd={(input) =>
			post('addObjective', {
				userId: input.userId,
				weekMondayISO: data.weekMondayISO,
				kind: input.kind,
				ticketId: input.ticketId,
				label: input.label,
				activityId: input.activityId
			})}
		onremove={(id) => post('removeObjective', { id })}
	/>
{/if}

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
	.wknav.disabled {
		opacity: 0.6;
		pointer-events: none;
	}
	.loading-hint {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.cur {
		padding: 0 12px;
		font-weight: 600;
		font-size: 13.5px;
		font-variant-numeric: tabular-nums;
	}
	.next-week {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 8px 12px;
		box-shadow: var(--shadow-sm);
		white-space: nowrap;
		transition: border-color 0.15s;
	}
	.next-week:hover {
		border-color: var(--border-strong);
	}
	.next-week b {
		color: var(--accent-ink);
	}

	.page-banner {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 13px;
		color: var(--accent-ink);
		background: var(--accent-tint-2);
		border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
		border-radius: var(--r-md);
		padding: 10px 14px;
		margin-bottom: 16px;
	}
	.page-banner svg {
		flex-shrink: 0;
	}
	.page-banner.past {
		color: var(--text-soft);
		background: var(--surface-sunk);
		border-color: var(--border);
	}

	.block-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.head-tools {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	.head-tools .btn {
		white-space: nowrap;
		flex-shrink: 0;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12.5px;
		color: var(--text-soft);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.progress .bar {
		width: 110px;
		height: 6px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.progress .bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 20px;
		transition: width 0.25s;
	}

	.ref-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 18px;
	}
	.ref-grid .block {
		margin-bottom: 0;
	}
	.person-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		text-align: left;
	}
	.person-card h3 {
		font-size: 14px;
		margin-bottom: 0;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.person-card.me {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
	}
	.person-card.all-done {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
	}
	.person-card-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.you {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent-ink);
		background: var(--accent-tint);
		padding: 2px 7px;
		border-radius: 20px;
		flex-shrink: 0;
	}
	.icon-btn {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		color: var(--text-mute);
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}
	.icon-btn:hover {
		background: var(--surface-sunk);
		color: var(--text-soft);
	}
	.obj-count {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 2px 8px;
		border-radius: 20px;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}
	.obj-count.full {
		background: var(--accent-tint);
		color: var(--accent-ink);
	}

	.person-tasks {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12.5px;
		list-style: none;
		color: var(--text-soft);
	}
	.task-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.task-text {
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}
	.task-row.done .task-text {
		color: var(--text-mute);
		/* L'état "fait" ne repose jamais sur la seule couleur (un membre de l'équipe est daltonien) :
		   le texte barré et la coche dessinée le disent aussi. */
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--text-mute) 60%, transparent);
	}
	.task-row.done .task-text :global(b) {
		font-weight: 600;
		color: inherit;
	}
	.task-row.done .task-ico {
		color: var(--text-mute);
	}

	.obj-check {
		width: 16px;
		height: 16px;
		margin-top: 2px;
		border: 1.6px solid var(--border-strong);
		border-radius: 4px;
		background: var(--surface);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		color: #fff;
		transition: background 0.12s, border-color 0.12s;
	}
	.obj-check svg {
		width: 10px;
		height: 10px;
	}
	.obj-check[aria-checked='true'] {
		background: var(--accent);
		border-color: var(--accent);
	}
	.obj-check:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.obj-check:disabled {
		cursor: default;
		opacity: 0.75;
	}
	.obj-check:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* Ordre et suppression au survol seulement — ils encombreraient trois lignes sur quatre. Rendus
	   permanents au focus clavier et sur écran tactile, où il n'y a pas de survol. */
	.row-ctl {
		display: flex;
		gap: 1px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.task-row:hover .row-ctl,
	.task-row:focus-within .row-ctl {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.row-ctl {
			opacity: 1;
		}
	}
	.ctl-btn {
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: 5px;
		color: var(--text-mute);
		font-size: 11px;
		line-height: 1;
	}
	.ctl-btn:hover:not(:disabled) {
		background: var(--surface-sunk);
		color: var(--text);
	}
	.ctl-btn:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.ctl-danger:hover:not(:disabled) {
		color: #c0392b;
	}

	.add-row {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		border-top: 1px dashed var(--border-strong);
		padding-top: 10px;
		margin-top: auto;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		text-align: left;
		transition: color 0.15s;
	}
	.add-row:hover {
		color: var(--accent-ink);
	}
	.add-row .plus {
		width: 17px;
		height: 17px;
		flex-shrink: 0;
		border-radius: 5px;
		background: var(--surface-sunk);
		display: grid;
		place-items: center;
		color: var(--text-soft);
	}
	/* display:block : sans lui le svg reste en ligne et l'espace sous la ligne de base le décale. */
	.add-row .plus svg {
		display: block;
		width: 11px;
		height: 11px;
	}

	.vac-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 16px;
	}
	.vac-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
		background: var(--surface-sunk);
		border: 1px solid transparent;
		padding: 4px 10px;
		border-radius: 20px;
		transition: border-color 0.15s, color 0.15s;
	}
	button.vac-chip:hover {
		color: var(--text-soft);
		border-color: var(--border-strong);
	}

	.task-ico {
		display: inline-flex;
		color: var(--accent);
		vertical-align: -0.2em;
	}
	.ic-inline {
		width: 1em;
		height: 1em;
		flex-shrink: 0;
		vertical-align: -0.15em;
	}
	.task-ico .ic-inline {
		width: 1.3em;
		height: 1.3em;
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

	@media (max-width: 860px) {
		.ref-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
