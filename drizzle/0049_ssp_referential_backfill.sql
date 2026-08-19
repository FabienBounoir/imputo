-- Le code SSP était un text libre saisi ticket par ticket : on le promeut en référentiel avant de
-- supprimer la colonne, sinon la donnée existante est perdue.
--
-- DISTINCT ON sur lower(btrim(...)) : deux graphies qui ne diffèrent que par la casse ou des
-- espaces désignent le même code budgétaire, et l'index ssp_ws_code_uq les rejetterait de toute
-- façon. On garde la première graphie rencontrée, l'admin corrige ensuite depuis les référentiels.
--
-- code = label au départ : personne ne connaît le libellé lisible des codes déjà saisis, c'est à
-- l'admin de renommer ("8364BEB5354" -> "Site Internet"). Le code, lui, reste la clé.
INSERT INTO "ssp" ("workspace_id", "code", "label")
SELECT DISTINCT ON ("workspace_id", lower(btrim("ssp_code")))
       "workspace_id", btrim("ssp_code"), btrim("ssp_code")
FROM "ticket"
WHERE "ssp_code" IS NOT NULL AND btrim("ssp_code") <> ''
ORDER BY "workspace_id", lower(btrim("ssp_code")), "created_at";--> statement-breakpoint

UPDATE "ticket" t SET "ssp_id" = s."id"
FROM "ssp" s
WHERE s."workspace_id" = t."workspace_id"
  AND lower(s."code") = lower(btrim(t."ssp_code"));--> statement-breakpoint

ALTER TABLE "ticket" DROP COLUMN "ssp_code";
