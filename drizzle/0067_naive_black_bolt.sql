-- Périmètres applicatifs : sous-scope DANS l'espace (l'espace reste la frontière d'isolation).
--
-- Le DDL généré par drizzle-kit posait `ticket.perimeter_id` en NOT NULL d'un bloc, ce qui échoue
-- sur toute base contenant déjà des tickets. On déroule donc, comme dans 0049 : colonne nullable →
-- création des périmètres → backfill → SET NOT NULL. L'état final est identique au snapshot.

CREATE TYPE "public"."perimeter_role" AS ENUM('CONTRIBUTOR', 'CP', 'CP_BACKUP');--> statement-breakpoint
CREATE TABLE "perimeter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"transverse" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perimeter_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"perimeter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "perimeter_role" DEFAULT 'CONTRIBUTOR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perimeter" ADD CONSTRAINT "perimeter_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_member" ADD CONSTRAINT "perimeter_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_member" ADD CONSTRAINT "perimeter_member_perimeter_id_perimeter_id_fk" FOREIGN KEY ("perimeter_id") REFERENCES "public"."perimeter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perimeter_member" ADD CONSTRAINT "perimeter_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perimeter_ws_idx" ON "perimeter" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_ws_name_uq" ON "perimeter" USING btree ("workspace_id",lower("name")) WHERE "perimeter"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "perimeter_member_uq" ON "perimeter_member" USING btree ("perimeter_id","user_id");--> statement-breakpoint
CREATE INDEX "perimeter_member_ws_user_idx" ON "perimeter_member" USING btree ("workspace_id","user_id");--> statement-breakpoint

-- Un périmètre par défaut par espace, nommé d'après l'espace : personne ne connaît encore le
-- découpage réel, c'est à l'admin de renommer/scinder ensuite depuis Admin > Périmètres.
INSERT INTO "perimeter" ("workspace_id", "name", "sort_order")
SELECT "id", "name", 0 FROM "workspace";--> statement-breakpoint

-- Périmètre transverse, pour que les chantiers transverses aient une destination dès le jour 1.
-- NOT EXISTS : un espace qui s'appellerait déjà « Transverse » a produit ci-dessus un périmètre de
-- même nom, et perimeter_ws_name_uq rejetterait le doublon.
INSERT INTO "perimeter" ("workspace_id", "name", "transverse", "sort_order")
SELECT w."id", 'Transverse', true, 100
FROM "workspace" w
WHERE NOT EXISTS (
	SELECT 1 FROM "perimeter" p
	WHERE p."workspace_id" = w."id" AND lower(p."name") = 'transverse'
);--> statement-breakpoint

ALTER TABLE "project" ADD COLUMN "perimeter_id" uuid;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "perimeter_id" uuid;--> statement-breakpoint
ALTER TABLE "ssp" ADD COLUMN "perimeter_id" uuid;--> statement-breakpoint
-- Nullable le temps du backfill, passée NOT NULL juste après.
ALTER TABLE "ticket" ADD COLUMN "perimeter_id" uuid;--> statement-breakpoint

-- Tout l'existant atterrit sur le périmètre par défaut de son espace. DISTINCT ON + ORDER BY
-- déterministe (sort_order, created_at, id) : le périmètre inséré en premier ci-dessus gagne, y
-- compris dans le cas tordu de l'espace nommé « Transverse ».
UPDATE "ticket" t SET "perimeter_id" = d."id"
FROM (
	SELECT DISTINCT ON ("workspace_id") "workspace_id", "id"
	FROM "perimeter"
	ORDER BY "workspace_id", "sort_order", "created_at", "id"
) d
WHERE d."workspace_id" = t."workspace_id";--> statement-breakpoint

ALTER TABLE "ticket" ALTER COLUMN "perimeter_id" SET NOT NULL;--> statement-breakpoint

-- Chaque membre actif est rattaché au périmètre par défaut. ADMIN/MANAGER y deviennent CP : sans
-- ça, plus personne ne pourrait éditer les champs MANAGER/ADMIN des tickets après cette migration.
--
-- `m."role"::text` et non `m."role" IN ('ADMIN', 'MANAGER')` : sur une base neuve, drizzle-kit
-- applique TOUTES les migrations dans une seule transaction, et Postgres interdit d'utiliser un
-- littéral d'enum ajouté par ALTER TYPE ... ADD VALUE dans la transaction qui l'a ajouté
-- («unsafe use of new value "MANAGER" of enum type role»). Comparer en texte contourne ça sans
-- rien changer au résultat. Ne s'applique pas à "perimeter_role", créé par cette migration même.
INSERT INTO "perimeter_member" ("workspace_id", "perimeter_id", "user_id", "role")
SELECT m."workspace_id", d."id", m."user_id",
       CASE WHEN m."role"::text IN ('ADMIN', 'MANAGER') THEN 'CP' ELSE 'CONTRIBUTOR' END::"perimeter_role"
FROM "membership" m
JOIN (
	SELECT DISTINCT ON ("workspace_id") "workspace_id", "id"
	FROM "perimeter"
	ORDER BY "workspace_id", "sort_order", "created_at", "id"
) d ON d."workspace_id" = m."workspace_id"
WHERE m."active";--> statement-breakpoint

ALTER TABLE "project" ADD CONSTRAINT "project_perimeter_id_perimeter_id_fk" FOREIGN KEY ("perimeter_id") REFERENCES "public"."perimeter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint" ADD CONSTRAINT "sprint_perimeter_id_perimeter_id_fk" FOREIGN KEY ("perimeter_id") REFERENCES "public"."perimeter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssp" ADD CONSTRAINT "ssp_perimeter_id_perimeter_id_fk" FOREIGN KEY ("perimeter_id") REFERENCES "public"."perimeter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_perimeter_id_perimeter_id_fk" FOREIGN KEY ("perimeter_id") REFERENCES "public"."perimeter"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_ws_perimeter_idx" ON "ticket" USING btree ("workspace_id","perimeter_id");
