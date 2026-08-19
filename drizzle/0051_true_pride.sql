CREATE TABLE "monthly_closing_ssp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closing_id" uuid NOT NULL,
	"ssp_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_closing_ssp" ADD CONSTRAINT "monthly_closing_ssp_closing_id_monthly_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."monthly_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_ssp" ADD CONSTRAINT "monthly_closing_ssp_ssp_id_ssp_id_fk" FOREIGN KEY ("ssp_id") REFERENCES "public"."ssp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_closing_ssp_uq" ON "monthly_closing_ssp" USING btree ("closing_id","ssp_id");