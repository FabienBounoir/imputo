// Dates fixes (comme les tests d'intégration absences.test.ts) : lundi→mercredi d'une semaine
// sans jour férié FR, pour ne jamais dépendre du jour d'exécution du test.
const MONDAY = '2026-06-22';
const WEDNESDAY = '2026-06-24';

function openDeclareWizard() {
	cy.visit('/absences');
	cy.clickReliably(() => cy.contains('button', '+ Déclarer une absence'), '.wizard-modal');
}

/** Étape "Dates" du wizard (déjà la première étape pour un admin sans membre externe). */
function fillDatesAndNext(start: string, end: string) {
	cy.get('#startDate').clear().type(start).should('have.value', start);
	cy.get('#endDate').clear().type(end).should('have.value', end);
	cy.get('.wizard-modal').contains('button', 'Suivant →').click();
}

/** Étape "Type" du wizard, puis soumission — ferme le wizard une fois l'absence créée. */
function selectTypeAndSubmit(type: string) {
	cy.get('#type').select(type);
	cy.get('.wizard-modal').contains('button', '+ Déclarer').click();
	cy.contains('.wizard-modal', 'Déclarer une absence').should('not.exist');
}

describe('absences → "Mon imputation" : synchronisation automatique', () => {
	it('un congé validé posé directement (admin) impute chaque jour ouvré sur la catégorie "Congé"', () => {
		cy.registerAndLogin().then(() => {
			openDeclareWizard();
			fillDatesAndNext(MONDAY, WEDNESDAY);
			// Un admin/manager peut poser un congé déjà validé, sans passer par le circuit prévisionnel.
			selectTypeAndSubmit('CONGE_VALIDE');

			cy.visit(`/imputation?w=${MONDAY}`);
			cy.get('table.imp').contains('tr', 'Congé').find('td.sum').should('have.text', '3');
		});
	});

	it("un congé prévisionnel n'impute rien tant qu'il n'est pas validé, et colore le total « Saisi » en attente", () => {
		cy.registerAndLogin().then(() => {
			openDeclareWizard();
			fillDatesAndNext(MONDAY, MONDAY);
			selectTypeAndSubmit('CONGE_PREVISIONNEL');

			cy.contains('h3', 'À valider').should('be.visible');
			cy.contains('.abs-item', 'Test E2E').should('be.visible');

			cy.visit(`/imputation?w=${MONDAY}`);
			cy.get('table.imp').should('not.contain.text', 'Congé');
			cy.get('.stat.pending-stat').should('exist').and('contain.text', 'Saisi');
		});
	});

	it('valider un congé prévisionnel l\'ajoute rétroactivement à "Mon imputation" et éteint le signal en attente', () => {
		cy.registerAndLogin().then(() => {
			openDeclareWizard();
			fillDatesAndNext(MONDAY, MONDAY);
			selectTypeAndSubmit('CONGE_PREVISIONNEL');

			cy.contains('.abs-item', 'Test E2E').contains('button', 'Valider').click();
			cy.contains('h3', 'À valider').should('not.exist');

			cy.visit(`/imputation?w=${MONDAY}`);
			cy.get('table.imp').contains('tr', 'Congé').find('td.sum').should('have.text', '1');
			cy.get('.stat.pending-stat').should('not.exist');
		});
	});

	it("supprimer une absence retire sa ligne d'imputation associée", () => {
		cy.registerAndLogin().then(() => {
			openDeclareWizard();
			fillDatesAndNext(MONDAY, MONDAY);
			selectTypeAndSubmit('HORS_PROJET');

			cy.visit(`/imputation?w=${MONDAY}`);
			cy.get('table.imp').contains('tr', 'Hors-projet').find('td.sum').should('have.text', '1');

			cy.visit('/absences');
			cy.contains('.abs-item', 'Hors projet').contains('button', '🗑 Retirer').click();
			cy.contains('.abs-item', 'Hors projet').should('not.exist');

			cy.visit(`/imputation?w=${MONDAY}`);
			cy.get('table.imp').should('not.contain.text', 'Hors-projet');
		});
	});

	it('la catégorie "Congé" (requise par le suivi des absences) ne peut pas être archivée depuis l\'admin', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('button', 'Référentiels'), 'input[placeholder="Nouvelle catégorie…"]');

			// Même motif que admin-referentials.cy.ts : le libellé vit en propriété `value` d'un
			// <input> de renommage inline, pas dans le textContent.
			const conge = () =>
				cy
					.get('input.ref-name')
					.filter((_, el) => (el as HTMLInputElement).value === 'Congé')
					.closest('.ref-item');

			conge().should('exist');
			conge().contains('🔒 requis').should('be.visible');
			conge().contains('button', 'Archiver').should('not.exist');
		});
	});
});
