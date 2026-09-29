<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import TicketEditModal from '$lib/components/TicketEditModal.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { formatMonthLabel } from '$lib/utils/date';

	let { data } = $props();
	const view = $derived(data.view);
	const ref = $derived(data.ref);

	type FilterKey = 'project' | 'sprint' | 'version' | 'ssp' | 'group';
	const current = $derived<Record<FilterKey, string>>({
		project: data.filters.projectId ?? '',
		sprint: data.filters.sprintId ?? '',
		version: data.filters.versionId ?? '',
		ssp: data.filters.sspId ?? '',
		group: data.filters.groupId ?? ''
	});
	const activeCount = $derived(Object.values(current).filter(Boolean).length);

	function navigateWith(partial: Partial<Record<FilterKey, string>>) {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries({ ...current, ...partial })) if (v) p.set(k, v);
		// Mémorisé pour le prochain retour sur la page (lu par +page.server.ts) ; vide = effacé.
		document.cookie = `${data.cookieName}=${encodeURIComponent(p.toString())}; path=/; max-age=${p.size ? 60 * 60 * 24 * 180 : 0}; samesite=lax`;
		// invalidateAll : filtres restaurés depuis le cookie, l'URL est déjà sans paramètre ; « Tout
		// effacer » y renavigue à l'identique et SvelteKit ne relancerait pas le load (le cookie n'est
		// pas une dépendance suivie) — le filtre resterait affiché.
		goto(`?${p.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
	}

	const round2 = (n: number) => Math.round(n * 100) / 100;
	const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

	// Lignes Absences / Sans activité incluses ou non dans les totaux (pastilles au-dessus du tableau).
	// Exclues, elles restent affichées (grisées) : on voit ce qu'on a mis de côté. Défaut = temps
	// travaillé (Absences exclues), oublis visibles (Sans activité incluse). Préférence d'affichage
	// seule → localStorage, comme le mode Personnes | Tâches.
	type OptionalKind = 'ABSENCE' | 'NONE';
	const INCLUDE_KEY = 'imputo-activite-include';
	let included = $state<Record<OptionalKind, boolean>>({ ABSENCE: false, NONE: true });
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(INCLUDE_KEY) ?? 'null');
			if (saved) included = { ABSENCE: !!saved.ABSENCE, NONE: !!saved.NONE };
		} catch {}
	});
	function toggleInclude(k: OptionalKind) {
		included = { ...included, [k]: !included[k] };
		try {
			localStorage.setItem(INCLUDE_KEY, JSON.stringify(included));
		} catch {}
	}
	const isCounted = (r: { kind: 'ACTIVITY' | OptionalKind }) => r.kind === 'ACTIVITY' || included[r.kind];
	const countedRows = $derived(view.rows.filter(isCounted));
	const excludedRows = $derived(view.rows.filter((r) => !isCounted(r)));
	const optionalRows = $derived(view.rows.filter((r) => r.kind !== 'ACTIVITY'));

	const sumMonths = (rows: typeof view.rows) =>
		view.windowMonths.map((m, i) => round2(rows.reduce((s, r) => s + (r.cells[i]?.total ?? 0), 0)));
	const monthTotals = $derived(sumMonths(countedRows));
	// Mois vides en tête de fenêtre masqués : sur un espace récent, 8 colonnes vides sur 12 noyaient
	// les seuls mois qui ont quelque chose à dire. Les mois vides AU MILIEU restent (un trou est une info).
	// Calculé sur TOUTES les lignes : exclure Absences ne doit pas faire sauter des colonnes.
	const firstIdx = $derived.by(() => {
		const i = sumMonths(view.rows).findIndex((t) => t > 0);
		return i === -1 ? 0 : i;
	});
	const months = $derived(view.windowMonths.slice(firstIdx));
	const lastMonth = $derived(view.windowMonths[view.windowMonths.length - 1]);

	const grandTotal = $derived(round2(countedRows.reduce((s, r) => s + r.total, 0)));
	// Échelle de la heatmap : max des cases ACTIVITÉ. Les lignes personne en sont des parts : sur la
	// même échelle elles restent plus claires, et on lit d'un coup d'œil qui pèse dans l'activité.
	// Lignes exclues hors échelle : elles sont grisées, et leur volume écraserait la rampe des activités.
	const maxCell = $derived(Math.max(1, ...countedRows.flatMap((r) => r.cells.map((c) => c.total))));
	// Plafond à 55 % d'accent : au-delà, le texte sombre perd en contraste, et le blanc n'en a jamais
	// assez sur les verts moyens — on garde donc un seul texte sombre et une rampe bornée.
	const heat = (v: number) => (v > 0 ? Math.round(10 + 45 * (v / maxCell)) : 0);

	// Activités triées par cumul, puis « Absences / hors-projet », puis « Sans activité » (oublis à
	// corriger) toujours en bas — cf. ActivitySynthesisRowKind.
	const KIND_ORDER = { ACTIVITY: 0, ABSENCE: 1, NONE: 2 } as const;
	const sortedRows = $derived([...view.rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.total - a.total));
	const actRows = $derived(sortedRows.filter((r) => r.kind === 'ACTIVITY'));
	const top = $derived(actRows[0]);
	const curTotal = $derived(monthTotals[monthTotals.length - 1] ?? 0);
	const prevTotal = $derived(monthTotals[monthTotals.length - 2] ?? 0);
	const contributors = $derived(
		new Set(countedRows.flatMap((r) => r.cells.flatMap((c) => c.byUser.map((u) => u.userId)))).size
	);

	type Row = (typeof view.rows)[number];
	const rowKey = (r: Row) => r.activityId ?? r.kind;
	// Détail d'une activité dépliée : par personne ou par tâche (ticket, catégorie, tâche libre).
	// Mode d'affichage seul (les données sont déjà là) : localStorage suffit, cf. /dashboard.
	type Detail = 'people' | 'tasks';
	const DETAIL_KEY = 'imputo-activite-detail';
	let detail = $state<Detail>('people');
	onMount(() => {
		try {
			if (localStorage.getItem(DETAIL_KEY) === 'tasks') detail = 'tasks';
		} catch {}
	});
	function setDetail(d: Detail) {
		detail = d;
		try {
			localStorage.setItem(DETAIL_KEY, d);
		} catch {}
	}

	// Même forme que SynthesisDetailLine (activitySynthesis.ts), renvoyée par /dashboard/activite/detail.
	type DetailLine = { id: string; label: string; userId?: string | null; ticketId?: string | null; ticketKey?: string | null; total: number; byMonth: Record<string, number> };
	function detailLines(row: Row, d: Detail): DetailLine[] {
		const acc = new Map<string, DetailLine>();
		for (const c of row.cells) {
			const items =
				d === 'people'
					? c.byUser.map((u) => ({ id: u.userId, label: u.displayName, userId: u.userId, total: u.total }))
					: c.byTask.map((t) => ({ id: t.taskId, label: t.label, ticketId: t.ticketId, ticketKey: t.ticketKey, total: t.total }));
			for (const { total, ...it } of items) {
				const l = acc.get(it.id) ?? { ...it, total: 0, byMonth: {} };
				l.total = round2(l.total + total);
				l.byMonth[c.month] = total;
				acc.set(it.id, l);
			}
		}
		return [...acc.values()].sort((a, b) => b.total - a.total);
	}

	// Une activité comme Dev peut porter des dizaines de tickets : on montre les plus gros d'abord.
	const TASK_LIMIT = 10;
	let showAll = $state<Record<string, boolean>>({});
	let editTicketId = $state<string | null>(null);

	// Modale de détail croisé : clic sur une personne → ses tâches sur la ligne ; clic sur une tâche →
	// les personnes qui y ont consommé. Chargée au clic (pas embarquée dans la page), mêmes filtres.
	let focus = $state<{ row: Row; line: DetailLine } | null>(null);
	let focusLines = $state<DetailLine[] | null>(null);
	let focusError = $state(false);
	let focusCtrl: AbortController | null = null;
	async function openFocus(row: Row, line: DetailLine) {
		focus = { row, line };
		focusLines = null;
		focusError = false;
		focusCtrl?.abort();
		const ctrl = (focusCtrl = new AbortController());
		const p = new URLSearchParams({ bucket: row.activityId ?? row.kind });
		if (line.userId) p.set('user', line.userId);
		else p.set('task', line.id);
		for (const [k, v] of Object.entries(current)) if (v) p.set(k, v);
		try {
			const res = await fetch(`/dashboard/activite/detail?${p}`, { signal: ctrl.signal });
			if (!res.ok) throw new Error(String(res.status));
			focusLines = (await res.json()).lines;
		} catch {
			if (!ctrl.signal.aborted) focusError = true;
		}
	}
	function closeFocus() {
		focusCtrl?.abort();
		focus = null;
	}

	/** Mini-courbe de tendance sur les mois affichés, échelle propre à la ligne (c'est la forme qui compte). */
	function spark(row: Row) {
		const vals = months.map((m) => row.cells.find((c) => c.month === m)?.total ?? 0);
		const max = Math.max(1, ...vals);
		const w = 64;
		const h = 22;
		const step = vals.length > 1 ? w / (vals.length - 1) : 0;
		const pts = vals.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
		const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
		return { line, area: `0,${h} ${line} ${w},${h}`, last: pts[pts.length - 1], w, h };
	}

	let headEl = $state<HTMLDivElement | null>(null);
	// Largeur mini partagée par les deux tableaux (en-tête sticky / corps) : au-delà, .scroll défile.
	const tableMinWidth = $derived(310 + 110 + months.length * 98);

	let expanded = $state<Record<string, boolean>>({});
	const allOpen = $derived(view.rows.length > 0 && view.rows.every((r) => expanded[rowKey(r)]));
	function toggle(id: string) {
		expanded = { ...expanded, [id]: !expanded[id] };
	}
	function toggleAll() {
		const open = !allOpen;
		expanded = Object.fromEntries(view.rows.map((r) => [rowKey(r), open]));
	}

	const monthShort = (m: string) => {
		const s = new Date(`${m}T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
		return s.charAt(0).toUpperCase() + s.slice(1);
	};
</script>

<svelte:head><title>Synthèse par activité — Imputo</title></svelte:head>

{#snippet filterSelect(key: FilterKey, label: string, all: string, options: { id: string; text: string }[])}
	<label class="fsel" class:on={!!current[key]}>
		<span class="fsel-k">{label}</span>
		<select value={current[key]} onchange={(e) => navigateWith({ [key]: e.currentTarget.value })} aria-label="Filtrer par {label.toLowerCase()}">
			<option value="">{all}</option>
			{#each options as o (o.id)}<option value={o.id}>{o.text}</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet tile(v: number, small: boolean = false)}
	{#if v}
		<span class="tile tabnum" class:sm={small} style:--h="{heat(v)}%">{fmt(v)}</span>
	{:else}
		<span class="tile empty-tile" class:sm={small}>–</span>
	{/if}
{/snippet}

<div class="topbar">
	<h1>
		Synthèse par activité<small>Où part le temps de l'équipe, mois par mois — 12 derniers mois, détail par personne ou par tâche.</small>
	</h1>
</div>

<div class="content">
	<div class="kpis">
		<div class="card kpi">
			<div class="k">Consommé sur la période</div>
			<div class="v tabnum">{fmt(grandTotal)}<small>j</small></div>
			<div class="sub">{formatMonthLabel(months[0])} → {formatMonthLabel(lastMonth)}</div>
		</div>
		<div class="card kpi">
			<div class="k">{formatMonthLabel(lastMonth)} <span class="live">en cours</span></div>
			<div class="v tabnum">{fmt(curTotal)}<small>j</small></div>
			<div class="sub">Mois précédent : <b class="tabnum">{fmt(prevTotal)} j</b></div>
		</div>
		<div class="card kpi">
			<div class="k">Activité principale</div>
			<div class="v v-text">{top?.label ?? '—'}</div>
			<div class="sub">{top && grandTotal ? `${Math.round((top.total / grandTotal) * 100)} % du total · ${fmt(top.total)} j` : 'Aucune conso'}</div>
		</div>
		<div class="card kpi">
			<div class="k">Contributeurs</div>
			<div class="v tabnum">{contributors}<small>{contributors > 1 ? 'personnes' : 'personne'}</small></div>
			<div class="sub">{actRows.length} activité{actRows.length > 1 ? 's' : ''} consommée{actRows.length > 1 ? 's' : ''}</div>
		</div>
	</div>

	<section class="card filters">
		<div class="filters-row">
			<span class="filters-title">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
				Filtres
				{#if activeCount}<span class="count">{activeCount}</span>{/if}
			</span>
			{@render filterSelect('version', 'Version', 'Toutes', ref.versions.map((v) => ({ id: v.id, text: v.name })))}
			{@render filterSelect('project', 'Projet', 'Tous', ref.projects.map((p) => ({ id: p.id, text: p.name })))}
			{@render filterSelect('sprint', 'Sprint', 'Tous', ref.sprints.map((s) => ({ id: s.id, text: s.name })))}
			{@render filterSelect('ssp', 'Code SSP', 'Tous', ref.ssps.map((s) => ({ id: s.id, text: `${s.code} — ${s.label}` })))}
			{@render filterSelect('group', 'Groupe', 'Tous', ref.ticketGroups.map((g) => ({ id: g.id, text: g.label })))}
			{#if activeCount}
				<button type="button" class="reset" onclick={() => navigateWith({ project: '', sprint: '', version: '', ssp: '', group: '' })}>
					Tout effacer
				</button>
			{/if}
		</div>
		{#if activeCount}
			<p class="filters-hint">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M12 11v5" /></svg>
				Les tâches libres (sans ticket) n'ont ni version, ni projet, ni sprint, ni SSP, ni groupe : elles sont exclues tant qu'un filtre est actif.
			</p>
		{/if}
	</section>

	{#if view.rows.length === 0}
		<section class="card empty">
			<div class="empty-ic">∅</div>
			<p><b>Aucune consommation</b> sur les 12 derniers mois{activeCount ? ' avec ces filtres' : ''}.</p>
		</section>
	{:else}
		<section class="card table-card">
			<header class="table-head">
				<div>
					<h2>Répartition mensuelle</h2>
					<p class="muted">
						{actRows.length} activités, de la plus à la moins consommée{#if firstIdx}{' · '}mois sans conso avant {formatMonthLabel(months[0])} masqués{/if}
					</p>
				</div>
				<div class="table-tools">
					<span class="legend" aria-hidden="true">Moins <i class="ramp"></i> Plus</span>
					{#if optionalRows.length}
						<div class="incl" role="group" aria-label="Lignes comptées dans les totaux">
							<span class="incl-k">Inclure</span>
							{#each optionalRows as r (r.kind)}
								{@const k = r.kind as OptionalKind}
								<button type="button" class="chip" class:on={included[k]} aria-pressed={included[k]} onclick={() => toggleInclude(k)}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d={included[k] ? 'm5 12 5 5 9-10' : 'M6 6l12 12M18 6 6 18'} /></svg>
									{r.label}
								</button>
							{/each}
						</div>
					{/if}
					<div class="seg" role="group" aria-label="Détail d'une activité dépliée">
						<button type="button" class:on={detail === 'people'} aria-pressed={detail === 'people'} onclick={() => setDetail('people')}>Personnes</button>
						<button type="button" class:on={detail === 'tasks'} aria-pressed={detail === 'tasks'} onclick={() => setDetail('tasks')}>Tâches</button>
					</div>
					<button type="button" class="btn-ghost" onclick={toggleAll}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d={allOpen ? 'm7 15 5-5 5 5' : 'm7 10 5 5 5-5'} /></svg>
						{allOpen ? 'Tout replier' : 'Tout déplier'}
					</button>
				</div>
			</header>

			<!-- En-tête dans son propre tableau, sticky en haut de l'écran pendant que la PAGE défile (pas
			     de panneau à scroll interne). Il ne peut pas vivre dans .scroll : overflow-x:auto force
			     overflow-y à auto (spec CSS), .scroll deviendrait le référentiel du sticky et l'en-tête ne
			     s'accrocherait à rien. Or à 12 mois le tableau dépasse presque toujours la largeur d'écran.
			     Mêmes colonnes des deux côtés (table-layout: fixed + colgroup + même min-width), défilement
			     horizontal recopié de .scroll vers l'en-tête. -->
			<div class="head-wrap" bind:this={headEl}>
				<table class="synth" style:min-width="{tableMinWidth}px">
					<colgroup><col class="col-act" />{#each months as m (m)}<col />{/each}<col class="col-tot" /></colgroup>
					<thead>
						<tr>
							<th class="c-act">Activité</th>
							{#each months as m (m)}
								<th class="c-m" class:cur={m === lastMonth}>
									<span class="mm">{monthShort(m)}</span>
									<span class="yy">{m === lastMonth ? 'en cours' : m.slice(0, 4)}</span>
								</th>
							{/each}
							<th class="c-tot" aria-sort="descending">
								<!-- Fenêtre bornée : sans le préciser, « Cumul » se lit comme « depuis toujours ». -->
								<Tooltip text="Somme des 12 derniers mois ({formatMonthLabel(view.windowMonths[0])} → {formatMonthLabel(lastMonth)}), pas depuis toujours">
									<button type="button" class="cumul-h">Cumul ↓ <span class="info" aria-hidden="true">ⓘ</span></button>
								</Tooltip>
							</th>
						</tr>
					</thead>
				</table>
			</div>
			<div class="scroll" onscroll={(e) => headEl && (headEl.scrollLeft = e.currentTarget.scrollLeft)}>
				<table class="synth" style:min-width="{tableMinWidth}px">
					<colgroup><col class="col-act" />{#each months as m (m)}<col />{/each}<col class="col-tot" /></colgroup>
					<tbody>
						{#each sortedRows as row, ri (rowKey(row))}
							{@const counted = isCounted(row)}
							{@const share = grandTotal ? row.total / grandTotal : 0}
							{@const open = !!expanded[rowKey(row)]}
							{@const sp = spark(row)}
							{#if ri > 0}<tr class="gap" aria-hidden="true"><td colspan={months.length + 2}></td></tr>{/if}
							<tr class="r-act" class:open class:excluded={!counted} class:none={row.kind === 'NONE'} class:absence={row.kind === 'ABSENCE'}>
								<th class="c-act" scope="row">
									<button type="button" class="act" onclick={() => toggle(rowKey(row))} aria-expanded={open} aria-label="{open ? 'Replier' : 'Déplier'} {row.label}">
										<span class="badge" aria-hidden="true">{row.label.charAt(0).toUpperCase()}</span>
										<span class="act-body">
											<span class="act-label">{row.label}{#if row.archived}<span class="arch">archivée</span>{/if}</span>
											<span class="act-meta">{#if counted}{Math.round(share * 100)} % du temps{:else}Exclue du total{/if}{#if row.kind === 'NONE'}{' · à corriger'}{/if}</span>
										</span>
										<svg class="spark" width={sp.w} height={sp.h} viewBox="0 0 {sp.w} {sp.h}" aria-hidden="true">
											<polygon points={sp.area} />
											<polyline points={sp.line} />
											<circle cx={sp.last[0]} cy={sp.last[1]} r="2.6" />
										</svg>
										<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6" /></svg>
									</button>
								</th>
								{#each months as m (m)}
									<td class="c-m">{@render tile(row.cells.find((c) => c.month === m)?.total ?? 0)}</td>
								{/each}
								<td class="c-tot"><b class="tot tabnum">{fmt(row.total)}</b></td>
							</tr>
							{#if open}
								{@const all = detailLines(row, detail)}
								{@const hidden = detail === 'tasks' && !showAll[rowKey(row)] ? Math.max(0, all.length - TASK_LIMIT) : 0}
								{@const ps = hidden ? all.slice(0, TASK_LIMIT) : all}
								{#each ps as p, i (p.id)}
									<tr class="r-person" class:excluded={!counted} class:last={!hidden && i === ps.length - 1}>
										<th class="c-act" scope="row">
											<span class="person">
												<button
													type="button"
													class="task-link"
													title={p.userId ? `Voir les tâches de ${p.label} sur ${row.label}` : `${p.ticketKey ? `${p.ticketKey} — ` : ''}${p.label} : voir qui y a contribué`}
													onclick={() => openFocus(row, p)}
												>
													{#if p.userId}
														<UserAvatar userId={p.userId} name={p.label} size={24} />
													{:else if p.ticketKey}
														<span class="task-key">{p.ticketKey}</span>
													{:else}
														<span class="task-key free" aria-hidden="true">·</span>
													{/if}
													<span class="person-name">{p.label}</span>
												</button>
												<span class="person-pct tabnum">{row.total ? Math.round((p.total / row.total) * 100) : 0} %</span>
											</span>
										</th>
										{#each months as m (m)}
											<td class="c-m">{@render tile(p.byMonth[m] ?? 0, true)}</td>
										{/each}
										<td class="c-tot"><span class="tot-person tabnum">{fmt(p.total)}</span></td>
									</tr>
								{/each}
								{#if hidden}
									<tr class="r-person last r-more" class:excluded={!counted}>
										<td colspan={months.length + 2}>
											<button type="button" class="more" onclick={() => (showAll = { ...showAll, [rowKey(row)]: true })}>
												Voir les {hidden} autre{hidden > 1 ? 's' : ''} tâche{hidden > 1 ? 's' : ''}
											</button>
										</td>
									</tr>
								{/if}
							{/if}
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<th class="c-act" scope="row">
								Total équipe
								{#if excludedRows.length}
									<span class="tot-hint">hors {excludedRows.map((r) => `${r.label} (${fmt(r.total)} j)`).join(', ')}</span>
								{/if}
							</th>
							{#each months as m, i (m)}
								<td class="c-m tabnum">{fmt(monthTotals[firstIdx + i])}</td>
							{/each}
							<td class="c-tot tabnum">{fmt(grandTotal)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</section>
	{/if}
</div>

<svelte:window
	onkeydown={(e) => {
		// Échap ferme d'abord la fiche ticket ouverte par-dessus (elle gère son propre Échap).
		if (e.key === 'Escape' && focus && !editTicketId) closeFocus();
	}}
/>

{#if focus}
	{@const f = focus}
	{@const byPerson = !!f.line.userId}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="fx-backdrop" onclick={(e) => e.target === e.currentTarget && closeFocus()}>
		<div class="fx-modal" role="dialog" aria-modal="true" aria-labelledby="fx-title">
			<header class="fx-head">
				<div class="fx-id">
					{#if f.line.userId}
						<UserAvatar userId={f.line.userId} name={f.line.label} size={40} />
					{:else if f.line.ticketKey}
						<span class="task-key">{f.line.ticketKey}</span>
					{/if}
					<div class="fx-titles">
						<h2 id="fx-title">{f.line.label}</h2>
						<p class="muted">
							<b>{f.row.label}</b> · {fmt(f.line.total)} j sur 12 mois · {byPerson ? 'ses tâches' : 'qui y a contribué'}
						</p>
					</div>
				</div>
				<div class="fx-actions">
					{#if f.line.ticketId}
						<button type="button" class="btn-ghost" onclick={() => (editTicketId = f.line.ticketId ?? null)}>Ouvrir la fiche ticket</button>
					{/if}
					<button type="button" class="fx-close" aria-label="Fermer" onclick={closeFocus}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6 6 18" /></svg>
					</button>
				</div>
			</header>

			{#if focusError}
				<p class="fx-msg">Impossible de charger le détail. Réessaie dans un instant.</p>
			{:else if !focusLines}
				<p class="fx-msg">Chargement…</p>
			{:else if focusLines.length === 0}
				<p class="fx-msg">Aucune consommation avec ces filtres.</p>
			{:else}
				<div class="fx-scroll">
					<table class="fx-table" style:--fx-months={months.length}>
						<colgroup><col class="fx-col-label" />{#each months as m (m)}<col />{/each}<col class="fx-col-tot" /></colgroup>
						<thead>
							<tr>
								<th class="fx-c-label">{byPerson ? 'Tâche' : 'Personne'}</th>
								{#each months as m (m)}
									<th class="c-m" class:cur={m === lastMonth}>
										<span class="mm">{monthShort(m)}</span>
										<span class="yy">{m === lastMonth ? 'en cours' : m.slice(0, 4)}</span>
									</th>
								{/each}
								<th class="c-tot">Cumul</th>
							</tr>
						</thead>
						<tbody>
							{#each focusLines as l (l.id)}
								<tr>
									<th class="fx-c-label" scope="row">
										<span class="person">
											{#if l.userId}
												<UserAvatar userId={l.userId} name={l.label} size={24} />
												<span class="person-name">{l.label}</span>
											{:else if l.ticketId}
												<button type="button" class="task-link" title="Ouvrir la fiche {l.ticketKey}" onclick={() => (editTicketId = l.ticketId ?? null)}>
													<span class="task-key">{l.ticketKey}</span>
													<span class="person-name">{l.label}</span>
												</button>
											{:else}
												<span class="task-key free" aria-hidden="true">·</span>
												<span class="person-name">{l.label}</span>
											{/if}
											<span class="person-pct tabnum">{f.line.total ? Math.round((l.total / f.line.total) * 100) : 0} %</span>
										</span>
									</th>
									{#each months as m (m)}
										<td class="c-m">{@render tile(l.byMonth[m] ?? 0, true)}</td>
									{/each}
									<td class="c-tot"><span class="tot-person tabnum">{fmt(l.total)}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
{/if}

<TicketEditModal
	ticketId={editTicketId}
	states={ref.states}
	projects={ref.projects}
	sprints={ref.sprints}
	versions={ref.versions}
	ssps={ref.ssps}
	ticketGroups={ref.ticketGroups}
	members={ref.members.filter((m) => !m.factice)}
	testPhase={data.testPhase}
	canEditEstimation={data.canEditEstimation}
	isAdmin={data.isAdmin}
	isOwner={data.isOwner}
	onClose={() => (editTicketId = null)}
	onSaved={() => invalidateAll()}
	onDeleted={() => {
		editTicketId = null;
		invalidateAll();
	}}
/>

<style>
	/* ---------- KPIs (même gabarit que le dashboard) ---------- */
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.kpi {
		padding: 16px 20px;
		min-width: 0;
	}
	.kpi .k {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.kpi .v {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kpi .v small {
		font-size: 14px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
		margin-left: 4px;
	}
	.kpi .v-text {
		font-size: 24px;
		line-height: 36px;
	}
	.kpi .sub {
		font-size: 12px;
		color: var(--text-mute);
		margin-top: 4px;
	}
	.kpi .sub b {
		color: var(--text-soft);
	}
	.live {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent-ink, var(--accent));
		background: var(--accent-tint);
		padding: 2px 7px;
		border-radius: 20px;
	}

	/* ---------- Filtres ---------- */
	/* Marge franche sous les filtres : collés au tableau, ils se lisaient comme sa première ligne. */
	.filters {
		padding: 12px 14px;
		margin-bottom: 28px;
	}
	.filters-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.filters-title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
		margin-right: 4px;
	}
	.count {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--accent);
		color: #fff;
		font-size: 11px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.fsel {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px 0 12px;
		border: 1px solid var(--border);
		border-radius: 30px;
		background: var(--surface);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.fsel:hover {
		border-color: var(--border-strong);
	}
	.fsel:focus-within {
		border-color: var(--accent);
	}
	.fsel.on {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.fsel-k {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.fsel.on .fsel-k {
		color: var(--accent-ink, var(--accent));
	}
	.fsel select {
		border: none;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		padding: 7px 6px;
		max-width: 180px;
		cursor: pointer;
		outline: none;
	}
	.reset {
		border: none;
		background: none;
		color: var(--text-mute);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		padding: 6px 8px;
		border-radius: 8px;
	}
	.reset:hover {
		color: var(--text);
		background: var(--surface-sunk);
	}
	.filters-hint {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 10px 2px 0;
		font-size: 12px;
		color: var(--text-mute);
	}

	/* ---------- Vide ---------- */
	.empty {
		padding: 40px 20px;
		text-align: center;
		color: var(--text-soft);
	}
	.empty-ic {
		font-size: 28px;
		color: var(--text-mute);
		margin-bottom: 6px;
	}
	.empty p {
		margin: 0;
	}

	/* ---------- Tableau ---------- */
	/* Pas d'overflow ici : un overflow sur un ancêtre casserait le sticky de .head-wrap. */
	.table-card {
		padding: 6px 10px 12px;
	}
	.head-wrap {
		position: sticky;
		top: 0;
		z-index: 5;
		overflow: hidden;
		padding: 0 4px;
		background: var(--surface);
		box-shadow: 0 1px 0 var(--border);
	}
	.head-wrap .c-act {
		background: var(--surface);
	}
	.table-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 14px 10px 10px;
	}
	.table-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.muted {
		margin: 3px 0 0;
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.table-tools {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.ramp {
		width: 72px;
		height: 8px;
		border-radius: 4px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--accent) 10%, var(--surface)),
			color-mix(in srgb, var(--accent) 55%, var(--surface))
		);
	}
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-soft);
		font-size: 12.5px;
		font-weight: 600;
		padding: 7px 12px;
		border-radius: 999px;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
	}
	.btn-ghost:hover {
		border-color: var(--accent);
		color: var(--accent-ink, var(--accent));
	}
	.scroll {
		overflow-x: auto;
		padding: 0 4px 4px;
	}

	/* Lignes en « cartes » : pas de quadrillage, un interligne de 6px et des bords arrondis sur la
	   première/dernière case. separate (pas collapse) : c'est aussi ce qui garde la 1re colonne
	   sticky avec son fond et ses coins. */
	.synth {
		border-collapse: separate;
		border-spacing: 0;
		width: 100%;
		table-layout: fixed;
		font-size: 13px;
	}
	/* Interligne entre activités par une ligne vide plutôt que border-spacing : le bloc des personnes
	   doit rester accolé à son activité, ce que border-spacing (global) interdit. */
	.gap td {
		height: 8px;
		padding: 0;
	}
	.synth thead th {
		padding-bottom: 8px;
	}
	.synth th,
	.synth td {
		padding: 0 5px;
		white-space: nowrap;
	}
	.synth thead th {
		padding: 4px 5px 10px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
		text-align: center;
	}
	.synth thead .c-act {
		text-align: left;
		padding-left: 14px;
	}
	.mm {
		display: block;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
	}
	.yy {
		display: block;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--text-mute);
	}
	thead .cur .yy {
		display: inline-block;
		margin-top: 2px;
		padding: 0 7px;
		border-radius: 10px;
		background: var(--accent-tint);
		color: var(--accent-ink, var(--accent));
		font-weight: 700;
	}

	/* Largeurs portées par le colgroup (table-layout: fixed) : identiques dans l'en-tête et le corps,
	   et un titre de ticket long ne peut pas élargir la colonne. */
	.col-act {
		width: 310px;
	}
	.col-tot {
		width: 110px;
	}
	.c-act {
		position: sticky;
		left: 0;
		z-index: 2;
		text-align: left;
	}
	.c-tot {
		text-align: right;
	}

	.r-act th,
	.r-act td {
		background: var(--surface-2);
		height: 58px;
		transition: background 0.15s;
	}
	.r-act .c-act {
		border-radius: 14px 0 0 14px;
		padding-left: 10px;
	}
	.r-act .c-tot {
		border-radius: 0 14px 14px 0;
		padding-right: 14px;
	}
	.r-act:hover th,
	.r-act:hover td {
		background: color-mix(in srgb, var(--accent) 5%, var(--surface-2));
	}
	/* « Sans activité » : saisie à corriger, pas une activité — atténuée, badge neutre et italique. */
	/* « Absences / hors-projet » : légitime, juste neutre (badge gris, pas d'italique). */
	.r-act.none .badge,
	.r-act.absence .badge {
		background: var(--border);
		color: var(--text-mute);
	}
	.r-act.none .act-label {
		font-style: italic;
		color: var(--text-mute);
	}
	/* Ligne dépliée : ses coins du bas se ferment sur le bloc des personnes, qui la prolonge. */
	.r-act.open .c-act {
		border-radius: 14px 0 0 0;
	}
	.r-act.open .c-tot {
		border-radius: 0 14px 0 0;
	}

	.act {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.badge {
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: var(--accent-tint);
		color: var(--accent-ink, var(--accent));
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 700;
	}
	.act-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.act-label {
		font-weight: 650;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.act-meta {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.arch {
		margin-left: 6px;
		font-size: 10px;
		font-weight: 600;
		color: var(--warn);
	}
	.spark {
		flex-shrink: 0;
		overflow: visible;
	}
	.spark polygon {
		fill: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.spark polyline {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.8;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.spark circle {
		fill: var(--accent);
	}
	.chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.2s ease;
	}
	.open .chev {
		transform: rotate(180deg);
		color: var(--accent);
	}

	/* Tuiles de heatmap : une seule teinte (l'accent), intensité = volume. Lisible sans distinguer de
	   couleurs (un membre de l'équipe est daltonien) — la valeur reste écrite, la teinte hiérarchise. */
	.tile {
		display: grid;
		place-items: center;
		height: 40px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent) var(--h, 0%), var(--surface));
		color: var(--text);
		font-weight: 650;
		font-size: 13px;
	}
	.tile.sm {
		height: 30px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 600;
	}
	/* Ligne exclue des totaux : toujours lisible, mais sortie de la heatmap et cumul barré. */
	.excluded .tile:not(.empty-tile) {
		background: var(--surface-2);
		color: var(--text-mute);
		font-weight: 500;
	}
	.excluded .tot,
	.excluded .tot-person {
		text-decoration: line-through;
		color: var(--text-mute);
	}
	.excluded .spark {
		opacity: 0.35;
	}
	.cumul-h {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: help;
		white-space: nowrap;
	}
	.info {
		color: var(--text-mute);
		font-size: 11px;
	}
	/* ---------- Modale de détail croisé ---------- */
	.fx-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 40; /* sous TicketEditModal (50), qui peut s'ouvrir par-dessus */
	}
	.fx-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		width: min(1200px, 100%);
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.fx-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 22px 14px;
		border-bottom: 1px solid var(--border);
	}
	.fx-id {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.fx-titles {
		min-width: 0;
	}
	.fx-titles h2 {
		margin: 0;
		font-size: 19px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fx-titles p {
		margin: 3px 0 0;
		font-size: 12.5px;
	}
	.fx-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.fx-close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text-soft);
		cursor: pointer;
	}
	.fx-close:hover {
		background: var(--surface-2);
	}
	.fx-msg {
		padding: 30px 22px;
		color: var(--text-mute);
		font-size: 13px;
	}
	.fx-scroll {
		overflow: auto;
		padding: 8px 14px 16px;
	}
	.fx-table {
		width: 100%;
		/* Mois de largeur égale (colgroup), comme le tableau principal. */
		table-layout: fixed;
		min-width: calc(430px + var(--fx-months, 5) * 80px);
		border-collapse: separate;
		border-spacing: 0 4px;
		font-size: 13px;
	}
	.fx-table th,
	.fx-table td {
		padding: 0 5px;
		white-space: nowrap;
	}
	.fx-table thead th {
		padding-bottom: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-mute);
		text-align: center;
		position: sticky;
		top: 0;
		background: var(--surface);
		z-index: 1;
	}
	.fx-table thead .fx-c-label {
		text-align: left;
	}
	.fx-col-label {
		width: 340px;
	}
	.fx-col-tot {
		width: 90px;
	}
	.fx-c-label {
		text-align: left;
	}
	.fx-table .person {
		padding-left: 4px;
	}
	.tot-hint {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-mute);
	}
	.incl {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.incl-k {
		font-size: 12px;
		color: var(--text-mute);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px dashed var(--border-strong, var(--border));
		background: none;
		color: var(--text-mute);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		padding: 5px 10px;
		border-radius: 999px;
		cursor: pointer;
	}
	.chip.on {
		border-style: solid;
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-ink, var(--accent));
	}
	.empty-tile {
		background: transparent;
		border: 1px dashed var(--border);
		color: var(--text-mute);
		font-weight: 400;
	}

	.tot {
		display: block;
		text-align: right;
		font-size: 15px;
	}

	/* Détail par personne : bloc accolé sous son activité (interligne annulé), fond blanc bordé, qui
	   se referme en arrondi sur la dernière personne. */
	.r-person th,
	.r-person td {
		background: var(--surface);
		height: 40px;
		border-top: 1px solid var(--border);
	}
	.r-person th:first-child {
		border-left: 1px solid var(--border);
	}
	.r-person td:last-child {
		border-right: 1px solid var(--border);
	}
	.r-person.last th,
	.r-person.last td {
		border-bottom: 1px solid var(--border);
	}
	.r-person.last .c-act {
		border-radius: 0 0 0 14px;
	}
	.r-person.last .c-tot {
		border-radius: 0 0 14px 0;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-left: 22px;
		font-size: 12.5px;
		color: var(--text-soft);
		min-width: 0;
		overflow: hidden;
	}
	.person-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.person-pct {
		font-size: 11.5px;
		color: var(--text-mute);
		padding-right: 8px;
	}
	/* Détail par tâche : clé ticket en pastille mono, ligne cliquable qui ouvre la fiche ticket. */
	.task-link {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.task-link:hover .person-name {
		color: var(--accent-ink, var(--accent));
		text-decoration: underline;
	}
	.task-link .person-name,
	.r-person .person-name {
		white-space: nowrap;
	}
	.task-key {
		flex-shrink: 0;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 6px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-soft);
	}
	.task-key.free {
		min-width: 24px;
		text-align: center;
		color: var(--text-mute);
	}
	.r-more td {
		border-left: 1px solid var(--border);
		border-right: 1px solid var(--border);
		border-radius: 0 0 14px 14px;
		padding-left: 22px;
	}
	.more {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent-ink, var(--accent));
		cursor: pointer;
	}
	.more:hover {
		text-decoration: underline;
	}
	.seg {
		display: inline-flex;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
	}
	.seg button {
		border: none;
		background: none;
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		padding: 5px 12px;
		border-radius: 999px;
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface);
		color: var(--accent-ink, var(--accent));
		box-shadow: var(--shadow-sm);
	}
	.tot-person {
		display: block;
		text-align: right;
		padding-right: 14px;
		font-weight: 600;
		color: var(--text-soft);
	}

	tfoot tr:first-child th,
	tfoot tr:first-child td {
		padding-top: 6px;
	}
	tfoot th,
	tfoot td {
		height: 46px;
		font-weight: 700;
		text-align: center;
		border-top: 2px dashed var(--border);
	}
	tfoot .c-act {
		text-align: left;
		padding-left: 14px;
		background: var(--surface);
	}
	tfoot .c-tot {
		text-align: right;
		padding-right: 14px;
		font-size: 15px;
	}

	@media (max-width: 1100px) {
		.spark {
			display: none;
		}
		.c-act {
			min-width: 230px;
			width: 230px;
		}
	}
	@media (max-width: 980px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.legend {
			display: none;
		}
	}
</style>
