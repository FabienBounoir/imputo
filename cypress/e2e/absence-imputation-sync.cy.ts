// Dates fixes (comme les tests d'intégration absences.test.ts) : lundi→mercredi d'une semaine
// sans jour férié FR, pour ne jamais dépendre du jour d'exécution du test.
const MONDAY = '2026-06-22';
const WEDNESDAY = '2026-06-24';

function openDeclareWizard() {
	cy.visit('/absences');
	cy.clickReliably(() => cy.contains('button', '+ Déclarer une absence'), '.wizard-modal');
	// Le créateur d'un espace en est ADMIN, donc canManageOthers : le wizard ouvre sur "Pour qui"
	// (moi-même par défaut) et pas sur "Dates". On avance d'une étape pour atteindre les dates.
	cy.get('.wizard-modal').contains('button', 'Suivant →').click();
}

/** Étape "Dates" du wizard. */
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

	it('une case verrouillée par une absence est grisée, colorée selon le type, et redirige vers Absences en surbrillance', () => {
		cy.registerAndLogin().then(() => {
			openDeclareWizard();
			fillDatesAndNext(MONDAY, MONDAY);
			selectTypeAndSubmit('CONGE_VALIDE');

			cy.visit(`/imputation?w=${MONDAY}`);
			// Fonction (pas .as()) : chaque appel requête le DOM à neuf, cf. admin-referentials.cy.ts.
			const row = () => cy.get('table.imp').contains('tr', 'Congé');

			// Fond grisé, chiffre coloré selon le type (#C00000 pour CONGE_VALIDE = rgb(192, 0, 0)) —
			// jamais la teinte accent normalement posée sur une case remplie (.cell.val). Un vrai lien
			// <a href>, pas un bouton + goto() (cf. absenceHref sur +page.svelte).
			row().find('a.cell.locked').should('have.length', 1).and('have.css', 'color', 'rgb(192, 0, 0)');

			// Ligne entièrement verrouillée : pas de "Supprimer la ligne", un cadenas à la place.
			row().find('button[aria-label="Supprimer la ligne"]').should('not.exist');
			row().find('a[aria-label="Ligne verrouillée par une absence"]').should('exist');

			row().find('a.cell.locked').click();
			cy.location('pathname').should('eq', '/absences');
			cy.location('search').should('include', 'highlight=');
			cy.get('.abs-item.highlighted').should('exist').and('contain.text', 'Congé validé');
		});
	});

	it('le sélecteur "+ Ajouter" de Mon imputation n\'propose plus les catégories liées à une absence', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/imputation');
			cy.clickReliably(() => cy.get('.qa-launcher'), '.qa-input');

			// MCO (catégorie non liée) doit rester proposée — seules Congé/Formation/Hors-projet, alimentées
			// uniquement depuis les absences validées (cf. syncAbsenceEntries), sont retirées du picker.
			cy.get('.qa-list').within(() => {
				cy.contains('.qa-item', 'MCO').should('exist');
				cy.contains('.qa-item', 'Congé').should('not.exist');
				cy.contains('.qa-item', 'Formation').should('not.exist');
				cy.contains('.qa-item', 'Hors-projet').should('not.exist');
			});
		});
	});

	it('la catégorie "Congé" (requise par le suivi des absences) ne peut pas être archivée depuis l\'admin', () => {
		cy.registerAndLogin().then(() => {
			cy.visit('/admin');
			cy.gotoRefSection('Catégories', 'Rechercher une catégorie…');

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
