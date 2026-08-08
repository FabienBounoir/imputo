ALTER TABLE "ticket" DROP CONSTRAINT "ticket_assignee_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "assignee_id";