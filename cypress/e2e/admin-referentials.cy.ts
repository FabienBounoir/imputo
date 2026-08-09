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
});
