CREATE TYPE "public"."monthly_closing_status" AS ENUM('DRAFT', 'INTEGRATED');--> statement-breakpoint
CREATE TABLE "monthly_closing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"month" date NOT NULL,
	"seq" integer NOT NULL,
	"status" "monthly_closing_status" DEFAULT 'DRAFT' NOT NULL,
	"integrated_at" timestamp with time zone,
	"integrated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_closing_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ssp_id" uuid NOT NULL,
	"complement" numeric(5, 3) DEFAULT '0' NOT NULL,
	"conso_snapshot" numeric(5, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_closing_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_override" numeric(5, 3),
	"planned_snapshot" numeric(5, 3)
);
--> statement-breakpoint
CREATE TABLE "ssp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"budget_days" numeric(8, 2),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "ssp_id" uuid;--> statement-breakpoint
ALTER TABLE "monthly_closing" ADD CONSTRAINT "monthly_closing_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing" ADD CONSTRAINT "monthly_closing_integrated_by_id_user_id_fk" FOREIGN KEY ("integrated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_line" ADD CONSTRAINT "monthly_closing_line_closing_id_monthly_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."monthly_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_line" ADD CONSTRAINT "monthly_closing_line_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_line" ADD CONSTRAINT "monthly_closing_line_ssp_id_ssp_id_fk" FOREIGN KEY ("ssp_id") REFERENCES "public"."ssp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_member" ADD CONSTRAINT "monthly_closing_member_closing_id_monthly_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."monthly_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_closing_member" ADD CONSTRAINT "monthly_closing_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssp" ADD CONSTRAINT "ssp_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_closing_ws_month_seq_uq" ON "monthly_closing" USING btree ("workspace_id","month","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_closing_ws_month_draft_uq" ON "monthly_closing" USING btree ("workspace_id","month") WHERE status = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_closing_line_uq" ON "monthly_closing_line" USING btree ("closing_id","user_id","ssp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_closing_member_uq" ON "monthly_closing_member" USING btree ("closing_id","user_id");--> statement-breakpoint
CREATE INDEX "ssp_ws_idx" ON "ssp" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssp_ws_code_uq" ON "ssp" USING btree ("workspace_id",lower("code")) WHERE "ssp"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ssp_id_ssp_id_fk" FOREIGN KEY ("ssp_id") REFERENCES "public"."ssp"("id") ON DELETE set null ON UPDATE no action;