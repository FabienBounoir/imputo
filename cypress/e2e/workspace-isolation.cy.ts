describe('isolation multi-espace (UI)', () => {
	it("un ticket créé dans l'espace A n'apparaît pas dans l'espace B", () => {
		const key = `ISO-${Date.now()}`;

		cy.registerAndLogin({ workspaceName: 'Espace Isolation A' }).then(() => {
			cy.visit('/tickets');
			cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#key');
			cy.get('#key').type(key);
			cy.get('#title').type('Ticket privé espace A');
			cy.contains('.card.create button[type=submit]', 'Créer').click();
			cy.contains(key).should('exist');

			cy.get('form[action="/logout"] button').click();
			cy.location('pathname').should('eq', '/login');
		});

		cy.registerAndLogin({ workspaceName: 'Espace Isolation B' }).then(() => {
			cy.visit('/tickets');
			cy.contains(key).should('not.exist');
		});
	});
});
