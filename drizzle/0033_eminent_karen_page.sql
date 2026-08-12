CREATE TABLE "imputation_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"ticket_id" uuid,
	"category_id" uuid,
	"objective_id" uuid,
	"activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_objective_id_weekly_objective_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."weekly_objective"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD CONSTRAINT "imputation_pin_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imputation_pin_ws_user_idx" ON "imputation_pin" USING btree ("workspace_id","user_id");