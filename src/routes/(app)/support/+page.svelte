<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatDayRange } from '$lib/utils/date';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { buildDeck, evaluatePick, clearOpen, isWon } from '$lib/utils/memoryGame';
	import { formatDuration } from '$lib/supportDuration';

	let { data, form } = $props();

	let pickerOpen = $state(false);
	let editEntry = $state<(typeof data.ownTimeEntries)[number] | null>(null);
	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.timeError) toast.error(form.timeError);
		if (form?.timeOk) {
			toast.success('Temps mis à jour ✓');
			editEntry = null;
		}
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

	// Le nombre de jours par semaine dans la grille reflète déjà le réglage "samedi inclus" (cf.
	// listDutyCalendar côté serveur) — on en déduit l'entête plutôt que de dupliquer le réglage ici.
	const WEEKDAYS = $derived(
		(data.calendar[0]?.days.length ?? 5) === 6 ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']
	);

	const firstName = (name: string) => name.split(/\s+/)[0];

	const fmtFull = (iso: string) =>
		new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00Z'));
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
	<h1>Support<small>Qui regarde les tickets</small></h1>
	<div class="spacer"></div>
	{#if data.canViewHistory}
		<a class="btn btn-ghost" href="/support/historique">Historique complet →</a>
	{/if}
</div>

<div class="content support-layout">
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

	{#if data.timeTrackingEnabled}
		<section class="card time-block">
			<h3>Mon temps sur le support</h3>
			{#if data.ownTimeEntries.length === 0}
				<p class="empty-hint">Aucune saisie pour l'instant — <kbd>Shift</kbd>+<kbd>T</kbd> depuis n'importe quelle page pour en ajouter une.</p>
			{:else}
				<div class="time-table-wrap">
					<table class="time-table">
						<thead><tr><th>Jour</th><th>Ticket</th><th class="num">Durée</th><th></th></tr></thead>
						<tbody>
							{#each data.ownTimeEntries as entry (entry.id)}
								<tr>
									<td>{fmtFull(entry.day)}</td>
									<td>{entry.ticketRef}</td>
									<td class="num tabnum">{formatDuration(entry.minutes)}</td>
									<td class="time-row-actions">
										<button type="button" class="link-btn" onclick={() => (editEntry = entry)}>Modifier</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
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
					<label for="et-day">Jour</label>
					<input id="et-day" name="day" type="date" value={entry.day} required />
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
	.time-block h3 {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 16px;
	}
	.time-table-wrap {
		overflow-x: auto;
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
	.time-row-actions {
		text-align: right;
	}
</style>
