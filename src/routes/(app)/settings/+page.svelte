<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
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
	import AccentPicker from '$lib/components/AccentPicker.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';

	let { data, form } = $props();

	let supported = $state(true);
	let subscribed = $state(false);
	let busy = $state(false);
	let flash = $state('');
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
			items: [{ key: 'supportDuty', label: 'Mon tour de support commence', when: '9h00' }]
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

	function note(msg: string) {
		flash = msg;
		setTimeout(() => (flash = ''), 2500);
	}

	async function enable() {
		busy = true;
		const ok = await subscribePush(data.vapidPublicKey);
		busy = false;
		subscribed = ok;
		if (ok) {
			prefs.enabled = true;
			await saveNotifPrefs(prefs);
			note('Notifications activées ✓');
		} else {
			note('Permission refusée ou non disponible.');
		}
	}
	async function disable() {
		busy = true;
		await unsubscribePush();
		busy = false;
		subscribed = false;
		note('Notifications désactivées sur cet appareil.');
	}
	async function savePref() {
		await saveNotifPrefs(prefs);
		note('Préférences enregistrées ✓');
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
		note(sent > 0 ? 'Notification de test envoyée.' : 'Aucun appareil abonné — active les notifications ci-dessus.');
	}
	function pickTheme(p: ThemePref) {
		themePref = p;
		setTheme(p);
	}

	const TABS = [
		{ key: 'notifications', label: 'Notifications' },
		{ key: 'securite', label: 'Sécurité' },
		{ key: 'apparence', label: 'Apparence' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	let tab = $state<Tab>(form?.pwOk || form?.pwError ? 'securite' : form?.accentPrefOk ? 'apparence' : 'notifications');
</script>

<div class="topbar">
	<h1>Réglages<small>Préférences personnelles</small></h1>
	<div class="spacer"></div>
	{#if flash}<span class="saved">{flash}</span>{/if}
</div>

<div class="content settings">
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button type="button" class:on={tab === t.key} onclick={() => (tab = t.key)}>{t.label}</button>
		{/each}
	</div>

	{#if tab === 'notifications'}
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
														disabled={!prefs.enabled}
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
			{#if form?.pwOk}<div class="flash ok">Mot de passe changé ✓</div>{/if}
			{#if form?.pwError}<div class="flash error">{form.pwError}</div>{/if}
			<form method="POST" action="?/changePassword" use:enhance>
				<PasswordField id="cpw" name="currentPassword" label="Mot de passe actuel" autocomplete="current-password" required />
				<PasswordField id="npw" name="password" label="Nouveau mot de passe" placeholder="8 caractères minimum" autocomplete="new-password" required />
				<PasswordField id="ncf" name="confirm" label="Confirmer le nouveau mot de passe" autocomplete="new-password" required />
				<button class="btn btn-primary" type="submit">Changer le mot de passe</button>
			</form>
		</section>
	{:else if tab === 'apparence'}
		<section class="card block">
			<h3>Thème</h3>
			<p class="hint">Apparence de l’interface. « Système » suit le réglage de ton appareil.</p>
			<div class="seg">
				<button type="button" class:on={themePref === 'system'} onclick={() => pickTheme('system')}>Système</button>
				<button type="button" class:on={themePref === 'light'} onclick={() => pickTheme('light')}>Clair</button>
				<button type="button" class:on={themePref === 'dark'} onclick={() => pickTheme('dark')}>Sombre</button>
			</div>
		</section>

		<section class="card block">
			<h3>Couleur d’accent</h3>
			<p class="hint">Par défaut, suit la couleur choisie par l’admin de l’espace. Force ta propre couleur (ou le mode RGB) si tu préfères, sur tous les espaces.</p>
			{#if form?.accentPrefOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/accentPref" use:enhance>
				<div class="seg">
					<button type="button" class:on={!accentOverride} onclick={() => (accentOverride = false)}>Suivre l’espace</button>
					<button type="button" class:on={accentOverride} onclick={() => (accentOverride = true)}>Personnaliser</button>
				</div>
				{#if accentOverride}
					<div style="margin-top:14px;">
						<AccentPicker bind:color={accentColor} bind:rgbMode={accentRgb} bind:discoMode={accentDisco} presets={PRESETS} />
					</div>
				{/if}
				<input
					type="hidden"
					name="mode"
					value={!accentOverride ? 'WORKSPACE' : accentRgb ? 'RGB' : accentDisco ? 'DISCO' : 'CUSTOM'}
				/>
				<input type="hidden" name="color" value={accentColor} />
				<button class="btn btn-primary" type="submit" style="margin-top:14px;">Enregistrer</button>
			</form>
		</section>

		<section class="card block">
			<h3>Répartition par activité</h3>
			<p class="hint">Ordre des activités dans la synthèse par sprint/version. Par défaut, suit l'ordre défini dans les référentiels de l'espace.</p>
			{#if form?.sortActivitiesAlphaOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/sortActivitiesAlphaPref" use:enhance>
				<div class="seg">
					<button type="submit" name="value" value="false" class:on={!sortActivitiesAlpha} onclick={() => (sortActivitiesAlpha = false)}>Ordre des référentiels</button>
					<button type="submit" name="value" value="true" class:on={sortActivitiesAlpha} onclick={() => (sortActivitiesAlpha = true)}>Alphabétique</button>
				</div>
			</form>
		</section>

		<section class="card block">
			<h3>Filtres tickets</h3>
			<p class="hint">Sur la vue Tickets &amp; chiffrage, retrouve tes derniers filtres (état, projet, sprint, version, recherche) à chaque retour sur la page, sur tous tes espaces. Désactive pour repartir sans filtre à chaque fois.</p>
			{#if form?.rememberTicketFiltersOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/rememberTicketFiltersPref" use:enhance>
				<div class="seg">
					<button type="submit" name="value" value="true" class:on={rememberTicketFilters} onclick={() => (rememberTicketFilters = true)}>Garder mes filtres</button>
					<button type="submit" name="value" value="false" class:on={!rememberTicketFilters} onclick={() => (rememberTicketFilters = false)}>Réinitialiser à chaque fois</button>
				</div>
			</form>

			{#if rememberTicketFilters}
				<p class="hint" style="margin-top:14px;">Inclure aussi le texte tapé dans la recherche, ou ne garder que l'état/projet/sprint/version.</p>
				{#if form?.rememberTicketSearchOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
				<form method="POST" action="?/rememberTicketSearchPref" use:enhance>
					<div class="seg">
						<button type="submit" name="value" value="true" class:on={rememberTicketSearch} onclick={() => (rememberTicketSearch = true)}>Garder aussi la recherche</button>
						<button type="submit" name="value" value="false" class:on={!rememberTicketSearch} onclick={() => (rememberTicketSearch = false)}>Sans la recherche</button>
					</div>
				</form>
			{/if}
		</section>

		<section class="card block">
			<h3>Détail par activité</h3>
			<p class="hint">Sur la vue Tickets &amp; chiffrage (tableau), chaque ticket peut afficher le détail par activité en dessous. Choisis l'état par défaut à l'ouverture — chaque ticket reste dépliable/repliable individuellement le temps de la session.</p>
			{#if form?.compactActivityOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/compactActivityPref" use:enhance>
				<div class="seg">
					<button type="submit" name="value" value="true" class:on={compactTicketActivity} onclick={() => (compactTicketActivity = true)}>Masquer par défaut</button>
					<button type="submit" name="value" value="false" class:on={!compactTicketActivity} onclick={() => (compactTicketActivity = false)}>Afficher par défaut</button>
				</div>
			</form>
		</section>

		<section class="card block">
			<h3>Bandeau motivation</h3>
			<p class="hint">Une citation motivante en haut de chaque page, renouvelée toutes les 30 secondes à partir d'une sélection récupérée chaque jour. Le défilement se met en pause au survol.</p>
			{#if form?.motivationBannerOk}<div class="flash ok">Préférence enregistrée ✓</div>{/if}
			<form method="POST" action="?/motivationBannerPref" use:enhance>
				<div class="seg">
					<button type="submit" name="value" value="true" class:on={motivationBanner} onclick={() => (motivationBanner = true)}>Afficher</button>
					<button type="submit" name="value" value="false" class:on={!motivationBanner} onclick={() => (motivationBanner = false)}>Masquer</button>
				</div>
			</form>
		</section>

		<section class="card block">
			<h3>Effets saisonniers</h3>
			<p class="hint">Petites surprises visuelles liées aux périodes de l'année (ex. neige à Noël). Désactivable si tu préfères une interface sobre.</p>
			<div class="row">
				<div>
					<b>{activeSeasonal.length ? activeSeasonal.map((e) => e.label).join(' + ') : 'Aucun effet actif en ce moment'}</b>
					<span class="sub">{seasonalState.enabled ? 'Activés' : 'Désactivés'} sur cet appareil</span>
				</div>
				{#if seasonalState.enabled}
					<button class="btn btn-ghost" onclick={() => setSeasonalEnabled(false)}>Désactiver</button>
				{:else}
					<button class="btn btn-primary" onclick={() => setSeasonalEnabled(true)}>Activer</button>
				{/if}
			</div>

			{#if konamiState.unlocked}
				<div class="konami-force">
					<p class="hint" style="margin:16px 0 8px;">🕹️ Mode forcé — débloqué par le code Konami. Outrepasse la détection par date, pratique pour tester (ou juste pour le fun).</p>
					<div class="seg seg-wrap">
						<button type="button" class:on={!seasonalState.forced} onclick={() => setForcedEffect(null)}>Auto (date)</button>
						{#each SEASONAL_EFFECTS as e (e.id)}
							<button type="button" class:on={seasonalState.forced === e.id} onclick={() => setForcedEffect(e.id)}>{e.label}</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.settings {
		max-width: 680px;
	}
	.tabs {
		display: inline-flex;
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
	.hint {
		color: var(--text-mute);
		font-size: 13px;
		margin-bottom: 16px;
	}
	.saved {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-tint-2);
		padding: 6px 12px;
		border-radius: 30px;
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
