<script lang="ts">
	import { enhance } from '$app/forms';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatDayRange } from '$lib/utils/date';

	let { data, form } = $props();

	let pickerOpen = $state(false);

	const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

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
</div>

<div class="content support-layout">
	<section class="card header-card">
		{#if form?.error}<div class="flash error">{form.error}</div>{/if}

		{#if !data.current}
			<p class="empty-hint">Aucun membre dans la rotation pour l'instant — à configurer dans Paramètres &amp; membres.</p>
		{:else}
			<div class="header-row">
				<div class="header-person">
					<span class="avatar-now"><span class="glow" aria-hidden="true"></span>{initials(data.current.displayName)}</span>
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
			<h3>Planning</h3>
			<div class="cal-scroll">
				<div class="cal-grid">
					{#each WEEKDAYS as w (w)}<div class="cal-head">{w}</div>{/each}
					{#each data.calendar as week (week.weekStart)}
						{#each week.days as day (day.date)}
							{@const active = Boolean(data.current) && day.date >= data.current!.periodStart && day.date <= data.current!.periodEnd}
							<div class="cal-cell" class:today={day.date === data.todayISO} class:active>
								<span class="cal-daynum">{fmtCellDate(day.date)}</span>
								<span class="cal-avatar">{initials(day.displayName)}</span>
								<span class="cal-name">{firstName(day.displayName)}</span>
							</div>
						{/each}
					{/each}
				</div>
			</div>
		</section>
	{/if}
</div>

<svelte:window onkeydown={(e) => pickerOpen && e.key === 'Escape' && (pickerOpen = false)} />

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
							<span class="candidate-avatar">{initials(m.displayName)}</span>
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
	.avatar-now {
		position: relative;
		width: 68px;
		height: 68px;
		flex-shrink: 0;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #000));
		color: #fff;
		font-size: 20px;
		font-weight: 700;
		box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.glow {
		position: absolute;
		inset: -10px;
		border-radius: 50%;
		border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
		animation: pulse 2.6s ease-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.glow {
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
			transform: scale(1.28);
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
	/* Filet de sécurité mobile : la grille garde une largeur lisible et scrolle horizontalement
	   plutôt que d'écraser les cellules jusqu'à l'illisible. */
	.cal-scroll {
		overflow-x: auto;
	}
	.cal-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(96px, 1fr));
		gap: 10px;
		min-width: 480px;
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
		gap: 8px;
		min-height: 88px;
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
	.cal-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-soft);
		font-size: 11.5px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}
	.cal-cell.active .cal-avatar {
		background: linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #000));
		border-color: transparent;
		color: #fff;
	}
	.cal-name {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-soft);
		text-align: center;
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
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
	.candidate-avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		color: var(--text-soft);
		font-size: 11px;
		font-weight: 700;
		display: grid;
		place-items: center;
		flex-shrink: 0;
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
</style>
