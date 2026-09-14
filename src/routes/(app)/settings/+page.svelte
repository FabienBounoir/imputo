<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import {
		pushSupported,
		isSubscribed,
		subscribePush,
		unsubscribePush,
		saveNotifPrefs,
		sendTestNotification,
		NOTIF_SLOTS,
		slotLabel,
		type NotifPrefs,
		type SlotKey
	} from '$lib/push';
	import { setTheme, storedTheme, type ThemePref } from '$lib/theme';
	import { seasonalState, setSeasonalEnabled, setForcedEffect, activeSeasonalEffects, SEASONAL_EFFECTS } from '$lib/seasonal.svelte';
	import { konamiState } from '$lib/konami.svelte';
	import { requestTourReplay } from '$lib/tour/tourState.svelte';
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import PetSprite from '$lib/components/PetSprite.svelte';
	import { petForBadge } from '$lib/pets';

	let { data, form } = $props();
	$effect(() => {
		if (!form) return;
		if (form.pwError) toast.error(form.pwError);
		else if (form.error) toast.error(form.error);
		else if (form.pwOk) toast.success('Mot de passe changé ✓');
		else if (
			form.accentPrefOk ||
			form.petPrefOk ||
			form.motivationBannerOk ||
			form.rememberTicketFiltersOk ||
			form.rememberTicketSearchOk ||
			form.compactActivityOk ||
			form.sortActivitiesAlphaOk
		) {
			toast.success('Enregistré ✓');
		}
	});

	let supported = $state(true);
	let subscribed = $state(false);
	let busy = $state(false);
	let prefs = $state<NotifPrefs>({ ...data.prefs });
	let themePref = $state<ThemePref>('system');

	const PRESETS = ['#16A34A', '#4F46E5', '#9333EA', '#0EA5E9', '#E11D48', '#EA580C', '#0D9488', '#CA8A04'];
	let accentOverride = $state(data.accentMode !== 'WORKSPACE');
	let accentRgb = $state(data.accentMode === 'RGB');
	let accentDisco = $state(data.accentMode === 'DISCO');
	let accentColor = $state(data.accentColor ?? data.workspace?.accentColor ?? PRESETS[0]);
	let sortActivitiesAlpha = $state(data.sortActivitiesAlpha);
	let rememberTicketFilters = $state(data.rememberTicketFilters);
	let rememberTicketSearch = $state(data.rememberTicketSearch);
	let compactTicketActivity = $state(data.compactTicketActivity);
	let motivationBanner = $state(data.motivationBanner);
	const activeSeasonal = $derived(activeSeasonalEffects());

	// Les clés booléennes de NotifPrefs (donc hors morningSlots/eveningSlots, qui sont des maps).
	type BoolPref = { [K in keyof NotifPrefs]: NotifPrefs[K] extends boolean ? K : never }[keyof NotifPrefs];
	// `when` = heure d'envoi réelle, telle que planifiée dans openshift/cronjobs.yaml (Europe/Paris).
	// Les rappels à plusieurs créneaux l'affichent via leurs chips, pas ici.
	type PrefItem = { key: BoolPref; label: string; when?: string; slots?: SlotKey };
	const GROUPS: { label: string; items: PrefItem[] }[] = [
		{
			label: 'Imputation',
			items: [
				{ key: 'eveningMissing', label: "Le soir, si aujourd'hui n'est pas saisi", slots: 'eveningSlots' },
				{ key: 'morningYesterday', label: "Le matin, si hier n'a pas été renseigné", slots: 'morningSlots' },
				{ key: 'weeklyRecap', label: 'Le vendredi, si la semaine reste incomplète', when: 'non planifié' },
				{ key: 'raeStale', label: 'RAE périmé sur mes tickets', when: '9h00' }
			]
		},
		{
			label: 'Congés',
			items: [
				{ key: 'absenceValidated', label: 'Mon congé a été validé', when: 'immédiat' },
				...(data.role === 'ADMIN'
					? [{ key: 'absencePending' as const, label: 'Un congé attend ma validation', when: 'immédiat' }]
					: [])
			]
		},
		{
			label: 'Support',
			items: [{ key: 'supportDuty', label: 'Mon tour de support commence ou change', when: '9h00 ou immédiat' }]
		},
		{
			label: 'Team mood',
			items: [
				{ key: 'moodDeadline', label: 'Dernier jour pour voter', when: '10h00' },
				...(data.role === 'ADMIN'
					? [{ key: 'moodRecap' as const, label: 'Baisse nette de la moyenne', when: '9h00' }]
					: [])
			]
		}
	];

	onMount(async () => {
		supported = pushSupported();
		subscribed = await isSubscribed();
		themePref = storedTheme() ?? 'system';
	});

	async function enable() {
		busy = true;
		const ok = await subscribePush(data.vapidPublicKey);
		busy = false;
		subscribed = ok;
		if (ok) {
			prefs.enabled = true;
			await saveNotifPrefs(prefs);
			toast.success('Notifications activées ✓');
		} else {
			toast.error('Permission refusée ou non disponible.');
		}
	}
	async function disable() {
		busy = true;
		await unsubscribePush();
		busy = false;
		subscribed = false;
		toast.message('Notifications désactivées sur cet appareil.');
	}
	async function savePref() {
		await saveNotifPrefs(prefs);
		toast.success('Préférences enregistrées ✓');
	}
	/** Cocher/décocher le rappel bascule ses trois créneaux d'un bloc. */
	async function toggleKind(item: PrefItem) {
		if (item.slots) for (const s of NOTIF_SLOTS[item.slots]) prefs[item.slots][s] = prefs[item.key];
		await savePref();
	}
	/** Décocher le dernier créneau éteint le rappel (et le recocher le rallume). */
	async function toggleSlot(item: PrefItem & { slots: SlotKey }) {
		prefs[item.key] = NOTIF_SLOTS[item.slots].some((s) => prefs[item.slots!][s]);
		await savePref();
	}
	async function test() {
		const sent = await sendTestNotification();
		if (sent > 0) toast.success('Notification de test envoyée.');
		else toast.error('Aucun appareil abonné', { description: 'Active les notifications ci-dessus pour en recevoir.' });
	}
	function pickTheme(p: ThemePref) {
		themePref = p;
		setTheme(p);
	}

	// « Apparence » = ce qui change le look de l'app entière ; « Mes vues » = les réglages par défaut
	// d'une page précise (Tickets & chiffrage, Synthèse). Les mélanger donnait une liste sans fin où
	// l'ordre des activités voisinait avec le choix du thème.
	import BadgeMedal from '$lib/components/BadgeMedal.svelte';
	import BadgeUnlock from '$lib/components/BadgeUnlock.svelte';
	import BadgeDetail from '$lib/components/BadgeDetail.svelte';

	const TABS = [
		{ key: 'badges', label: 'Badges & compagnon' },
		{ key: 'notifications', label: 'Notifications' },
		{ key: 'apparence', label: 'Apparence' },
		{ key: 'vues', label: 'Mes vues' },
		{ key: 'securite', label: 'Sécurité' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	// Repli sur l'onglet concerné après un POST sans JS (use:enhance ne remonte pas le composant).
	let tab = $state<Tab>(
		form?.pwOk || form?.pwError
			? 'securite'
			: form?.accentPrefOk || form?.motivationBannerOk
				? 'apparence'
				: form?.sortActivitiesAlphaOk || form?.rememberTicketFiltersOk || form?.rememberTicketSearchOk || form?.compactActivityOk
					? 'vues'
					: 'badges'
	);

	// Paliers gagnés mais pas encore montrés : joués l'un après l'autre à l'ouverture, puis marqués
	// vus côté serveur.
	// Fiche ouverte, et rejeu demandé depuis cette fiche. L'ANNONCE des nouveaux paliers, elle, est
	// gérée par le layout de l'app : elle doit pouvoir surgir sur n'importe quelle page. La rejouer
	// aussi ici lancerait deux animations superposées sur l'écran des Réglages.
	let selected = $state<(typeof data.badges)[number] | null>(null);
	let replay = $state<(typeof data.badges)[number] | null>(null);
	const current = $derived(replay);
	const won = $derived(data.badges.filter((b) => b.tier > 0).length);
	const tiersTotal = $derived(data.badges.reduce((n, b) => n + b.tier, 0));
	const petsUnlocked = $derived(data.pets.filter((p) => p.unlocked).length);

	// Un rejeu ne marque rien comme vu : c'est une relecture, pas une annonce.
	function closeBadge() {
		replay = null;
	}

	// Avancement à l'intérieur du palier courant, pas depuis zéro : sinon une barre à 99 % stagne
	// pendant des mois entre deux seuils éloignés.
	function badgePct(b: (typeof data.badges)[number]) {
		if (!b.next) return 100;
		const floor = b.tier > 0 ? b.thresholds[b.tier - 1] : 0;
		return Math.max(2, Math.min(100, Math.round(((b.value - floor) / (b.next.target - floor)) * 100)));
	}
</script>

<div class="topbar">
	<h1>Réglages<small>Préférences personnelles</small></h1>
	<div class="spacer"></div>
	<button type="button" class="btn btn-ghost" onclick={requestTourReplay}>Revoir le tutoriel</button>
</div>

<div class="content settings" class:wide={tab === 'badges'}>
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button type="button" class:on={tab === t.key} onclick={() => (tab = t.key)}>{t.label}</button>
		{/each}
	</div>

	{#if tab === 'badges'}
		<section class="card block">
			<h3>Mon compagnon</h3>
			<p class="hint">
				{petsUnlocked} compagnon{petsUnlocked > 1 ? 's' : ''} sur {data.pets.length} débloqué{petsUnlocked > 1 ? 's' : ''}.
				Chacun s’ouvre avec un palier de badge. Celui qu’on choisit s’installe en bas de la fenêtre sur
				toutes les pages : il se promène, s’endort si on l’oublie, et se laisse attraper, lancer et
				renvoyer au curseur.
			</p>
			<form method="POST" action="?/petPref" use:enhance>
				<div class="pet-grid">
					<button type="submit" name="petId" value="" class="pet-card" class:on={!data.petId}>
						<span class="pet-slot" aria-hidden="true">∅</span>
						<b>Aucun</b>
						<span class="pet-species">Rien en bas de l’écran</span>
					</button>
					{#each data.pets as p (p.id)}
						<button
							type="submit"
							name="petId"
							value={p.id}
							class="pet-card"
							class:on={data.petId === p.id}
							class:locked={!p.unlocked}
							disabled={!p.unlocked}
						>
							{#if p.unlocked}
								<PetSprite petId={p.id} scale={4} />
							{:else}
								<span class="pet-slot" aria-hidden="true">?</span>
							{/if}
							<b>{p.name}</b>
							<span class="pet-species">{p.unlocked ? p.species : 'À débloquer'}</span>
							<span class="pet-trait">{p.unlocked ? p.trait : p.requirement}</span>
						</button>
					{/each}
				</div>
			</form>
		</section>

		<section class="card block">
			<h3>Mes badges</h3>
			<p class="hint">
				{won} badge{won > 1 ? 's' : ''} décroché{won > 1 ? 's' : ''} · {tiersTotal} paliers sur {data.badges.length * 5}.
				Chaque badge a cinq paliers : le compteur avance tout seul, rien à réclamer.
			</p>
			<div class="badge-grid">
				{#each data.badges as b (b.id)}
					<button
						type="button"
						class="badge-card"
						class:locked={b.tier === 0}
						onclick={() => (selected = b)}
						aria-label="Voir le détail du badge {b.name}"
					>
						<BadgeMedal badgeId={b.id} tier={b.tier} letter={b.name[0]} size={128} locked={b.tier === 0} interactive />
						<b>{b.name}</b>
						<span class="badge-tier">
							{#if b.tier > 0}{b.tierNames[b.tier - 1]} · palier {b.tier}/5{:else}Pas encore décroché{/if}
						</span>
						<div class="badge-bar" aria-hidden="true"><i style:width="{badgePct(b)}%"></i></div>
						<span class="badge-progress">
							{#if b.next}{b.value} / {b.next.target} {b.unit}{:else}{b.value} {b.unit} — palier max{/if}
						</span>
						<span class="badge-how">{b.how}</span>
						{#if petForBadge(b.id)}
							{@const p = petForBadge(b.id)!}
							<span class="badge-pet" class:got={b.tier >= p.unlock.tier}>
								🐾 {p.name} au palier {p.unlock.tier}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>

		{#if selected}
			<BadgeDetail
				badge={selected}
				onclose={() => (selected = null)}
				onreplay={() => {
					replay = selected;
					selected = null;
				}}
			/>
		{/if}

		{#if current}
			<BadgeUnlock
				badgeId={current.id}
				name={current.name}
				tier={current.tier}
				tierName={current.tierNames[current.tier - 1]}
				letter={current.name[0]}
				onclose={closeBadge}
			/>
		{/if}
	{:else if tab === 'notifications'}
		<section class="card block">
			<h3>Notifications</h3>
			<p class="hint">Rappels pour ne pas oublier de saisir ton imputation ou de mettre à jour ton RAE. Envoyés même quand l’app est fermée (navigateur compatible, ou app installée sur iOS).</p>

			{#if !data.vapidConfigured}
				<div class="flash error">Notifications non configurées côté serveur (clés VAPID manquantes).</div>
			{:else if !supported}
				<div class="flash error">Ton navigateur ne supporte pas les notifications push.</div>
			{:else}
				<div class="row">
					<div>
						<b>Notifications push</b>
						<span class="sub">{subscribed ? 'Activées sur cet appareil' : 'Désactivées sur cet appareil'}</span>
					</div>
					{#if subscribed}
						<button class="btn btn-ghost" onclick={disable} disabled={busy}>Désactiver</button>
					{:else}
						<button class="btn btn-primary" onclick={enable} disabled={busy}>Activer</button>
					{/if}
				</div>

				{#if subscribed}
					<div class="prefs">
						<label class="pref master">
							<input type="checkbox" bind:checked={prefs.enabled} onchange={savePref} />
							<span>Activer les rappels</span>
						</label>
						{#each GROUPS as g (g.label)}
							<div class="pref-group" class:off={!prefs.enabled}>
								<span class="pref-group-label">{g.label}</span>
								{#each g.items as t (t.key)}
									<label class="pref">
										<input type="checkbox" bind:checked={prefs[t.key]} onchange={() => toggleKind(t)} disabled={!prefs.enabled} />
										<span>{t.label}{#if t.when}<span class="when">({t.when})</span>{/if}</span>
									</label>
									{#if t.slots}
										<div class="slots" class:off={!prefs.enabled || !prefs[t.key]}>
											{#each NOTIF_SLOTS[t.slots] as s (s)}
												<label class="slot">
													<input
														type="checkbox"
														bind:checked={prefs[t.slots][s]}
														onchange={() => toggleSlot(t as PrefItem & { slots: SlotKey })}
														disabled={!prefs.enabled || !prefs[t.key]}
													/>
													<span>{slotLabel(s)}</span>
												</label>
											{/each}
										</div>
									{/if}
								{/each}
							</div>
						{/each}
						<button class="btn btn-ghost test" onclick={test}>Envoyer une notification de test</button>
					</div>
				{/if}
			{/if}
		</section>
	{:else if tab === 'securite'}
		<section class="card block">
			<h3>Mot de passe</h3>
			<p class="hint">Change ton mot de passe de connexion.</p>
			<form method="POST" action="?/changePassword" use:enhance>
				<PasswordField id="cpw" name="currentPassword" label="Mot de passe actuel" autocomplete="current-password" required />
				<PasswordField id="npw" name="password" label="Nouveau mot de passe" placeholder="8 caractères minimum" autocomplete="new-password" required />
				<PasswordField id="ncf" name="confirm" label="Confirmer le nouveau mot de passe" autocomplete="new-password" required />
				<button class="btn btn-primary" type="submit">Changer le mot de passe</button>
			</form>
		</section>
	{:else if tab === 'apparence'}
		<section class="card block">
			<h3>Thème &amp; couleur</h3>

			<div class="opt">
				<div class="opt-t">
					<b>Thème</b>
					<span class="hint">« Système » suit le réglage de ton appareil.</span>
				</div>
				<div class="seg">
					<button type="button" class:on={themePref === 'system'} onclick={() => pickTheme('system')}>Système</button>
					<button type="button" class:on={themePref === 'light'} onclick={() => pickTheme('light')}>Clair</button>
					<button type="button" class:on={themePref === 'dark'} onclick={() => pickTheme('dark')}>Sombre</button>
				</div>
			</div>

			<div class="opt">
				<div class="opt-t">
					<b>Couleur d’accent</b>
					<span class="hint">Par défaut, suit la couleur choisie par l’admin de l’espace. Personnalise pour imposer la tienne sur tous les espaces.</span>
				</div>
				<div class="seg">
					<button type="button" class:on={!accentOverride} onclick={() => (accentOverride = false)}>Suivre l’espace</button>
					<button type="button" class:on={accentOverride} onclick={() => (accentOverride = true)}>Personnaliser</button>
				</div>
			</div>
			<!-- Le nuancier reste hors de la ligne : il lui faut la largeur pleine de la carte, la
			     colonne de droite d'une ligne de réglage ne suffit pas. -->
			<form method="POST" action="?/accentPref" use:enhance class="opt-more">
				{#if accentOverride}
					<AccentPicker bind:color={accentColor} bind:rgbMode={accentRgb} bind:discoMode={accentDisco} presets={PRESETS} />
				{/if}
				<input
					type="hidden"
					name="mode"
					value={!accentOverride ? 'WORKSPACE' : accentRgb ? 'RGB' : accentDisco ? 'DISCO' : 'CUSTOM'}
				/>
				<input type="hidden" name="color" value={accentColor} />
				<button class="btn btn-primary" type="submit">Enregistrer</button>
			</form>
		</section>

		<section class="card block">
			<h3>Ambiance</h3>

			<div class="opt">
				<div class="opt-t">
					<b>Bandeau motivation</b>
					<span class="hint">Une citation en haut de chaque page, renouvelée toutes les 30 s (en pause au survol).</span>
				</div>
				<form method="POST" action="?/motivationBannerPref" use:enhance>
					<div class="seg">
						<button type="submit" name="value" value="true" class:on={motivationBanner} onclick={() => (motivationBanner = true)}>Afficher</button>
						<button type="submit" name="value" value="false" class:on={!motivationBanner} onclick={() => (motivationBanner = false)}>Masquer</button>
					</div>
				</form>
			</div>

			<div class="opt">
				<div class="opt-t">
					<b>Effets saisonniers</b>
					<span class="hint">
						Surprises visuelles liées à la saison (neige à Noël…), réglées sur cet appareil.
						{activeSeasonal.length
							? `En ce moment : ${activeSeasonal.map((e) => e.label).join(' + ')}.`
							: 'Aucun effet actif en ce moment.'}
					</span>
				</div>
				{#if seasonalState.enabled}
					<button class="btn btn-ghost" onclick={() => setSeasonalEnabled(false)}>Désactiver</button>
				{:else}
					<button class="btn btn-primary" onclick={() => setSeasonalEnabled(true)}>Activer</button>
				{/if}
			</div>

			{#if konamiState.unlocked}
				<div class="opt-more">
					<p class="hint">🕹️ Mode forcé — débloqué par le code Konami. Outrepasse la détection par date, pratique pour tester (ou juste pour le fun).</p>
					<div class="seg seg-wrap">
						<button type="button" class:on={!seasonalState.forced} onclick={() => setForcedEffect(null)}>Auto (date)</button>
						{#each SEASONAL_EFFECTS as e (e.id)}
							<button type="button" class:on={seasonalState.forced === e.id} onclick={() => setForcedEffect(e.id)}>{e.label}</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{:else if tab === 'vues'}
		<section class="card block">
			<h3>Tickets &amp; chiffrage</h3>

			<div class="opt">
				<div class="opt-t">
					<b>Filtres</b>
					<span class="hint">Retrouver tes derniers filtres (état, projet, sprint, version) à chaque retour sur la page, sur tous tes espaces.</span>
				</div>
				<form method="POST" action="?/rememberTicketFiltersPref" use:enhance>
					<div class="seg">
						<button type="submit" name="value" value="true" class:on={rememberTicketFilters} onclick={() => (rememberTicketFilters = true)}>Garder</button>
						<button type="submit" name="value" value="false" class:on={!rememberTicketFilters} onclick={() => (rememberTicketFilters = false)}>Réinitialiser</button>
					</div>
				</form>
			</div>

			{#if rememberTicketFilters}
				<div class="opt opt-sub">
					<div class="opt-t">
						<b>Texte de recherche</b>
						<span class="hint">Garder aussi ce qui est tapé dans la recherche, ou seulement les filtres.</span>
					</div>
					<form method="POST" action="?/rememberTicketSearchPref" use:enhance>
						<div class="seg">
							<button type="submit" name="value" value="true" class:on={rememberTicketSearch} onclick={() => (rememberTicketSearch = true)}>Garder</button>
							<button type="submit" name="value" value="false" class:on={!rememberTicketSearch} onclick={() => (rememberTicketSearch = false)}>Ignorer</button>
						</div>
					</form>
				</div>
			{/if}

			<div class="opt">
				<div class="opt-t">
					<b>Détail par activité</b>
					<span class="hint">État par défaut du détail sous chaque ticket — il reste dépliable ticket par ticket le temps de la session.</span>
				</div>
				<form method="POST" action="?/compactActivityPref" use:enhance>
					<div class="seg">
						<button type="submit" name="value" value="true" class:on={compactTicketActivity} onclick={() => (compactTicketActivity = true)}>Masquer</button>
						<button type="submit" name="value" value="false" class:on={!compactTicketActivity} onclick={() => (compactTicketActivity = false)}>Afficher</button>
					</div>
				</form>
			</div>
		</section>

		<section class="card block">
			<h3>Synthèse</h3>

			<div class="opt">
				<div class="opt-t">
					<b>Répartition par activité</b>
					<span class="hint">Ordre des activités dans la synthèse par sprint/version.</span>
				</div>
				<form method="POST" action="?/sortActivitiesAlphaPref" use:enhance>
					<div class="seg">
						<button type="submit" name="value" value="false" class:on={!sortActivitiesAlpha} onclick={() => (sortActivitiesAlpha = false)}>Référentiels</button>
						<button type="submit" name="value" value="true" class:on={sortActivitiesAlpha} onclick={() => (sortActivitiesAlpha = true)}>Alphabétique</button>
					</div>
				</form>
			</div>
		</section>
	{/if}
</div>

<style>
	.settings {
		/* Un peu plus large qu'avant (680px) : les lignes de réglage sont sur deux colonnes, une
		   explication qui tenait sur une ligne en pleine largeur en prenait trois. */
		max-width: 780px;
	}
	/* L'onglet Badges est une galerie, pas un formulaire : la brider à 780 px laissait la moitié de
	   l'écran vide et forçait la grille à 4 colonnes alors qu'elle peut en tenir le double. Les
	   autres onglets gardent leur largeur de lecture. */
	.settings.wide {
		max-width: none;
	}
	/* Grille de badges : 170 px mini par carte, c'est la taille en dessous de laquelle la scène
	   sertie dans la monture cesse d'être lisible et ne ressemble plus qu'à une tache. */
	.badge-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 16px;
		margin-top: 14px;
	}
	/* Carte = bouton : elle ouvre la fiche du badge, donc elle doit être atteignable au clavier et
	   annoncée comme cliquable. D'où le reset des styles natifs de <button>. */
	.badge-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 12px 14px;
		border: 1px solid var(--border);
		border-radius: 14px;
		text-align: center;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}
	.badge-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}
	.badge-card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.badge-card b {
		margin-top: 4px;
		font-size: 14px;
	}
	.badge-tier {
		font-size: 12px;
		color: var(--text-mute);
	}
	.badge-bar {
		width: 100%;
		height: 5px;
		border-radius: 999px;
		background: var(--border);
		overflow: hidden;
	}
	.badge-bar i {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.badge-progress {
		font-size: 11px;
		color: var(--text-mute);
		line-height: 1.35;
	}
	.badge-card.locked .badge-tier {
		opacity: 0.75;
	}
	/* Ce que le badge mène à débloquer : discret tant que ce n'est pas acquis, à l'accent une fois
	   le palier franchi — c'est ce qui rend le badge utile à autre chose qu'à lui-même. */
	.badge-pet {
		font-size: 11px;
		color: var(--text-mute);
	}
	.badge-pet.got {
		color: var(--accent);
		font-weight: 500;
	}
	/* Compagnons : même trame que les badges, cartes plus basses — le sprite fait 64 px de large. */
	.pet-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 14px;
	}
	.pet-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: none;
		font: inherit;
		color: inherit;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}
	.pet-card:hover:not(:disabled) {
		border-color: var(--accent);
		transform: translateY(-2px);
	}
	.pet-card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.pet-card.on {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.pet-card:disabled {
		cursor: not-allowed;
	}
	.pet-card b {
		font-size: 13px;
	}
	.pet-species {
		font-size: 11.5px;
		color: var(--text-mute);
	}
	.pet-trait {
		font-size: 11px;
		color: var(--text-mute);
		line-height: 1.35;
	}
	/* Verrouillé : le dessin reste caché, comme un badge non décroché. Seuls le nom et la condition
	   sont lisibles — découvrir la bestiole fait partie de la récompense. */
	.pet-slot {
		display: grid;
		place-items: center;
		width: 64px;
		height: 80px;
		font-size: 24px;
		color: var(--text-mute);
		border: 1px dashed var(--border);
		border-radius: 10px;
	}
	/* La consigne d'obtention : discrète sur un badge déjà gagné, mise en avant sur un verrouillé —
	   c'est la seule chose qu'on y apprend, le dessin restant caché jusqu'au déblocage. */
	.badge-how {
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-mute);
		opacity: 0.75;
	}
	.badge-card.locked .badge-how {
		opacity: 1;
		color: var(--text);
	}

	.tabs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
		margin-bottom: 18px;
	}
	.tabs button {
		padding: 8px 18px;
		border-radius: 30px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.tabs button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
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

	/* --- Ligne de réglage ---
	   Un réglage = une ligne (libellé + explication à gauche, contrôle à droite), plusieurs lignes
	   par carte. Avant, chaque réglage occupait sa propre carte titre + paragraphe + segmented :
	   l'onglet Apparence devenait une liste verticale interminable pour 7 interrupteurs. */
	.opt {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 15px 0;
		border-top: 1px solid var(--border);
	}
	.opt:first-of-type {
		border-top: none;
		padding-top: 6px;
	}
	.opt-t {
		min-width: 0;
	}
	.opt-t b {
		display: block;
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 2px;
	}
	.opt .hint {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.45;
	}
	.opt > form,
	.opt > .seg,
	.opt > .btn {
		flex-shrink: 0;
	}
	/* Réglage qui n'existe que si celui du dessus est actif (ex. « garder aussi la recherche »). */
	.opt-sub {
		padding-left: 16px;
		border-left: 2px solid var(--border);
		margin-left: 2px;
	}
	/* Contrôle trop large pour la colonne de droite (nuancier, chips konami) : pleine largeur sous
	   les lignes, séparé par le même filet. */
	.opt-more {
		border-top: 1px solid var(--border);
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
	}
	/* Sous ~560px, libellé et contrôle ne cohabitent plus sur une ligne sans écraser le segmented. */
	@media (max-width: 560px) {
		.opt {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
		}
	}
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		margin-bottom: 16px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
	}
	.row b {
		display: block;
		font-size: 14px;
	}
	.row .sub {
		font-size: 12.5px;
		color: var(--text-mute);
	}
	.prefs {
		margin-top: 16px;
		border-top: 1px solid var(--border);
		padding-top: 14px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pref-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pref-group.off {
		opacity: 0.5;
	}
	.pref-group-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-mute);
	}
	.pref {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.pref.master {
		font-weight: 600;
		color: var(--text);
		margin-bottom: -2px;
	}
	.pref input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}
	.when {
		margin-left: 6px;
		font-size: 12px;
		color: var(--text-mute);
	}
	/* Créneaux de relance, alignés sous le libellé du rappel (26px = case + gap du .pref). */
	.slots {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: -2px 0 2px 26px;
	}
	.slots.off {
		opacity: 0.5;
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 12px;
		color: var(--text-soft);
		cursor: pointer;
	}
	.slot input {
		width: 13px;
		height: 13px;
		accent-color: var(--accent);
	}
	.slot:has(input:checked) {
		border-color: var(--accent);
		color: var(--text);
	}
	.test {
		align-self: flex-start;
		margin-top: 4px;
	}
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: 30px;
		background: var(--surface-sunk);
		border: 1px solid var(--border);
	}
	.seg button {
		padding: 7px 16px;
		border-radius: 30px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-mute);
	}
	.seg button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	/* Le sélecteur d'effet forcé (mode konami) a trop d'options à labels longs pour tenir sur
	   une ligne façon "segmented control" : on le laisse retomber en chips sur plusieurs lignes. */
	.seg-wrap {
		flex-wrap: wrap;
		border-radius: 14px;
	}
	.seg-wrap button {
		border-radius: 20px;
	}
</style>
