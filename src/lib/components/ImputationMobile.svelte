<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { dayName, dayNum, parseISODate, isPublicHolidayFR } from '$lib/utils/date';
	import {
		ABSENCE_TYPE_COLORS,
		ABSENCE_TYPE_LABELS,
		ABSENCE_PERIOD_LABELS,
		type AbsenceType
	} from '$lib/absenceTypes';
	import type { Row } from '$lib/imputationRow';

	let {
		rows,
		days,
		today,
		capacity,
		absences,
		readOnly = false,
		showPerimeters = false,
		canManageObjectives = false,
		onCycle,
		onSetAmount,
		onDelete,
		onPickActivity,
		activityLabel,
		absenceHref,
		rowIcon
	}: {
		rows: Row[];
		days: string[];
		today: string;
		capacity: number;
		absences: Record<string, { type: AbsenceType; period: 'FULL' | 'AM' | 'PM' }>;
		readOnly?: boolean;
		/** L'espace a plusieurs périmètres : affiche la pastille sur les lignes de ticket. */
		showPerimeters?: boolean;
		/** Manager/admin uniquement : peut retirer un objectif depuis /admin/objectifs — change le
		 * message du cadenas sur une ligne issue d'un objectif (cf. objectifs de la semaine). */
		canManageObjectives?: boolean;
		onCycle: (row: Row, day: string) => void;
		onSetAmount: (row: Row, day: string, value: number) => void;
		onDelete: (row: Row) => void;
		onPickActivity: (row: Row) => void;
		activityLabel: (row: Row) => string | null;
		absenceHref: (absenceId: string) => string;
		rowIcon: Snippet<[Row]>;
	} = $props();

	function objectiveLockMessage(): string {
		return canManageObjectives
			? "Cette ligne vient d'un objectif de la semaine — retirez l'objectif depuis Objectifs de la semaine pour la faire disparaître."
			: "Cette ligne vient d'un objectif de la semaine assigné par ton manager — demande-lui de le retirer depuis Objectifs de la semaine.";
	}

	function round(n: number) {
		return Math.round((n + Number.EPSILON) * 1000) / 1000;
	}
	const fmt = (n: number | undefined) => (!n ? '·' : String(n));

	// Un seul jour à l'écran : c'est ce qui remplace le défilement horizontal du tableau. Par défaut
	// aujourd'hui s'il est dans la période, sinon son dernier jour (même cadrage que le desktop).
	let selected = $state('');
	$effect(() => {
		if (days.includes(selected)) return;
		selected = days.includes(today) ? today : days[days.length - 1];
	});

	let dayTotals = $derived.by(() => {
		const t: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
		for (const r of rows) for (const d of days) t[d] = round(t[d] + (r.amounts[d] ?? 0));
		return t;
	});
	let selTotal = $derived(dayTotals[selected] ?? 0);
	let selAbsence = $derived(absences[selected]);
	let selHoliday = $derived(!!selected && isPublicHolidayFR(selected));

	// Même dégradé warn → success que le total du jour du tableau desktop.
	let selFill = $derived(
		capacity > 0 && selTotal <= capacity
			? `color-mix(in srgb, var(--success) ${(Math.max(0, selTotal) / capacity) * 100}%, var(--warn))`
			: 'var(--warn)'
	);

	// Le chip du jour sélectionné doit rester visible quand la période fait un mois (30 chips).
	let daybar: HTMLDivElement | null = $state(null);
	$effect(() => {
		// `days` explicitement lu : sans lui, passer de « semaine » à « mois » sans changer de jour
		// sélectionné ne redéclenche rien et la barre reste calée sur le 1er du mois. Le rAF est
		// nécessaire pour la même raison inverse : au changement de période, l'effet part avant que
		// les nouveaux chips soient reflowés — sans lui on centre sur des offsets périmés.
		if (days.length === 0 || !daybar) return;
		const day = selected;
		const id = requestAnimationFrame(() =>
			daybar
				?.querySelector<HTMLElement>(`[data-chip="${day}"]`)
				?.scrollIntoView({ inline: 'center', block: 'nearest' })
		);
		return () => cancelAnimationFrame(id);
	});

	function rowTotal(row: Row) {
		return round(days.reduce((a, d) => a + (row.amounts[d] ?? 0), 0));
	}
</script>

<div class="msheet">
	<div class="daybar" bind:this={daybar}>
		{#each days as d (d)}
			{@const abs = absences[d]}
			<button
				type="button"
				class="daychip"
				class:on={d === selected}
				class:today={d === today}
				data-chip={d}
				style={abs ? `--absence-color:${ABSENCE_TYPE_COLORS[abs.type]}` : undefined}
				onclick={() => (selected = d)}
			>
				<span class="dn">{dayName(parseISODate(d))}</span>
				<span class="dd">{dayNum(parseISODate(d))}</span>
				<span class="dt tabnum" class:filled={(dayTotals[d] ?? 0) > 0}>{fmt(dayTotals[d])}</span>
				{#if abs || isPublicHolidayFR(d)}<span class="dot" class:holiday={!abs}></span>{/if}
			</button>
		{/each}
	</div>

	<div class="dayhead">
		<div class="dh-lab">
			<b>{selected ? `${dayName(parseISODate(selected))} ${dayNum(parseISODate(selected))}` : ''}</b>
			{#if selHoliday}<span class="dh-tag holiday">Férié</span>{/if}
			{#if selAbsence}
				<span class="dh-tag" style="--absence-color:{ABSENCE_TYPE_COLORS[selAbsence.type]}">
					{ABSENCE_TYPE_LABELS[selAbsence.type]}{selAbsence.period !== 'FULL'
						? ` — ${ABSENCE_PERIOD_LABELS[selAbsence.period]}`
						: ''}
				</span>
			{/if}
		</div>
		<span class="dh-tot tabnum" style="color:{selFill}">{selTotal} / {capacity} j</span>
	</div>

	<ul class="mrows">
		{#each rows as row (row.rowKey)}
			{@const locked = row.lockedDays[selected]}
			{@const v = row.amounts[selected] ?? 0}
			<!-- N'importe quel jour verrouillé de la ligne bloque la suppression, pas seulement le jour
			     affiché (cf. hasLockedDay côté desktop) : la case sélectionnée peut être libre alors que
			     la ligne porte quand même un jour généré par une absence validée ailleurs dans la
			     période — supprimer effacerait les heures réelles des autres jours sans le signaler. -->
			{@const anyLocked = Object.keys(row.lockedDays).length > 0}
			<li class="mrow">
				<span class="pill pill-ico">{@render rowIcon(row)}</span>
				<div class="tt">
					<b>{row.objectiveNote || row.label}</b>
					<span class="sub">
						<span class="ell">{row.sublabel}</span>
						<!-- Pas de sections sur mobile (liste verticale déjà dense) : la pastille porte
						     l'information de périmètre à elle seule. -->
						{#if showPerimeters && row.perimeterName}
							<span class="perim-chip" style="--perim:{row.perimeterColor ?? 'var(--muted)'}">{row.perimeterName}</span>
						{/if}
						{#if readOnly || row.objectiveId}
							{#if activityLabel(row)}<span class="tag" title={row.objectiveId ? "Activité fixée par l'objectif de la semaine" : undefined}>{activityLabel(row)}</span>{/if}
						{:else if activityLabel(row)}
							<button type="button" class="tag tag-link" onclick={() => onPickActivity(row)}>{activityLabel(row)}</button>
						{:else}
							<button type="button" class="tag tag-link" onclick={() => onPickActivity(row)}>+ Activité</button>
						{/if}
						<span class="rsum tabnum">Σ {rowTotal(row)}</span>
					</span>
				</div>
				{#if readOnly}
					<span class="mcell ro" class:val={v > 0}>{fmt(v)}</span>
				{:else if locked}
					<a
						class="mcell locked"
						href={absenceHref(locked)}
						style={row.absenceType ? `--absence-color:${ABSENCE_TYPE_COLORS[row.absenceType]}` : undefined}
						title="Imputé depuis une absence validée — à modifier depuis la page Absences.">{fmt(v)}</a
					>
				{:else}
					<!-- ponytail: appui long = remise à zéro (oncontextmenu), pas de geste custom — ça ne
					     marche pas sur iOS Safari, mais le tap cyclique repasse de toute façon par 0. -->
					<button
						type="button"
						class="mcell"
						class:val={v > 0}
						onclick={() => onCycle(row, selected)}
						oncontextmenu={(e) => {
							e.preventDefault();
							onSetAmount(row, selected, 0);
						}}
						aria-label="Imputation de {row.label}">{fmt(v)}</button
					>
				{/if}
				{#if !readOnly}
					{#if anyLocked}
						<a
							class="mdel mdel-locked"
							href={absenceHref(Object.values(row.lockedDays)[0])}
							aria-label="Ligne verrouillée par une absence"
							title="Cette ligne contient des jours issus d'une absence validée — à retirer depuis la page Absences."
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg
							>
						</a>
					{:else if row.objectiveId}
						<button
							type="button"
							class="mdel mdel-locked"
							onclick={() => toast.message(objectiveLockMessage())}
							aria-label="Ligne verrouillée par un objectif de la semaine"
							title={objectiveLockMessage()}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
								><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg
							>
						</button>
					{:else}
						<button type="button" class="mdel" onclick={() => onDelete(row)} aria-label="Supprimer la ligne">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg
							>
						</button>
					{/if}
				{/if}
			</li>
		{/each}
		{#if rows.length === 0}
			<li class="mempty">
				{readOnly ? 'Aucune imputation sur cette période.' : 'Aucune ligne — ajoutez un ticket ou une catégorie ci-dessous.'}
			</li>
		{/if}
	</ul>
</div>

<style>
	.msheet {
		display: flex;
		flex-direction: column;
	}

	/* --- Sélecteur de jour --- */
	.daybar {
		display: flex;
		gap: 6px;
		padding: 10px;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--border);
		scroll-behavior: smooth;
	}
	.daybar::-webkit-scrollbar {
		display: none;
	}
	.daychip {
		position: relative;
		flex: 0 0 auto;
		width: 52px;
		padding: 7px 0 6px;
		border-radius: var(--r-md);
		border: 1.5px solid transparent;
		background: var(--surface-2);
		color: var(--text-mute);
		display: grid;
		gap: 1px;
		text-align: center;
		line-height: 1.1;
	}
	.daychip .dn {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.daychip .dd {
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}
	.daychip .dt {
		font-size: 10.5px;
		font-weight: 600;
		opacity: 0.55;
	}
	.daychip .dt.filled {
		color: var(--accent-ink);
		opacity: 1;
	}
	.daychip.today .dn,
	.daychip.today .dd {
		color: var(--accent);
	}
	.daychip.on {
		background: var(--accent-tint-2);
		border-color: var(--accent);
	}
	.daychip .dot {
		position: absolute;
		top: 5px;
		right: 6px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--absence-color, var(--text-mute));
	}
	.daychip .dot.holiday {
		background: var(--danger, #c0392b);
	}

	/* --- Entête du jour affiché --- */
	.dayhead {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 14px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.dh-lab {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		flex: 1;
	}
	.dh-lab b {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 600;
		text-transform: capitalize;
	}
	.dh-tag {
		font-size: 10.5px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 20px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--absence-color, var(--text-mute));
		background: color-mix(in srgb, var(--absence-color, var(--text-mute)) 14%, transparent);
	}
	.dh-tag.holiday {
		--absence-color: var(--danger, #c0392b);
	}
	.dh-tot {
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
	}

	/* --- Lignes --- */
	.mrows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.mrow {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-top: 1px solid var(--border);
	}
	.mrow:first-child {
		border-top: none;
	}
	.pill-ico {
		width: 30px;
		height: 30px;
		padding: 0;
		justify-content: center;
		flex-shrink: 0;
	}
	.pill-ico :global(svg) {
		width: 17px;
		height: 17px;
	}
	.tt {
		min-width: 0;
	}
	.tt b {
		display: block;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		/* 2 lignes max : un titre de ticket long ne doit pas pousser la case de saisie hors écran. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tt .sub {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: 11px;
		color: var(--text-mute);
		min-width: 0;
	}
	.tt .sub .ell {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		color: var(--text-soft);
		background: var(--surface-sunk);
		padding: 2px 7px;
		border-radius: 20px;
		white-space: nowrap;
	}
	.tag-link {
		border: 1px dashed var(--border-strong);
	}
	.rsum {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 10.5px;
		font-weight: 600;
	}

	/* Cible tactile : 44px minimum, contrairement aux 38px de la grille desktop (souris). */
	.mcell {
		width: 52px;
		height: 44px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		border: 1.5px solid var(--border);
		background: var(--surface-2);
		color: var(--text-mute);
		text-decoration: none;
		touch-action: manipulation;
	}
	.mcell.val {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 34%, transparent);
		color: var(--accent-ink);
	}
	:global([data-theme='dark']) .mcell.val {
		color: color-mix(in srgb, var(--accent) 80%, #fff);
	}
	.mcell.locked {
		color: var(--absence-color, var(--text-mute));
		background: color-mix(in srgb, var(--text-mute) 12%, transparent);
		border-color: transparent;
	}
	.mcell:active {
		transform: scale(0.96);
	}
	.mdel {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		color: var(--text-mute);
	}
	.mdel:active {
		background: color-mix(in srgb, var(--danger, #c0392b) 12%, transparent);
		color: var(--danger, #c0392b);
	}
	/* Lien vers l'absence, pas une suppression : teinte neutre plutôt que danger-rouge au toucher.
	   Doit rester après .mdel:active dans la feuille — même spécificité, l'ordre de déclaration tranche. */
	.mdel-locked:active {
		background: color-mix(in srgb, var(--text-mute) 18%, transparent);
		color: var(--text);
	}
	.mempty {
		list-style: none;
		text-align: center;
		color: var(--text-mute);
		padding: 28px 16px;
		font-size: 13.5px;
	}
	.perim-chip {
		font-size: 0.66rem;
		line-height: 1.5;
		padding: 0 0.35rem;
		border-radius: 999px;
		white-space: nowrap;
		color: var(--text);
		background: color-mix(in srgb, var(--perim) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--perim) 38%, transparent);
	}
</style>
