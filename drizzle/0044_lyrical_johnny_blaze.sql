ALTER TYPE "public"."accent_mode" ADD VALUE 'DISCO';--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "accent_disco" boolean DEFAULT false NOT NULL;