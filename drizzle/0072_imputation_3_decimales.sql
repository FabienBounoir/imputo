ALTER TABLE "ssp" ALTER COLUMN "budget_days" SET DATA TYPE numeric(8, 3);--> statement-breakpoint
ALTER TABLE "ssp_annual_prod" ALTER COLUMN "value" SET DATA TYPE numeric(8, 3);--> statement-breakpoint
ALTER TABLE "ssp_annual_rae_override" ALTER COLUMN "value" SET DATA TYPE numeric(8, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "estimation_real" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "rae_real" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "estimation_test" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "prepa" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "rae_test" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "estimation_prev" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "enveloppe_totale" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "rae_real" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "rae_real" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "rae_test" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "rae_test" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "estimation" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "estimation" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "budget" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_activity_rae" ALTER COLUMN "budget" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "estimation_real" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "estimation_real" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "rae_real" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "rae_real" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "rae_test" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "rae_test" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "consumed" SET DATA TYPE numeric(7, 3);--> statement-breakpoint
ALTER TABLE "ticket_snapshot" ALTER COLUMN "consumed" SET DEFAULT '0';