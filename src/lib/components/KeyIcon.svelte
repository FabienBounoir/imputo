<script module lang="ts">
	// Icônes de touches clavier pour les pastilles <kbd>, dessinées plutôt qu'en glyphes (⇧ ↑ ↓ ↵ ⇥) :
	// ces caractères manquent dans les polices monospace des pastilles et retombent sur une police
	// système plus fine et mal alignée. Échap et les lettres restent en texte (Échap essayé en symbole
	// ⎋ : il se lisait comme « actualiser »).
	const ICONS = {
		shift: { label: 'Maj', d: 'M9 18v-6H5l7-7 7 7h-4v6H9z' },
		up: { label: 'Haut', d: 'M12 19V5M5 12l7-7 7 7' },
		down: { label: 'Bas', d: 'M12 5v14M19 12l-7 7-7-7' },
		enter: { label: 'Entrée', d: 'M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4' },
		tab: { label: 'Tab', d: 'M3 12h14M11 6l6 6-6 6M21 5v14' },
		tabBack: { label: 'Tab', d: 'M3 19V5M13 6l-6 6 6 6M7 12h14' }
	};
	export type KeyName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name }: { name: KeyName } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2.4"
	stroke-linecap="round"
	stroke-linejoin="round"
	role="img"
	aria-label={ICONS[name].label}><path d={ICONS[name].d} /></svg
>

<style>
	/* En em : suit la taille de police de la pastille qui l'accueille (badge de bouton, pied de palette,
	   texte d'aide). vertical-align ne sert que dans un <kbd> en ligne ; ignoré dans une pastille flex. */
	svg {
		width: 1.1em;
		height: 1.1em;
		flex-shrink: 0;
		vertical-align: -0.2em;
	}
</style>
