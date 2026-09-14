CREATE TABLE IF NOT EXISTS "badge_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_id" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"discoveries" jsonb,
	"tier_at" timestamp with time zone,
	"seen_tier" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "badge_progress" ADD CONSTRAINT "badge_progress_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_progress" ADD CONSTRAINT "badge_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "badge_progress_ws_user_badge_uq" ON "badge_progress" USING btree ("workspace_id","user_id","badge_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "badge_progress_ws_user_idx" ON "badge_progress" USING btree ("workspace_id","user_id");
-- Aucun backfill ici : les compteurs se recalculent entièrement depuis l'historique (cf.
-- services/badges.ts, computeAll), donc la première visite de /badges remplit la table toute seule.
-- Conséquence assumée et voulue : chacun découvre plusieurs paliers déjà acquis au déploiement.
