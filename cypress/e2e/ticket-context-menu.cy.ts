// Menu clic droit sur les lignes de ticket (Tickets & chiffrage + Synthèse Par sprint) —
// copier/changer état/priorité/assigné/éditer/supprimer, cf. cypress/support/e2e.ts pour les
// commandes partagées (registerAndLogin, clickReliably).

function createTicketViaQuickAdd(key: string, title: string) {
	cy.visit('/tickets');
	cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#qc-key');
	cy.get('#qc-key').type(key);
	cy.get('#qc-title').type(title);
	cy.contains('.qc-popover button[type=submit]', 'Créer').click();
	cy.get('.qc-popover').should('not.exist');
	cy.contains(key).should('exist');
}

describe('menu clic droit — Tickets & chiffrage', () => {
	it('copier la clé, changer état/priorité/assigné, fermer par Escape et par clic extérieur', () => {
		const key = `CTX-${Date.now()}`;

		cy.registerAndLogin({ displayName: 'Test E2E' }).then(() => {
			createTicketViaQuickAdd(key, 'Ticket pour le menu contextuel');
			const row = () => cy.contains('tr.ticket-row', key);

			// Ouverture + fermeture par Escape.
			row().rightclick();
			cy.get('.ctx-menu').should('be.visible');
			cy.get('body').type('{esc}');
			cy.get('.ctx-menu').should('not.exist');

			// Ouverture + fermeture par clic en dehors du menu.
			row().rightclick();
			cy.get('.ctx-menu').should('be.visible');
			cy.get('body').click(5, 5);
			cy.get('.ctx-menu').should('not.exist');

			// Copier la clé — le toast confirme, pas d'assertion sur le presse-papier (permissions
			// headless peu fiables), cf. même choix pour d'autres tests de copie dans ce repo.
			row().rightclick();
			cy.contains('.ctx-menu button', 'Copier la clé').click();
			cy.contains('[data-sonner-toast]', 'Clé copié').should('exist');

			// Changer la priorité (P2 par défaut à la création, cf. schema.ts) — sous-menu à boutons
			// plats, pas le slider (qui lui vit dans la modale d'édition).
			row().rightclick();
			cy.contains('.ctx-menu button', "Changer la priorité").click();
			cy.contains('.ctx-menu button.ctx-priority', 'P0').click();
			row().find('.priority-badge').should('contain.text', 'P0');

			// Changer l'état.
			row().rightclick();
			cy.contains('.ctx-menu button', "Changer l'état").click();
			cy.contains('.ctx-menu button', 'En cours de dev').click();
			row().should('contain.text', 'En cours de dev');

			// Assigner à — seul membre de l'espace fraîchement créé : soi-même.
			row().find('.assignee-avatar').should('not.exist');
			row().rightclick();
			cy.contains('.ctx-menu button', 'Assigner à').click();
			cy.contains('.ctx-menu button', 'Test E2E').click();
			row().find('.assignee-avatar').should('exist');
		});
	});

	it('supprimer : bloqué si des imputations sont liées, sinon retire la ligne', () => {
		const keyBlocked = `CTX-BLOCK-${Date.now()}`;
		const keyFree = `CTX-FREE-${Date.now()}`;

		cy.registerAndLogin().then(() => {
			createTicketViaQuickAdd(keyBlocked, 'Ticket avec imputation');
			// Imputation via Mon imputation (mêmes étapes que ticket-lifecycle.cy.ts).
			cy.visit('/imputation');
			cy.clickReliably(() => cy.get('.qa-launcher'), '.qa-input');
			cy.get('.qa-input').type(keyBlocked);
			cy.contains('.qa-item', keyBlocked).click();
			cy.contains('.activity-option', 'Aucune activité').click();
			cy.contains('tr', keyBlocked).find('td.day .cell').first().click();
			cy.contains('tr', keyBlocked).find('td.sum').should('contain', '0.25');

			createTicketViaQuickAdd(keyFree, 'Ticket sans imputation');

			cy.visit('/tickets');
			cy.contains('tr.ticket-row', keyBlocked).rightclick();
			cy.contains('.ctx-menu button', 'Supprimer').click();
			cy.contains('[data-sonner-toast]', 'Suppression impossible').should('exist');
			cy.contains('tr.ticket-row', keyBlocked).should('exist');
			// Laisse le toast se dissiper avant de rouvrir le menu : sinon il reste au-dessus du bouton
			// "Supprimer" de la ligne suivante (animation de sortie de sonner) et bloque le clic.
			cy.contains('[data-sonner-toast]', 'Suppression impossible', { timeout: 6000 }).should('not.exist');

			cy.contains('tr.ticket-row', keyFree).rightclick();
			cy.contains('.ctx-menu button', 'Supprimer').click();
			cy.contains('.cd-modal .cd-danger', 'Supprimer').click();
			cy.contains('tr.ticket-row', keyFree).should('not.exist');
		});
	});
});

describe('menu clic droit — Synthèse (Par sprint)', () => {
	it("propose Éditer (pas Ajouter à Mon imputation) et modifie sans quitter la page", () => {
		const key = `CTXS-${Date.now()}`;
		const sprintName = `Sprint CTX ${Date.now()}`;

		cy.registerAndLogin().then(() => {
			// Référentiel Sprint requis pour que le ticket apparaisse dans Par sprint.
			cy.visit('/admin');
			cy.gotoRefSection('Sprints', 'Rechercher sprints…');
			cy.openRefAddForm('input[placeholder="Nouveau sprint…"]');
			cy.get('input[placeholder="Nouveau sprint…"]').type(sprintName);
			cy.get('input[placeholder="Nouveau sprint…"]').closest('form').find('button[type=submit]').click();
			// Le nom du sprint vit dans la value d'un <input> (édition inline), pas dans du texte — donc
			// cy.contains(selector, text) ne le trouve pas, cf. .ref-item/.ref-name dans admin/+page.svelte.
			cy.get('.ref-item .ref-name').should('have.value', sprintName);

			cy.visit('/tickets');
			cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#qc-key');
			cy.get('#qc-key').type(key);
			cy.get('#qc-title').type('Ticket Synthèse');
			cy.get('#qc-sprint').select(sprintName);
			cy.contains('.qc-popover button[type=submit]', 'Créer').click();
			cy.get('.qc-popover').should('not.exist');

			cy.visit('/dashboard/sprint');
			cy.contains(key).should('exist');
			// Même délai d'hydratation que clickReliably (cf. e2e.ts) : la ligne existe dans le DOM
			// avant que son handler oncontextmenu soit attaché, un rightclick immédiat ne fait donc rien.
			cy.wait(1000);

			const row = () => cy.contains('tr.us-row', key);
			row().rightclick();
			cy.contains('.ctx-menu button', 'Éditer').should('exist');
			cy.contains('.ctx-menu button', 'Ajouter à Mon imputation').should('not.exist');

			cy.contains('.ctx-menu button', 'Éditer').click();
			cy.get('.tk-modal').should('be.visible');
			cy.get('.priority-slider').should('be.visible');
			cy.contains('.tk-modal label', 'Assigné à').find('select').should('exist');
			// Clic tout à droite de la piste (inversée : droite = 0/Urgent, cf. priorityValueAt).
			cy.get('.priority-slider').click('right');
			cy.get('.priority-thumb').should('have.text', '0');
			cy.get('.tk-x').click();
			cy.get('.tk-modal').should('not.exist');

			// Toujours sur Par sprint, aucune navigation déclenchée par la modale.
			cy.location('pathname').should('eq', '/dashboard/sprint');
			row().find('.priority-badge').should('contain.text', 'P0');
		});
	});
});
