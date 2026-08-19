describe('admin : gestion des référentiels', () => {
	it('crée puis archive une catégorie', () => {
		const label = `Cat E2E ${Date.now()}`;

		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			// Placeholder distinctif : l'espace a des catégories seedées par défaut, dont les champs
			// de renommage (name="label" aussi) précèdent ce formulaire de création dans le DOM.
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'input[placeholder="Nouvelle catégorie…"]');

			cy.get('input[placeholder="Nouvelle catégorie…"]').type(label);
			cy.get('input[placeholder="Nouvelle catégorie…"]').closest('form').find('button[type=submit]').click();

			// Le libellé vit dans la propriété `value` d'un <input> (renommage inline), pas dans le
			// textContent ni l'attribut HTML value (Svelte l'assigne en propriété DOM) : ni
			// `cy.contains` ni un sélecteur CSS `[value=...]` ne peuvent la trouver.
			const item = () =>
				cy
					.get('input.ref-name')
					.filter((_, el) => (el as HTMLInputElement).value === label)
					.closest('.ref-item');
			item().should('exist');
			item().contains('button', 'Archiver').click();
			item().should('have.class', 'archived');
			item().contains('button', 'Restaurer').should('exist');
		});
	});

	// Deux régressions constatées sur les codes SSP, toutes deux silencieuses côté utilisateur.
	it('un refus du serveur est affiché et le champ revient à la valeur stockée', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'form.ssp-add input[name=code]');
			[
				['AAA-1', 'Alpha'],
				['MMM-2', 'Mike']
			].forEach(([c, l]) => {
				cy.get('form.ssp-add input[name=code]').clear().type(c);
				cy.get('form.ssp-add input[name=label]').clear().type(l);
				cy.get('form.ssp-add button[type=submit]').click();
			});
			// Code déjà pris : le service refuse. Sans bandeau ni remise à zéro du champ, l'écran
			// affichait une valeur qui n'existait pas en base jusqu'au prochain changement de page.
			cy.get('form.ssp-form input[name=code]').eq(1).clear().type('AAA-1').blur();
			cy.get('.ref-error').should('contain.text', 'déjà');
			cy.get('form.ssp-form input[name=code]').eq(1).should('have.value', 'MMM-2');
		});
	});

	it('un budget SSP accepte deux décimales', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'form.ssp-add input[name=code]');
			cy.get('form.ssp-add input[name=code]').type('BUD-1');
			cy.get('form.ssp-add input[name=label]').type('Budget');
			cy.get('form.ssp-add button[type=submit]').click();
			// step="0.25" rendait le champ invalide : le navigateur bloquait requestSubmit() et rien
			// n'était enregistré, sans le moindre signal.
			cy.get('form.ssp-form input[name=budgetDays]').clear().type('213.81').blur();
			cy.wait(1500);
			cy.reload();
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'form.ssp-add input[name=code]');
			cy.get('form.ssp-form input[name=budgetDays]').should('have.value', '213.81');
		});
	});
});
