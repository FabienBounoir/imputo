CREATE TABLE "time_entry_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"amount" numeric(5, 3) NOT NULL,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry_part" ADD CONSTRAINT "time_entry_part_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entry_part_entry_idx" ON "time_entry_part" USING btree ("time_entry_id");