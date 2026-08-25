# Imputo Wrapped — idées de stats

Fonctionnalité façon "Spotify Wrapped" : récap annuel perso, actif début décembre → début janvier.

## Contraintes déjà tranchées

- **Traitement à côté, pas de modif structurelle** : nouvelle table dédiée (probablement `wrapped_snapshot`,
  1 ligne par `workspace_id`/`user_id`/`year`, contenu en `jsonb`), nouveau job cron sur le modèle de
  `src/routes/api/jobs/snapshot/+server.ts` (scheduler externe + `CRON_SECRET`), nouvelle page de
  consultation. Aucune table/service/route existant à modifier.
- **Fenêtre d'activation** : 1 déc → 5 jan. Pas de cron spécifique à cette plage — le job tourne tous les
  jours comme celui du snapshot, et no-op si `today` est hors fenêtre.
- **Perf** : non-problème. `time_entry` est indexé `(workspace_id, user_id, day)`, un an de données pour
  une personne = quelques centaines à ~2000 lignes. La table dédiée sert à figer le snapshot (comme
  Spotify) et à garantir que les corrélations d'équipe sont calculées au même instant pour tout le monde
  — pas à économiser du calcul.
- **Mood = anonyme, invariant existant** (cf. commentaire schema.ts ligne ~706) : jamais de comparaison
  nominative du score d'un collègue précis. Moyenne/évolution perso OK, agrégats d'équipe OK, classement
  nominatif interdit.
- **Corrélations d'équipe** : toujours en framing positif ("duo qui a bossé ensemble"), jamais de
  classement descendant type "t'es 8e/12".

## Idées de stats (groupées par source de données)

**Imputation (`time_entry`)**
- Ticket le plus chronophage de l'année
- Répartition PRODUCTIVE vs NON_PRODUCTIVE (%)
- Activité favorite (`activityId` le plus imputé)
- Jour de la semaine où t'imputes le plus
- Mois le plus chargé / le plus creux
- Plus longue série de jours consécutifs avec imputation saisie (streak)
- Nombre de tickets différents touchés dans l'année
- Premier et dernier ticket de l'année

**Objectifs hebdo (`weekly_objective` + `time_entry.objectiveId`)**
- Taux de complétion (objectif posé vs effectivement travaillé dessus)
- Nombre de semaines "100% objectifs remplis"

**Team mood (`mood_vote`)**
- Moyenne d'humeur sur l'année, mois le plus/moins en forme
- Taux de participation au vote vs moyenne du workspace (agrégé)

**Perm support (calculé à la volée, pas stocké)**
- Nombre de fois de perm dans l'année
- Mois le plus chargé en perms

**Absences**
- Répartition congé / formation / hors-projet
- Mois le plus absent

**Notifications (`notification_log`)** — angle fun/auto-dérision
- Nombre de fois "t'as oublié d'imputer hier" (EVENING_MISSING/MORNING_YESTERDAY)
- Nombre de relances RAE_STALE reçues

**Préférences perso (`user`)**
- Dark mode vs light mode, % de l'équipe qui partage ton thème
- Mode accent activé (DISCO/RGB = "team chaos certifié")

**Corrélations d'équipe**
- Ticket sur lequel le plus de monde a bossé ensemble
- Duo qui a le plus souvent imputé sur le même ticket le même jour

## À trancher plus tard

- Short-list des 5-6 stats pour un premier jet (plutôt que tout d'un coup)
- Wording/design des cartes (voir feedback empty-state pour le style d'overlay)
