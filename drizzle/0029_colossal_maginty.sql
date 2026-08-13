ALTER TABLE "weekly_objective" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill : préserve l'ordre d'affichage actuel (par date de création) avant toute réorganisation manuelle.
UPDATE "weekly_objective" AS wo SET "sort_order" = ranked.rn
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "workspace_id", "user_id", "week_monday" ORDER BY "created_at") - 1 AS rn
	FROM "weekly_objective"
) AS ranked
WHERE wo."id" = ranked."id";