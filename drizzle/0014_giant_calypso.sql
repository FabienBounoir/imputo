CREATE TYPE "public"."mood_period_kind" AS ENUM('WEEK_1', 'WEEK_2', 'WEEK_3', 'MONTH');--> statement-breakpoint
CREATE TABLE "mood_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"score" integer NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "mood_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "mood_period_kind" "mood_period_kind" DEFAULT 'WEEK_1' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "mood_start_weekday" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mood_vote" ADD CONSTRAINT "mood_vote_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mood_vote" ADD CONSTRAINT "mood_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mood_vote_ws_user_period_uq" ON "mood_vote" USING btree ("workspace_id","user_id","period_start");--> statement-breakpoint
CREATE INDEX "mood_vote_ws_period_idx" ON "mood_vote" USING btree ("workspace_id","period_start");