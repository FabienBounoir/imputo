<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { driver, type Driver } from 'driver.js';
	import 'driver.js/dist/driver.css';
	import { TOUR_STEPS, tourStepsFor, type TourRole } from '$lib/tour/steps';
	import { tourState, tourTrigger, startTour, stopTour } from '$lib/tour/tourState.svelte';

	let {
		role,
		moodEnabled,
		wrappedAvailable,
		tutorialSeenAt
	}: {
		role: TourRole | null;
		moodEnabled: boolean;
		wrappedAvailable: boolean;
		tutorialSeenAt: Date | null;
	} = $props();

	let driverObj: Driver | null = null;

	function finish() {
		driverObj?.destroy();
		driverObj = null;
		stopTour();
		if (browser) fetch('/tour', { method: 'POST' }).catch(() => {});
	}

	async function showStep() {
		const ids = tourState.steps;
		if (!ids) return;
		const step = TOUR_STEPS.find((s) => s.id === ids[tourState.index]);
		if (!step) return finish();

		if (page.url.pathname !== step.path) await goto(step.path);
		await tick();

		driverObj?.destroy();
		const isLast = tourState.index === ids.length - 1;
		driverObj = driver({
			allowClose: true,
			overlayOpacity: 0.55,
			stagePadding: 6,
			stageRadius: 10,
			popoverClass: 'imputo-tour-popover',
			nextBtnText: isLast ? 'Terminer' : 'Suivant',
			prevBtnText: 'Précédent',
			onCloseClick: finish,
			onNextClick: () => {
				if (isLast) return finish();
				tourState.index += 1;
				showStep();
			},
			onPrevClick: () => {
				if (tourState.index === 0) return;
				tourState.index -= 1;
				showStep();
			}
		});
		// highlight() ignore la config ci-dessus pour showButtons/progressText (bug connu de driver.js :
		// il force showButtons=[] par défaut) — il faut les repasser explicitement à chaque étape.
		driverObj.highlight({
			element: step.element,
			popover: {
				title: step.title,
				description: step.description,
				showButtons: ['next', 'previous', 'close'],
				disableButtons: tourState.index === 0 ? ['previous'] : [],
				showProgress: true,
				progressText: `Étape ${tourState.index + 1} / ${ids.length}`
			}
		});
	}

	function replay() {
		const ids = tourStepsFor(role, { moodEnabled, wrappedAvailable }).map((s) => s.id);
		if (ids.length === 0) return;
		startTour(ids);
		showStep();
	}

	// Navigation manuelle (clic sur un lien du menu) pendant le tour : l'élément visé n'existe
	// plus sur la nouvelle page, le popover resterait affiché "dans le vide" sans ce garde-fou.
	// Ne doit dépendre QUE de l'URL — le reste est lu en untrack() pour ne pas se redéclencher sur
	// le tourState.index qu'on vient nous-mêmes d'incrémenter (avant même que le goto() associé résolve).
	$effect(() => {
		const path = page.url.pathname;
		untrack(() => {
			const ids = tourState.steps;
			if (!ids || !driverObj) return;
			const step = TOUR_STEPS.find((s) => s.id === ids[tourState.index]);
			if (step && path !== step.path) finish();
		});
	});

	// Déclenché depuis Réglages ("Revoir le tutoriel"), quelle que soit la page où se trouve ce bouton.
	$effect(() => {
		if (tourTrigger.requested) {
			tourTrigger.requested = false;
			replay();
		}
	});

	onMount(() => {
		if (!tutorialSeenAt) replay();
	});
</script>
