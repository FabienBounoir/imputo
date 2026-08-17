CREATE TABLE "ticket_sprint_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_sprint_id_sprint_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_version_id_sprint_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_sprint_member" ADD CONSTRAINT "ticket_sprint_member_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_sprint_member" ADD CONSTRAINT "ticket_sprint_member_sprint_id_sprint_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_sprint_member_uq" ON "ticket_sprint_member" USING btree ("ticket_id","sprint_id");--> statement-breakpoint
-- Backfill : bascule ticket.sprint_id/version_id (1 sprint + 1 version max par ticket avant ce
-- changement) vers la table many-to-many, avant de dropper les colonnes.
INSERT INTO "ticket_sprint_member" ("ticket_id", "sprint_id")
SELECT "id", "sprint_id" FROM "ticket" WHERE "sprint_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "ticket_sprint_member" ("ticket_id", "sprint_id")
SELECT "id", "version_id" FROM "ticket" WHERE "version_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "sprint_id";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "version_id";