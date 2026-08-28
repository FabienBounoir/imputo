/** État en mémoire du tour actif. Volontairement pas persisté (localStorage) : un F5 en plein
 *  tour l'interrompt, ce qui est acceptable pour une visite guidée non bloquante. */
export const tourState = $state<{ steps: string[] | null; index: number }>({
	steps: null,
	index: 0
});

/** Demande de (re)lancement, posée depuis n'importe quelle page (ex. bouton Réglages) — TourHost
 *  (monté une fois dans le layout, seul à connaître rôle et flags du workspace) l'écoute et calcule
 *  lui-même la liste d'étapes adaptée. */
export const tourTrigger = $state<{ requested: boolean }>({ requested: false });

export function requestTourReplay() {
	tourTrigger.requested = true;
}

export function startTour(stepIds: string[]) {
	tourState.steps = stepIds;
	tourState.index = 0;
}

export function stopTour() {
	tourState.steps = null;
	tourState.index = 0;
}
