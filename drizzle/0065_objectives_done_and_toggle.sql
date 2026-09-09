ALTER TABLE "weekly_objective" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "objectives_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- La colonne arrive à false pour que tout nouvel espace démarre sans les objectifs. Les espaces qui
-- s'en servent déjà (au moins un objectif attribué, ou une semaine de congés marquée depuis cette
-- page) les gardent activés : personne ne perd la feature en déployant.
UPDATE "workspace" SET "objectives_enabled" = true
WHERE EXISTS (SELECT 1 FROM "weekly_objective" o WHERE o."workspace_id" = "workspace"."id")
   OR EXISTS (SELECT 1 FROM "weekly_vacation" v WHERE v."workspace_id" = "workspace"."id");
