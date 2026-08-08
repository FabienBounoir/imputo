CREATE TYPE "public"."change_log_action" AS ENUM('UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."change_log_entity" AS ENUM('TICKET', 'ABSENCE');--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" "change_log_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"activity_id" uuid,
	"field" text,
	"action" "change_log_action" NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("workspace_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "change_log_ws_created_idx" ON "change_log" USING btree ("workspace_id","created_at");