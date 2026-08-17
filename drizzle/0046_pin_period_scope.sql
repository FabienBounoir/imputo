ALTER TABLE "imputation_pin" ADD COLUMN "first_day" date;--> statement-breakpoint
ALTER TABLE "imputation_pin" ADD COLUMN "last_day" date;--> statement-breakpoint
-- Lignes déjà en base avant le scoping par période : bornes larges pour préserver leur
-- comportement actuel (toujours visibles) plutôt que de les faire disparaître.
UPDATE "imputation_pin" SET "first_day" = '2000-01-01', "last_day" = '2100-01-01' WHERE "first_day" IS NULL;--> statement-breakpoint
ALTER TABLE "imputation_pin" ALTER COLUMN "first_day" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "imputation_pin" ALTER COLUMN "last_day" SET NOT NULL;
