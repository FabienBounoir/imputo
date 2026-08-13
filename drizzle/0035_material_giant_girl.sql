ALTER TABLE "activity" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "sort_activities_alpha" boolean DEFAULT false NOT NULL;