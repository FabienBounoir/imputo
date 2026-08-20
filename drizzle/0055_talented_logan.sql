CREATE TABLE "ssp_annual_prod" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ssp_id" uuid NOT NULL,
	"month" date NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssp_annual_rae_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ssp_id" uuid NOT NULL,
	"month" date NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "annual_tracking_month" date;--> statement-breakpoint
ALTER TABLE "ssp_annual_prod" ADD CONSTRAINT "ssp_annual_prod_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssp_annual_prod" ADD CONSTRAINT "ssp_annual_prod_ssp_id_ssp_id_fk" FOREIGN KEY ("ssp_id") REFERENCES "public"."ssp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssp_annual_rae_override" ADD CONSTRAINT "ssp_annual_rae_override_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssp_annual_rae_override" ADD CONSTRAINT "ssp_annual_rae_override_ssp_id_ssp_id_fk" FOREIGN KEY ("ssp_id") REFERENCES "public"."ssp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ssp_annual_prod_ssp_month_uq" ON "ssp_annual_prod" USING btree ("ssp_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "ssp_annual_rae_override_ssp_month_uq" ON "ssp_annual_rae_override" USING btree ("ssp_id","month");