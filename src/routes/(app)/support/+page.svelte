<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatDayRange } from '$lib/utils/date';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import KeyIcon from '$lib/components/KeyIcon.svelte';
	import { buildDeck, evaluatePick, clearOpen, isWon } from '$lib/utils/memoryGame';
	import { formatDuration } from '$lib/supportDuration';

	let { data, form } = $props();

	let pickerOpen = $state(false);
	let editEntry = $state<(typeof data.ownTimeEntries)[number] | null>(null);
	// Valeur du <input type="datetime-local"> de la modale (heure locale, sans fuseau) : le jour
	// imputé + l'heure enregistrée, c'est-à-dire exactement ce que la ligne affiche.
	let editAt = $state('');
	function openEdit(entry: (typeof data.ownTimeEntries)[number]) {
		editAt = `${entry.day}T${fmtTime(entry.createdAt)}`;
		editEntry = entry;
	}
	const localNow = () => {
		const d = new Date();
		d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
		return d.toISOString().slice(0, 16);
	};
	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.timeError) toast.error(form.timeError);
		if (form?.timeOk) {
			toast.success('Temps mis à jour ✓');
			editEntry = null;
		}
		if (form?.timeDeleted) toast.success('Saisie supprimée ✓');
	});

	// Jeu des paires caché dans la grille du planning : les cases existantes deviennent des cartes
	// dès qu'on en clique une (pas de mode séparé). cardSeeds[i] === '' => case hors-jeu (nombre
	// de cases impair) ou jeu pas encore démarré.
	const flatDays = $derived(data.calendar.flatMap((week) => week.days));
	// Styles Dicebear "personnage" (on exclut icons/shapes/rings/thumbs, pas des avatars).
	const DICEBEAR_STYLES = [
		'adventurer',
		'avataaars',
		'big-ears',
		'big-smile',
		'bottts',
		'croodles',
		'fun-emoji',
		'lorelei',
		'micah',
		'notionists',
		'open-peeps',
		'personas',
		'pixel-art',
		'critters'
	];
	let dicebearStyle = $state('critters');
	let gameActive = $state(false);
	let busy = $state(false);
	let game = $state({ cardSeeds: [] as string[], matched: new Set<number>(), openIndexes: [] as number[], moves: 0 });

	function startGame(total: number) {
		dicebearStyle = DICEBEAR_STYLES[Math.floor(Math.random() * DICEBEAR_STYLES.length)];
		game = { cardSeeds: buildDeck(total), matched: new Set(), openIndexes: [], moves: 0 };
		gameActive = true;
	}

	function resetGame() {
		gameActive = false;
		game = { cardSeeds: [], matched: new Set(), openIndexes: [], moves: 0 };
	}

	function pick(i: number) {
		if (busy) return;
		if (!gameActive) startGame(flatDays.length);

		const { state, result } = evaluatePick(game, i);
		game = state;
		if (result === 'mismatch') {
			busy = true;
			setTimeout(() => {
				game = clearOpen(game);
				busy = false;
			}, 700);
		}
	}

	const gameWon = $derived(isWon(game));

	// Récap des 5 derniers jours ouvrés (du plus récent au plus ancien, cf. +page.server.ts).
	const recapTotal = $derived(data.dailyRecap.reduce((a, d) => a + d.minutes, 0));
	const fmtRecapDay = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(
			new Date(iso + 'T00:00:00Z')
		);

	// Le nombre de jours par semaine dans la grille reflète déjà le réglage "samedi inclus" (cf.
	// listDutyCalendar côté serveur) — on en déduit l'entête plutôt que de dupliquer le réglage ici.
	const WEEKDAYS = $derived(
		(data.calendar[0]?.days.length ?? 5) === 6 ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']
	);

	const firstName = (name: string) => name.split(/\s+/)[0];

	const fmtFull = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'));
	// Heure de création de la saisie (fuseau Paris) : le jour seul ne suffit pas à distinguer
	// plusieurs saisies du même jour sur le même ticket.
	const fmtTime = (d: Date) =>
		new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(
			new Date(d)
		);
	// "10 août" — jour + mois affichés dans chaque case du calendrier, pour se repérer sans colonne dédiée.
	const fmtCellDate = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso + 'T00:00:00Z'));

	const eyebrow = $derived.by(() => {
		if (!data.current) return '';
		const { periodStart, periodEnd } = data.current;
		if (periodStart === periodEnd) return `Aujourd'hui · ${fmtFull(periodStart)}`;
		const spanDays = Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000);
		const label = spanDays <= 6 ? 'Cette semaine' : 'Ce mois-ci';
		return `${label} · ${formatDayRange(periodStart, periodEnd)}`;
	});

	// Part écoulée de la période courante — masqué pour une cadence DAY (start === end, rien à montrer).
	const periodPct = $derived.by(() => {
		if (!data.current || data.current.periodStart === data.current.periodEnd) return null;
		const start = Date.parse(data.current.periodStart + 'T00:00:00Z');
		const end = Date.parse(data.current.periodEnd + 'T00:00:00Z') + 86400000;
		const today = Date.parse(data.todayISO + 'T00:00:00Z');
		return Math.max(4, Math.min(100, Math.round(((today - start) / (end - start)) * 100)));
	});

	// La confirmation vit dans `use:enhance` : avant l'hydratation, un clic partirait en POST natif
	// et supprimerait la saisie sans rien demander. Le bouton reste donc inerte jusque-là.
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	const confirmDeleteEntry =
		(entry: (typeof data.ownTimeEntries)[number]) =>
		async ({ cancel }: { cancel: () => void }) => {
			const ok = await confirmDialog({
				title: 'Supprimer la saisie',
				message: `${entry.ticketRef} · ${formatDuration(entry.minutes)} du ${fmtFull(entry.day)} — la saisie sera définitivement supprimée.`,
				confirmLabel: 'Supprimer'
			});
			if (!ok) cancel();
		};

	async function confirmSkip({ cancel }: { cancel: () => void }) {
		const ok = await confirmDialog({
			title: 'Passer le tour',
			message: `Toute la rotation décale d'un cran à partir de maintenant — ${data.current?.displayName} ne sera plus jamais désigné à cette place dans le cycle.`,
			confirmLabel: 'Passer au suivant'
		});
		if (!ok) cancel();
		else pickerOpen = false;
	}
</script>

<div class="topbar">
	<h1>Support<small>{data.supportEnabled ? 'Qui regarde les tickets' : 'Temps passé sur les tickets'}</small></h1>
	<div class="spacer"></div>
	{#if data.canViewHistory}
		<a class="btn btn-ghost" href="/support/historique">Historique complet →</a>
	{/if}
</div>

<div class="content support-layout">
	{#if data.supportEnabled}
	<section class="card header-card">
		{#if !data.current}
			<p class="empty-hint">Aucun membre dans la rotation pour l'instant — à configurer dans Paramètres &amp; membres.</p>
		{:else}
			<div class="header-row">
				<div class="header-person">
					<span class="duty-avatar-wrap" aria-hidden="true">
						<UserAvatar userId={data.current.userId} name={data.current.displayName} size={52} />
					</span>
					<div>
						<span class="eyebrow">{eyebrow}</span>
						<h2>{data.current.displayName}</h2>
						{#if data.current.overridden}<span class="pill current">🔁 remplacement ponctuel</span>{/if}
					</div>
				</div>

				{#if data.canManage}
					<div class="header-actions">
						<button class="btn btn-ghost" type="button" onclick={() => (pickerOpen = true)}>
							{data.current.overridden ? 'Changer le remplaçant' : "Quelqu'un est absent"}
						</button>
						{#if data.current.overridden}
							<form method="POST" action="?/clearOverride" use:enhance>
								<input type="hidden" name="periodStart" value={data.current.periodStart} />
								<button class="link-btn" type="submit">Revenir à la rotation</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>

			{#if periodPct !== null}
				<div class="period-track" title="Avancement de la période">
					<div class="period-fill" style="width:{periodPct}%"></div>
				</div>
			{/if}
		{/if}
	</section>

	{#if data.calendar.length > 0}
		<section class="card calendar-card">
			<div class="cal-head-row">
				<h3>Planning</h3>
				{#if gameActive}
					<span class="game-status">{gameWon ? `Gagné en ${game.moves} coups 🎉` : `${game.moves} coups`}</span>
					<button type="button" class="link-btn" onclick={resetGame}>Réinitialiser</button>
				{/if}
			</div>
			<div class="cal-scroll">
				<div class="cal-grid" style="--cal-cols:{WEEKDAYS.length}">
					{#each WEEKDAYS as w (w)}<div class="cal-head">{w}</div>{/each}
					{#each flatDays as day, i (day.date)}
						{@const active = Boolean(data.current) && day.date >= data.current!.periodStart && day.date <= data.current!.periodEnd}
						{@const flipped = gameActive && game.cardSeeds[i] && (game.matched.has(i) || game.openIndexes.includes(i))}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="cal-cell" class:today={day.date === data.todayISO} class:active class:game={gameActive} onclick={() => pick(i)}>
							{#if gameActive && game.cardSeeds[i]}
								<div class="cal-flip" class:flipped>
									<div class="cal-face cal-back">?</div>
									<div class="cal-face cal-front">
										<img src="https://api.dicebear.com/10.x/{dicebearStyle}/svg?seed={encodeURIComponent(game.cardSeeds[i])}" alt="" />
									</div>
								</div>
							{:else}
								<span class="cal-daynum"><span class="cal-weekday">{WEEKDAYS[i % WEEKDAYS.length]}</span> {fmtCellDate(day.date)}</span>
								<span class="cal-name">{firstName(day.displayName)}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}
	{/if}

	{#if data.timeTrackingEnabled}
		<section class="card time-block">
			<div class="time-block-header">
				<h3>Mon temps sur le support</h3>
				<button
					type="button"
					class="btn btn-primary time-add-btn"
					title="Ajouter une saisie (Shift+T)"
					onclick={() => window.dispatchEvent(new CustomEvent('supporttimeopen'))}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>
					Ajouter
					<kbd class="shortcut-kbd"><KeyIcon name="shift" />T</kbd>
				</button>
			</div>
			<div class="time-body">
			<!-- Avant la liste dans le DOM : sur mobile le résumé passe au-dessus du détail ; sur grand
			     écran la grille le range à droite. -->
			<aside class="recap" aria-label="Récapitulatif des 5 derniers jours ouvrés">
				<div class="recap-head">
					<span>5 derniers jours</span>
					<b class="tabnum">{recapTotal ? formatDuration(recapTotal, { weeks: false }) : '—'}</b>
				</div>
				<ol class="recap-days">
					{#each data.dailyRecap as d (d.day)}
						<li class="recap-day" class:today={d.day === data.todayISO} class:empty={d.minutes === 0 && d.tickets === 0}>
							<span class="recap-label">{fmtRecapDay(d.day)}</span>
							<span class="recap-time tabnum">{d.minutes ? formatDuration(d.minutes) : '—'}</span>
							<span class="recap-tickets">{d.tickets} ticket{d.tickets > 1 ? 's' : ''}</span>
						</li>
					{/each}
				</ol>
			</aside>
			<div class="time-list">
			{#if data.ownTimeEntries.length === 0}
				<p class="empty-hint">Aucune saisie pour l'instant.</p>
			{:else}
				<div class="time-table-wrap">
					<table class="time-table">
						<thead><tr><th>Jour</th><th>Ticket</th><th class="num">Durée</th><th></th></tr></thead>
						<tbody>
							{#each data.ownTimeEntries as entry (entry.id)}
								<tr>
									<td>{fmtFull(entry.day)} <span class="time-hour tabnum">{fmtTime(entry.createdAt)}</span></td>
									<td>{entry.ticketRef}</td>
									<td class="num tabnum">{formatDuration(entry.minutes)}</td>
									<td class="time-row-actions">
										<button
											type="button"
											class="icon-btn"
											title="Modifier"
											aria-label="Modifier la saisie"
											onclick={() => openEdit(entry)}
										>
											<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
										</button>
										<form method="POST" action="?/deleteTimeEntry" use:enhance={confirmDeleteEntry(entry)}>
											<input type="hidden" name="id" value={entry.id} />
											<button
												type="submit"
												class="icon-btn icon-btn-danger"
												title="Supprimer"
												aria-label="Supprimer la saisie"
												disabled={!hydrated}
											>
												<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
											</button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			</div>
			</div>
		</section>
	{/if}
</div>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (editEntry) editEntry = null;
		else if (pickerOpen) pickerOpen = false;
	}}
/>

{#if pickerOpen && data.current}
	{@const current = data.current}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (pickerOpen = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Absence de {current.displayName}</h3>
			<p class="hint">Choisissez qui prend le relais pour {eyebrow.split(' · ')[0].toLowerCase()}, ou passez directement au suivant dans l'ordre.</p>

			<form
				method="POST"
				action="?/override"
				use:enhance={() => async ({ update }) => {
					pickerOpen = false;
					update();
				}}
			>
				<input type="hidden" name="periodStart" value={current.periodStart} />
				<div class="candidates">
					{#each data.members as m (m.id)}
						<button
							type="submit"
							name="userId"
							value={m.userId}
							class="candidate-row"
							class:sel={m.userId === current.userId}
							disabled={m.userId === current.userId}
						>
							<UserAvatar userId={m.userId} name={m.displayName} size={22} />
							{m.displayName}
							{#if m.userId === current.userId}<span class="candidate-tag">actuel</span>{/if}
						</button>
					{/each}
				</div>
			</form>

			<div class="modal-divider"></div>

			<form method="POST" action="?/skip" use:enhance={confirmSkip}>
				<input type="hidden" name="periodStart" value={current.periodStart} />
				<button class="skip-btn" type="submit">
					⏭️ Passer son tour
					<span>Décale toute la rotation d'un cran, pour cette période et les suivantes</span>
				</button>
			</form>

			<div class="modal-actions">
				<button class="btn btn-ghost" type="button" onclick={() => (pickerOpen = false)}>Fermer</button>
			</div>
		</div>
	</div>
{/if}

{#if editEntry}
	{@const entry = editEntry}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (editEntry = null)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Modifier cette saisie</h3>
			<p class="hint">Seules tes propres saisies sont modifiables.</p>
			<form method="POST" action="?/editTimeEntry" use:enhance>
				<input type="hidden" name="id" value={entry.id} />
				<div class="field">
					<label for="et-ticket">Ticket</label>
					<input id="et-ticket" name="ticketRef" value={entry.ticketRef} required />
				</div>
				<div class="field">
					<label for="et-duration">Durée</label>
					<input id="et-duration" name="duration" value={formatDuration(entry.minutes)} required />
				</div>
				<div class="field">
					<label for="et-at">Jour et heure</label>
					<input id="et-at" type="datetime-local" bind:value={editAt} max={localNow()} required />
					<!-- Le serveur reçoit un instant ISO : c'est le navigateur qui connaît le fuseau. -->
					<input type="hidden" name="at" value={editAt ? new Date(editAt).toISOString() : ''} />
				</div>
				<div class="modal-actions">
					<button class="btn btn-ghost" type="button" onclick={() => (editEntry = null)}>Annuler</button>
					<button class="btn btn-primary" type="submit">Enregistrer</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.support-layout {
		max-width: 980px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.empty-hint {
		color: var(--text-mute);
		font-size: 13.5px;
		margin: 0;
	}

	/* ---------- Header ---------- */
	.header-card {
		padding: 28px 32px;
	}
	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		flex-wrap: wrap;
	}
	.header-person {
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.duty-avatar-wrap {
		position: relative;
		flex-shrink: 0;
		border-radius: 50%;
		box-shadow: 0 0 0 4px var(--accent-tint-2);
	}
	.duty-avatar-wrap::after {
		content: '';
		position: absolute;
		inset: -6px;
		border-radius: 50%;
		border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
		animation: pulse 2.6s ease-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.duty-avatar-wrap::after {
			animation: none;
		}
	}
	@keyframes pulse {
		0% {
			opacity: 0.55;
			transform: scale(0.85);
		}
		75%,
		100% {
			opacity: 0;
			transform: scale(1.8);
		}
	}
	.eyebrow {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 2px;
	}
	.header-person h2 {
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 0 0 6px;
	}
	.pill.current {
		margin: 0;
	}
	.header-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		padding-top: 4px;
	}
	.link-btn {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		padding: 2px 0;
	}
	.link-btn:hover {
		text-decoration: underline;
	}

	.period-track {
		width: 100%;
		height: 5px;
		border-radius: 30px;
		background: var(--surface-sunk);
		overflow: hidden;
		margin-top: 18px;
	}
	.period-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 30px;
	}

	/* ---------- Calendrier ---------- */
	.calendar-card {
		padding: 24px 28px 28px;
	}
	.calendar-card h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 16px;
	}
	.cal-scroll {
		overflow-x: auto;
	}
	.cal-grid {
		display: grid;
		grid-template-columns: repeat(var(--cal-cols, 5), minmax(96px, 1fr));
		gap: 10px;
		min-width: calc(var(--cal-cols, 5) * 96px);
	}
	.cal-head {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-mute);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		text-align: center;
		padding-bottom: 6px;
	}
	.cal-cell {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 70px;
		padding: 12px 8px 10px;
		border-radius: var(--r-md);
		background: var(--surface-sunk);
		border: 1px solid transparent;
		transition: border-color 0.15s;
	}
	.cal-cell.active {
		background: var(--accent-tint-2);
	}
	.cal-cell.today {
		border-color: var(--accent);
	}
	.cal-cell.game {
		cursor: pointer;
	}
	.cal-flip {
		position: relative;
		width: 46px;
		height: 46px;
		perspective: 400px;
	}
	.cal-flip > * {
		transition: transform 0.3s;
	}
	.cal-face {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		backface-visibility: hidden;
		transform-style: preserve-3d;
	}
	.cal-back {
		background: var(--border);
		color: var(--text-mute);
		font-weight: 700;
		font-size: 18px;
	}
	.cal-front {
		background: var(--accent-tint-2);
		transform: rotateY(180deg);
	}
	.cal-front img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
	}
	.cal-flip.flipped .cal-back {
		transform: rotateY(180deg);
	}
	.cal-flip.flipped .cal-front {
		transform: rotateY(360deg);
	}
	.game-status {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.cal-daynum {
		position: absolute;
		top: 7px;
		right: 9px;
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.cal-cell.today .cal-daynum {
		color: var(--accent);
		font-weight: 700;
	}
	.cal-weekday {
		display: none;
	}
	.cal-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-soft);
		text-align: center;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.cal-cell.active .cal-name {
		color: var(--accent-ink);
	}
	:global([data-theme='dark']) .cal-cell.active .cal-name {
		color: color-mix(in srgb, var(--accent) 78%, #fff);
	}
	.cal-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.cal-head-row h3 {
		margin: 0;
	}

	/* < 640px : la grille à colonnes fixes ne rentre plus (elle "dépassait" et forçait un scroll
	   horizontal peu lisible) — on repasse en liste verticale, une ligne par jour. */
	@media (max-width: 640px) {
		.cal-scroll {
			overflow-x: visible;
		}
		.cal-grid {
			grid-template-columns: 1fr;
			min-width: 0;
			gap: 6px;
		}
		.cal-head {
			display: none;
		}
		.cal-cell {
			flex-direction: row;
			align-items: center;
			justify-content: flex-start;
			gap: 12px;
			min-height: auto;
			padding: 11px 14px;
		}
		.cal-daynum {
			position: static;
			flex-shrink: 0;
			white-space: nowrap;
			font-size: 12.5px;
		}
		.cal-weekday {
			display: inline;
			color: var(--text);
			font-weight: 700;
		}
		.cal-name {
			flex: 1;
			min-width: 0;
			margin-left: auto;
			text-align: right;
		}
	}

	/* ---------- Modale de remplacement ---------- */
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
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-lg);
		padding: 24px;
		width: 100%;
		max-width: 420px;
	}
	/* iOS Safari donne aux champs date/heure une largeur intrinsèque qui ignore `width: 100%` et
	   ne se comprime pas : sans ça le champ déborde de la modale sur téléphone. */
	.modal .field input[type='datetime-local'] {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.modal h3 {
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		margin-bottom: 4px;
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		line-height: 1.5;
	}
	.candidates {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 16px;
	}
	.candidate-row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		padding: 8px 9px;
		border-radius: var(--r-md);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
		text-align: left;
	}
	.candidate-row:not(:disabled):hover {
		background: var(--surface-2);
	}
	.candidate-row:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.candidate-row.sel {
		background: var(--accent-tint-2);
	}
	.candidate-tag {
		margin-left: auto;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.modal-divider {
		height: 1px;
		background: var(--border);
		margin: 18px 0 14px;
	}
	.skip-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 10px 12px;
		border-radius: var(--r-md);
		border: 1px dashed var(--border-strong);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-soft);
	}
	.skip-btn:hover {
		border-color: var(--accent);
		color: var(--text);
	}
	.skip-btn span {
		font-size: 11.5px;
		font-weight: 500;
		color: var(--text-mute);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 18px;
	}

	/* ---------- Temps sur le support ---------- */
	.time-block {
		padding: 24px 28px 28px;
	}
	.time-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}
	.time-block h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
	}
	.time-add-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.shortcut-kbd {
		display: inline-flex;
		align-items: center;
		font-family: ui-monospace, monospace;
		font-size: 10.5px;
		line-height: 1;
		background: rgba(255, 255, 255, 0.22);
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 4px;
		padding: 2px 5px;
		margin-left: 2px;
		gap: 2px; /* entre l'icône Maj (KeyIcon) et la lettre */
	}
	.time-table-wrap {
		overflow-x: auto;
	}

	/* Liste + récap : récap à droite sur grand écran, au-dessus de la liste sur mobile. */
	.time-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 210px;
		grid-template-areas: 'list recap';
		gap: 24px;
		align-items: start;
	}
	.time-list {
		grid-area: list;
		min-width: 0;
	}
	.recap {
		grid-area: recap;
		padding-left: 20px;
		border-left: 1px solid var(--border);
	}
	.recap-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		margin-bottom: 10px;
	}
	.recap-head b {
		font-size: 13px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text);
	}
	.recap-days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.recap-day {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas: 'label time' 'tickets tickets';
		column-gap: 8px;
		row-gap: 3px;
		padding: 8px 10px;
		border-radius: var(--r-md);
		background: var(--surface-sunk);
		border: 1px solid transparent;
	}
	.recap-day.today {
		border-color: var(--accent);
	}
	.recap-label {
		grid-area: label;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		text-transform: capitalize;
	}
	.recap-day.today .recap-label {
		color: var(--accent);
	}
	.recap-time {
		grid-area: time;
		font-size: 13px;
		font-weight: 700;
	}
	.recap-tickets {
		grid-area: tickets;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.recap-day.empty .recap-time,
	.recap-day.empty .recap-tickets {
		color: var(--text-mute);
		font-weight: 500;
	}

	@media (max-width: 760px) {
		.time-body {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'recap' 'list';
			gap: 18px;
		}
		.recap {
			padding-left: 0;
			border-left: none;
		}
		/* Une ligne par jour (jour · temps · tickets) : des tuiles côte à côte tronquaient les
		   libellés dès 320 px de large. */
		.recap-days {
			gap: 4px;
		}
		.recap-day {
			grid-template-columns: minmax(0, 1fr) 52px 64px;
			grid-template-areas: 'label time tickets';
			align-items: center;
			padding: 7px 10px;
		}
		.recap-time {
			text-align: right;
		}
		.recap-tickets {
			text-align: right;
			white-space: nowrap;
		}
	}
	.time-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
	}
	.time-table th {
		text-align: left;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
		padding: 0 10px 8px;
		white-space: nowrap;
	}
	.time-table td {
		padding: 9px 10px;
		border-top: 1px solid var(--border);
		white-space: nowrap;
	}
	.time-table .num {
		text-align: right;
	}
	/* .icon-btn vient de app.css (bouton icône standard de l'appli) — on n'ajoute ici que la
	   disposition en ligne et la teinte de survol de la suppression. */
	/* Pas de `display: flex` sur la cellule : ça la sort de la grille du tableau et le filet de
	   séparation s'arrête avant la dernière colonne. */
	.time-row-actions {
		text-align: right;
		white-space: nowrap;
	}
	.time-row-actions form {
		display: inline-block;
		vertical-align: middle;
		margin-left: 6px;
	}
	/* .icon-btn (app.css) est un bloc `grid` : sur une ligne de tableau il faut le repasser en
	   ligne pour que crayon et corbeille restent côte à côte. */
	.time-row-actions .icon-btn {
		display: inline-grid;
		vertical-align: middle;
	}
	.time-hour {
		color: var(--text-mute);
		font-size: 12px;
	}
	.icon-btn-danger {
		color: var(--text-soft);
	}
	.icon-btn-danger:hover,
	.icon-btn-danger:focus-visible {
		background: color-mix(in srgb, var(--warn) 14%, transparent);
		color: var(--warn);
	}
</style>
