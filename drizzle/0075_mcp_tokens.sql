CREATE TABLE "mcp_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mcp_token_user_idx" ON "mcp_token" USING btree ("user_id");
CREATE INDEX "mcp_token_token_idx" ON "mcp_token" USING btree ("token");
