CREATE TYPE "public"."absence_period" AS ENUM('FULL', 'AM', 'PM');--> statement-breakpoint
CREATE TYPE "public"."absence_type" AS ENUM('CONGE_VALIDE', 'CONGE_PREVISIONNEL', 'FORMATION', 'HORS_PROJET');--> statement-breakpoint
CREATE TABLE "absence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "absence_type" NOT NULL,
	"period" "absence_period" DEFAULT 'FULL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_ws_user_idx" ON "absence" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "absence_ws_range_idx" ON "absence" USING btree ("workspace_id","start_date","end_date");