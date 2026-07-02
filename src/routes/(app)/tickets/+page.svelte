<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();

	let showCreate = $state(false);
	let query = $state('');
	let fState = $state('');
	let fAssignee = $state('');
	let fProject = $state('');
	let fSprint = $state('');
	let fVersion = $state('');
	let savedFlash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout>;

	type Row = {
		id: string;
		key: string;
		title: string;
		isChild: boolean;
		stateId: string | null;
		assigneeId: string | null;
		projectId: string | null;
		sprintId: string | null;
		versionId: string | null;
		prepa: number;
		comment: string | null;
		flags: Record<string, string>;
		estimationReal: number;
		raeReal: number;
		estimationTest: number;
		raeTest: number;
		consumed: number;
	};

	const FLAG_VALUES = ['Oui', 'Non', 'N/A', 'À MAJ', 'MAJ', 'OK'];
	const FLAG_FIELDS = [
		{ key: 'cypress', label: 'Cypress' },
		{ key: 'docTech', label: 'Doc technique' },
		{ key: 'prepaQualif', label: 'Prépa qualif' }
	] as const;

	let rows = $state<Row[]>([]);
	let openId = $state<string | null>(null);
	const toggleDetail = (id: string) => (openId = openId === id ? null : id);
	// (Re)synchronise quand les données serveur changent (création, reload).
	$effect(() => {
		rows = data.tickets.map((t) => ({
			id: t.id,
			key: t.key,
			title: t.title,
			isChild: t.isChild,
			stateId: t.stateId,
			assigneeId: t.assigneeId,
			projectId: t.projectId,
			sprintId: t.sprintId,
			versionId: t.versionId,
			prepa: t.prepa,
			comment: t.comment,
			flags: { ...t.flags },
			estimationReal: t.estimationReal,
			raeReal: t.raeReal,
			estimationTest: t.estimationTest,
			raeTest: t.raeTest,
			consumed: t.consumed
		}));
	});

	const stateById = $derived(new Map(data.ref.states.map((s) => [s.id, s])));

	const hasFilters = $derived(
		!!(query || fState || fAssignee || fProject || fSprint || fVersion)
	);
	function resetFilters() {
		query = fState = fAssignee = fProject = fSprint = fVersion = '';
	}

	let filtered = $derived(
		rows.filter(
			(t) =>
				(!query ||
					t.key.toLowerCase().includes(query.toLowerCase()) ||
					t.title.toLowerCase().includes(query.toLowerCase())) &&
				(!fState || t.stateId === fState) &&
				(!fAssignee || t.assigneeId === fAssignee) &&
				(!fProject || t.projectId === fProject) &&
				(!fSprint || t.sprintId === fSprint) &&
				(!fVersion || t.versionId === fVersion)
		)
	);

	// --- calculs dérivés (mêmes formules que le serveur) ---
	const n = (v: number | string | null) => (v == null || v === '' ? 0 : Number(v) || 0);
	const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
	const totalEst = (r: Row) => round(n(r.estimationReal) + (data.testPhase ? n(r.estimationTest) : 0));
	const totalRae = (r: Row) => round(n(r.raeReal) + (data.testPhase ? n(r.raeTest) : 0));
	const ecart = (r: Row) => round(r.consumed - totalEst(r));
	const avancement = (r: Row) => {
		const te = totalEst(r);
		return te > 0 ? Math.min(1, Math.max(0, (te - totalRae(r)) / te)) : 0;
	};
	const raeSugg = (r: Row) => round(Math.max(0, totalEst(r) - r.consumed));
	const pct = (x: number) => Math.round(x * 100);

	// --- Vue Kanban ---
	let view = $state<'table' | 'kanban'>('table');
	let dragId = $state<string | null>(null);
	// Modal d'édition (ouverte au clic sur une carte Kanban).
	let editId = $state<string | null>(null);
	const editRow = $derived(rows.find((r) => r.id === editId) ?? null);
	const assigneeName = (id: string) => data.ref.members.find((m) => m.id === id)?.displayName ?? '';
	const kanbanCols = $derived([
		...data.ref.states.map((s) => ({
			id: s.id as string | null,
			label: s.label,
			emoji: s.emoji,
			color: s.color
		})),
		{ id: null as string | null, label: 'Sans état', emoji: '∅', color: null as string | null }
	]);
	const colTickets = (id: string | null) => filtered.filter((t) => t.stateId === id);
	function onColumnDrop(stateId: string | null) {
		const r = rows.find((x) => x.id === dragId);
		dragId = null;
		stopAutoScroll();
		if (!r || r.stateId === stateId) return;
		r.stateId = stateId; // optimiste
		save(r, 'stateId', stateId);
	}

	// Auto-scroll horizontal du board quand on drague une carte près d'un bord.
	let kanbanEl = $state<HTMLElement | null>(null);
	let scrollDir = 0;
	let rafId = 0;
	const EDGE = 90; // zone sensible (px) à gauche/droite
	const SPEED = 18; // px par frame
	function autoScrollStep() {
		if (scrollDir !== 0 && kanbanEl) {
			kanbanEl.scrollLeft += scrollDir * SPEED;
			rafId = requestAnimationFrame(autoScrollStep);
		} else {
			rafId = 0;
		}
	}
	function onKanbanDragOver(e: DragEvent) {
		e.preventDefault();
		if (!kanbanEl) return;
		const r = kanbanEl.getBoundingClientRect();
		if (e.clientX < r.left + EDGE) scrollDir = -1;
		else if (e.clientX > r.right - EDGE) scrollDir = 1;
		else scrollDir = 0;
		if (scrollDir !== 0 && !rafId) rafId = requestAnimationFrame(autoScrollStep);
	}
	function stopAutoScroll() {
		scrollDir = 0;
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	async function save(row: Row, field: string, value: string | number | null) {
		const body = new FormData();
		body.set('ticketId', row.id);
		body.set('field', field);
		body.set('value', value == null ? '' : String(value));
		await fetch('?/update', { method: 'POST', body });
		flash();
	}
	// Saisie d'une estimation : pré-remplit le RAE correspondant s'il est encore vide
	// (sinon un ticket estimé mais sans RAE afficherait 100 % d'avancement).
	async function saveEst(row: Row, which: 'real' | 'test') {
		if (which === 'real') {
			await save(row, 'estimationReal', row.estimationReal);
			if (!row.raeReal) {
				row.raeReal = row.estimationReal;
				await save(row, 'raeReal', row.raeReal);
			}
		} else {
			await save(row, 'estimationTest', row.estimationTest);
			if (!row.raeTest) {
				row.raeTest = row.estimationTest;
				await save(row, 'raeTest', row.raeTest);
			}
		}
	}
	async function saveFlag(row: Row, key: string, value: string) {
		const body = new FormData();
		body.set('ticketId', row.id);
		body.set('key', key);
		body.set('value', value ?? '');
		await fetch('?/flag', { method: 'POST', body });
		flash();
	}
	function flash() {
		savedFlash = true;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (savedFlash = false), 1400);
	}
</script>

<div class="topbar">
	<h1>Tickets &amp; chiffrage<small>{rows.length} tickets · édition directe</small></h1>
	<div class="spacer"></div>
	{#if savedFlash}<span class="saved">Enregistré ✓</span>{/if}
	<a class="btn btn-ghost" href="/export" data-sveltekit-reload>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="8" rx="1.5"/><path d="M12 17v-6M9 14l3 3 3-3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/></svg>
		Exporter Excel
	</a>
	<button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>
		Nouveau ticket
	</button>
</div>

<div class="content">
	{#if form?.error}<div class="flash error">{form.error}</div>{/if}

	{#if showCreate}
		<div class="card create">
			<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); showCreate = false; }}>
				<div class="grid2">
					<div class="field"><label for="key">Clé</label><input id="key" name="key" placeholder="BLM-1234" required /></div>
					<div class="field"><label for="title">Titre</label><input id="title" name="title" placeholder="Intitulé du ticket" required /></div>
				</div>
				<div class="grid4">
					<div class="field"><label for="project">Projet</label>
						<select id="project" name="projectId"><option value="">—</option>{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="sprint">Sprint</label>
						<select id="sprint" name="sprintId"><option value="">—</option>{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="version">Version</label>
						<select id="version" name="versionId"><option value="">—</option>{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select>
					</div>
					<div class="field"><label for="state">État</label>
						<select id="state" name="stateId"><option value="">—</option>{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}</select>
					</div>
					<div class="field"><label for="assignee">Dev</label>
						<select id="assignee" name="assigneeId"><option value="">—</option>{#each data.ref.members as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}</select>
					</div>
				</div>
				<div class="grid2">
					<div class="field"><label for="er">Est. Réal</label><input id="er" name="estimationReal" type="number" step="0.25" min="0" /></div>
					{#if data.testPhase}<div class="field"><label for="et">Est. Test</label><input id="et" name="estimationTest" type="number" step="0.25" min="0" /></div>{/if}
				</div>
				<div class="actions-row">
					<button type="button" class="btn btn-ghost" onclick={() => (showCreate = false)}>Annuler</button>
					<button type="submit" class="btn btn-primary">Créer</button>
				</div>
			</form>
		</div>
	{/if}

	<div class="filters">
		<div class="seg2">
			<button class:on={view === 'table'} onclick={() => (view = 'table')}>Tableau</button>
			<button class:on={view === 'kanban'} onclick={() => (view = 'kanban')}>Kanban</button>
		</div>
		<select class="filter-sel" bind:value={fState} aria-label="Filtrer par état">
			<option value="">Tous les états</option>
			{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
		</select>
		<select class="filter-sel" bind:value={fAssignee} aria-label="Filtrer par dev">
			<option value="">Tous les devs</option>
			{#each data.ref.members as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
		</select>
		<select class="filter-sel" bind:value={fProject} aria-label="Filtrer par projet">
			<option value="">Tous les projets</option>
			{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
		</select>
		<select class="filter-sel" bind:value={fSprint} aria-label="Filtrer par sprint">
			<option value="">Tous les sprints</option>
			{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
		</select>
		<select class="filter-sel" bind:value={fVersion} aria-label="Filtrer par version">
			<option value="">Toutes les versions</option>
			{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
		</select>
		{#if hasFilters}
			<button class="reset-btn" onclick={resetFilters}>✕ Réinitialiser</button>
			<span class="count">{filtered.length} / {rows.length}</span>
		{/if}
		<div class="search">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
			<input placeholder="Rechercher une US…" bind:value={query} />
		</div>
	</div>

	{#if view === 'table'}
	<div class="card" style="overflow:visible;">
		<table class="tk">
			<thead>
				<tr>
					<th style="width:170px;">État</th><th>Ticket</th><th style="width:130px;">Dev</th>
					<th class="num">Est. Réal</th><th class="num">RAE Réal</th>
					{#if data.testPhase}<th class="num">Est. Test</th><th class="num">RAE Test</th>{/if}<th class="num">Conso.</th>
					<th class="num">Écart</th><th class="num" style="width:130px;">Avancement</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as r (r.id)}
					{@const st = r.stateId ? stateById.get(r.stateId) : null}
					<tr class:parent={!r.isChild}>
						<td>
							<select
								class="cell-select state-select"
								style={st?.color ? `color:${st.color};font-weight:600;` : ''}
								bind:value={r.stateId}
								onchange={() => save(r, 'stateId', r.stateId)}
							>
								<option value={null}>—</option>
								{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
							</select>
						</td>
						<td class="ttl" class:sub={r.isChild}>
							<div class="ttl-wrap">
								<button
									class="expand-btn"
									class:open={openId === r.id}
									onclick={() => toggleDetail(r.id)}
									aria-label="Plus de champs"
									aria-expanded={openId === r.id}
								>›</button>
								<div class="ttl-main">
									<div class="key tabnum">{r.key}</div>
									<input class="cell-input title-input" bind:value={r.title} onchange={() => save(r, 'title', r.title)} />
								</div>
							</div>
						</td>
						<td>
							<select class="cell-select" bind:value={r.assigneeId} onchange={() => save(r, 'assigneeId', r.assigneeId)}>
								<option value={null}>—</option>
								{#each data.ref.members as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
							</select>
						</td>
						<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" bind:value={r.estimationReal} onchange={() => saveEst(r, 'real')} /></td>
						<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" bind:value={r.raeReal} onchange={() => save(r, 'raeReal', r.raeReal)} title={`RAE suggéré (total) : ${raeSugg(r)}`} /></td>
						{#if data.testPhase}
							<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" bind:value={r.estimationTest} onchange={() => saveEst(r, 'test')} /></td>
							<td class="num"><input class="cell-input num-input" type="number" step="0.25" min="0" bind:value={r.raeTest} onchange={() => save(r, 'raeTest', r.raeTest)} /></td>
						{/if}
						<td class="num tabnum consumed">{r.consumed || '—'}</td>
						<td class="num tabnum" class:gap-pos={ecart(r) > 0}>{ecart(r) > 0 ? '+' : ''}{ecart(r) || 0}</td>
						<td>
							<div class="prog">
								<div class="bar"><i style="width:{pct(avancement(r))}%"></i></div>
								<span class="pct tabnum">{pct(avancement(r))}%</span>
							</div>
						</td>
					</tr>
					{#if openId === r.id}
						<tr class="detail-row">
							<td colspan={data.testPhase ? 10 : 8}>
								<div class="detail-grid">
									<div class="dfield">
										<label for="d-proj-{r.id}">Projet</label>
										<select id="d-proj-{r.id}" class="cell-select" bind:value={r.projectId} onchange={() => save(r, 'projectId', r.projectId)}>
											<option value={null}>—</option>
											{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
										</select>
									</div>
									<div class="dfield">
										<label for="d-sprint-{r.id}">Sprint</label>
										<select id="d-sprint-{r.id}" class="cell-select" bind:value={r.sprintId} onchange={() => save(r, 'sprintId', r.sprintId)}>
											<option value={null}>—</option>
											{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
										</select>
									</div>
									<div class="dfield">
										<label for="d-version-{r.id}">Version</label>
										<select id="d-version-{r.id}" class="cell-select" bind:value={r.versionId} onchange={() => save(r, 'versionId', r.versionId)}>
											<option value={null}>—</option>
											{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
										</select>
									</div>
									{#if data.testPhase}
										<div class="dfield">
											<label for="d-prepa-{r.id}">Prépa</label>
											<input id="d-prepa-{r.id}" class="cell-input" type="number" step="0.25" min="0" bind:value={r.prepa} onchange={() => save(r, 'prepa', r.prepa)} />
										</div>
										{#each FLAG_FIELDS as fl (fl.key)}
											<div class="dfield">
												<label for="d-{fl.key}-{r.id}">{fl.label}</label>
												<select id="d-{fl.key}-{r.id}" class="cell-select" bind:value={r.flags[fl.key]} onchange={() => saveFlag(r, fl.key, r.flags[fl.key])}>
													<option value="">—</option>
													{#each FLAG_VALUES as v (v)}<option value={v}>{v}</option>{/each}
												</select>
											</div>
										{/each}
									{/if}
									<div class="dfield wide">
										<label for="d-comment-{r.id}">Commentaire</label>
										<input id="d-comment-{r.id}" class="cell-input" placeholder="Note libre…" bind:value={r.comment} onchange={() => save(r, 'comment', r.comment)} />
									</div>
								</div>
							</td>
						</tr>
					{/if}
				{/each}
				{#if filtered.length === 0}
					<tr><td colspan={data.testPhase ? 10 : 8} class="empty-row">Aucun ticket. Créez-en un pour démarrer.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
	{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="kanban" bind:this={kanbanEl} ondragover={onKanbanDragOver}>
		{#each kanbanCols as col (col.id ?? 'none')}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="kcol" ondragover={(e) => e.preventDefault()} ondrop={() => onColumnDrop(col.id)}>
				<div class="kcol-head">
					<span class="kdot" style={col.color ? `background:${col.color}` : 'background:var(--text-mute)'}></span>
					<span class="klabel">{col.emoji ?? ''} {col.label}</span>
					<span class="kcount">{colTickets(col.id).length}</span>
				</div>
				<div class="kcards">
					{#each colTickets(col.id) as t (t.id)}
						<div
							class="kcard"
							class:dragging={dragId === t.id}
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={() => (dragId = t.id)}
							ondragend={() => {
								dragId = null;
								stopAutoScroll();
							}}
							onclick={() => (editId = t.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									editId = t.id;
								}
							}}
						>
							<div class="kkey tabnum">{t.key}</div>
							<div class="ktitle">{t.title}</div>
							<div class="kmeta">
								{#if t.assigneeId}<span class="kassignee">{assigneeName(t.assigneeId)}</span>{:else}<span class="kassignee none">Non assigné</span>{/if}
								<span class="kbar"><i style="width:{pct(avancement(t))}%"></i></span>
								<span class="kpct tabnum">{pct(avancement(t))}%</span>
							</div>
						</div>
					{/each}
					{#if colTickets(col.id).length === 0}<div class="kempty">Aucun ticket</div>{/if}
				</div>
			</div>
		{/each}
	</div>
	{/if}
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (editId = null)} />

{#if editRow}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="tk-backdrop" onclick={(e) => { if (e.target === e.currentTarget) editId = null; }}>
		<div class="tk-modal">
			<div class="tk-modal-head">
				<span class="tk-key tabnum">{editRow.key}</span>
				<button class="tk-x" onclick={() => (editId = null)} aria-label="Fermer">✕</button>
			</div>
			<input class="tk-title" bind:value={editRow.title} onchange={() => save(editRow!, 'title', editRow!.title)} aria-label="Titre" />
			<div class="tk-grid">
				<label class="dfield"><span>État</span>
					<select class="cell-select" bind:value={editRow.stateId} onchange={() => save(editRow!, 'stateId', editRow!.stateId)}>
						<option value={null}>—</option>{#each data.ref.states as s (s.id)}<option value={s.id}>{s.emoji} {s.label}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Dev</span>
					<select class="cell-select" bind:value={editRow.assigneeId} onchange={() => save(editRow!, 'assigneeId', editRow!.assigneeId)}>
						<option value={null}>—</option>{#each data.ref.members as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Projet</span>
					<select class="cell-select" bind:value={editRow.projectId} onchange={() => save(editRow!, 'projectId', editRow!.projectId)}>
						<option value={null}>—</option>{#each data.ref.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Sprint</span>
					<select class="cell-select" bind:value={editRow.sprintId} onchange={() => save(editRow!, 'sprintId', editRow!.sprintId)}>
						<option value={null}>—</option>{#each data.ref.sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Version</span>
					<select class="cell-select" bind:value={editRow.versionId} onchange={() => save(editRow!, 'versionId', editRow!.versionId)}>
						<option value={null}>—</option>{#each data.ref.versions as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
					</select>
				</label>
				<label class="dfield"><span>Est. Réal</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.estimationReal} onchange={() => saveEst(editRow!, 'real')} /></label>
				<label class="dfield"><span>RAE Réal</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.raeReal} onchange={() => save(editRow!, 'raeReal', editRow!.raeReal)} /></label>
				{#if data.testPhase}
					<label class="dfield"><span>Est. Test</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.estimationTest} onchange={() => saveEst(editRow!, 'test')} /></label>
					<label class="dfield"><span>Prépa</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.prepa} onchange={() => save(editRow!, 'prepa', editRow!.prepa)} /></label>
					<label class="dfield"><span>RAE Test</span><input class="cell-input" type="number" step="0.25" min="0" bind:value={editRow.raeTest} onchange={() => save(editRow!, 'raeTest', editRow!.raeTest)} /></label>
					{#each FLAG_FIELDS as fl (fl.key)}
						<label class="dfield"><span>{fl.label}</span>
							<select class="cell-select" bind:value={editRow.flags[fl.key]} onchange={() => saveFlag(editRow!, fl.key, editRow!.flags[fl.key])}>
								<option value="">—</option>{#each FLAG_VALUES as v (v)}<option value={v}>{v}</option>{/each}
							</select>
						</label>
					{/each}
				{/if}
				<label class="dfield wide"><span>Commentaire</span><input class="cell-input" placeholder="Note libre…" bind:value={editRow.comment} onchange={() => save(editRow!, 'comment', editRow!.comment)} /></label>
			</div>
			<div class="tk-foot">
				<span>Consommé <b class="tabnum">{editRow.consumed || '—'}</b></span>
				<span>Écart <b class="tabnum" class:gap-pos={ecart(editRow) > 0}>{ecart(editRow) > 0 ? '+' : ''}{ecart(editRow) || 0}</b></span>
				<span>Avancement <b class="tabnum">{pct(avancement(editRow))}%</b></span>
			</div>
		</div>
	</div>
{/if}

<style>
	.saved {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-tint-2);
		padding: 6px 12px;
		border-radius: 30px;
	}
	.create {
		padding: 18px;
		margin-bottom: 18px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 180px 1fr;
		gap: 14px;
	}
	.grid4 {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
	}
	.actions-row {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 4px;
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}
	.filter-sel {
		padding: 7px 11px;
		border-radius: 30px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 12.5px;
		box-shadow: var(--shadow-sm);
		max-width: 170px;
	}
	.filter-sel:focus {
		outline: none;
		border-color: var(--accent);
	}
	.reset-btn {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		padding: 7px 12px;
		border-radius: 30px;
		border: 1px solid var(--border);
		transition: border-color 0.15s, color 0.15s;
	}
	.reset-btn:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.count {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		font-variant-numeric: tabular-nums;
	}
	.search {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 13px;
		border-radius: 30px;
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-sm);
		color: var(--text-mute);
		min-width: 240px;
	}
	.search input {
		border: none;
		background: none;
		outline: none;
		color: var(--text);
		font-size: 13px;
		width: 100%;
	}
	table.tk {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
	}
	.tk thead th {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-mute);
		padding: 14px 10px 12px;
		text-align: left;
		white-space: nowrap;
	}
	.tk thead th.num {
		text-align: right;
	}
	.tk tbody td {
		padding: 6px 8px;
		border-top: 1px solid var(--border);
		font-size: 13.5px;
		vertical-align: middle;
	}
	.tk tbody td.num {
		text-align: right;
	}
	.tk tbody tr:hover {
		background: var(--surface-2);
	}
	.tk tr.parent td {
		background: var(--surface-2);
	}
	.tk .key {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
		padding-left: 7px;
	}
	.ttl-wrap {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.ttl-main {
		flex: 1;
		min-width: 0;
	}
	.tk .ttl.sub .key,
	.tk .ttl.sub .title-input {
		margin-left: 20px;
	}
	.expand-btn {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-mute);
		font-size: 16px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s, color 0.15s, background 0.15s;
	}
	.expand-btn:hover {
		background: var(--surface);
		border-color: var(--border-strong);
		color: var(--text);
	}
	.expand-btn.open {
		transform: rotate(90deg);
		color: var(--accent);
	}
	.detail-row td {
		background: var(--surface-2);
		padding: 4px 14px 16px 36px !important;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
	}
	.detail-grid .dfield.wide {
		grid-column: 1 / -1;
	}
	.dfield {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.dfield label,
	.dfield > span {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
	}
	.dfield .cell-input,
	.dfield .cell-select {
		border-color: var(--border);
		background: var(--surface);
	}
	.consumed {
		font-weight: 700;
		color: var(--text-soft);
		padding-right: 14px !important;
	}

	/* contrôles inline */
	.cell-input,
	.cell-select {
		width: 100%;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 6px 7px;
		font: inherit;
		font-size: 13.5px;
		color: var(--text);
		transition: border-color 0.15s, background 0.15s;
	}
	.cell-input:hover,
	.cell-select:hover {
		border-color: var(--border-strong);
		background: var(--surface);
	}
	.cell-input:focus,
	.cell-select:focus {
		border-color: var(--accent);
		background: var(--surface);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
		outline: none;
	}
	.title-input {
		font-weight: 500;
	}
	.num-input {
		width: 68px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}
	.state-select {
		font-size: 12.5px;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 9px;
		justify-content: flex-end;
		padding-right: 6px;
	}
	.prog .bar {
		width: 60px;
		height: 7px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.prog .bar i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, #000), var(--accent));
	}
	.prog .pct {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 34px;
		text-align: right;
	}
	.gap-pos {
		color: var(--warn) !important;
		font-weight: 700;
	}
	.empty-row {
		text-align: center;
		color: var(--text-mute);
		padding: 30px;
	}
	.seg2 {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
	}
	.seg2 button {
		padding: 6px 14px;
		border-radius: 30px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-mute);
		transition: background 0.15s, color 0.15s;
	}
	.seg2 button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}

	/* Kanban */
	.kanban {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding-bottom: 8px;
		align-items: stretch;
		/* Occupe au moins la hauteur visible restante (sous topbar + filtres). */
		min-height: calc(100dvh - 13rem);
	}
	.kcol {
		flex: 0 0 280px;
		display: flex;
		flex-direction: column;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		padding: 12px;
	}
	.kcol-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 4px 12px;
	}
	.kdot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.klabel {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}
	.kcount {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-mute);
		background: var(--surface-sunk);
		padding: 1px 8px;
		border-radius: 20px;
	}
	.kcards {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.kcard {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: 11px 12px;
		cursor: grab;
		box-shadow: var(--shadow-sm);
		transition: border-color 0.15s, transform 0.1s, opacity 0.15s;
	}
	.kcard:hover {
		border-color: var(--border-strong);
	}
	.kcard:active {
		cursor: grabbing;
	}
	.kcard.dragging {
		opacity: 0.45;
		border-color: var(--accent);
	}
	.kkey {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.ktitle {
		font-size: 13.5px;
		font-weight: 500;
		margin: 3px 0 9px;
		line-height: 1.35;
	}
	.kmeta {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.kassignee {
		font-size: 11.5px;
		color: var(--text-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}
	.kassignee.none {
		color: var(--text-mute);
		font-style: italic;
	}
	.kbar {
		flex: 1;
		height: 6px;
		border-radius: 20px;
		background: var(--surface-sunk);
		overflow: hidden;
	}
	.kbar i {
		display: block;
		height: 100%;
		border-radius: 20px;
		background: var(--accent);
	}
	.kpct {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-soft);
		min-width: 30px;
		text-align: right;
	}
	.kempty {
		font-size: 12px;
		color: var(--text-mute);
		text-align: center;
		padding: 14px 0;
	}
	/* Modal d'édition de ticket */
	.tk-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 50;
	}
	.tk-modal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--r-lg, 16px);
		box-shadow: var(--shadow-lg, 0 20px 50px rgba(0, 0, 0, 0.3));
		padding: 22px 24px;
		width: 100%;
		max-width: 600px;
		max-height: 86vh;
		overflow-y: auto;
	}
	.tk-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.tk-key {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.tk-x {
		font-size: 15px;
		color: var(--text-mute);
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.tk-x:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.tk-title {
		width: 100%;
		font-family: var(--font-display);
		font-size: 19px;
		font-weight: 600;
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 6px 8px;
		margin: 2px 0 16px;
	}
	.tk-title:hover,
	.tk-title:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
		outline: none;
	}
	.tk-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.tk-grid .dfield.wide {
		grid-column: 1 / -1;
	}
	.tk-foot {
		display: flex;
		gap: 22px;
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 13px;
		color: var(--text-mute);
	}
	.tk-foot b {
		color: var(--text-soft);
		margin-left: 4px;
	}
	@media (max-width: 560px) {
		.tk-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	.hint-edit {
		font-size: 12.5px;
		color: var(--text-mute);
		margin: 14px 4px 0;
	}
</style>
