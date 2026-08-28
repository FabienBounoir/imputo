<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatDateTime, formatDayList } from '$lib/utils/date';

	let { data, form } = $props();
	$effect(() => {
		if (form?.error) toast.error(form.error);
	});

	const view = $derived(data.view);
	const closing = $derived(view.closing);
	const integrated = $derived(closing?.status === 'INTEGRATED');
	const editable = $derived(closing !== null && !integrated);

	// Clé de la colonne « sans code SSP » — doit rester alignée sur UNASSIGNED_SSP côté serveur
	// (monthlyClosing.ts) ; on ne peut pas importer $lib/server depuis un composant.
	const UNASSIGNED_SSP = '';

	// En-têtes : le CODE par défaut, c'est lui qu'on recopie dans GPS et qui sert de référence
	// commune avec la compta. Le libellé est là pour se relire, derrière un interrupteur. Mémorisé
	// en localStorage (même motif que le dashboard) : départ sur le code pour un rendu serveur
	// cohérent, hydraté juste après le montage — le flash est sans conséquence, ça ne change qu'un
	// en-tête sur des données déjà chargées.
	const HEADER_STORAGE_KEY = 'imputo-cloture-header-mode';
	let showLabels = $state(false);
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		showLabels = localStorage.getItem(HEADER_STORAGE_KEY) === 'label';
	});
	function setShowLabels(v: boolean) {
		showLabels = v;
		if (typeof localStorage !== 'undefined')
			localStorage.setItem(HEADER_STORAGE_KEY, v ? 'label' : 'code');
	}

	// Colonnes : les SSP actifs, plus une colonne « Sans code SSP » en lecture seule quand des
	// imputations du mois portent sur des tickets non rattachés — sinon ce temps disparaîtrait
	// silencieusement du total et le « à ventiler » deviendrait faux.
	// Repli des cartes. Mémorisé en localStorage : ouvrir une passe ou intégrer passe par une
	// redirection, donc sans persistance tout se rouvrirait à chaque action.
	const COLLAPSE_STORAGE_KEY = 'imputo-cloture-collapsed';
	let collapsed = $state<Record<string, boolean>>({});
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			collapsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? '{}');
		} catch {
			/* entrée corrompue : on repart tout déplié */
		}
	});
	function toggleCard(key: string) {
		collapsed = { ...collapsed, [key]: !collapsed[key] };
		if (typeof localStorage !== 'undefined')
			localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
	}

	const cols = $derived([
		...view.ssps.map((s) => ({
			id: s.id,
			label: s.label,
			code: s.code,
			archived: s.archived,
			editable: true
		})),
		...(view.hasUnassigned
			? [
					{
						id: UNASSIGNED_SSP,
						label: 'Sans code SSP',
						code: 'Sans code SSP',
						archived: false,
						editable: false
					}
				]
			: [])
	]);
	/** L'en-tête montre un des deux, l'autre passe en title — jamais les deux, la colonne est étroite. */
	const head = (c: { code: string; label: string }) => (showLabels ? c.label : c.code);
	const headAlt = (c: { code: string; label: string }) => (showLabels ? c.code : c.label);

	/** Copie locale des saisies : l'affichage est optimiste, le serveur n'est pas rechargé à chaque case. */
	let complements = $state<Record<string, number>>({});
	let plannedEdits = $state<Record<string, number | null>>({});

	// Repart de la donnée serveur à chaque changement de mois / de passe.
	$effect(() => {
		const next: Record<string, number> = {};
		const nextPlanned: Record<string, number | null> = {};
		for (const m of view.members) {
			nextPlanned[m.userId] = m.plannedOverride;
			for (const [sspId, v] of Object.entries(m.complement)) next[`${m.userId}:${sspId}`] = v;
		}
		complements = next;
		plannedEdits = nextPlanned;
	});

	// Prévu / à ventiler / arrondi sont recalculés ici alors que le serveur les calcule déjà
	// (calc.ts plannedDays/toAllocate/round) : la grille doit réagir à la frappe sans aller-retour,
	// et $lib/server n'est pas importable côté client. Même duplication assumée que le % de
	// capacité dans imputation/+page.svelte — si l'une des deux formules bouge, bouger l'autre.
	const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
	const cell = (userId: string, sspId: string) => complements[`${userId}:${sspId}`] ?? 0;

	function complementTotal(userId: string) {
		let t = 0;
		for (const c of cols) if (c.editable) t += cell(userId, c.id);
		return round2(t);
	}
	function plannedOf(m: (typeof view.members)[number]) {
		if (integrated) return m.planned;
		const o = plannedEdits[m.userId];
		return o ?? round2(Math.max(0, effectiveWorkdays - m.absenceDays));
	}
	const toAllocate = (m: (typeof view.members)[number]) =>
		round2(plannedOf(m) - m.consoTotal - complementTotal(m.userId));

	/** Conso + complément — c'est la ligne qu'on reporte dans GPS. */
	const integrationCell = (userId: string, sspId: string) =>
		round2((view.members.find((m) => m.userId === userId)?.conso[sspId] ?? 0) + cell(userId, sspId));

	function colTotal(sspId: string, fn: (userId: string, sspId: string) => number) {
		return round2(view.members.reduce((a, m) => a + fn(m.userId, sspId), 0));
	}
	/** Somme d'une colonne calculée par personne (Total, Prévu, À ventiler…). */
	function rowsTotal(fn: (m: (typeof view.members)[number]) => number) {
		return round2(view.members.reduce((a, m) => a + fn(m), 0));
	}
	// Dérivés plutôt que {@const} : ce dernier n'est pas autorisé en enfant direct d'un <tfoot>.
	const restantTotal = $derived(rowsTotal(toAllocate));
	const ecartTotal = $derived(
		rowsTotal((m) => cols.reduce((a, c) => a + gapCell(m.userId, c.id), 0))
	);
	const consoCell = (userId: string, sspId: string) =>
		view.members.find((m) => m.userId === userId)?.conso[sspId] ?? 0;
	// Conso réelle à date, distincte de `conso` (figée) une fois la passe intégrée — sert à afficher
	// le réel entre parenthèses dans le tableau 1 sans devoir aller chercher l'écart du tableau 4.
	const consoLiveCell = (userId: string, sspId: string) =>
		view.members.find((m) => m.userId === userId)?.consoLive?.[sspId] ?? 0;
	const consoLiveTotal = (userId: string) =>
		round2(cols.reduce((a, c) => a + consoLiveCell(userId, c.id), 0));
	// Dérivés plutôt que {@const} : ce dernier n'est pas autorisé en enfant direct d'un <tfoot>.
	const consoGrandTotal = $derived(round2(view.members.reduce((a, m) => a + m.consoTotal, 0)));
	const consoGrandLive = $derived(
		integrated ? round2(view.members.reduce((a, m) => a + consoLiveTotal(m.userId), 0)) : consoGrandTotal
	);
	/** Colonne vide : ni conso ni complément. Le serveur revérifie, ceci ne fait que cacher le ✕. */
	const isEmptyCol = (sspId: string) =>
		colTotal(sspId, consoCell) === 0 && colTotal(sspId, cell) === 0;
	const gapCell = (userId: string, sspId: string) => {
		const m = view.members.find((x) => x.userId === userId);
		if (!m?.consoLive) return 0;
		return round2((m.consoLive[sspId] ?? 0) - integrationCell(userId, sspId));
	};

	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body });
		// L'affichage est optimiste : sans remonter l'échec, la case resterait à sa nouvelle valeur
		// alors que rien n'a été enregistré (cf. le même pattern dans tickets/+page.svelte).
		const result = deserialize(await res.text());
		if (result.type === 'failure') toast.error((result.data?.error as string) ?? "Erreur lors de l'enregistrement.");
	}

	function onComplement(userId: string, sspId: string, raw: string) {
		const v = raw.trim() === '' ? 0 : Number(raw.replace(',', '.'));
		if (!Number.isFinite(v)) return;
		complements[`${userId}:${sspId}`] = v;
		post('setComplement', { closingId: closing!.id, userId, sspId, amount: String(v) });
	}
	// Base commune à tout le monde. Optimiste comme les autres saisies : sans état local, la valeur
	// reviendrait à l'ancienne tant que le serveur n'a pas répondu.
	let workdaysEdit = $state<number | null>(null);
	$effect(() => {
		workdaysEdit = view.workdays.override;
	});
	const effectiveWorkdays = $derived(workdaysEdit ?? view.workdays.computed);

	function onWorkdays(raw: string) {
		const t = raw.trim();
		const v = t === '' ? null : Number(t.replace(',', '.'));
		if (v !== null && !Number.isFinite(v)) return;
		workdaysEdit = v;
		post('setWorkdays', { closingId: closing!.id, value: t });
	}

	function onPlanned(userId: string, raw: string) {
		const t = raw.trim();
		const v = t === '' ? null : Number(t.replace(',', '.'));
		if (v !== null && !Number.isFinite(v)) return;
		plannedEdits[userId] = v;
		post('setPlanned', { closingId: closing!.id, userId, value: t });
	}

	const fmt = (n: number) => (n === 0 ? '·' : String(round2(n)));
	// `fmt` mappuie sur "·" pour un zéro isolé — mais associé au réel ("· X" juste après), ce même
	// point devient illisible (deux points collés). Le figé garde alors son 0 explicite.
	const fmtBase = (n: number, paired: boolean) => (paired ? String(round2(n)) : fmt(n));
</script>

<svelte:head><title>Clôture mensuelle — Imputo</title></svelte:head>

<!-- En-tête de carte : bouton de repli (motif disclosure standard — aria-expanded + le titre
     dans le bouton), plutôt que <details>/<summary> qui rendrait le placement du bouton
     « Intégrer GPS » de la carte 3 bancal. -->
{#snippet cardHead(key: string, title: string)}
	<button
		type="button"
		class="card-head"
		aria-expanded={!collapsed[key]}
		onclick={() => toggleCard(key)}
	>
		<svg
			class="chev"
			class:closed={collapsed[key]}
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"><path d="m6 9 6 6 6-6" /></svg
		>
		<h3>{title}</h3>
	</button>
{/snippet}

<div class="topbar">
	<h1>
		Clôture mensuelle<small>
			Report des jours dans GPS — la clôture tombant avant la fin du mois, on complète le
			manquant à la main, puis on rejoue une passe plus tard si besoin.
		</small>
	</h1>
	<div class="spacer"></div>
	<div class="head-actions">
		<select
			class="cell-select"
			value={view.month}
			onchange={(e) => goto(`?month=${e.currentTarget.value}`, { keepFocus: true })}
			aria-label="Mois"
		>
			{#each data.months as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
		</select>
		{#if view.passes.length > 0}
			<select
				class="cell-select"
				value={String(closing?.seq ?? '')}
				onchange={(e) => goto(`?month=${view.month}&seq=${e.currentTarget.value}`, { keepFocus: true })}
				aria-label="Passe"
			>
				{#each view.passes as p (p.id)}
					<option value={String(p.seq)}>
						Passe {p.seq}{p.status === 'INTEGRATED'
							? ` — intégrée le ${formatDateTime(p.integratedAt!)}${p.integratedByName ? ` par ${p.integratedByName}` : ''}`
							: ' — en cours'}
					</option>
				{/each}
			</select>
		{/if}
		<div class="seg" role="group" aria-label="En-têtes de colonnes">
			<button type="button" class:on={!showLabels} onclick={() => setShowLabels(false)}>Codes</button>
			<button type="button" class:on={showLabels} onclick={() => setShowLabels(true)}>Libellés</button>
		</div>
	</div>
</div>

<div class="content">
	{#if !closing}
		<section class="card block empty">
			<p>Aucune passe de clôture ouverte sur ce mois.</p>
			<form method="POST" action="?/open" use:enhance>
				<input type="hidden" name="month" value={view.month} />
				<button class="btn btn-primary" type="submit">Ouvrir la clôture</button>
			</form>
		</section>
	{:else}
		{#if integrated}
			<section class="card block banner">
				<div>
					<b>🔒 Passe {closing.seq} intégrée</b> le {formatDateTime(closing.integratedAt!)}{closing.integratedByName
						? ` par ${closing.integratedByName}`
						: ''}
				</div>
				<form
					method="POST"
					action="?/open"
					use:enhance={async ({ cancel }) => {
						const ok = await confirmDialog(
							`Ouvrir la passe ${closing!.seq + 1} ? Les compléments sont recopiés, les consommations repartent des imputations à jour. La passe ${closing!.seq} reste consultable.`
						);
						if (!ok) cancel();
					}}
				>
					<input type="hidden" name="month" value={view.month} />
					<button class="btn btn-primary" type="submit">Nouvelle passe</button>
				</form>
			</section>
		{/if}

		{#if cols.length === 0}
			<section class="card block empty">
				{#if view.availableSsps.length === 0}
					<p>Aucun code SSP dans cet espace — créez-les dans <a href="/admin?tab=referentiels">Référentiels</a>.</p>
				{:else}
					<p>
						Aucune imputation sur un code SSP ce mois-ci. Ajoutez la colonne du code sur lequel
						vous voulez rattraper des jours, plus bas dans « Complément pour fin de mois ».
					</p>
				{/if}
			</section>
		{/if}

		<section class="card block table-conso">
			{@render cardHead('conso', `1 · Consommation réelle${integrated ? ' (Figée)' : ''}`)}
			{#if !collapsed.conso}
			<p class="hint">
				Imputations du mois par code SSP. 
				{#if integrated}
					Les chiffres <span class="conso-live">en rouge</span> = le réel à date, si différent.
				{:else}
					Suit les saisies en direct.
				{/if}
			</p>
			<div class="scroll">
				<table class="weekly-table">
					<thead>
						<tr>
							<th>Personne</th>
							{#each cols as c (c.id)}<th class="num" title={headAlt(c)}>
								{#if c.id === UNASSIGNED_SSP}
									<!-- Ces imputations ne remontent dans aucun code budgétaire : le lien mène droit
									     aux tickets fautifs, filtrés, pour leur affecter un code. -->
									<a href="/tickets?ssp=none" title="Voir les tickets sans code SSP pour les corriger">
										{head(c)} ↗
									</a>
								{:else}
									{head(c)}{#if c.archived}<span class="tag-arch" title="Code archivé — colonne conservée car elle porte encore des jours">⌫</span>{/if}
								{/if}
							</th>{/each}
							<th class="num">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each view.members as m (m.userId)}
							{@const liveTotal = integrated ? consoLiveTotal(m.userId) : m.consoTotal}
							{@const totalDiff = liveTotal !== m.consoTotal}
							<tr>
								<td>{m.displayName}{#if m.inactive}<span class="tag-arch" title="N'est plus membre actif de l'espace, mais garde des jours sur ce mois">inactif</span>{/if}</td>
								{#each cols as c (c.id)}
									{@const figé = consoCell(m.userId, c.id)}
									{@const réel = integrated ? consoLiveCell(m.userId, c.id) : figé}
									{@const diff = réel !== figé}
									<td class="num tabnum"
										>{fmtBase(figé, diff)}{#if diff}
											<span class="conso-live" title="Réel à date">· {fmt(réel)}</span>
										{/if}</td
									>
								{/each}
								<td class="num tabnum">
									<b>{fmtBase(m.consoTotal, totalDiff)}</b>{#if totalDiff}
										<span class="conso-live" title="Réel à date">· {fmt(liveTotal)}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td>Total</td>
							{#each cols as c (c.id)}
								{@const t = colTotal(c.id, consoCell)}
								{@const tLive = integrated ? colTotal(c.id, consoLiveCell) : t}
								{@const tDiff = tLive !== t}
								<td class="num tabnum"
									><b>{fmtBase(t, tDiff)}</b>{#if tDiff}
										<span class="conso-live" title="Réel à date">· {fmt(tLive)}</span>
									{/if}</td
								>
							{/each}
							<td class="num tabnum">
								<b>{fmtBase(consoGrandTotal, consoGrandLive !== consoGrandTotal)}</b>{#if consoGrandLive !== consoGrandTotal}
									<span class="conso-live" title="Réel à date">· {fmt(consoGrandLive)}</span>
								{/if}
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
			{/if}
		</section>

		<section class="card block table-complement">
			{@render cardHead('complement', '2 · Complément pour fin de mois')}
			{#if !collapsed.complement}
			<p class="hint">Jours à répartir d'ici la fin du mois. « À ventiler » doit tomber à 0.</p>
			<div class="toolbar">
				<label class="tool">
					Jours ouvrés
					{#if editable}
						<input
							class="grid-input workdays-input tabnum"
							type="number"
							step="0.5"
							min="0"
							max="31"
							placeholder={String(view.workdays.computed)}
							value={workdaysEdit ?? ''}
							title="{view.workdays.weekdays} jours de semaine{view.workdays.holidays.length
								? ` − ${view.workdays.holidays.length} férié(s)`
								: ''}. Modifiable si un férié a été travaillé ou s'il manque un jour chômé."
							onchange={(e) => onWorkdays(e.currentTarget.value)}
						/>
					{:else}
						<b class="tabnum">{effectiveWorkdays}</b>
					{/if}
				</label>
				{#if view.workdays.holidays.length > 0}
					<span class="wd-calc">
						{view.workdays.weekdays} − {view.workdays.holidays.length} férié{view.workdays.holidays
							.length > 1
							? 's'
							: ''} ({formatDayList(view.workdays.holidays)})
					</span>
				{/if}
				<!-- Rien à ajouter = pas de contrôle : un select vide et un bouton grisé n'apprennent rien. -->
				{#if editable && view.availableSsps.length > 0}
					<form method="POST" action="?/addSsp" use:enhance class="tool add-ssp">
						<input type="hidden" name="closingId" value={closing?.id} />
						<select name="sspId" class="cell-select">
							{#each view.availableSsps as s (s.id)}
								<option value={s.id}>{s.code} — {s.label}</option>
							{/each}
						</select>
						<button class="btn btn-ghost" type="submit">+ Colonne</button>
					</form>
				{/if}
			</div>
			<div class="scroll">
				<table class="weekly-table">
					<thead>
						<tr>
							<th>Personne</th>
							{#each cols as c (c.id)}<th class="num" title={headAlt(c)}>
								{#if c.id === UNASSIGNED_SSP}
									<!-- Ces imputations ne remontent dans aucun code budgétaire : le lien mène droit
									     aux tickets fautifs, filtrés, pour leur affecter un code. -->
									<a href="/tickets?ssp=none" title="Voir les tickets sans code SSP pour les corriger">
										{head(c)} ↗
									</a>
								{:else}
									{head(c)}{#if c.archived}<span class="tag-arch" title="Code archivé — colonne conservée car elle porte encore des jours">⌫</span>{/if}
									{#if editable && isEmptyCol(c.id)}
										<form method="POST" action="?/removeSsp" use:enhance class="col-rm">
											<input type="hidden" name="closingId" value={closing?.id} />
											<input type="hidden" name="sspId" value={c.id} />
											<button type="submit" title="Retirer cette colonne (vide)">✕</button>
										</form>
									{/if}
								{/if}
							</th>{/each}
							<th class="num">Total</th>
							<th class="num">Prévu</th>
							<th class="num">À ventiler</th>
						</tr>
					</thead>
					<tbody>
						{#each view.members as m (m.userId)}
							<tr class:ok={toAllocate(m) === 0}>
								<td>{m.displayName}{#if m.inactive}<span class="tag-arch" title="N'est plus membre actif de l'espace, mais garde des jours sur ce mois">inactif</span>{/if}</td>
								{#each cols as c (c.id)}
									<td class="num">
										{#if c.editable && editable}
											<input
												class="grid-input complement-input tabnum"
												type="number"
												step="0.25"
												value={cell(m.userId, c.id) || ''}
												onchange={(e) => onComplement(m.userId, c.id, e.currentTarget.value)}
											/>
										{:else}
											<span class="tabnum">{c.editable ? fmt(cell(m.userId, c.id)) : '—'}</span>
										{/if}
									</td>
								{/each}
								<td class="num tabnum"><b>{fmt(complementTotal(m.userId))}</b></td>
								<td class="num">
									{#if editable}
										<input
											class="grid-input planned-input tabnum"
											type="number"
											step="0.25"
											min="0"
											placeholder={String(round2(Math.max(0, effectiveWorkdays - m.absenceDays)))}
											value={plannedEdits[m.userId] ?? ''}
											title="{effectiveWorkdays} j ouvrés − {m.absenceDays} j d'absence"
											onchange={(e) => onPlanned(m.userId, e.currentTarget.value)}
										/>
									{:else}
										<span class="tabnum">{fmt(plannedOf(m))}</span>
									{/if}
								</td>
								<td class="num tabnum" class:warn={toAllocate(m) !== 0}>{round2(toAllocate(m))}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td>Total</td>
							{#each cols as c (c.id)}
								<td class="num tabnum"><b>{c.editable ? fmt(colTotal(c.id, cell)) : '—'}</b></td>
							{/each}
							<td class="num tabnum"><b>{fmt(rowsTotal((m) => complementTotal(m.userId)))}</b></td>
							<td class="num tabnum"><b>{fmt(rowsTotal(plannedOf))}</b></td>
							<td class="num tabnum" class:warn={restantTotal !== 0}><b>{round2(restantTotal)}</b></td>
						</tr>
					</tfoot>
				</table>
			</div>
			{/if}
		</section>

		<section class="card block table-integration">
			<div class="row-head">
				{@render cardHead('integration', '3 · Détail intégration')}
				{#if editable}
					<form
						method="POST"
						action="?/integrate"
						use:enhance={async ({ cancel }) => {
							const rest = view.members.filter((m) => toAllocate(m) !== 0).length;
							const ok = await confirmDialog(
								`Intégrer la passe ${closing!.seq} ? Les consommations et le prévu sont figés définitivement.${rest > 0 ? ` ${rest} personne${rest > 1 ? 's ont' : ' a'} encore du reste à ventiler.` : ''}`
							);
							if (!ok) cancel();
						}}
					>
						<input type="hidden" name="closingId" value={closing.id} />
						<input type="hidden" name="month" value={view.month} />
						<button class="btn btn-primary" type="submit">Intégrer GPS</button>
					</form>
				{/if}
			</div>
			{#if !collapsed.integration}
			<p class="hint">Consommation réelle + complément.</p>
			<div class="scroll">
				<table class="weekly-table">
					<thead>
						<tr>
							<th>Personne</th>
							{#each cols as c (c.id)}<th class="num" title={headAlt(c)}>
								{#if c.id === UNASSIGNED_SSP}
									<!-- Ces imputations ne remontent dans aucun code budgétaire : le lien mène droit
									     aux tickets fautifs, filtrés, pour leur affecter un code. -->
									<a href="/tickets?ssp=none" title="Voir les tickets sans code SSP pour les corriger">
										{head(c)} ↗
									</a>
								{:else}
									{head(c)}{#if c.archived}<span class="tag-arch" title="Code archivé — colonne conservée car elle porte encore des jours">⌫</span>{/if}
								{/if}
							</th>{/each}
							<th class="num">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each view.members as m (m.userId)}
							<tr>
								<td>{m.displayName}{#if m.inactive}<span class="tag-arch" title="N'est plus membre actif de l'espace, mais garde des jours sur ce mois">inactif</span>{/if}</td>
								{#each cols as c (c.id)}<td class="num tabnum">{fmt(integrationCell(m.userId, c.id))}</td>{/each}
								<td class="num tabnum"><b>{fmt(round2(m.consoTotal + complementTotal(m.userId)))}</b></td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td>Total</td>
							{#each cols as c (c.id)}<td class="num tabnum"><b>{fmt(colTotal(c.id, integrationCell))}</b></td>{/each}
							<td class="num tabnum">
								<b>{fmt(round2(view.members.reduce((a, m) => a + m.consoTotal + complementTotal(m.userId), 0)))}</b>
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
			{/if}
		</section>

		{#if integrated}
			<section class="card block table-gap">
				{@render cardHead('gap', '4 · Écart vs prévisionnel')}
				{#if !collapsed.gap}
				<p class="hint">
					Conso réelle à aujourd'hui moins ce qui a été intégré. Chaque ligne devrait tendre vers 0
					à mesure que la fin du mois se saisit.
				</p>
				<div class="scroll">
					<table class="weekly-table">
						<thead>
							<tr>
								<th>Personne</th>
								{#each cols as c (c.id)}<th class="num" title={headAlt(c)}>
								{#if c.id === UNASSIGNED_SSP}
									<!-- Ces imputations ne remontent dans aucun code budgétaire : le lien mène droit
									     aux tickets fautifs, filtrés, pour leur affecter un code. -->
									<a href="/tickets?ssp=none" title="Voir les tickets sans code SSP pour les corriger">
										{head(c)} ↗
									</a>
								{:else}
									{head(c)}{#if c.archived}<span class="tag-arch" title="Code archivé — colonne conservée car elle porte encore des jours">⌫</span>{/if}
								{/if}
							</th>{/each}
								<th class="num">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each view.members as m (m.userId)}
								{@const line = round2(cols.reduce((a, c) => a + gapCell(m.userId, c.id), 0))}
								<tr>
									<td>{m.displayName}{#if m.inactive}<span class="tag-arch" title="N'est plus membre actif de l'espace, mais garde des jours sur ce mois">inactif</span>{/if}</td>
									{#each cols as c (c.id)}
										{@const g = gapCell(m.userId, c.id)}
										<td class="num tabnum" class:warn={g !== 0}>{fmt(g)}</td>
									{/each}
									<td class="num tabnum" class:warn={line !== 0}><b>{fmt(line)}</b></td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr>
								<td>Total</td>
								{#each cols as c (c.id)}
									{@const t = colTotal(c.id, gapCell)}
									<td class="num tabnum" class:warn={t !== 0}><b>{fmt(t)}</b></td>
								{/each}
								<td class="num tabnum" class:warn={ecartTotal !== 0}><b>{fmt(ecartTotal)}</b></td>
							</tr>
						</tfoot>
					</table>
				</div>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	/* .topbar est déjà en flex avec wrap (app.css) : le .spacer pousse ce bloc à droite, et il
	   passe à la ligne tout seul quand le titre prend toute la largeur. */
	.head-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
	.hint {
		margin: 0 0 14px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-mute);
		max-width: 78ch;
	}
	/* .card ne porte aucun padding dans app.css : chaque page pose le sien, 22px comme /admin. */
	.block {
		padding: 22px;
		margin-bottom: 18px;
	}
	.block h3 {
		margin: 0;
	}
	/* Le titre est le bouton de repli : pleine largeur pour que toute la ligne soit cliquable. */
	.card-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0;
		margin-bottom: 6px;
		color: var(--text);
		text-align: left;
	}
	.card-head .chev {
		flex-shrink: 0;
		color: var(--text-mute);
		transition: transform 0.15s ease;
	}
	.card-head .chev.closed {
		transform: rotate(-90deg);
	}
	.card-head:hover .chev {
		color: var(--accent);
	}
	/* Carte 3 : le bouton reste dans la barre, il ne doit pas s'étirer sur toute la largeur. */
	.row-head .card-head {
		width: auto;
		margin-bottom: 0;
	}
	.row-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.row-head h3 {
		margin: 0;
	}
	/* Interrupteur codes / libellés — deux boutons collés, pas un <select> : le choix est binaire
	   et se relit d'un coup d'œil à côté des en-têtes qu'il pilote. */
	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--r-sm, 8px);
		overflow: hidden;
	}
	.seg button {
		padding: 7px 12px;
		font-size: 12.5px;
		color: var(--text-mute);
		background: var(--surface-2, var(--surface));
	}
	.seg button + button {
		border-left: 1px solid var(--border);
	}
	.seg button.on {
		background: var(--accent-tint, var(--surface));
		color: var(--text);
		font-weight: 600;
	}
	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}
	.empty {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.empty p {
		margin: 0;
	}
	/* Le nombre de codes SSP n'est pas borné : le tableau scrolle dans sa carte plutôt que de
	   pousser la page en scroll horizontal. Le padding de .block fait la marge gauche/droite. */
	.scroll {
		overflow-x: auto;
	}
	/* table-layout fixed + largeurs explicites, et surtout PAS width:100% : les 4 tableaux n'ont
	   pas le même nombre de colonnes (le 2 ajoute Prévu et À ventiler), donc un étirement à 100 %
	   leur donnerait des largeurs de colonnes différentes et plus rien ne s'alignerait d'un
	   tableau à l'autre. À largeur fixe, les colonnes communes tombent au même endroit partout. */
	.weekly-table {
		table-layout: fixed;
		width: max-content;
		border-collapse: collapse;
		font-size: 13px;
	}
	.weekly-table th,
	.weekly-table td {
		width: 120px;
	}
	.weekly-table th:first-child,
	.weekly-table td:first-child {
		width: 200px;
	}
	.weekly-table th,
	.weekly-table td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
		text-align: left;
		white-space: nowrap;
	}
	.weekly-table th {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--text-mute);
	}
	.weekly-table th a {
		color: var(--warn);
		text-decoration: none;
	}
	.weekly-table th a:hover {
		text-decoration: underline;
	}
	/* Le nom reste lisible quand on scrolle vers les derniers codes SSP — le fond opaque est
	   obligatoire, une cellule sticky transparente laisse défiler les chiffres dessous. */
	.weekly-table th:first-child,
	.weekly-table td:first-child {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
	}
	.weekly-table .num {
		text-align: right;
	}
	.weekly-table tfoot td {
		border-bottom: none;
		border-top: 1px solid var(--border-strong, var(--border));
	}
	.warn {
		color: var(--warn);
		font-weight: 600;
	}
	/* Réel à date entre parenthèses à côté du figé — c'est lui qui bouge encore, donc lui qui porte
	   l'alerte (gras rouge) ; le figé reste en poids normal, il ne change plus. margin-left plutôt
	   qu'un espace texte en tête : Svelte rogne l'espace de tête du premier enfant d'un élément/bloc
	   à la compilation, un espace littéral avant "·" ne survit jamais au rendu. */
	.conso-live {
		margin-left: 0.3em;
		font-weight: 700;
		color: var(--warn);
	}
	/* Ligne soldée : plus rien à ventiler. Teinte très basse — c'est l'état normal qu'on doit
	   pouvoir balayer du regard, pas une alerte. Le vert porte sur les cellules et non sur le
	   <tr>, qui n'accepte pas de background sous border-collapse. */
	.weekly-table tbody tr.ok td {
		background: color-mix(in srgb, var(--success) 7%, transparent);
	}
	/* La première colonne est sticky : son fond doit rester opaque, sinon les chiffres défilent
	   dessous. On mélange donc la même teinte avec la surface plutôt qu'avec du transparent. */
	.weekly-table tbody tr.ok td:first-child {
		background: color-mix(in srgb, var(--success) 7%, var(--surface));
	}
	/* Les deux réglages du tableau tiennent sur une ligne, au-dessus de lui : le nombre de jours
	   ouvrés (ajustable si un férié a été travaillé) et l'ajout d'une colonne pour rattraper sur un
	   code non imputé. L'ajout pousse à droite, il agit sur les colonnes et non sur les lignes. */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
		font-size: 12.5px;
	}
	.tool {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.wd-calc {
		color: var(--text-mute);
	}
	/* Colonne ou ligne conservée alors qu'elle n'est plus « normale » : archivée, ou membre sorti. */
	.tag-arch {
		margin-left: 5px;
		font-size: 10px;
		font-weight: 500;
		color: var(--warn);
	}
	.add-ssp {
		margin-left: auto;
		font-weight: 400;
	}
	.workdays-input {
		flex: 0 0 68px;
	}
	/* ✕ de retrait : discret dans l'en-tête, et seulement quand la colonne est vide. */
	.col-rm {
		display: inline;
	}
	.col-rm button {
		padding: 0 2px;
		font-size: 11px;
		color: var(--text-mute);
	}
	.col-rm button:hover {
		color: var(--warn);
	}
	.grid-input {
		width: 100%;
		padding: 4px 6px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
		text-align: right;
	}
	.cell-select {
		padding: 7px 9px;
		border-radius: var(--r-sm, 8px);
		border: 1px solid var(--border);
		background: var(--surface-2, var(--surface));
		color: var(--text);
		font-size: 13px;
	}
</style>
