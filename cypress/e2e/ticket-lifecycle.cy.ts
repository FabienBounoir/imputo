describe('cycle de vie ticket -> imputation', () => {
	it('crée un ticket, impute des heures dessus, et ça persiste après rechargement', () => {
		const key = `E2E-${Date.now()}`;

		cy.registerAndLogin().then(() => {
			cy.visit('/tickets');
			cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#key');
			cy.get('#key').type(key);
			cy.get('#title').type('Ticket créé par le test E2E');
			cy.contains('.card.create button[type=submit]', 'Créer').click();

			// Le formulaire se ferme (use:enhance) et le ticket apparaît dans la liste.
			cy.contains('.card.create', 'Créer').should('not.exist');
			cy.contains(key).should('exist');

			cy.visit('/imputation');
			cy.clickReliably(() => cy.get('.tp-trigger'), '.tp-search');
			cy.get('.tp-search').type(key);
			cy.contains('.tp-item', key).click();
			cy.contains('.addrow button', 'Ajouter').click();

			// N'importe quel jour ouvré affiché (pas forcément "aujourd'hui" : un week-end n'a pas de
			// colonne dans la grille, qui n'affiche que les jours ouvrés de la période).
			cy.contains('tr', key).find('td.day .cell').first().click();
			cy.contains('tr', key).find('td.sum').should('contain', '0.25');

			// Round-trip serveur : après rechargement, la valeur doit persister (pas juste optimiste).
			cy.reload();
			cy.contains('tr', key).find('td.sum').should('contain', '0.25');
		});
	});
});
