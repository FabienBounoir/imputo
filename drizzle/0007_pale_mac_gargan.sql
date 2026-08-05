CREATE TABLE "ticket_activity_rae" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"rae_real" numeric(7, 2) DEFAULT '0' NOT NULL,
	"rae_test" numeric(7, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ADD CONSTRAINT "ticket_activity_rae_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ADD CONSTRAINT "ticket_activity_rae_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_activity_rae_uq" ON "ticket_activity_rae" USING btree ("ticket_id","activity_id");