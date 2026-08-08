CREATE TABLE "ticket_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_group" ADD CONSTRAINT "ticket_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_group_member" ADD CONSTRAINT "ticket_group_member_group_id_ticket_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ticket_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_group_member" ADD CONSTRAINT "ticket_group_member_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_group_ws_label_uq" ON "ticket_group" USING btree ("workspace_id",lower("label")) WHERE "ticket_group"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_group_member_uq" ON "ticket_group_member" USING btree ("group_id","ticket_id");