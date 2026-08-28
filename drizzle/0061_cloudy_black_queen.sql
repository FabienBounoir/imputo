ALTER TABLE "workspace" ADD COLUMN "jira_sync_priority" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Ancienne échelle : 0 (moins urgent) à 5 (plus urgent). Nouvelle échelle (inversée, alignée sur
-- Jira) : 0=P0/Urgent à 4=P4/Backlog. Remappe les tickets déjà notés pour préserver leur urgence
-- relative plutôt que de les laisser avec une valeur au sens désormais inversé.
UPDATE "ticket" SET "priority" = 4 - ROUND((priority::numeric * 4) / 5)::integer;