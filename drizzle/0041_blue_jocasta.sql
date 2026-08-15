CREATE TABLE "jira_sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"status" "jira_sync_status" NOT NULL,
	"tickets_seen" integer DEFAULT 0 NOT NULL,
	"tickets_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	"undone_at" timestamp with time zone,
	"undone_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "created_by_sync_run_id" uuid;--> statement-breakpoint
ALTER TABLE "jira_sync_run" ADD CONSTRAINT "jira_sync_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_sync_run" ADD CONSTRAINT "jira_sync_run_undone_by_id_user_id_fk" FOREIGN KEY ("undone_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jira_sync_run_ws_started_idx" ON "jira_sync_run" USING btree ("workspace_id","started_at");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_sync_run_id_jira_sync_run_id_fk" FOREIGN KEY ("created_by_sync_run_id") REFERENCES "public"."jira_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_sync_run_idx" ON "ticket" USING btree ("created_by_sync_run_id");