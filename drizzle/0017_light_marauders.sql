CREATE TABLE "external_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "absence" ADD COLUMN "external_member_id" uuid;--> statement-breakpoint
ALTER TABLE "external_member" ADD CONSTRAINT "external_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_member_ws_idx" ON "external_member" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "absence" ADD CONSTRAINT "absence_external_member_id_external_member_id_fk" FOREIGN KEY ("external_member_id") REFERENCES "public"."external_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_ws_external_idx" ON "absence" USING btree ("workspace_id","external_member_id");