-- Sous-tâches dont le parent a déjà été supprimé (aucune FK jusqu'ici) : détachées, sinon la FK refuse de se poser.
UPDATE "ticket" SET "parent_id" = NULL WHERE "parent_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ticket" p WHERE p."id" = "ticket"."parent_id");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_parent_id_ticket_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ticket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN "rae_updated_at";--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_subject_ck" CHECK (num_nonnulls("absence"."user_id", "absence"."external_member_id") = 1);--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_target_ck" CHECK (("time_entry"."target_type"::text = 'TICKET' and "time_entry"."ticket_id" is not null and "time_entry"."category_id" is null)
				or ("time_entry"."target_type"::text = 'CATEGORY' and "time_entry"."category_id" is not null and "time_entry"."ticket_id" is null)
				or ("time_entry"."target_type"::text = 'OBJECTIVE' and "time_entry"."ticket_id" is null and "time_entry"."category_id" is null));