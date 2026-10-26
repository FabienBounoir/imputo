-- Doublons existants (même case saisie deux fois par deux écritures simultanées) : montants additionnés
-- dans la plus ancienne ligne (celle d'une absence en priorité), les autres supprimées — le total du jour
-- reste celui que la vue équipe affichait déjà.
WITH d AS (
	SELECT id,
		row_number() OVER w AS rn,
		sum(amount) OVER (PARTITION BY workspace_id, user_id, day, ticket_id, category_id, objective_id, activity_id) AS total
	FROM "time_entry"
	WINDOW w AS (PARTITION BY workspace_id, user_id, day, ticket_id, category_id, objective_id, activity_id ORDER BY (absence_id IS NULL), created_at, id)
), upd AS (
	UPDATE "time_entry" t SET amount = d.total FROM d WHERE t.id = d.id AND d.rn = 1 AND t.amount <> d.total RETURNING t.id
)
DELETE FROM "time_entry" t USING d WHERE t.id = d.id AND d.rn > 1;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_cell_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","user_id","day","ticket_id","category_id","objective_id","activity_id");
