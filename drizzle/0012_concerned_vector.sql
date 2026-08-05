CREATE TYPE "public"."objective_kind" AS ENUM('TICKET', 'CUSTOM');--> statement-breakpoint
ALTER TYPE "public"."target_type" ADD VALUE 'OBJECTIVE';--> statement-breakpoint
CREATE TABLE "weekly_objective" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"week_monday" date NOT NULL,
	"kind" "objective_kind" NOT NULL,
	"ticket_id" uuid,
	"label" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_vacation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"week_monday" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "objective_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_objective" ADD CONSTRAINT "weekly_objective_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_objective" ADD CONSTRAINT "weekly_objective_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_objective" ADD CONSTRAINT "weekly_objective_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_objective" ADD CONSTRAINT "weekly_objective_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_vacation" ADD CONSTRAINT "weekly_vacation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_vacation" ADD CONSTRAINT "weekly_vacation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_objective_ws_user_week_idx" ON "weekly_objective" USING btree ("workspace_id","user_id","week_monday");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_vacation_ws_user_week_uq" ON "weekly_vacation" USING btree ("workspace_id","user_id","week_monday");--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_objective_id_weekly_objective_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."weekly_objective"("id") ON DELETE set null ON UPDATE no action;