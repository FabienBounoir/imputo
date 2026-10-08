<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from 'svelte-sonner';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { formatDateTime } from '$lib/utils/date';
	import type { ImportLine } from '$lib/server/services/ticketImport';

	let { data, form } = $props();

	const plan = $derived(form?.plan ?? null);
	const result = $derived(form?.result ?? null);
	const step = $derived(result ? 3 : plan ? 2 : 1);

	let formEl: HTMLFormElement | undefined = $state();
	let fileInput: HTMLInputElement | undefined = $state();
	let checkBtn: HTMLButtonElement | undefined = $state();
	let busy = $state(false);
	let dragging = $state(false);
	let filter = $state<'all' | 'new' | 'note' | 'skip' | 'err'>('all');
	// Jetons « type:nom » des versions / sprints / projets décochés. Vide = tout est créé : c'est l'état
	// de départ de tout aperçu, sans rien à initialiser quand il arrive.
	let unchecked = $state<string[]>([]);
	const toggle = (t: string) => (unchecked = unchecked.includes(t) ? unchecked.filter((x) => x !== t) : [...unchecked, t]);

	// Versions, sprints et projets se décochent ; les codes SSP sont toujours créés (cf. planImport).
	const OPTIONAL = [
		{ kind: 'version', label: 'Versions', one: 'version', many: 'versions' },
		{ kind: 'sprint', label: 'Sprints', one: 'sprint', many: 'sprints' },
		{ kind: 'project', label: 'Projets', one: 'projet', many: 'projets' }
	] as const;
	const token = (kind: string, name: string) => `${kind}:${name.toLowerCase()}`;

	const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
	const list = new Intl.ListFormat('fr', { style: 'long', type: 'conjunction' });
	const STATUS = { new: ['+', 'À créer'], skip: ['=', 'Ignorée'], err: ['×', 'Erreur'] } as const;

	const noted = (l: ImportLine) => l.status === 'new' && l.notes.length > 0;
	const shown = $derived(
		(plan?.lines ?? []).filter((l) => filter === 'all' || (filter === 'note' ? noted(l) : l.status === filter))
	);
	const ignoredColumns = $derived((plan?.columns ?? []).filter((c) => !c.label));
	// Colonnes connues mais non lues, regroupées par raison (phase Test désactivée, doublon).
	const ignoredWhy = $derived.by(() => {
		const byWhy = new Map<string, string[]>();
		for (const c of ignoredColumns) if (c.why) byWhy.set(c.why, [...(byWhy.get(c.why) ?? []), c.header]);
		return [...byWhy];
	});
	const flaggedSsp = $derived((plan?.toCreate.ssp ?? []).filter((r) => r.similarTo || r.archived));
	const hasCreations = $derived(!!plan && (OPTIONAL.some((o) => plan.toCreate[o.kind].length > 0) || plan.toCreate.ssp.length > 0));
	// Ce que le clic sur « Importer » va créer dans les référentiels, selon les cases cochées.
	const refSentence = $derived.by(() => {
		if (!plan) return '';
		const parts = [
			...OPTIONAL.map((o) => [plan.toCreate[o.kind].filter((r) => !unchecked.includes(token(o.kind, r.name))).length, o.one, o.many] as const),
			[plan.toCreate.ssp.length, 'code SSP', 'codes SSP'] as const
		].filter(([n]) => n > 0);
		return parts.length ? `Crée ${list.format(parts.map(([n, one, many]) => count(n, one, many)))}.` : '';
	});

	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ result: res, update }) => {
			busy = false;
			if (res.type === 'failure') {
				// Pas d'update() : l'aperçu en cours reste affiché si la validation échoue.
				toast.error(String(res.data?.error ?? 'Erreur.'));
				return;
			}
			if (res.type === 'success' && res.data?.plan) {
				unchecked = [];
				filter = 'all';
			}
			// reset: false — le fichier doit rester dans le champ : il est renvoyé à la validation.
			await update({ reset: false });
		};
	};

	// « Annuler ce lot » : confirmation d'abord (suppression de tickets), puis le bilan en toast.
	const undo: SubmitFunction = async ({ cancel }) => {
		const ok = await confirmDialog({
			title: 'Annuler cet import ?',
			message:
				"Les tickets de ce lot restés tels qu'importés sont supprimés. Ceux qui ont déjà servi (imputation, modification, objectif…) sont conservés, ainsi que les versions, sprints et codes SSP créés.",
			confirmLabel: 'Supprimer les tickets'
		});
		if (!ok) return cancel();
		return async ({ result: res, update }) => {
			if (res.type === 'failure') toast.error(String(res.data?.error ?? 'Erreur.'));
			if (res.type === 'success' && res.data?.undone) {
				const { deleted, kept } = res.data.undone as { deleted: number; kept: number };
				toast.success(
					`${count(deleted, 'ticket supprimé', 'tickets supprimés')}` +
						(kept ? `, ${count(kept, 'conservé car déjà utilisé', 'conservés car déjà utilisés')}.` : '.')
				);
			}
			await update();
		};
	};

	function picked() {
		const file = fileInput?.files?.[0];
		if (!file) return;
		if (file.size > data.maxBytes) {
			toast.error('Fichier trop lourd (480 Ko au plus) : retirez la mise en forme ou enregistrez-le en CSV.');
			fileInput!.value = '';
			return;
		}
		formEl?.requestSubmit(checkBtn);
	}

	function dropped(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (!fileInput || !e.dataTransfer?.files.length) return;
		fileInput.files = e.dataTransfer.files;
		picked();
	}
</script>

<svelte:head><title>Import de tickets — Imputo</title></svelte:head>

{#snippet lineRow(l: ImportLine)}
	<li class="row s-{l.status}">
		<span class="ln">L{l.line}</span>
		<span class="st st-{l.status}"><i class="g g-{l.status}">{STATUS[l.status][0]}</i>{STATUS[l.status][1]}</span>
		<span class="key">{l.key}</span>
		<span class="body">
			<span class="line">
				<span class="ttl" class:empty={!l.title}>{l.title || '(titre vide)'}</span>
				{#if l.tags.length}
					<span class="tags">
						{#each l.tags as t}
							<span class="tag" class:add={t.add} title={t.add ? 'Sera créé' : undefined}>{t.add ? '+ ' : ''}{t.text}</span>
						{/each}
					</span>
				{/if}
			</span>
			{#each l.notes as n}
				<span class="remark">{#if l.status === 'new'}<i class="g g-note">!</i>{/if}<span>{n}</span></span>
			{/each}
		</span>
	</li>
{/snippet}

<div class="topbar">
	<h1>
		{step === 3 ? 'Import terminé' : 'Import de tickets'}
		<small>
			{#if form?.fileName && step > 1}
				{form.fileName}{#if plan}&nbsp;· {count(plan.counts.total, 'ligne lue', 'lignes lues')}{/if}
			{:else}
				Créez des tickets en masse depuis un classeur Excel ou un CSV.
			{/if}
		</small>
	</h1>
	<span class="spacer"></span>
	{#if step === 2}
		<!-- Rechargement complet : repart d'un champ fichier vide, sans aperçu en mémoire. -->
		<a class="btn btn-ghost" href="/admin/import" data-sveltekit-reload>Changer de fichier</a>
	{/if}
</div>

<div class="content imp">
	<ol class="steps">
		<li class:done={step > 1} class:cur={step === 1}>Fichier</li>
		<li class:done={step > 2} class:cur={step === 2}>Vérification</li>
		<li class:cur={step === 3}>Import</li>
	</ol>

	<form class="flow" method="POST" action="?/check" enctype="multipart/form-data" use:enhance={submit} bind:this={formEl}>
		<!-- Toujours monté, même hors de l'étape 1 : la validation renvoie ce même fichier. -->
		<input
			class="file"
			id="import-file"
			type="file"
			name="file"
			accept=".xlsx,.csv"
			bind:this={fileInput}
			onchange={picked}
		/>
		<button class="file" type="submit" bind:this={checkBtn} tabindex="-1" aria-hidden="true">Vérifier</button>

		{#if step === 2 && plan}
			<!-- Une seule carte, deux zones : les chiffres à gauche, ce que l'import crée et les colonnes à
			     droite. Deux cartes côte à côte laissaient un trou dès que l'une était plus courte. -->
			<section class="card sum">
				<div class="sum-stats">
					<h2>Bilan du fichier</h2>
					<ul class="stats">
						<li class="k-new">
							<b>{plan.counts.new}</b>
							<span><i class="g g-new">+</i>{plan.counts.new > 1 ? 'tickets à créer' : 'ticket à créer'}</span>
							<small>{plan.counts.noted ? `dont ${plan.counts.noted} avec une remarque` : 'sans remarque'}</small>
						</li>
						<li>
							<b>{plan.counts.skip}</b>
							<span><i class="g g-skip">=</i>{plan.counts.skip > 1 ? 'lignes ignorées' : 'ligne ignorée'}</span>
							<small>clé déjà dans l'espace</small>
						</li>
						<li class:k-err={plan.counts.err > 0}>
							<b>{plan.counts.err}</b>
							<span><i class="g g-err">×</i>{plan.counts.err > 1 ? 'lignes en erreur' : 'ligne en erreur'}</span>
							<small>non importées</small>
						</li>
					</ul>
				</div>

				<div class="sum-main">
					<div class="sum-part">
						<h2>À créer dans les référentiels</h2>
						{#if !hasCreations}
							<p class="soft">Rien à créer : le fichier n'apporte ni version, ni sprint, ni projet, ni code SSP nouveau.</p>
						{:else if OPTIONAL.some((o) => plan.toCreate[o.kind].length > 0)}
							<p class="soft">Une version, un sprint ou un projet décoché n'est pas créé : le champ reste vide sur les tickets concernés.</p>
						{/if}
						{#if hasCreations || plan.neverCreated.length}
							<dl class="refs">
								{#each OPTIONAL as o}
									{#if plan.toCreate[o.kind].length}
										<dt>{o.label}</dt>
										<dd>
											{#each plan.toCreate[o.kind] as r}
												<input type="hidden" name="listed" value={token(o.kind, r.name)} />
												<label class="chk">
													<input type="checkbox" name="create" value={token(o.kind, r.name)} checked={!unchecked.includes(token(o.kind, r.name))} onchange={() => toggle(token(o.kind, r.name))} />
													{r.name}<small>{count(r.tickets, 'ticket', 'tickets')}</small>
												</label>
											{/each}
										</dd>
									{/if}
								{/each}
								{#if plan.toCreate.ssp.length}
									<dt>Codes SSP</dt>
									<dd>
										{#each plan.toCreate.ssp as r}
											{@const flagged = !!(r.similarTo || r.archived)}
											<span class="newval" class:check={flagged}>
												<i class="g {flagged ? 'g-note' : 'g-new'}">{flagged ? '!' : '+'}</i>{r.name}<small>{count(r.tickets, 'ticket', 'tickets')}</small>
											</span>
										{/each}
										<p class="soft wide">
											{plan.toCreate.ssp.length > 1 ? "Ces codes n'existent pas dans l'espace : ils seront créés." : "Ce code n'existe pas dans l'espace : il sera créé."}
											{#each flaggedSsp as r}
												{' '}{r.name}
												{r.similarTo ? `ressemble à ${r.similarTo}` : ''}{r.similarTo && r.archived ? ' et ' : ''}{r.archived ? 'existe déjà, mais archivé' : ''}.
											{/each}
											{#if flaggedSsp.length}Si c'est une faute de frappe, corrigez le fichier et redéposez-le.{/if}
										</p>
									</dd>
								{/if}
								{#if plan.neverCreated.length}
									<dt>Jamais créés</dt>
									<dd><p class="soft wide">{list.format(plan.neverCreated)} : {plan.neverCreated.length > 1 ? 'absents' : 'absent'} de l'espace, le champ reste vide.</p></dd>
								{/if}
							</dl>
						{/if}
					</div>

					<div class="sum-part cols">
						<h2>Colonnes du fichier</h2>
						<p class="soft">{count(plan.columns.length, 'colonne lue', 'colonnes lues')}, dont {plan.columns.length - ignoredColumns.length} {plan.columns.length - ignoredColumns.length > 1 ? 'reconnues' : 'reconnue'}.</p>
						{#if ignoredColumns.length}
							<div class="tags">
								<span class="soft">{ignoredColumns.length > 1 ? 'Ignorées :' : 'Ignorée :'}</span>
								{#each ignoredColumns as c}<span class="tag off" title={c.why}>{c.header}</span>{/each}
							</div>
							{#each ignoredWhy as [why, headers]}
								<p class="soft">{list.format(headers)} : {why}.</p>
							{/each}
						{/if}
						<details>
							<summary>Voir les colonnes reconnues</summary>
							<div class="tags">
								{#each plan.columns.filter((c) => c.label) as c}
									<span class="tag" title={c.label !== c.header ? `Lue comme « ${c.label} »` : undefined}>{c.header}</span>
								{/each}
							</div>
						</details>
					</div>
				</div>
			</section>

			<section class="card block">
				<div class="spread">
					<h2>Lignes du fichier</h2>
					<div class="filters" role="group" aria-label="Filtrer les lignes">
						{#each [['all', 'Toutes', plan.counts.total], ['new', 'À créer', plan.counts.new], ['note', 'Remarques', plan.counts.noted], ['skip', 'Ignorées', plan.counts.skip], ['err', 'Erreurs', plan.counts.err]] as const as [value, label, n]}
							<button type="button" class:on={filter === value} aria-pressed={filter === value} onclick={() => (filter = value)}>{label} <b>{n}</b></button>
						{/each}
					</div>
				</div>
				<ul class="rows">
					{#each shown as l (l.line)}{@render lineRow(l)}{/each}
				</ul>
				{#if shown.length === 0}<p class="soft">Aucune ligne dans ce filtre.</p>{/if}
			</section>

			<div class="bar">
				<p>
					<b>{plan.counts.new ? `${count(plan.counts.new, 'ticket sera créé', 'tickets seront créés')}.` : 'Aucun ticket à créer.'}</b>
					{plan.counts.new ? refSentence : ''}
					{#if plan.counts.err}{count(plan.counts.err, "ligne en erreur n'est pas importée", 'lignes en erreur ne sont pas importées')}.{/if}
				</p>
				<a class="btn btn-ghost" href="/admin/import" data-sveltekit-reload>Annuler</a>
				<button class="btn btn-primary" type="submit" formaction="?/apply" disabled={busy || plan.counts.new === 0}>
					{busy ? 'Import en cours…' : `Importer ${count(plan.counts.new, 'ticket', 'tickets')}`}
				</button>
			</div>
		{/if}
	</form>

	<!-- Hors du formulaire principal : la zone de dépôt vise le champ par son id, et chaque ligne
	     d'historique porte son propre formulaire d'annulation. Écran large : dépôt à gauche, modèle
	     et historique à droite. -->
	{#if step === 1}
		<div class="start">
			<label
				class="drop"
				class:over={dragging}
				for="import-file"
				ondragover={(e) => { e.preventDefault(); dragging = true; }}
				ondragleave={() => (dragging = false)}
				ondrop={dropped}
			>
				<span class="drop-ic">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
				</span>
				<strong>{busy ? 'Lecture du fichier…' : 'Déposez un fichier .xlsx ou .csv'}</strong>
				<span class="btn btn-primary">Choisir un fichier</span>
				<small>{data.maxRows} lignes au plus. La vérification s'affiche avant toute création.</small>
			</label>

			<div class="side">
				<section class="card block">
					<div>
						<h2>Modèle à remplir</h2>
						<p class="soft">Un classeur vide avec les bonnes colonnes et, en listes déroulantes, les états, versions, sprints et codes SSP de l'espace. Seules Clé et Titre sont obligatoires.</p>
					</div>
					<a class="btn btn-ghost fit" href="/admin/import/modele" download>Télécharger le modèle</a>
				</section>
				{#if data.imports.length}
					<section class="card block">
						<h2>Imports précédents</h2>
						<ul class="hist">
							{#each data.imports as i (i.id)}
								<li>
									<span class="f">{i.fileName}</span>
									<small>{formatDateTime(i.createdAt)} · {count(i.ticketsCreated, 'ticket', 'tickets')}{i.createdByName ? ` · ${i.createdByName}` : ''}</small>
									{#if i.undoneAt}
										<small class="act">annulé le {formatDateTime(i.undoneAt)}</small>
									{:else}
										<form class="act" method="POST" action="?/undo" use:enhance={undo}>
											<input type="hidden" name="importId" value={i.id} />
											<button class="linkish" type="submit">Annuler ce lot</button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		</div>
	{/if}

	{#if step === 3 && result}
		{@const refs = [[result.refs.version, 'version', 'versions'], [result.refs.sprint, 'sprint', 'sprints'], [result.refs.project, 'projet', 'projets'], [result.refs.ssp, 'code SSP', 'codes SSP']] as const}
		{@const added = refs.filter(([n]) => n > 0).map(([n, one, many]) => count(n, one, many))}
		<!-- Écran large : le résultat à gauche, l'annulation à droite. -->
		<div class="end" class:solo={!result.importId}>
			<section class="card block">
				<p class="big">{count(result.created, 'ticket créé', 'tickets créés')}.</p>
				<ul class="outcome">
					{#if added.length}<li><i class="g g-new">+</i>{list.format(added)} : ajouté aux référentiels.</li>{/if}
					{#if result.skipped}<li><i class="g g-skip">=</i>{count(result.skipped, 'ligne ignorée', 'lignes ignorées')} : la clé existait déjà.</li>{/if}
					{#if result.errors.length}<li><i class="g g-err">×</i>{count(result.errors.length, 'ligne non importée', 'lignes non importées')}, à corriger ci-dessous.</li>{/if}
				</ul>
				<div class="actions">
					<!-- Filtre d'URL sur le lot (cf. TicketFilters#importId) : seuls les tickets de cet import. -->
					<a class="btn btn-primary" href={result.importId ? `/tickets?import=${result.importId}` : '/tickets'}>Voir les tickets</a>
					<a class="btn btn-ghost" href="/admin/import" data-sveltekit-reload>Importer un autre fichier</a>
				</div>
			</section>
			{#if result.importId}
				<section class="card block">
					<div>
						<h2>Annuler cet import</h2>
						<p class="soft">Supprime les tickets de ce lot qui n'ont ni imputation ni modification depuis. Les référentiels créés restent en place. Possible aussi plus tard, depuis « Imports précédents ».</p>
					</div>
					<form class="fit" method="POST" action="?/undo" use:enhance={undo}>
						<input type="hidden" name="importId" value={result.importId} />
						<button class="btn btn-ghost" type="submit">Annuler ce lot</button>
					</form>
				</section>
			{/if}
		</div>
		{#if result.errors.length}
			<section class="card block">
				<div>
					<h2>{count(result.errors.length, 'ligne à corriger', 'lignes à corriger')}</h2>
					<p class="soft">Corrigez-les dans le fichier et redéposez-le en entier : les tickets déjà créés seront ignorés, seules les lignes corrigées seront ajoutées.</p>
				</div>
				<ul class="rows">
					{#each result.errors as l (l.line)}{@render lineRow(l)}{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.imp {
		display: flex;
		flex-direction: column;
		gap: 18px;
		/* Au-delà, les cartes s'étirent sans rien gagner en lisibilité. */
		max-width: 1280px;
		/* Remarque : teinte distincte de --warn (erreur), jamais seule — toujours avec le « ! » carré. */
		--caution: #a15c00;
		--caution-tint: #fdf1d8;
	}
	:global([data-theme='dark']) .imp {
		--caution: #fde047;
		--caution-tint: color-mix(in srgb, #fde047 13%, var(--surface));
	}
	.flow {
		display: contents;
	}
	.file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	h2 {
		font-size: 15px;
		font-weight: 700;
	}
	.soft {
		font-size: 13px;
		color: var(--text-soft);
		margin-top: 4px;
	}
	.soft.wide {
		flex-basis: 100%;
		margin-top: 0;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
	}
	.spread {
		display: flex;
		flex-flow: row wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.fit {
		align-self: flex-start;
	}

	/* Deux colonnes dès que la zone de contenu le permet (barre latérale de 256 px déduite). */
	.start,
	.end {
		display: grid;
		gap: 18px;
		align-items: start;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}
	@media (min-width: 1100px) {
		.start,
		.end:not(.solo) {
			grid-template-columns: minmax(0, 1.4fr) minmax(300px, 1fr);
		}
		.start .drop {
			min-height: 340px;
		}
	}

	.steps {
		counter-reset: step;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 10px;
		list-style: none;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.steps li {
		counter-increment: step;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.steps li::before {
		content: counter(step);
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		font-size: 12px;
	}
	.steps li:not(:last-child)::after {
		content: '';
		width: 26px;
		height: 1px;
		background: var(--border-strong);
	}
	.steps li.done {
		color: var(--text-soft);
	}
	.steps li.done::before {
		content: '✓';
		background: var(--accent-tint);
		color: var(--accent-ink);
		border-color: transparent;
	}
	.steps li.cur {
		color: var(--text);
	}
	.steps li.cur::before {
		background: var(--accent);
		color: #fff;
		border-color: transparent;
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px 18px;
		border: 2px dashed var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface-2);
		text-align: center;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.drop:hover,
	.drop.over {
		border-color: var(--accent);
		background: var(--accent-tint-2);
	}
	/* Le champ fichier, invisible, vit dans le formulaire : son focus clavier se montre ici. */
	.imp:has(.file:focus-visible) .drop {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.drop-ic {
		display: grid;
		place-items: center;
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: var(--accent-tint);
		color: var(--accent-ink);
	}
	.drop strong {
		font-size: 17px;
	}
	.drop small {
		font-size: 12.5px;
		color: var(--text-soft);
	}

	/* Pictogrammes d'état : le signe et la forme portent le sens, la couleur vient en plus. */
	.g {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 17px;
		height: 17px;
		border-radius: 50%;
		font-style: normal;
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}
	.g-new {
		background: var(--accent);
		color: #fff;
	}
	.g-skip {
		border: 1.5px solid var(--text-mute);
		color: var(--text-mute);
	}
	.g-err {
		background: var(--warn);
		color: var(--surface);
	}
	.g-note {
		border-radius: 4px;
		border: 1.5px solid var(--caution);
		color: var(--caution);
		background: var(--caution-tint);
	}

	.stats {
		display: flex;
		flex-direction: column;
		gap: 8px;
		list-style: none;
	}
	.stats li {
		display: grid;
		grid-template-columns: 54px minmax(0, 1fr);
		column-gap: 12px;
		align-items: center;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.stats b {
		grid-row: span 2;
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		line-height: 1;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.stats span {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13.5px;
		font-weight: 600;
	}
	.stats small {
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.stats li.k-new {
		background: var(--accent-tint-2);
		border-color: color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.stats li.k-new b {
		color: var(--accent-ink);
	}
	.stats li.k-err b {
		color: var(--warn);
	}
	/* Entre téléphone et écran large, la zone des chiffres est en haut : les trois côte à côte. */
	@media (min-width: 620px) and (max-width: 1099px) {
		.stats {
			flex-direction: row;
		}
		.stats li {
			flex: 1 1 0;
		}
	}

	/* Bilan : une carte, deux zones séparées par un filet. La plus courte garde son fond jusqu'en
	   bas, donc pas de trou quel que soit le contenu de l'autre. */
	.sum {
		display: grid;
		overflow: hidden;
	}
	.sum-stats {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.sum-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.sum-part {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 18px 20px;
	}
	.sum-part:first-child {
		flex: 1;
	}
	.sum-part + .sum-part {
		border-top: 1px solid var(--border);
	}
	.sum-part .soft {
		margin-top: 0;
	}
	@media (min-width: 1100px) {
		.sum {
			grid-template-columns: 320px minmax(0, 1fr);
		}
		.sum-stats {
			border-bottom: 0;
			border-right: 1px solid var(--border);
		}
	}
	.cols .tags {
		align-items: center;
	}
	.cols details .tags {
		margin-top: 8px;
	}

	.refs {
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		gap: 12px 14px;
		/* Sur la ligne de base : le libellé s'aligne aussi bien sur une étiquette que sur une phrase. */
		align-items: baseline;
	}
	.refs dt {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-soft);
	}
	.refs dd {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		min-width: 0;
	}
	@media (max-width: 560px) {
		.refs {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
		}
	}
	.chk,
	.newval {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px 7px 9px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 13.5px;
		font-weight: 600;
	}
	.chk {
		cursor: pointer;
	}
	.chk input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}
	.chk small,
	.newval small {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--text-soft);
	}
	/* Valeur créée d'office : contour pointillé et « + », comme les étiquettes des lignes — pas de case. */
	.newval {
		border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
		background: transparent;
	}
	.newval.check {
		border-color: var(--caution);
		background: var(--caution-tint);
	}

	summary {
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent-ink);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.tag {
		padding: 2px 8px;
		border: 1px solid transparent;
		border-radius: 30px;
		background: var(--surface-sunk);
		color: var(--text-soft);
		font-size: 11.5px;
		font-weight: 600;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.tag.add {
		background: transparent;
		border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
		color: var(--accent-ink);
	}
	.tag.off {
		text-decoration: line-through;
		color: var(--text-mute);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.filters button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		border: 1px solid var(--border);
		border-radius: 30px;
		background: var(--surface-2);
		color: var(--text-soft);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
	}
	.filters button b {
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.filters button.on {
		background: var(--text);
		border-color: var(--text);
		color: var(--surface);
	}
	.filters button.on b {
		color: var(--surface);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		list-style: none;
		container-type: inline-size;
	}
	.row {
		display: grid;
		grid-template-columns: 34px 102px 96px minmax(0, 1fr);
		gap: 6px 12px;
		align-items: baseline;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.ln {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.key {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12.5px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 12px;
	}
	.ttl {
		flex: 1 1 220px;
		min-width: 0;
		font-size: 14px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.ttl.empty {
		font-style: italic;
		color: var(--text-mute);
	}
	.remark {
		display: flex;
		gap: 7px;
		align-items: flex-start;
		font-size: 12.5px;
		color: var(--text-soft);
	}
	.remark .g {
		margin-top: 1px;
	}
	.row.s-err {
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
		background: color-mix(in srgb, var(--warn) 6%, var(--surface));
	}
	.row.s-err .remark {
		color: var(--warn);
		font-weight: 600;
	}
	.row.s-skip {
		border-style: dashed;
		background: transparent;
	}
	.row.s-skip .ttl,
	.row.s-skip .key {
		color: var(--text-mute);
	}
	@container (max-width: 540px) {
		.row {
			grid-template-columns: auto auto minmax(0, 1fr);
		}
		.body {
			grid-column: 1 / -1;
		}
	}
	.st {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		justify-self: start;
		padding: 2px 9px 2px 3px;
		border-radius: 30px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.st-new {
		background: var(--accent-tint);
		color: var(--accent-ink);
	}
	.st-skip {
		background: var(--surface-sunk);
		color: var(--text-soft);
	}
	.st-err {
		background: var(--warn-tint);
		color: var(--warn);
	}

	/* Collée en bas de la zone qui défile (.main), pas dans un panneau à hauteur bornée. */
	.bar {
		position: sticky;
		bottom: 12px;
		/* Barre d'action flottante, pas un bandeau : elle ne s'étire pas sur toute la page. */
		align-self: center;
		width: min(100%, 900px);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 12px;
		padding: 12px 14px 12px 18px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.bar p {
		flex: 1 1 280px;
		min-width: 0;
		font-size: 13px;
		color: var(--text-soft);
	}
	.bar p b {
		display: block;
		font-size: 14.5px;
		color: var(--text);
	}

	.big {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--accent-ink);
	}
	.outcome {
		display: flex;
		flex-direction: column;
		gap: 6px;
		list-style: none;
		font-size: 13.5px;
	}
	.outcome li {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
	.outcome .g {
		margin-top: 2px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.hist {
		display: flex;
		flex-direction: column;
		list-style: none;
	}
	.hist li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 12px;
		align-items: center;
		padding: 10px 0;
		border-top: 1px solid var(--border);
		font-size: 13px;
	}
	.hist li:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.hist li:last-child {
		padding-bottom: 0;
	}
	.hist .f {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.hist small {
		font-size: 12.5px;
		color: var(--text-soft);
	}
	/* Action ou mention « annulé » : à droite, sur la hauteur des deux lignes. */
	.hist .act {
		grid-column: 2;
		grid-row: 1 / span 2;
		text-align: right;
	}
	.linkish {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-ink);
		font-size: 12.5px;
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
</style>
