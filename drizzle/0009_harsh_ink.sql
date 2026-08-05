CREATE TABLE "ticket_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"date" date NOT NULL,
	"estimation_real" numeric(7, 2) DEFAULT '0' NOT NULL,
	"rae_real" numeric(7, 2) DEFAULT '0' NOT NULL,
	"rae_test" numeric(7, 2) DEFAULT '0' NOT NULL,
	"consumed" numeric(7, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ADD CONSTRAINT "ticket_snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ADD CONSTRAINT "ticket_snapshot_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_snapshot_ticket_date_uq" ON "ticket_snapshot" USING btree ("ticket_id","date");--> statement-breakpoint
CREATE INDEX "ticket_snapshot_ws_date_idx" ON "ticket_snapshot" USING btree ("workspace_id","date");