<script lang="ts">
	import { tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { navigating } from '$app/state';
	import { deserialize } from '$app/forms';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { toast } from 'svelte-sonner';
	import { downloadSvgAsPng } from '$lib/utils/svgToPng';
	import { jiraTicketUrl, type JiraLinkConfig } from '$lib/jiraLink';
	import UserAvatar from './UserAvatar.svelte';
	import Tooltip from './Tooltip.svelte';
	import TicketEditModal from './TicketEditModal.svelte';

	function round2(n: number) {
		return Math.round((n + Number.EPSILON) * 100) / 100;
	}

	type SprintDashboard = {
		sprintId: string;
		sprintName: string;
		kind: 'SPRINT' | 'VERSION';
		kpis: {
			estTotal: number;
			consumedTotal: number;
			raeTotal: number;
			avancement: number;
			ecartVsEstimeTotal: number;
			/** Admin only — null pour un USER standard. Libellé historique "TNF". */
			ecartVsBudgetTotal: number | null;
			/** Admin only — somme des enveloppeTotale du périmètre. */
			budgetTotal: number | null;
			ticketCount: number;
		};
		byActivity: { label: string; raeReal: number; raeTest: number }[];
		byPerson: { name: string; consumed: number }[];
		history: { date: string; consumed: number; rae: number }[];
		tickets: SprintDashboardTicket[];
		ticketGroups: {
			groupId: string | null;
			label: string;
			estTotal: number;
			raeTotal: number;
			consumed: number;
			avancement: number;
			tickets: SprintDashboardTicket[];
		}[];
	};

	type SprintDashboardTicket = {
		id: string;
		key: string;
		title: string;
		stateLabel: string | null;
		stateEmoji: string | null;
		stateColor: string | null;
		budget: number | null;
		estTotal: number;
		raeTotal: number;
		consumed: number;
		ecartVsEstime: number;
		ecartVsBudget: number | null;
		avancement: number;
		priority: number;
		assigneeId: string | null;
		assigneeName: string | null;
	};

	let {
		title,
		baseHref,
		options,
		selectedId,
		dashboard: dashboardProp,
		emptyLabel,
		jiraCfg,
		states,
		projects,
		sprints,
		versions,
		ssps,
		ticketGroups: allTicketGroups,
		members,
		testPhase,
		canEditEstimation,
		isAdmin,
		isOwner
	}: {
		title: string;
		baseHref: string;
		options: { id: string; name: string }[];
		selectedId: string | null;
		dashboard: SprintDashboard | null;
		emptyLabel: string;
		jiraCfg: JiraLinkConfig;
		// Tout ce qui suit sert uniquement au menu clic droit + à la modale d'édition complète
		// (TicketEditModal, même modal que Tickets & chiffrage) sur les tickets de ce dashboard.
		states: { id: string; label: string; emoji: string | null; color: string | null }[];
		projects: { id: string; name: string }[];
		sprints: { id: string; name: string }[];
		versions: { id: string; name: string }[];
		ssps: { id: string; code: string; label: string }[];
		ticketGroups: { id: string; label: string }[];
		members: { id: string; displayName: string; factice: boolean }[];
		testPhase: boolean;
		canEditEstimation: boolean;
		isAdmin: boolean;
		isOwner: boolean;
	} = $props();

	// Copie locale reactive (`$state`) du prop : le patch optimiste du menu clic droit (cf.
	// patchTicket plus bas) doit muter un objet que Svelte suit, pas juste le contenu d'un prop
	// (une mutation de propriété profonde sur `dashboardProp` ne déclenche aucun rendu — vérifié en
	// pratique, cf. `rows = $state(...)` dans tickets/+page.svelte, même contrainte). Resynchronisée
	// dès que le prop change réellement (changement de sprint/version, ou invalidateAll après
	// suppression/édition complète).
	let dashboard = $state(dashboardProp);
	$effect(() => {
		dashboard = dashboardProp;
	});

	const pct = (x: number) => Math.round(x * 100);
	// État, Ticket, Assigné, Estimé, RAE, Consommé, Écart vs estimé, Avancement — + Budget / Écart vs
	// budget si visibles (isAdmin), pour le colspan de l'en-tête et de la ligne de sous-total par groupe.
	const usColCount = $derived(
		8 + (dashboard?.kpis.budgetTotal !== null ? 1 : 0) + (dashboard?.kpis.ecartVsBudgetTotal !== null ? 1 : 0)
	);

	// Sections par groupe de tickets : préférence locale (retour utilisateur), pas serveur — chacun
	// choisit sa vue sans que ça affecte les autres. Défaut = pas de groupement (liste à plat).
	const GROUP_KEY = 'imputo-dashboard-group-tickets';
	let groupByTicketGroup = $state(false);
	$effect(() => {
		groupByTicketGroup = localStorage.getItem(GROUP_KEY) === '1';
	});
	function onToggleGroup() {
		localStorage.setItem(GROUP_KEY, groupByTicketGroup ? '1' : '0');
	}

	// Menu clic droit sur une ligne — même panneau que Tickets & chiffrage (tickets/+page.svelte,
	// voir les commentaires là-bas pour le détail du positionnement/flip). Différences : pas
	// d'"Ajouter à Mon imputation" (naviguerait hors de la page Synthèse), remplacé par "Éditer" qui
	// ouvre TicketEditModal sans quitter la vue ; et après une mise à jour, `invalidateAll()` plutôt
	// qu'une mutation locale — les KPIs/écarts agrégés du dashboard doivent être recalculés côté
	// serveur, pas juste le champ isolé qu'on vient de changer.
	let ctxRow = $state<SprintDashboardTicket | null>(null);
	let ctxAnchor = $state<{ x: number; y: number } | null>(null);
	let ctxPos = $state({ x: 0, y: 0 });
	let ctxSubmenu = $state<'state' | 'priority' | 'assignee' | null>(null);
	let ctxMenuEl: HTMLDivElement | null = $state(null);
	let editTicketId = $state<string | null>(null);

	async function positionCtxMenu() {
		if (!ctxAnchor) return;
		await tick();
		if (!ctxMenuEl) return;
		let { x, y } = ctxAnchor;
		if (x + ctxMenuEl.offsetWidth > window.innerWidth) x = Math.max(4, window.innerWidth - ctxMenuEl.offsetWidth - 4);
		if (y + ctxMenuEl.offsetHeight > window.innerHeight) y = Math.max(4, window.innerHeight - ctxMenuEl.offsetHeight - 4);
		ctxPos = { x, y };
	}
	function openContextMenu(e: MouseEvent, row: SprintDashboardTicket) {
		e.preventDefault();
		ctxRow = row;
		ctxAnchor = { x: e.clientX, y: e.clientY };
		ctxPos = { ...ctxAnchor };
		ctxSubmenu = null;
		positionCtxMenu();
	}
	function closeContextMenu() {
		ctxRow = null;
		ctxAnchor = null;
		ctxSubmenu = null;
	}
	function openCtxSubmenu(which: 'state' | 'priority' | 'assignee' | null) {
		ctxSubmenu = which;
		positionCtxMenu();
	}
	function onWindowClickCloseCtxMenu(e: MouseEvent) {
		if (ctxRow && !(e.target as HTMLElement).closest('.ctx-menu')) closeContextMenu();
	}
	function onWindowKeydownCtxMenu(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (editTicketId) return; // TicketEditModal gère déjà son propre Escape (onClose)
		closeContextMenu();
	}
	async function ctxCopy(text: string, label: string) {
		closeContextMenu();
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${label} copié ✓`);
		} catch {
			toast.error('Impossible de copier.');
		}
	}
	// État/priorité/assigné n'entrent dans le calcul d'aucun KPI/écart affiché ici (avancement,
	// consommé, écarts vs estimé/budget ne dépendent que de estTotal/raeTotal/consumed) : patcher
	// le ticket en local suffit, pas besoin d'un invalidateAll qui recharge tout le dashboard (chart,
	// répartitions...) pour un simple changement de badge. Les données du load ayant traversé un
	// aller-retour JSON, le même ticket existe comme des objets DISTINCTS dans dashboard.tickets et
	// dans chaque dashboard.ticketGroups[].tickets — il faut patcher chaque occurrence trouvée.
	function patchTicket(ticketId: string, patch: Partial<SprintDashboardTicket>) {
		if (!dashboard) return;
		const apply = (list: SprintDashboardTicket[]) => {
			const t = list.find((x) => x.id === ticketId);
			if (t) Object.assign(t, patch);
		};
		apply(dashboard.tickets);
		for (const g of dashboard.ticketGroups) apply(g.tickets);
	}
	async function ctxUpdate(ticketId: string, field: string, value: string | number | null) {
		const body = new FormData();
		body.set('ticketId', ticketId);
		body.set('field', field);
		body.set('value', value == null ? '' : String(value));
		const res = await fetch('/tickets?/update', { method: 'POST', body });
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			toast.error((result.data?.error as string) ?? 'Erreur lors de l’enregistrement.');
		} else {
			toast.success('Enregistré ✓');
		}
	}
	function ctxSetState(row: SprintDashboardTicket, stateId: string | null) {
		closeContextMenu();
		const s = stateId ? states.find((x) => x.id === stateId) : null;
		patchTicket(row.id, { stateLabel: s?.label ?? null, stateEmoji: s?.emoji ?? null, stateColor: s?.color ?? null });
		ctxUpdate(row.id, 'stateId', stateId);
	}
	function ctxSetPriority(row: SprintDashboardTicket, priority: number) {
		closeContextMenu();
		patchTicket(row.id, { priority });
		ctxUpdate(row.id, 'priority', priority);
	}
	function ctxSetAssignee(row: SprintDashboardTicket, assigneeId: string | null) {
		closeContextMenu();
		const m = assigneeId ? members.find((x) => x.id === assigneeId) : null;
		patchTicket(row.id, { assigneeId, assigneeName: m?.displayName ?? null });
		ctxUpdate(row.id, 'assigneeId', assigneeId);
	}
	function ctxEdit(row: SprintDashboardTicket) {
		closeContextMenu();
		editTicketId = row.id;
	}
	// Reproduit le flux de suppression de tickets/+page.svelte (vérif imputationCount,
	// confirmDialog, POST /tickets?/delete) sans passer par le <form>/use:enhance de la modale.
	async function ctxDelete(row: SprintDashboardTicket) {
		closeContextMenu();
		const res = await fetch(`/api/tickets/${row.id}`);
		const t = res.ok ? await res.json() : null;
		if (!t || t.imputationCount > 0) {
			if (t) {
				const n = t.imputationCount;
				toast.error('Suppression impossible', { description: `${n} imputation${n > 1 ? 's sont liées' : ' est liée'} à ce ticket.` });
			} else {
				toast.error('Erreur lors de la vérification.');
			}
			return;
		}
		const ok = await confirmDialog({
			title: 'Supprimer le ticket',
			message: `Supprimer définitivement ${row.key} — « ${row.title} » ? Cette action est irréversible.`,
			confirmLabel: 'Supprimer'
		});
		if (!ok) return;
		const body = new FormData();
		body.set('ticketId', row.id);
		const delRes = await fetch('/tickets?/delete', { method: 'POST', body });
		const result = deserialize(await delRes.text());
		if (result.type === 'failure') {
			toast.error((result.data?.error as string) ?? 'Erreur lors de la suppression.');
		} else {
			await invalidateAll();
		}
	}

	// Export en image (PNG) de la table Tickets — but : coller directement dans une diapo (retour
	// utilisateur). Même table, même groupement que ce qui est affiché à l'écran.
	let imgBusy = $state(false);
	async function downloadTicketsPng() {
		if (!dashboard) return;
		imgBusy = true;
		try {
			const params = new URLSearchParams({ id: dashboard.sprintId, grouped: groupByTicketGroup ? '1' : '0' });
			const res = await fetch(`/dashboard/tickets-export-image?${params}`);
			if (!res.ok) return;
			const svgText = await res.text();
			const slug = dashboard.sprintName.replace(/[^\w-]+/g, '-');
			await downloadSvgAsPng(svgText, `tickets-${slug}.png`);
		} finally {
			imgBusy = false;
		}
	}

	// Repli d'un groupe : mémorisé par groupe, pas par sprint/version — un groupe de tickets est
	// une notion d'espace, replier « Dette technique » une fois vaut pour tous les sprints. Même
	// motif que la préférence de groupement ci-dessus : local, jamais serveur.
	const GROUP_COLLAPSE_KEY = 'imputo-dashboard-group-collapsed';
	let collapsedGroups = $state<Record<string, boolean>>({});
	$effect(() => {
		try {
			collapsedGroups = JSON.parse(localStorage.getItem(GROUP_COLLAPSE_KEY) ?? '{}');
		} catch {
			/* entrée corrompue : on repart tout déplié */
		}
	});
	function toggleGroupCollapse(key: string) {
		collapsedGroups = { ...collapsedGroups, [key]: !collapsedGroups[key] };
		localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(collapsedGroups));
	}
	const maxActivity = $derived(Math.max(1, ...(dashboard?.byActivity.map((a) => a.raeReal + a.raeTest) ?? [1])));
	const maxPerson = $derived(Math.max(1, ...(dashboard?.byPerson.map((p) => p.consumed) ?? [1])));

	// Courbe conso/RAE : petit line chart SVG, 2 séries à couleur fixe (identité, pas de rang).
	// Grille Y graduée + aire remplie + axe X à dates régulières, pour que le graphe garde du
	// "corps" même avec peu de points (retour utilisateur : "juste des points sans rien").
	const CHART_W = 600;
	const CHART_H = 180;
	const PAD_T = 10;
	const PAD_B = 22;
	const PAD_L = 34;
	const PAD_R = 10;

	/** Pas "rond" (1/2/5 × 10^n) pour ~`targetCount` graduations entre 0 et maxVal. */
	function niceStep(maxVal: number, targetCount = 4): number {
		if (maxVal <= 0) return 1;
		const raw = maxVal / targetCount;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
		return mult * mag;
	}
	function fmtShortDate(iso: string): string {
		const [, m, d] = iso.split('-');
		return `${d}/${m}`;
	}

	const points = $derived.by(() => {
		const h = dashboard?.history ?? [];
		if (h.length === 0) return null;
		const rawMax = Math.max(1, ...h.map((p) => Math.max(p.consumed, p.rae)));
		const step = niceStep(rawMax);
		const topVal = Math.ceil(rawMax / step) * step;

		const innerW = CHART_W - PAD_L - PAD_R;
		const innerH = CHART_H - PAD_T - PAD_B;
		const stepX = h.length > 1 ? innerW / (h.length - 1) : 0;
		const x = (i: number) => PAD_L + i * stepX;
		const y = (v: number) => PAD_T + innerH - (v / topVal) * innerH;
		const baseline = PAD_T + innerH;

		const consumedPath = h.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.consumed)}`).join(' ');
		const raePath = h.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.rae)}`).join(' ');
		// Aire remplie : referme la ligne sur la baseline. Rien à fermer à 0-1 point (pas de ligne).
		const area = (path: string) => (h.length > 1 ? `${path} L ${x(h.length - 1)} ${baseline} L ${x(0)} ${baseline} Z` : null);

		const yTicks: { v: number; y: number }[] = [];
		for (let v = 0; v <= topVal + step * 0.001; v += step) yTicks.push({ v: round2(v), y: y(v) });

		// ~5 ticks X répartis uniformément sur les index (jamais plus que de points).
		const n = Math.min(5, h.length);
		const idx = n <= 1 ? [0] : [...new Set(Array.from({ length: n }, (_, k) => Math.round((k * (h.length - 1)) / (n - 1))))];
		const xTicks = idx.map((i, k) => ({
			x: x(i),
			label: fmtShortDate(h[i].date),
			anchor: k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle'
		}));

		return {
			consumedPath,
			raePath,
			consumedArea: area(consumedPath),
			raeArea: area(raePath),
			dots: h.map((p, i) => ({ x: x(i), yc: y(p.consumed), yr: y(p.rae), date: p.date, consumed: p.consumed, rae: p.rae })),
			yTicks,
			xTicks
		};
	});
</script>

<div class="topbar">
	<h1>{title}{#if dashboard}<small>{dashboard.sprintName}</small>{/if}</h1>
	<div class="spacer"></div>
	{#if options.length > 0}
		{#if navigating.to}<span class="loading-hint">Chargement…</span>{/if}
		<select
			class="periodsel"
			value={selectedId}
			disabled={!!navigating.to}
			onchange={(e) => goto(`${baseHref}?id=${e.currentTarget.value}`, { keepFocus: true })}
			aria-label="Sélectionner"
		>
			{#each options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
		</select>
	{/if}
</div>

<div class="content">
	{#if !dashboard}
		<p class="empty">{emptyLabel}</p>
	{:else}
		<div class="kpis">
			<div class="card kpi">
				<div class="k">Avancement</div>
				<div class="v tabnum">{pct(dashboard.kpis.avancement)}<small>%</small></div>
				<div class="sub">{dashboard.kpis.ticketCount} tickets</div>
			</div>
			<div class="card kpi">
				<div class="k">Consommé / Estimé</div>
				<div class="v tabnum">{dashboard.kpis.consumedTotal}<small>/ {dashboard.kpis.estTotal} j</small></div>
			</div>
			{#if dashboard.kpis.budgetTotal !== null}
				<div class="card kpi">
					<div class="k">Consommé / Budget</div>
					<div class="v tabnum">{dashboard.kpis.consumedTotal}<small>/ {dashboard.kpis.budgetTotal} j</small></div>
				</div>
			{/if}
			<div class="card kpi">
				<div class="k">RAE global</div>
				<div class="v tabnum">{dashboard.kpis.raeTotal}<small>j</small></div>
			</div>
			<div class="card kpi" class:warn={dashboard.kpis.ecartVsEstimeTotal > 0} class:good={dashboard.kpis.ecartVsEstimeTotal < 0}>
				<div class="k">Écart vs estimé</div>
				<div class="v tabnum">{dashboard.kpis.ecartVsEstimeTotal > 0 ? '+' : ''}{dashboard.kpis.ecartVsEstimeTotal}<small>j</small></div>
			</div>
			{#if dashboard.kpis.ecartVsBudgetTotal !== null}
				<div class="card kpi" class:warn={dashboard.kpis.ecartVsBudgetTotal > 0} class:good={dashboard.kpis.ecartVsBudgetTotal < 0}>
					<div class="k">Écart vs budget (TNF)</div>
					<div class="v tabnum">{dashboard.kpis.ecartVsBudgetTotal > 0 ? '+' : ''}{dashboard.kpis.ecartVsBudgetTotal}<small>j</small></div>
				</div>
			{/if}
		</div>

		<div class="card panel">
			<h3>Évolution conso / RAE</h3>
			{#if !points}
				<p class="empty">Pas encore d'historique — alimenté par le snapshot quotidien.</p>
			{:else}
				<svg viewBox="0 0 {CHART_W} {CHART_H}" class="history-chart" role="img" aria-label="Courbe consommé et RAE dans le temps">
					{#each points.yTicks as t (t.v)}
						<line x1={PAD_L} y1={t.y} x2={CHART_W - PAD_R} y2={t.y} class="grid-line" />
						<text x={PAD_L - 6} y={t.y} text-anchor="end" dominant-baseline="middle" class="axis-label">{t.v}</text>
					{/each}
					{#if points.consumedArea}<path d={points.consumedArea} class="area area-consumed" />{/if}
					{#if points.raeArea}<path d={points.raeArea} class="area area-rae" />{/if}
					<path d={points.consumedPath} fill="none" stroke="var(--accent)" stroke-width="2" />
					<path d={points.raePath} fill="none" stroke="color-mix(in srgb, var(--accent) 30%, var(--text-mute))" stroke-width="2" />
					{#each points.dots as d (d.date)}
						<circle cx={d.x} cy={d.yc} r="3" fill="var(--accent)"><title>{d.date} — Consommé {d.consumed} j</title></circle>
						<circle cx={d.x} cy={d.yr} r="3" fill="color-mix(in srgb, var(--accent) 30%, var(--text-mute))"><title>{d.date} — RAE {d.rae} j</title></circle>
					{/each}
					{#each points.xTicks as t (t.x)}
						<text x={t.x} y={CHART_H - 6} text-anchor={t.anchor} class="axis-label">{t.label}</text>
					{/each}
				</svg>
				<div class="chart-axis">
					<span class="chart-legend"><i class="dot prod"></i> Consommé <i class="dot nonprod"></i> RAE</span>
				</div>
			{/if}
		</div>

		<div class="grid">
			<div class="card panel">
				<h3>RAE par activité</h3>
				{#if dashboard.byActivity.length === 0}
					<p class="empty">Aucune donnée.</p>
				{:else}
					<div class="rae-activity-wrap">
						<div class="barlist">
							{#each dashboard.byActivity as a (a.label)}
								<div class="barrow">
									<span class="lbl">{a.label}</span>
									<div class="track"><i style="width:{((a.raeReal + a.raeTest) / maxActivity) * 100}%"></i></div>
									<span class="val tabnum">{round2(a.raeReal + a.raeTest)}</span>
								</div>
							{/each}
						</div>
						{#if dashboard.kpis.raeTotal === 0}
							<div class="rae-zero-overlay">
								<p>Rien à engager — le RAE de ce sprint est à zéro.</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="card panel">
				<h3>Répartition par personne</h3>
				{#if dashboard.byPerson.length === 0}
					<p class="empty">Aucune imputation.</p>
				{:else}
					<div class="barlist">
						{#each dashboard.byPerson as p (p.name)}
							<div class="barrow">
								<span class="lbl">{p.name}</span>
								<div class="track"><i style="width:{(p.consumed / maxPerson) * 100}%"></i></div>
								<span class="val tabnum">{p.consumed}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="card panel tickets-panel">
			<div class="tickets-head">
				<h3>{dashboard.kind === 'VERSION' ? 'Tickets de la version' : 'Tickets du sprint'}</h3>
				<div class="tickets-head-actions">
					<label class="group-toggle">
						<input type="checkbox" bind:checked={groupByTicketGroup} onchange={onToggleGroup} />
						<span class="switch"></span>
						<span class="switch-label">Grouper par groupe de tickets</span>
					</label>
					{#if dashboard.tickets.length > 0}
						<button type="button" class="btn btn-ghost export-btn" disabled={imgBusy} onclick={downloadTicketsPng}>
							{imgBusy ? 'Génération…' : '⬇ Exporter en image (PNG)'}
						</button>
					{/if}
				</div>
			</div>
			{#if dashboard.tickets.length === 0}
				<p class="empty">Aucun ticket.</p>
			{:else}
				{#snippet ticketRow(t: SprintDashboardTicket)}
					<tr
						class="us-row"
						tabindex="0"
						role="link"
						onclick={() => goto(`/tickets?ticket=${encodeURIComponent(t.key)}`)}
						onkeydown={(e) => {
							if (e.key === 'Enter') goto(`/tickets?ticket=${encodeURIComponent(t.key)}`);
						}}
						oncontextmenu={(e) => openContextMenu(e, t)}
					>
						<td>
							<span
								class="state-pill"
								style={t.stateColor ? `background:color-mix(in srgb, ${t.stateColor} 18%, transparent); color:${t.stateColor};` : ''}
							>{t.stateEmoji ?? ''} {t.stateLabel ?? '—'}</span>
						</td>
						<td class="ttl">
							{#if jiraTicketUrl(jiraCfg, t.key)}
								<a class="key tabnum" href={jiraTicketUrl(jiraCfg, t.key)} target="_blank" rel="noopener noreferrer" title="Ouvrir dans Jira" onclick={(e) => e.stopPropagation()}>{t.key}</a>
							{:else}
								<span class="key tabnum">{t.key}</span>
							{/if}
							<span class="priority-badge" style="--pcolor:var(--priority-{t.priority})" title="Priorité P{t.priority}">P{t.priority}</span>
							<span class="title">{t.title}</span>
						</td>
						<td class="assignee-cell">
							{#if t.assigneeId}
								<Tooltip text={t.assigneeName ?? ''}><UserAvatar userId={t.assigneeId} name={t.assigneeName ?? '?'} size={24} /></Tooltip>
							{/if}
						</td>
						{#if dashboard!.kpis.budgetTotal !== null}<td class="num tabnum">{t.budget ?? '—'}</td>{/if}
						<td class="num tabnum">{t.estTotal}</td>
						<td class="num tabnum">{t.raeTotal}</td>
						<td class="num tabnum">{t.consumed || '—'}</td>
						{#if dashboard!.kpis.ecartVsBudgetTotal !== null}
							<td class="num tabnum" class:over={(t.ecartVsBudget ?? 0) > 0} class:under={(t.ecartVsBudget ?? 0) < 0}>{(t.ecartVsBudget ?? 0) > 0 ? '+' : ''}{t.ecartVsBudget ?? 0}</td>
						{/if}
						<td class="num tabnum" class:over={t.ecartVsEstime > 0} class:under={t.ecartVsEstime < 0}>{t.ecartVsEstime > 0 ? '+' : ''}{t.ecartVsEstime || 0}</td>
						<td>
							<div class="prog">
								<div class="bar"><i style="width:{pct(t.avancement)}%"></i></div>
								<span class="pct tabnum">{pct(t.avancement)}%</span>
							</div>
						</td>
					</tr>
				{/snippet}
				<div class="us-table-wrap">
					<table class="us-table">
						<thead>
							<tr>
								<th>État</th><th>Ticket</th><th class="assignee-cell"></th>
								{#if dashboard.kpis.budgetTotal !== null}<th class="num">Budget</th>{/if}
								<th class="num">Estimé</th><th class="num">RAE</th><th class="num">Consommé</th>
								{#if dashboard.kpis.ecartVsBudgetTotal !== null}<th class="num">Écart vs budget</th>{/if}
								<th class="num">Écart vs estimé</th><th class="num">Avancement</th>
							</tr>
						</thead>
						<tbody>
							{#if groupByTicketGroup}
								{#each dashboard.ticketGroups as g (g.groupId ?? '__none__')}
									{@const gKey = g.groupId ?? '__none__'}
									{@const open = !collapsedGroups[gKey]}
									<tr class="us-group-row">
										<td colspan={usColCount}>
											<!-- Le sous-total reste visible replié : c'est le résumé du groupe. -->
											<button
												type="button"
												class="us-group-toggle"
												aria-expanded={open}
												onclick={() => toggleGroupCollapse(gKey)}
											>
												<svg
													class="chev"
													class:closed={!open}
													width="13"
													height="13"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"><path d="m6 9 6 6 6-6" /></svg
												>
												{g.label}
												<span class="us-group-count">{g.tickets.length} ticket{g.tickets.length > 1 ? 's' : ''}</span>
											</button>
										</td>
									</tr>
									{#if open}
										{#each g.tickets as t (t.id)}
											{@render ticketRow(t)}
										{/each}
									{/if}
									<tr class="us-subtotal-row">
										<td></td>
										<td class="ttl">Sous-total</td>
										<td></td>
										{#if dashboard.kpis.budgetTotal !== null}<td></td>{/if}
										<td class="num tabnum">{g.estTotal}</td>
										<td class="num tabnum">{g.raeTotal}</td>
										<td class="num tabnum">{g.consumed || '—'}</td>
										{#if dashboard.kpis.ecartVsBudgetTotal !== null}<td></td>{/if}
										<td></td>
										<td>
											<div class="prog">
												<div class="bar"><i style="width:{pct(g.avancement)}%"></i></div>
												<span class="pct tabnum">{pct(g.avancement)}%</span>
											</div>
										</td>
									</tr>
								{/each}
							{:else}
								{#each dashboard.tickets as t (t.id)}
									{@render ticketRow(t)}
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

<svelte:window onkeydown={onWindowKeydownCtxMenu} onclick={onWindowClickCloseCtxMenu} />

{#if ctxRow}
	{@const row = ctxRow}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="ctx-menu"
		role="menu"
		bind:this={ctxMenuEl}
		style="left:{ctxPos.x}px; top:{ctxPos.y}px;"
		onclick={(e) => e.stopPropagation()}
	>
		{#if ctxSubmenu === null}
			<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxCopy(row.key, 'Clé')}>Copier la clé</button>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxCopy(`${location.origin}/tickets?ticket=${row.key}`, 'Lien')}>Copier le lien</button>
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => openCtxSubmenu('state')}>Changer l'état →</button>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => openCtxSubmenu('priority')}>Changer la priorité →</button>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => openCtxSubmenu('assignee')}>Assigner à… →</button>
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxEdit(row)}>Éditer</button>
			{#if isOwner}
				<div class="ctx-sep"></div>
				<button type="button" class="ctx-item danger" role="menuitem" onclick={() => ctxDelete(row)}>Supprimer</button>
			{/if}
		{:else if ctxSubmenu === 'state'}
			<button type="button" class="ctx-item ctx-back" role="menuitem" onclick={() => openCtxSubmenu(null)}>← Retour</button>
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxSetState(row, null)}>—</button>
			{#each states as s (s.id)}
				<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxSetState(row, s.id)}>{s.emoji} {s.label}</button>
			{/each}
		{:else if ctxSubmenu === 'priority'}
			<button type="button" class="ctx-item ctx-back" role="menuitem" onclick={() => openCtxSubmenu(null)}>← Retour</button>
			<div class="ctx-sep"></div>
			{#each [0, 1, 2, 3, 4] as n (n)}
				<button type="button" class="ctx-item ctx-priority" role="menuitem" onclick={() => ctxSetPriority(row, n)}>
					<span class="ctx-priority-dot" style="--pcolor:var(--priority-{n})"></span>P{n}
				</button>
			{/each}
		{:else if ctxSubmenu === 'assignee'}
			<button type="button" class="ctx-item ctx-back" role="menuitem" onclick={() => openCtxSubmenu(null)}>← Retour</button>
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxSetAssignee(row, null)}>—</button>
			{#each members.filter((m) => !m.factice) as m (m.id)}
				<button type="button" class="ctx-item" role="menuitem" onclick={() => ctxSetAssignee(row, m.id)}>
					<UserAvatar userId={m.id} name={m.displayName} size={18} />
					{m.displayName}
				</button>
			{/each}
		{/if}
	</div>
{/if}

<TicketEditModal
	ticketId={editTicketId}
	{states}
	{projects}
	{sprints}
	{versions}
	{ssps}
	ticketGroups={allTicketGroups}
	{members}
	{testPhase}
	{canEditEstimation}
	{isAdmin}
	{isOwner}
	onClose={() => (editTicketId = null)}
	onSaved={() => invalidateAll()}
	onDeleted={() => {
		editTicketId = null;
		invalidateAll();
	}}
/>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 18px;
	}
	.topbar h1 {
		display: flex;
		flex-direction: column;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		margin: 0;
	}
	.topbar h1 small {
		font-family: var(--font-ui);
		font-size: 13px;
		font-weight: 500;
		color: var(--text-mute);
	}
	.spacer {
		flex: 1;
	}
	.periodsel {
		appearance: none;
		padding: 9px 34px 9px 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--border);
		background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.periodsel:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.loading-hint {
		font-size: 12px;
		color: var(--text-mute);
	}
	.empty {
		color: var(--text-mute);
		font-size: 13px;
	}
	/* RAE par activité à 0 partout : la barlist reste dessous, ce message flotte par-dessus et
	   s'efface au survol pour la laisser consultable plutôt que la cacher. */
	.rae-activity-wrap {
		position: relative;
	}
	.rae-zero-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 12px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(2px);
		border-radius: var(--r-md);
		transition: opacity 0.15s ease;
	}
	.rae-zero-overlay p {
		color: var(--text-mute);
		font-size: 13px;
		margin: 0;
	}
	.rae-activity-wrap:hover .rae-zero-overlay {
		opacity: 0;
		pointer-events: none;
	}
	.kpis {
		display: grid;
		/* auto-fit et non repeat(N) : les cartes budget/écart vs budget sont masquées hors
		   ADMIN/MANAGER, une grille figée laisserait alors un trou. */
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
		margin-bottom: 18px;
	}
	.kpi {
		padding: 16px 18px;
	}
	.kpi.warn {
		border-color: #c0392b;
	}
	.kpi.good {
		border-color: var(--success);
	}
	.kpi .k {
		font-size: 12px;
		color: var(--text-mute);
		font-weight: 600;
	}
	.kpi .v {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-top: 6px;
	}
	.kpi .v small {
		font-size: 13px;
		color: var(--text-mute);
		font-family: var(--font-ui);
		font-weight: 500;
	}
	.kpi .sub {
		margin-top: 2px;
		font-size: 12px;
		color: var(--text-mute);
	}
	.panel {
		padding: 18px 20px;
	}
	.panel h3 {
		margin: 0 0 14px;
		font-size: 14px;
		font-weight: 700;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}
	.history-chart {
		width: 100%;
		height: 180px;
	}
	.grid-line {
		stroke: var(--border);
		stroke-width: 1;
	}
	.axis-label {
		font-size: 9px;
		fill: var(--text-mute);
	}
	.area-consumed {
		fill: var(--accent);
		opacity: 0.12;
	}
	.area-rae {
		fill: color-mix(in srgb, var(--accent) 30%, var(--text-mute));
		opacity: 0.12;
	}
	.chart-axis {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 6px;
		font-size: 11px;
		color: var(--text-mute);
	}
	.chart-legend {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.dot.prod {
		background: var(--accent);
	}
	.dot.nonprod {
		background: color-mix(in srgb, var(--accent) 30%, var(--text-mute));
		margin-left: 8px;
	}
	.barlist {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.barrow {
		display: grid;
		grid-template-columns: 110px 1fr 50px;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-soft);
	}
	.track {
		height: 8px;
		border-radius: 4px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 4px;
	}
	.val {
		text-align: right;
		font-weight: 600;
	}

	.tickets-panel {
		margin-top: 16px;
	}
	.tickets-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.tickets-head h3 {
		margin: 0;
	}
	.tickets-head-actions {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.export-btn {
		font-size: 12.5px;
		padding: 7px 12px;
	}
	.group-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}
	.group-toggle input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.switch {
		position: relative;
		width: 34px;
		height: 20px;
		flex-shrink: 0;
		border-radius: 20px;
		background: var(--border-strong);
		transition: background 0.15s;
	}
	.switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
		transition: transform 0.15s;
	}
	.group-toggle input:checked + .switch {
		background: var(--accent);
	}
	.group-toggle input:checked + .switch::after {
		transform: translateX(14px);
	}
	.group-toggle input:focus-visible + .switch {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.switch-label {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.us-table-wrap {
		overflow-x: auto;
	}
	.us-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.us-table th {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-mute);
		padding: 8px 10px;
		text-align: left;
		white-space: nowrap;
	}
	.us-table th.num,
	.us-table td.num {
		text-align: right;
	}
	.assignee-cell {
		width: 1%;
	}
	.us-table td {
		padding: 8px 10px;
		border-top: 1px solid var(--border);
		vertical-align: middle;
	}
	.us-row {
		cursor: pointer;
	}
	.us-row:hover {
		background: var(--surface-2);
	}
	.us-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.us-group-row td {
		padding: 10px 10px 6px;
		border-top: none;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-soft);
	}
	.us-group-row:first-child td {
		padding-top: 8px;
	}
	.us-group-toggle {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0;
		color: inherit;
		font: inherit;
	}
	.us-group-toggle .chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.15s ease;
	}
	.us-group-toggle .chev.closed {
		transform: rotate(-90deg);
	}
	.us-group-toggle:hover .chev {
		color: var(--accent);
	}
	.us-group-count {
		margin-left: 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		color: var(--text-mute);
	}
	.us-subtotal-row td {
		background: var(--surface-2);
		font-weight: 600;
		color: var(--text-soft);
	}
	.us-table .ttl {
		display: flex;
		align-items: baseline;
		gap: 8px;
		white-space: nowrap;
	}
	.us-table .key {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		flex-shrink: 0;
	}
	/* Même badge que Tickets & chiffrage (--priority-0..4, app.css) — juste copié ici plutôt que
	   partagé, pas de composant dédié pour un si petit bout de markup. */
	.priority-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--pcolor);
		background: color-mix(in srgb, var(--pcolor) 18%, var(--surface-2));
		flex-shrink: 0;
	}
	.us-table .title {
		font-weight: 500;
		/* Plafonne le titre (pas la cellule elle-même, sinon la case se détache de sa colonne et
		   laisse un trou sans fond/bordure) : un titre très long forçait sinon la table entière à
		   déborder et à scroller horizontalement (retour utilisateur) — tronqué en ellipse à la place. */
		max-width: 380px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.state-pill {
		display: inline-block;
		padding: 3px 9px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.us-table td.over {
		color: var(--warn);
		font-weight: 700;
	}
	.us-table td.under {
		color: var(--success);
		font-weight: 700;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: flex-end;
	}
	.prog .bar {
		width: 60px;
		height: 6px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.prog .bar i {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 20px;
	}
	.prog .pct {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 32px;
		text-align: right;
	}

	@media (max-width: 1000px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.grid {
			grid-template-columns: 1fr;
		}
	}

	/* Menu clic droit — copié tel quel de tickets/+page.svelte (.ctx-menu et suivants). */
	.ctx-menu {
		position: fixed;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 220px;
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px;
		border-radius: var(--r-md, 10px);
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
	}
	.ctx-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 7px 9px;
		border-radius: 8px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		text-align: left;
		white-space: nowrap;
	}
	.ctx-item:hover {
		background: var(--accent-tint, var(--surface-2));
		color: var(--text);
	}
	.ctx-item.danger:hover {
		background: rgba(192, 57, 43, 0.12);
		color: #c0392b;
	}
	.ctx-item.ctx-back {
		color: var(--text-mute);
		font-weight: 700;
	}
	.ctx-priority-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--pcolor);
		flex-shrink: 0;
	}
	.ctx-sep {
		height: 1px;
		margin: 4px 2px;
		background: var(--border);
	}
</style>
