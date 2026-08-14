ALTER TABLE "user" ADD COLUMN "remember_ticket_filters" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ticket_filters_snapshot" text;