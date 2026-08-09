DROP INDEX "notif_log_uq";--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "slot" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notif_log_uq" ON "notification_log" USING btree ("user_id","workspace_id","kind","ref_date","slot");