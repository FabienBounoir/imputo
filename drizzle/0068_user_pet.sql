ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pet_id" text;
-- Null = aucun compagnon affiché, et c'est le défaut voulu : personne ne se retrouve avec une
-- bestiole en bas de l'écran sans l'avoir choisie. Aucune contrainte sur la valeur : le catalogue
-- vit dans le code (cf. src/lib/pets.ts), un identifiant retiré du catalogue se comporte comme
-- "aucun compagnon" au rendu plutôt que de casser la session.
