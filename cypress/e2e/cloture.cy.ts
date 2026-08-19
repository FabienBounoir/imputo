describe('clôture mensuelle', () => {
	it('crée un code SSP, ouvre une passe, saisit un complément et intègre', () => {
		const code = `E2E-${Date.now()}`;

		// Ancré sur la classe du formulaire, ni sur un placeholder (les codes d'exemple ont déjà
		// changé deux fois avec l'anonymisation) ni sur un .filter() (chaîne non rejouable : le
		// moindre re-rendu pendant la frappe détache le sujet au lieu de laisser Cypress réessayer).

		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			// Toujours passer par le clic d'onglet : `?tab=referentiels` + submit immédiat perd
			// l'onglet (repli natif avant hydratation), cf. admin-referentials.cy.ts.
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'form.ssp-add input[name=code]');

			cy.get('form.ssp-add input[name=code]').type(code);
			cy.get('form.ssp-add input[name=label]').type('Libellé E2E');
			cy.get('form.ssp-add button[type=submit]').click();

			// Le code vit dans la propriété `value` d'un <input> (édition inline) : ni cy.contains ni
			// [value=...] ne le trouvent. Le filtrage se fait DANS le should et pas via .filter() :
			// une chaîne contenant .filter() n'est pas rejouable, donc si la page se re-rend pendant
			// l'attente (fin d'hydratation, POST natif), Cypress échoue au lieu de réessayer.
			cy.get('input.ssp-code').should(($els) => {
				expect([...$els].some((el) => (el as HTMLInputElement).value === code)).to.equal(true);
			});

			cy.visit('/admin/cloture');
			// clickReliably (et pas .click()) : le formulaire part en POST natif tant que la page
			// n'est pas hydratée, et la grille qui suit n'est pilotée QUE par du JS — taper dedans
			// trop tôt fait écrire une valeur que l'hydratation réécrase aussitôt.
			cy.clickReliably(() => cy.contains('button', 'Ouvrir la clôture'), 'form.add-ssp');

			// Aucune imputation sur ce nouvel espace : par défaut la clôture n'affiche donc aucune
			// colonne. On ajoute celle du code créé plus haut pour pouvoir rattraper dessus.
			cy.get('form.add-ssp select').select(0);
			cy.get('form.add-ssp button[type=submit]').click();
			cy.get('input.complement-input').should('exist');

			// Aucune imputation sur ce nouvel espace : le prévu est entièrement à ventiler, et le
			// complément saisi doit le réduire d'autant.
			cy.typeReliably('input.complement-input', '3');
			cy.get('input.complement-input').blur();

			// Sélecteur direct plutôt que .contains().closest().within() : même raison que plus haut,
			// une chaîne de navigation DOM n'est pas rejouable si la page se re-rend.
			cy.get('.table-integration tbody').should('contain.text', '3');

			cy.clickReliably(() => cy.contains('button', 'Intégrer GPS'), '.cd-backdrop');
			cy.contains('button', 'Confirmer').click();

			cy.contains('Passe 1 intégrée').should('exist');
			cy.contains('button', 'Intégrer GPS').should('not.exist');
			cy.get('.table-gap').should('exist');

			// Ouvrir une passe doit basculer dessus, pas laisser l'écran sur la précédente : le load
			// ne le fait que si l'URL ne pinne pas de `seq`, d'où la redirection côté action.
			cy.clickReliably(() => cy.contains('button', 'Nouvelle passe'), '.cd-backdrop');
			cy.contains('button', 'Confirmer').click();

			cy.contains('Passe 1 intégrée').should('not.exist');
			cy.contains('button', 'Intégrer GPS').should('exist');
			cy.get('select[aria-label=Passe]').should('have.value', '2');
			// Le complément de la passe 1 est recopié dans la 2.
			cy.get('input.complement-input').should('have.value', '3');
		});
	});
});
