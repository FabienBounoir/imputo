/**
 * Action Svelte qui accroche un panneau au viewport VISIBLE plutôt qu'au viewport de mise en page.
 *
 * Pourquoi : quand le clavier virtuel s'ouvre, ni `100vh` ni `100dvh` ne rétrécissent sur iOS — la
 * moitié basse d'une modale se retrouve alors cachée derrière le clavier, y compris sa liste de
 * résultats. Seul `window.visualViewport` connaît la zone réellement visible.
 *
 * Pose deux variables CSS sur le nœud :
 *   --vv-height  hauteur du viewport visible
 *   --vv-top     son décalage vertical (iOS fait défiler la page sous le clavier au lieu de la
 *                redimensionner : sans ce décalage, la feuille glisserait hors de l'écran)
 *
 * Navigateur sans `visualViewport` : rien n'est posé, et le CSS retombe sur ses valeurs de repli
 * (`100dvh`) — le comportement actuel, jamais pire.
 */
export function visualViewportFit(node: HTMLElement) {
	const vv = typeof window !== 'undefined' ? window.visualViewport : null;
	if (!vv) return {};

	const write = () => {
		node.style.setProperty('--vv-height', `${vv.height}px`);
		node.style.setProperty('--vv-top', `${vv.offsetTop}px`);
	};

	// rAF : sur iOS, resize et scroll partent en rafale pendant l'animation d'ouverture du clavier.
	// Sans ça, on repeint la feuille à chaque événement pour rien. Uniquement pour les MISES À JOUR :
	// la première écriture est synchrone, sinon rien ne serait posé tant que l'onglet reste en
	// arrière-plan (rAF n'y tourne pas) et la feuille s'ouvrirait sans dimensions.
	let frame = 0;
	const apply = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(write);
	};

	write();
	vv.addEventListener('resize', apply);
	vv.addEventListener('scroll', apply);
	return {
		destroy() {
			cancelAnimationFrame(frame);
			vv.removeEventListener('resize', apply);
			vv.removeEventListener('scroll', apply);
		}
	};
}
