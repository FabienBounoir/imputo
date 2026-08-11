CREATE TYPE "public"."support_cadence" AS ENUM('DAY', 'WEEK', 'MONTH');--> statement-breakpoint
CREATE TABLE "support_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_rotation_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "support_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "support_cadence" "support_cadence" DEFAULT 'WEEK' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_override" ADD CONSTRAINT "support_override_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_override" ADD CONSTRAINT "support_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_rotation_member" ADD CONSTRAINT "support_rotation_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_rotation_member" ADD CONSTRAINT "support_rotation_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_override_ws_period_uq" ON "support_override" USING btree ("workspace_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "support_rotation_member_ws_user_uq" ON "support_rotation_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "support_rotation_member_ws_idx" ON "support_rotation_member" USING btree ("workspace_id");