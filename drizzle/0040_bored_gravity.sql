ALTER TABLE "time_entry" ALTER COLUMN "amount" SET DATA TYPE numeric(5, 3);--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "imputation_step" SET DATA TYPE numeric(4, 3);--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "imputation_step" SET DEFAULT '0.25';