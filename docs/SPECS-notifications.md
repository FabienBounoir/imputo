# SPEC — Notifications Web Push (rappels d'imputation & RAE)

> Spécification de fonctionnalité. **À implémenter sur demande explicite** (non développée à ce jour).

## 1. Contexte

L'app n'envoie aucune notification. On veut **relancer automatiquement** les membres qui
oublient de tenir leur suivi, via **Web Push** (canal naturel : PWA + service worker déjà en
place, et pas de SMTP dans le projet). Cas visés :

- **Soir** : rien saisi aujourd'hui (ou sous la capacité).
- **Matin** : le dernier jour ouvré n'a pas été renseigné.
- **RAE périmé** : tickets actifs assignés dont le RAE n'a pas bougé depuis X jours.
- **Récap hebdo** (vendredi après-midi) : des jours de la semaine restent incomplets.

Décisions actées :
- Suivi `raeUpdatedAt` pour détecter un RAE périmé.
- Garde-fous : **jours ouvrés** uniquement, pas de relance si **congé/férié**, seuil aligné sur
  la **capacité** (temps partiel), fuseau **Europe/Paris**.
- Activation **par défaut dès que le navigateur a autorisé**, **désactivable** par l'utilisateur
  (interrupteur principal + par type).

## 2. Technologies (Web Push natif — aucun service tiers)

| Besoin | Techno |
|---|---|
| Afficher la notif (app fermée incluse) | **Service Worker** + Notification API (`registration.showNotification`) |
| S'abonner côté navigateur | **Push API** (`pushManager.subscribe`) |
| Authentifier le serveur auprès du service push | **VAPID** (paire de clés — pas de FCM/Firebase) |
| Envoyer côté serveur | lib **`web-push`** (JWT VAPID + chiffrement + POST aux endpoints) |
| Stockage abonnements + déduplication | **PostgreSQL** (Drizzle) |
| Déclenchement planifié | **Cron externe → endpoint protégé `CRON_SECRET`** (Vercel Cron / CronJob K8s) |

Écartés : Firebase/FCM (dépendance Google inutile), OneSignal/Pusher (SaaS, données qui sortent),
Notification API seule (ne fonctionne pas app fermée).

## 3. Répartition front / back

- **Décision + envoi = 100 % backend** : cron → service serveur (requêtes DB) → `web-push` → endpoints.
  L'app **n'a pas besoin d'être ouverte** (le device est réveillé par le service de push du navigateur).
- **Frontend = abonnement + affichage uniquement** : une page demande la permission, s'abonne (clé
  **publique** VAPID), envoie la subscription au serveur ; le **Service Worker** affiche la notif au reçu du push.

Chemin complet :
```
Cron → Backend (web-push, clé privée VAPID) → Service push du navigateur (FCM/Mozilla…)
     → Service Worker du device → showNotification
```

## 4. Contraintes & limites
- **iOS** : Web Push seulement si l'app est **installée en PWA** (iOS 16.4+). Desktop Chrome/Firefox/Edge : direct.
- **Idempotence** : les jobs cron peuvent être rejoués → déduplication obligatoire.
- **Isolation** : un rappel d'imputation est **par (utilisateur, espace)** ; un user multi-espaces peut être relancé pour chacun.
- **Confidentialité** : contenu générique, aucune donnée sensible dans la notif.

## 5. Modèle de données (`schema.ts` + migration)
- **`push_subscription`** : `id, userId (FK user cascade), endpoint (text unique), p256dh, auth,
  userAgent, createdAt, lastSeenAt, failureCount (int def 0)`. Plusieurs par utilisateur ; portée **globale** (identité).
- **`notification_log`** (dédup) : `id, userId, workspaceId, kind, refDate (date), sentAt`.
  **Unique `(userId, workspaceId, kind, refDate)`**.
- **enum `notification_kind`** : `EVENING_MISSING | MORNING_YESTERDAY | RAE_STALE | WEEKLY_RECAP`.
- **`ticket.raeUpdatedAt`** (timestamptz, nullable) : posé à la création, mis à jour à chaque modif de `raeReal`/`raeTest`.
- **`user.notifPrefs`** (text JSON, parsé comme `ticket.flags`) :
  `{ enabled, eveningMissing, morningYesterday, raeStale, weeklyRecap }` (booléens). `null` = tout activé (défaut).

## 6. Dépendances & variables d'environnement
- npm : **`web-push`**.
- env (`config.ts` via `$env`) : `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `NOTIF_RAE_STALE_DAYS` (def 7).
- env public client : **`PUBLIC_VAPID_KEY`** (`$env/static/public`).
- Génération des clés : `npx web-push generate-vapid-keys`.
- Réutilise : `CRON_SECRET`, `PUBLIC_BASE_URL`.

## 7. Détection (service `notifications.ts`)
Helpers date (étendre `src/lib/utils/date.ts`) : `todayInParis()`, `previousWorkday(dateISO)`,
`isWorkday(dateISO)` (calcul Europe/Paris via `Intl … timeZone`). Réutilise `countWorkdays`.

Pour un `kind` + une date de référence, parcourir **chaque espace** puis **chaque membre actif** :
- **EVENING_MISSING / MORNING_YESTERDAY** : total `timeEntry.amount` pour `(membre, espace, refDate)` ;
  candidat si `total < capacité` (`membership.capacityPerDay`). **Skip** si une catégorie
  **non-productive** (congé/férié/formation) est saisie ce jour-là.
- **RAE_STALE** : tickets `assigneeId = membre`, espace, non archivés, `raeReal+raeTest > 0`,
  `raeUpdatedAt < now − NOTIF_RAE_STALE_DAYS`. Candidat si ≥ 1 ticket (message = nombre).
- **WEEKLY_RECAP** (vendredi) : un jour ouvré de la semaine a `total < capacité` (hors absences).

Garde-fous communs : membre **actif**, **jour ouvré**, **dédup** (`notification_log`),
**préférences** (`enabled` + flag du type), et ≥ 1 `push_subscription`.

## 8. Envoi (service `push.ts`)
- `sendToUser(userId, payload)` → toutes les subscriptions via `web-push`.
  - `410/404` → supprimer la subscription ; autre erreur → `failureCount++`, purge au-delà d'un seuil.
- Payload : `{ title, body, url, tag }` (url ex. `/imputation?w=<workspaceId>`, `tag` = kind+refDate).
- Après succès → insérer `notification_log` (dédup).

## 9. Planification (cron) — `routes/api/jobs/notify/+server.ts`
- Même patron que `api/jobs/cleanup` (protégé `CRON_SECRET`, GET/POST).
- `?kind=morning|evening|weekly` → calcule refDate en Paris :
  - `morning` : MORNING_YESTERDAY (veille ouvrée) **+** RAE_STALE.
  - `evening` : EVENING_MISSING.
  - `weekly` : WEEKLY_RECAP (vendredi).
- Idempotent. Scheduler externe : Vercel Cron (`vercel.json`) ou CronJob K8s, ~09:00 / ~17:00 / vendredi ~16:00 (Paris).

## 10. Service worker (`src/service-worker.ts`)
- `push` → `showNotification(title, { body, icon: '/icons/icon-192.png', badge, tag, data: { url } })`.
- `notificationclick` → focus d'un onglet existant ou `clients.openWindow(data.url)`.

## 11. Client & réglages
- Helper `src/lib/push.ts` : `subscribe()` (permission + `pushManager.subscribe` avec `PUBLIC_VAPID_KEY`
  + POST `/api/push/subscribe`), `unsubscribe()`, `savePrefs()`.
- Endpoints `routes/api/push/{subscribe,unsubscribe,prefs}/+server.ts` (JSON, gardés par `locals.user`).
- **Page `/settings`** (réglages perso) : section **Notifications** (activation → permission, toggles par
  type, bouton « notification de test ») ; y déplacer aussi le **thème** pour cohérence. Lien depuis la carte
  utilisateur de la sidebar.
- « Activé par défaut » : permission accordée + subscription stockée ⇒ `notifPrefs` par défaut = tout activé.

## 12. Maintien de `raeUpdatedAt` (`tickets.ts`)
- `createTicket` : `raeUpdatedAt = now`.
- `updateTicketField` : si `field ∈ {raeReal, raeTest}` → `raeUpdatedAt = now`.

## 13. Fichiers concernés (implémentation)
- `schema.ts` (+ migration) : `push_subscription`, `notification_log`, `notification_kind`, `ticket.raeUpdatedAt`, `user.notifPrefs`.
- `src/lib/server/services/notifications.ts`, `push.ts` ; `src/lib/server/config.ts`.
- `src/routes/api/jobs/notify/+server.ts` ; `src/routes/api/push/{subscribe,unsubscribe,prefs}/+server.ts`.
- `src/service-worker.ts` ; `src/lib/push.ts` ; `src/routes/settings/+page.{svelte,server.ts}`.
- `src/lib/utils/date.ts` ; `src/lib/server/services/tickets.ts`.
- Déploiement : `vercel.json` cron (ou manifest CronJob K8s) + doc env VAPID.

## 14. Vérification (à l'implémentation)
- `npx web-push generate-vapid-keys` → env ; `npm run build && npm run preview`.
- Autoriser les notifs (Chrome desktop) → une `push_subscription` est créée.
- `GET /api/jobs/notify?kind=evening&secret=…` → la notif arrive ; clic → ouvre `/imputation`.
- **Dédup** : rejouer → aucune 2ᵉ notif. **Garde-fous** : congé → rien ; week-end → rien ; temps partiel → seuil = capacité.
- **RAE** : modifier un RAE met `raeUpdatedAt` à jour ; ticket actif non touché > X jours → `RAE_STALE`.
- **Tests unitaires** purs : `isWorkday` / `previousWorkday` (autour d'un week-end), détection de manque
  (entrées → candidats), façon `calc.test.ts` / `date.test.ts`. `npm run check` + `npm run test` verts.

## 15. Hors périmètre (cette itération)
- Préférences **par espace** (on reste par utilisateur global au MVP).
- Canal email/Teams, digest configurable par l'admin, calendrier de jours fériés dédié
  (on s'appuie sur la catégorie « Jour férié » saisie en imputation).
