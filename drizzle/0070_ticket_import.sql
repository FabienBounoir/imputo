CREATE TABLE "ticket_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"tickets_created" integer NOT NULL,
	"created_by_id" uuid,
	"undone_at" timestamp with time zone,
	"undone_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "created_by_import_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_import" ADD CONSTRAINT "ticket_import_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_import" ADD CONSTRAINT "ticket_import_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_import" ADD CONSTRAINT "ticket_import_undone_by_id_user_id_fk" FOREIGN KEY ("undone_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_import_ws_created_idx" ON "ticket_import" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_import_id_ticket_import_id_fk" FOREIGN KEY ("created_by_import_id") REFERENCES "public"."ticket_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_import_idx" ON "ticket" USING btree ("created_by_import_id");