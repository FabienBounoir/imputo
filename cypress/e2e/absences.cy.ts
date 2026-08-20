describe('absences : déclaration puis validation', () => {
	it("déclare une absence, elle apparaît en attente de validation, puis se valide", () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/absences');
			cy.clickReliably(() => cy.contains('button', '+ Déclarer une absence'), '.wizard-modal');

			// Le créateur d'un espace en est ADMIN, donc canManageOthers : le wizard a 3 étapes
			// (Pour qui / Dates / Type), pas 2. Les valeurs par défaut de chacune sont déjà valides
			// (moi-même, aujourd'hui -> aujourd'hui, congé prévisionnel), on ne fait qu'avancer.
			cy.contains('.wizard-modal h3', 'Déclarer une absence').should('be.visible');
			cy.get('.wizard-modal').contains('button', 'Suivant →').click();
			cy.get('.wizard-modal').contains('button', 'Suivant →').click();

			// Étape "Type" : le type par défaut (congé prévisionnel) reste sélectionné.
			// Scopé au modal : "+ Déclarer" est aussi une sous-chaîne du bouton déclencheur
			// "+ Déclarer une absence" resté dans le DOM derrière le backdrop.
			cy.get('.wizard-modal').contains('button', '+ Déclarer').click();

			cy.contains('.wizard-modal', 'Déclarer une absence').should('not.exist');
			cy.contains('h3', 'À valider').should('be.visible');
			cy.contains('.abs-item', 'Test E2E').should('be.visible');

			cy.contains('.abs-item', 'Test E2E').contains('button', 'Valider').click();

			cy.contains('h3', 'À valider').should('not.exist');
		});
	});
});
