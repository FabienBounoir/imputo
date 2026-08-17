ALTER TABLE "category" ADD COLUMN "linked_absence_type" "absence_type";--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "absence_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_absence_id_absence_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."absence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_ws_linked_absence_uq" ON "category" USING btree ("workspace_id","linked_absence_type") WHERE "category"."linked_absence_type" is not null;--> statement-breakpoint
CREATE INDEX "time_entry_absence_idx" ON "time_entry" USING btree ("absence_id");