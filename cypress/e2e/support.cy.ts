describe('support : cycle complet activation → rotation solo → vidage', () => {
	it("redirige tant que désactivé, puis reflète l'état de la rotation (vide, peuplée, vidée) une fois activé", () => {
		cy.registerAndLogin().then((admin) => {
			// Désactivé par défaut sur un espace tout neuf : la page redirige.
			cy.visit('/support');
			cy.location('pathname').should('eq', '/imputation');

			// Un clic sur un bouton de formulaire parti avant l'hydratation Svelte tombe en repli
			// natif (POST classique) : ça exécute bien l'action, mais l'URL de repli remplace le
			// `?tab=support`, on retomberait sur l'onglet "Général". D'où le clic d'onglet piloté par
			// clickReliably, qui garantit l'hydratation avant tout submit sur cette page.
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('.tabs button', 'Support'), '#support-cadence');
			cy.contains('button', /^Activer$/).click();
			cy.contains('button', /^Désactiver$/).should('exist');

			// Activé mais personne dans la rotation : état vide affiché, pas de calendrier.
			cy.visit('/support');
			cy.location('pathname').should('eq', '/support');
			cy.contains('Aucun membre dans la rotation').should('be.visible');
			cy.get('.calendar-card').should('not.exist');

			// Cadence + inclusion du samedi : aller-retour pour vérifier que les deux réglages persistent.
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('.tabs button', 'Support'), '#support-cadence');
			cy.get('#support-cadence').select('MONTH');
			cy.get('#support-cadence').should('have.value', 'MONTH');
			cy.get('#support-cadence').select('WEEK');
			cy.get('#support-cadence').should('have.value', 'WEEK');

			cy.contains('button', /^Inclure$/).click();
			cy.contains('b', 'inclus').should('be.visible');
			cy.contains('button', /^Exclure$/).click();
			cy.contains('b', 'exclu').should('be.visible');

			// Seul candidat disponible sur un espace fraîchement créé : soi-même.
			cy.get('.state-add select').select(admin.displayName);
			cy.contains('.state-add button', '+ Ajouter').click();
			cy.contains('.state-row', admin.displayName).should('exist');
			// Seul membre de la rotation : les deux flèches de réordonnancement sont désactivées.
			cy.contains('.state-row', admin.displayName).find('button[aria-label="Monter"]').should('be.disabled');
			cy.contains('.state-row', admin.displayName).find('button[aria-label="Descendre"]').should('be.disabled');

			cy.visit('/support');
			cy.contains('.header-person h2', admin.displayName).should('be.visible');
			cy.get('.calendar-card').should('be.visible');
			cy.contains('.cal-cell .cal-name', admin.displayName.split(' ')[0]).should('exist');

			// Retrait : retour à l'état vide malgré le flag toujours activé.
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('.tabs button', 'Support'), '#support-cadence');
			cy.contains('.state-row', admin.displayName).find('.ref-btn').click();
			cy.contains('.state-row', admin.displayName).should('not.exist');

			cy.visit('/support');
			cy.contains('Aucun membre dans la rotation').should('be.visible');
			cy.get('.calendar-card').should('not.exist');
		});
	});
});

describe('support : rotation à deux, remplacement ponctuel, passer son tour, vue lecture seule', () => {
	it('permet à un admin de gérer un remplacement et de décaler la rotation, et laisse un membre simple consulter sans gérer', () => {
		const rnd = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		const memberEmail = `e2e-support-${rnd}@acme.test`;
		const memberPassword = 'password123';
		const memberName = 'Membre Rotation E2E';

		cy.registerAndLogin().then((admin) => {
			// Invite + active un second membre : il faut au moins 2 personnes dans la rotation pour
			// qu'un remplacement ponctuel ou un "passer son tour" aient un effet observable.
			cy.visit('/admin');
			cy.clickReliably(() => cy.contains('.tabs button', 'Membres'), '#dn');
			cy.get('#dn').type(memberName);
			cy.get('#em').type(memberEmail);
			cy.contains('button', "Générer l'invitation").click();

			cy.get('.invite-msg pre')
				.invoke('text')
				.then((body) => {
					const match = body.match(/\/invite\/\S+/);
					expect(match, "lien d'invitation trouvé dans le message").to.not.be.null;
					const path = match![0];

					cy.visit(path);
					cy.contains('Bienvenue').should('be.visible');
					cy.get('#pw').type(memberPassword);
					cy.get('#cf').type(memberPassword);
					cy.contains('button', 'Activer mon compte').click();
					// L'activation connecte directement le nouveau membre : il faut redevenir admin.
					cy.location('pathname').should('eq', '/imputation');

					cy.get('form[action="/logout"] button').click();
					cy.location('pathname').should('eq', '/login');
					cy.typeReliably('#em', admin.email);
					cy.typeReliably('#pw', admin.password);
					cy.get('button[type=submit]').click();
					cy.location('pathname').should('eq', '/imputation');

					cy.visit('/admin');
					cy.clickReliably(() => cy.contains('.tabs button', 'Support'), '#support-cadence');
					cy.contains('button', /^Activer$/).click();

					cy.get('.state-add select').select(admin.displayName);
					cy.contains('.state-add button', '+ Ajouter').click();
					cy.get('.state-add select').select(memberName);
					cy.contains('.state-add button', '+ Ajouter').click();
					cy.get('.state-row').should('have.length', 2);

					// Réordonnancement : la première ligne descend d'un cran, l'ordre doit s'inverser.
					cy.get('.state-row .ref-name')
						.then(($els) => [...$els].map((el) => el.textContent?.trim()))
						.then((before) => {
							cy.get('.state-row').first().find('button[aria-label="Descendre"]').click();
							cy.get('.state-row .ref-name').should(($els) => {
								const after = [...$els].map((el) => el.textContent?.trim());
								expect(after).to.deep.equal([...before].reverse());
							});
						});

					cy.visit('/support');
					cy.get('.header-person h2')
						.invoke('text')
						.then((currentText) => {
							const originalName = currentText.trim();
							const otherName = originalName === admin.displayName ? memberName : admin.displayName;

							// Remplacement ponctuel vers l'autre personne de la rotation.
							cy.clickReliably(() => cy.contains('button', "Quelqu'un est absent"), '.modal');
							cy.get('.candidate-row.sel').should('be.disabled').and('contain.text', 'actuel');
							cy.get('.candidate-row:not(.sel)').click();
							cy.get('.modal').should('not.exist');
							cy.contains('.pill.current', 'remplacement ponctuel').should('be.visible');
							cy.get('.header-person h2').should('have.text', otherName);

							// Retour à la normale : la personne calculée par la chaîne revient.
							cy.contains('button', 'Revenir à la rotation').click();
							cy.contains('.pill.current', 'remplacement ponctuel').should('not.exist');
							cy.get('.header-person h2').should('have.text', originalName);

							// Passer son tour : décale la rotation d'un cran, définitivement — avec
							// exactement 2 membres, la personne de perm bascule forcément sur l'autre.
							cy.clickReliably(() => cy.contains('button', "Quelqu'un est absent"), '.modal');
							cy.contains('.skip-btn', 'Passer son tour').click();
							cy.get('.cd-modal').should('be.visible');
							cy.contains('.cd-modal button', 'Passer au suivant').click();
							cy.get('.modal').should('not.exist');
							cy.get('.header-person h2').should('have.text', otherName);
							cy.contains('.pill.current', 'remplacement ponctuel').should('not.exist');
						});

					// Vue d'un membre simple (rôle par défaut USER) : consultation seule, sans les
					// actions réservées aux admins/managers.
					cy.get('form[action="/logout"] button').click();
					cy.location('pathname').should('eq', '/login');
					cy.typeReliably('#em', memberEmail);
					cy.typeReliably('#pw', memberPassword);
					cy.get('button[type=submit]').click();
					cy.location('pathname').should('eq', '/imputation');

					cy.visit('/support');
					cy.location('pathname').should('eq', '/support');
					cy.get('.header-person h2').should('be.visible');
					cy.get('.calendar-card').should('be.visible');
					cy.get('.header-actions').should('not.exist');
				});
		});
	});
});
