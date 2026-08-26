describe('auth', () => {
	it('crée un espace, redirige vers /imputation, puis permet de se reconnecter', () => {
		cy.registerAndLogin().then(({ email, password }) => {
			cy.get('form[action="/logout"] button').click();
			cy.location('pathname').should('eq', '/login');

			cy.typeReliably('#em', email);
			cy.typeReliably('#pw', 'wrong-password');
			cy.get('button[type=submit]').click();
			// L'erreur de login est un toast fixe (ModalErrorToast), plus le `.flash.error` en flux.
			cy.contains('.modal-error-toast', /.+/);

			cy.typeReliably('#pw', password);
			cy.get('button[type=submit]').click();
			cy.location('pathname').should('eq', '/imputation');
		});
	});
});
