CREATE TYPE "public"."accent_mode" AS ENUM('WORKSPACE', 'CUSTOM', 'RGB');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "accent_mode" "accent_mode" DEFAULT 'WORKSPACE' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "accent_color" text;