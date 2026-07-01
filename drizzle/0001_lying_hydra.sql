CREATE TYPE "public"."sprint_kind" AS ENUM('SPRINT', 'VERSION');--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "kind" "sprint_kind" DEFAULT 'SPRINT' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_version_id_sprint_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."sprint"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_ws_name_uq" ON "project" USING btree ("workspace_id",lower("name")) WHERE "project"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_ws_kind_name_uq" ON "sprint" USING btree ("workspace_id","kind",lower("name")) WHERE "sprint"."archived_at" is null;