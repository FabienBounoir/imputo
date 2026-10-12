// Écritures concurrentes sur un ticket (SPECS §9, tickets.ts TicketConflictError) : la page envoie la
// valeur qu'elle affichait avant la saisie, le serveur refuse si quelqu'un l'a changée entre-temps.
// Deux sens à tenir : ses propres saisies successives ne déclenchent jamais d'alerte, celle d'un
// collègue (simulée par un POST direct, comme un autre onglet) en déclenche une et recharge sa valeur.

function createTicketViaQuickAdd(key: string, title: string) {
	cy.visit('/tickets');
	cy.clickReliably(() => cy.contains('button', 'Nouveau ticket'), '#qc-key');
	cy.get('#qc-key').type(key);
	cy.get('#qc-title').type(title);
	cy.contains('.qc-popover button[type=submit]', 'Créer').click();
	cy.get('.qc-popover').should('not.exist');
	cy.contains(key).should('exist');
}

const conflictToast = () => cy.contains('[data-sonner-toast]', 'Modifié entre-temps');

describe('écritures concurrentes — Tickets & chiffrage', () => {
	it('ses propres saisies successives passent, celle écrasée par un collègue est signalée puis rechargée', () => {
		const key = `CONC-${Date.now()}`;

		cy.registerAndLogin().then(() => {
			createTicketViaQuickAdd(key, 'Titre 1');
			const row = () => cy.contains('tr.ticket-row', key);
			const title = () => row().find('input.title-input');

			// Trois saisies d'affilée sur le même champ : chacune part de la précédente, aucune alerte.
			title().clear().type('Titre 2').blur();
			cy.contains('[data-sonner-toast]', 'Enregistré').should('exist');
			title().clear().type('Titre 3').blur();
			row().rightclick();
			cy.contains('.ctx-menu button', 'Changer la priorité').click();
			cy.contains('.ctx-menu button.ctx-priority', 'P0').click();
			row().rightclick();
			cy.contains('.ctx-menu button', 'Changer la priorité').click();
			cy.contains('.ctx-menu button.ctx-priority', 'P1').click();
			row().find('.priority-badge').should('contain.text', 'P1');
			conflictToast().should('not.exist');

			// Un collègue renomme le ticket pendant que la page reste ouverte sur « Titre 3 ».
			row()
				.invoke('attr', 'id')
				.then((id) => {
					cy.request({
						method: 'POST',
						url: '/tickets?/update',
						form: true,
						headers: { origin: Cypress.config('baseUrl')! },
						body: { ticketId: id!.replace('ticket-', ''), field: 'title', value: 'Par un collègue' }
					});
				});
			title().should('have.value', 'Titre 3');

			// Notre saisie partait de « Titre 3 » : refusée, signalée, et la valeur du collègue revient.
			title().clear().type('Titre 4').blur();
			conflictToast().should('exist');
			title().should('have.value', 'Par un collègue');

			// Repartie de la valeur rechargée, la saisie suivante passe.
			title().clear().type('Titre 5').blur();
			cy.reload();
			title().should('have.value', 'Titre 5');
		});
	});
});
