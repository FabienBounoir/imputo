describe('permissions : un rôle USER ne peut pas accéder à /admin', () => {
	it("invite un membre USER, active son compte, vérifie qu'il est redirigé hors de /admin", () => {
		const rnd = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		const memberEmail = `e2e-member-${rnd}@acme.test`;
		const memberPassword = 'password123';

		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.get('#dn').type('Membre USER E2E');
			cy.get('#em').type(memberEmail);
			// Le select #ro a déjà "USER" (Membre) comme première option/valeur par défaut.
			cy.contains('button', "Générer l'invitation").click();

			cy.get('.invite-msg pre')
				.invoke('text')
				.then((body) => {
					const match = body.match(/\/invite\/\S+/);
					expect(match, 'lien d\'invitation trouvé dans le message').to.not.be.null;
					const path = match![0];

					cy.visit(path);
					cy.contains('Bienvenue').should('be.visible');
					cy.get('#pw').type(memberPassword);
					cy.get('#cf').type(memberPassword);
					cy.contains('button', 'Activer mon compte').click();

					// L'activation crée directement une session pour ce nouveau membre USER.
					cy.location('pathname').should('eq', '/imputation');

					cy.visit('/admin');
					cy.location('pathname').should('eq', '/imputation');
				});
		});
	});
});
