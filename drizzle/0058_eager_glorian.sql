ALTER TABLE "workspace" ADD COLUMN "jira_link_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_link_key_regex_pattern" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_link_key_regex_replacement" text;