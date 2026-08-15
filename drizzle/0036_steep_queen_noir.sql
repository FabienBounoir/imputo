CREATE TYPE "public"."jira_conflict_strategy" AS ENUM('JIRA_WINS', 'KEEP_LOCAL');--> statement-breakpoint
CREATE TYPE "public"."jira_sync_status" AS ENUM('SUCCESS', 'ERROR');--> statement-breakpoint
ALTER TYPE "public"."change_log_entity" ADD VALUE 'WORKSPACE';--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_pat_encrypted" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_jql" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_pat_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_pat_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_key_regex_pattern" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_key_regex_replacement" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_conflict_strategy" "jira_conflict_strategy" DEFAULT 'KEEP_LOCAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_last_sync_status" "jira_sync_status";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_last_sync_ticket_count" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "jira_consecutive_failures" integer DEFAULT 0 NOT NULL;