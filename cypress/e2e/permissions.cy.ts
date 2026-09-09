describe('permissions : un rôle USER ne peut pas accéder à /admin', () => {
	it("invite un membre USER, active son compte, vérifie qu'il est redirigé hors de /admin", () => {
		const rnd = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		const memberEmail = `e2e-member-${rnd}@acme.test`;
		const memberPassword = 'password123';

		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('.tabs button', 'Membres'), '#dn');
			cy.get('#dn').type('Membre USER E2E');
			cy.get('#em').type(memberEmail);
			// Le select #ro a déjà "USER" (Membre) comme première option/valeur par défaut.
			cy.generateInviteLink().then((path) => {
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
