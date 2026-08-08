ALTER TABLE "absence" ADD COLUMN "validated_by" uuid;--> statement-breakpoint
ALTER TABLE "absence" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;