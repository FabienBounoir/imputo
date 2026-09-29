// Synthèse par activité (/dashboard/activite) : navigation sous Synthèse, lignes Absences / Sans
// activité, pastilles « Inclure », détail Personnes | Tâches, modale de détail croisé chargée au
// clic, et filtres mémorisés d'une visite à l'autre.

/** Lundi (ISO) de la semaine contenant `d`, décalé de `weeks` semaines. Dates relatives au jour
 * d'exécution : la page ne montre que les 12 derniers mois, une date fixe finirait par en sortir. */
function mondayISO(weeks = 0) {
	const d = new Date();
	d.setUTCHours(12, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + weeks * 7);
	return d.toISOString().slice(0, 10);
}

const ROW = (label: string) => cy.contains('.scroll tr.r-act', label);

describe('synthèse par activité', () => {
	it('conso par activité, absences exclues par défaut, détail croisé et filtres mémorisés', () => {
		const key = `SYN-${Date.now()}`;
		const title = 'Ticket synthèse E2E';
		const projectName = `Projet E2E ${Date.now()}`;
		// Ticket et congé sur deux semaines différentes : un jour déjà couvert par une absence validée
		// est verrouillé dans Mon imputation.
		const thisMonday = mondayISO(0);
		const lastMonday = mondayISO(-1);

		cy.registerAndLogin().then((account) => {
			// --- Données : 0,25 j de Dev sur un ticket + 1 j de congé validé ---
			cy.visit('/tickets');
			cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#qc-key');
			cy.get('#qc-key').type(key);
			cy.get('#qc-title').type(title);
			cy.contains('.qc-popover button[type=submit]', 'Créer').click();
			cy.get('.qc-popover').should('not.exist');

			cy.visit(`/imputation?w=${thisMonday}`);
			cy.clickReliably(() => cy.get('.qa-launcher'), '.qa-input');
			cy.get('.qa-input').type(key);
			cy.contains('.qa-item', key).click();
			cy.contains('.activity-option', /^\s*Dev\s*$/).click();
			cy.contains('tr', key).find('td.day .cell').first().click();
			cy.contains('tr', key).find('td.sum').should('contain', '0.25');

			cy.visit('/absences');
			cy.clickReliably(() => cy.contains('button', '+ Déclarer une absence'), '.wizard-modal');
			cy.get('.wizard-modal').contains('button', 'Suivant →').click();
			cy.get('#startDate').clear().type(lastMonday).should('have.value', lastMonday);
			cy.get('#endDate').clear().type(lastMonday).should('have.value', lastMonday);
			cy.get('.wizard-modal').contains('button', 'Suivant →').click();
			cy.get('#type').select('CONGE_VALIDE');
			cy.get('.wizard-modal').contains('button', '+ Déclarer').click();
			cy.contains('.wizard-modal', 'Déclarer une absence').should('not.exist');

			// --- Accès depuis le menu, sous Synthèse ---
			cy.visit('/dashboard');
			cy.contains('.nav-sub-group a', 'Par activité').click();
			cy.location('pathname').should('eq', '/dashboard/activite');

			// Absences exclues par défaut : grisées, hors total, signalées dans le pied de tableau.
			ROW('Dev').find('.c-tot').should('contain', '0,25');
			ROW('Absences').should('have.class', 'excluded').and('contain', 'Exclue du total');
			cy.get('.kpi').first().find('.v').should('contain', '0,25');
			cy.get('tfoot').should('contain', 'hors Absences (1 j)');

			// Pastille « Absences » : le congé rejoint le total, choix conservé au rechargement.
			cy.clickReliably(() => cy.contains('.incl .chip', 'Absences'), '.incl .chip.on');
			cy.get('.kpi').first().find('.v').should('contain', '1,25');
			ROW('Absences').should('not.have.class', 'excluded');
			cy.reload();
			cy.get('.kpi').first().find('.v').should('contain', '1,25');
			cy.contains('.incl .chip', 'Absences').click();
			cy.get('.kpi').first().find('.v').should('contain', '0,25');

			// Le cumul précise sa période au survol (pas « depuis toujours »).
			cy.get('.head-wrap .cumul-h').trigger('mouseenter');
			cy.get('[role=tooltip]').should('contain', '12 derniers mois');
			cy.get('.head-wrap .cumul-h').trigger('mouseleave');

			// --- Détail par personne → modale : les tâches de la personne sur Dev ---
			cy.contains('.seg button', 'Personnes').click();
			ROW('Dev').find('button.act').click();
			cy.contains('tr.r-person', account.displayName).find('.task-link').click();
			cy.get('.fx-modal #fx-title').should('have.text', account.displayName);
			cy.get('.fx-modal').should('contain', 'Dev').and('contain', 'ses tâches');
			cy.contains('.fx-table tbody tr', key).should('contain', title).find('.c-tot').should('contain', '0,25');

			// La fiche ticket s'ouvre par-dessus ; Échap la ferme d'abord, puis la modale.
			cy.contains('.fx-table .task-link', key).click();
			cy.get('.tk-modal').should('exist');
			cy.get('body').type('{esc}');
			cy.get('.tk-modal').should('not.exist');
			cy.get('.fx-modal').should('exist');
			cy.get('body').type('{esc}');
			cy.get('.fx-modal').should('not.exist');

			// --- Détail par tâche → modale : qui a contribué au ticket sur Dev ---
			cy.contains('.seg button', 'Tâches').click();
			cy.contains('tr.r-person', key).find('.task-link').click();
			cy.get('.fx-modal #fx-title').should('have.text', title);
			cy.get('.fx-modal').should('contain', 'qui y a contribué');
			cy.contains('.fx-table tbody tr', account.displayName).should('exist');
			cy.get('.fx-modal').contains('button', 'Ouvrir la fiche ticket').should('exist');
			cy.get('.fx-modal button[aria-label="Fermer"]').click();
			cy.get('.fx-modal').should('not.exist');

			// --- Filtres mémorisés : un projet sans conso vide la page, et le reste au retour ---
			cy.visit('/admin');
			cy.gotoRefSection('Projets', 'Rechercher projets…');
			cy.openRefAddForm('input[placeholder="Nouveau projet…"]');
			cy.get('input[placeholder="Nouveau projet…"]').type(projectName);
			cy.get('input[placeholder="Nouveau projet…"]').closest('form').find('button[type=submit]').click();
			cy.get('input.ref-name').filter((_, el) => (el as HTMLInputElement).value === projectName).should('exist');

			cy.visit('/dashboard/activite');
			cy.get('select[aria-label="Filtrer par projet"] option')
				.contains(projectName)
				.invoke('val')
				.then((projectId) => {
					cy.selectReliably('select[aria-label="Filtrer par projet"]', String(projectId));
					cy.contains('.empty', 'Aucune consommation').should('exist');

					// Retour par le menu, URL sans paramètre : le filtre est restauré côté serveur.
					cy.visit('/dashboard');
					cy.contains('.nav-sub-group a', 'Par activité').click();
					cy.location('search').should('eq', '');
					cy.get('select[aria-label="Filtrer par projet"]').should('have.value', String(projectId));
					cy.contains('.empty', 'Aucune consommation').should('exist');

					// « Tout effacer » vide aussi la mémoire : pas de filtre à la visite suivante.
					cy.clickReliably(() => cy.contains('button.reset', 'Tout effacer'), '.scroll');
					ROW('Dev').should('exist');
					cy.visit('/dashboard/activite');
					cy.get('select[aria-label="Filtrer par projet"]').should('have.value', '');
					ROW('Dev').should('exist');
				});
		});
	});
});
