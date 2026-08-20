const gotoSsp = () => cy.gotoRefSection('Codes SSP', 'Rechercher un code ou un libellé…');

describe('admin : gestion des référentiels', () => {
	it('crée puis archive une catégorie', () => {
		const label = `Cat E2E ${Date.now()}`;

		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.gotoRefSection('Catégories', 'Rechercher une catégorie…');
			// Placeholder distinctif : l'espace a des catégories seedées par défaut, dont les champs
			// de renommage (name="label" aussi) précèdent ce formulaire de création dans le DOM.
			cy.openRefAddForm('input[placeholder="Nouvelle catégorie…"]');

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

	// Trois régressions constatées sur les codes SSP, toutes silencieuses côté utilisateur.
	it('un refus du serveur est affiché et le champ revient à la valeur stockée', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			gotoSsp();
			cy.openRefAddForm('form.ssp-add input[name=code]');
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
			cy.get('.flash.error').should('contain.text', 'déjà');
			cy.get('form.ssp-form input[name=code]').eq(1).should('have.value', 'MMM-2');
		});
	});

	it('un budget SSP accepte deux décimales', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			gotoSsp();
			cy.openRefAddForm('form.ssp-add input[name=code]');
			cy.get('form.ssp-add input[name=code]').type('BUD-1');
			cy.get('form.ssp-add input[name=label]').type('Budget');
			cy.get('form.ssp-add button[type=submit]').click();
			// step="0.25" rendait le champ invalide : le navigateur bloquait requestSubmit() et rien
			// n'était enregistré, sans le moindre signal.
			cy.get('form.ssp-form input[name=budgetDays]').clear().type('213.81').blur();
			cy.wait(1500);
			cy.reload();
			gotoSsp();
			cy.get('form.ssp-form input[name=budgetDays]').should('have.value', '213.81');
		});
	});

	it("éditer un champ d'une ligne SSP ne ressuscite pas les deux autres", () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			gotoSsp();
			cy.openRefAddForm('form.ssp-add input[name=code]');
			cy.get('form.ssp-add input[name=code]').type('REG-1');
			cy.get('form.ssp-add input[name=label]').type('Avant');
			cy.get('form.ssp-add input[name=budgetDays]').type('10');
			cy.get('form.ssp-add button[type=submit]').click();

			cy.get('form.ssp-form input[name=code]').clear().type('REG-2').blur();
			cy.get('form.ssp-form input[name=code]').should('have.value', 'REG-2');
			// L'enregistrement doit être retombé avant d'attaquer le champ suivant : sinon
			// l'invalidateAll réécrit l'input pendant que Cypress y tape, et brouille la saisie.
			cy.wait(1500);

			// Le form.reset() par défaut de `update()` remettait chaque champ à son attribut `value`
			// d'origine (REG-1 / 10) — attribut que Svelte n'écrit jamais, il n'assigne que la
			// propriété. La donnée serveur n'ayant pas changé, rien ne réécrivait derrière : la
			// ligne affichait l'ancien code, et l'enregistrement suivant le renvoyait en base.
			cy.get('form.ssp-form input[name=label]').clear().type('Après').blur();
			cy.get('form.ssp-form input[name=code]').should('have.value', 'REG-2');
			cy.get('form.ssp-form input[name=budgetDays]').should('have.value', '10');

			cy.wait(1500);
			cy.reload();
			gotoSsp();
			cy.get('form.ssp-form input[name=code]').should('have.value', 'REG-2');
			cy.get('form.ssp-form input[name=label]').should('have.value', 'Après');
			cy.get('form.ssp-form input[name=budgetDays]').should('have.value', '10');
		});
	});
});
