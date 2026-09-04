# Périmètres applicatifs, CP / backup / DP et consolidation

> Fonctionnalité livrée. Ce document explique **pourquoi** le modèle est celui-là, et surtout ce
> qui a été volontairement écarté — c'est là que se trouvent les pièges.

## 1. Le besoin

- un **CP** pilote un **périmètre applicatif** ;
- un **collaborateur** intervient sur **plusieurs périmètres** ;
- un **CP peut être le backup d'un autre CP**, et agit alors comme CP de ce périmètre ;
- des **chantiers transverses** n'appartiennent naturellement à aucun périmètre applicatif ;
- le **DP** voit chaque périmètre, y agit comme CP, **et** consolide charges + économie.

## 2. Pourquoi un sous-scope et pas un espace de plus

Imputo n'avait qu'un niveau de cloisonnement : l'**espace**, avec isolation totale
(cf. `SPECS.md` §12). Faire du périmètre un espace supplémentaire aurait :

- **éclaté la feuille d'imputation** d'un collaborateur multi-périmètres, qui aurait dû changer
  d'espace ligne par ligne — l'exact contraire du besoin ;
- **dupliqué les référentiels** (SSP, activités, états, catégories) autant de fois que de
  périmètres ;
- rendu la consolidation DP **cross-tenant**, ce que `isolation.test.ts` interdit précisément.

Le périmètre est donc un **sous-scope à l'intérieur de l'espace**. L'espace reste la frontière
d'isolation : les tests d'isolation existants sont inchangés et verts.

```
workspace (le domaine du DP — isolation inchangée)
 ├── perimeter « Applications mobiles »   CP: Alice · backup: Bob
 ├── perimeter « Portail web »            CP: Chloé · backup: Bob
 └── perimeter « Transverse »             transverse = true
collaborateur = membre de l'espace + rattaché à N périmètres
```

## 3. Modèle

| Table / colonne | Rôle |
|---|---|
| `perimeter` | nom, couleur, `transverse`, ordre, `archivedAt` |
| `perimeter_member` | rattachement `(perimeterId, userId)` + rôle `CONTRIBUTOR \| CP \| CP_BACKUP` |
| `ticket.perimeterId` | **NOT NULL** — l'autorité du rattachement |
| `ssp.perimeterId` | nullable — porte le **budget** (`budgetDays`) |
| `project.perimeterId`, `sprint.perimeterId` | nullables, filtrage des pickers |

**`CP` et `CP_BACKUP` ouvrent exactement les mêmes droits** (`isLeadRole`). La distinction n'existe
que pour l'affichage. Un même user étant `CP` d'un périmètre et `CP_BACKUP` d'un autre, le cas
« un CP backup d'un autre CP » tombe du modèle sans champ dédié.

### Le piège central : deux chemins de rattachement

| Ce qu'on ventile | Par quoi | Exact ? |
|---|---|---|
| charges (conso, RAE, estimation) et budget du ticket | `ticket.perimeterId` | **oui, toujours** |
| budget et prod portés par le code SSP | `ssp.perimeterId` | non si le code est partagé |

`ssp.budgetDays` n'a aucun autre porteur possible, d'où `ssp.perimeterId`. Mais **la conso ne passe
jamais par le code SSP** : un code partagé entre deux périmètres donnerait des chiffres faux. Un
code sans périmètre alimente une ligne **« Partagé »** plutôt qu'une répartition arbitraire.
Un test dédié (`perimeterConsolidation.test.ts`) épingle exactement ce cas.

## 4. Droits

| Persona | Traduction |
|---|---|
| **DP** | `membership.role = ADMIN` → lead implicite de **tous** les périmètres |
| **CP / backup** | `perimeterMember.role ∈ (CP, CP_BACKUP)` → chiffrage et budget **de ses périmètres** |
| **Collaborateur** | `USER` + `CONTRIBUTOR` sur N périmètres |

`membership.role` est inchangé ; le périmètre est une **élévation** par-dessus. Le contexte
(`locals.perimeterCtx`) est chargé par `hooks.server.ts` ; `canLead(ctx, perimeterId)` est le
prédicat unique, évalué **toujours après** le filtre `workspaceId`, jamais à sa place.

Conséquences concrètes :

- la rédaction de `estimationPrev` / `enveloppeTotale` / TNF budget se décide **ticket par ticket**
  (`LeadScopeArg` a remplacé l'ancien booléen `isAdmin`, devenu insuffisant) ;
- déplacer un ticket entre périmètres exige d'être lead **des deux côtés** ;
- un CP **consulte** l'imputation des collaborateurs de ses périmètres ; l'écriture pour autrui
  reste ADMIN strict ;
- un MANAGER qui ne pilote aucun périmètre perd l'édition du chiffrage. La migration `0065` fait CP
  tout ADMIN/MANAGER existant sur le périmètre par défaut : rien ne change sur l'existant, c'est
  pour les périmètres créés ensuite que le rattachement devient explicite.

## 5. Consolidation DP — `/dashboard/consolidation`

Une ligne par périmètre, charges et économie côte à côte, plus un total.

- **charges** : estimé, consommé, RAE, écart d'exécution, avancement, nb tickets ;
- **économie ticket** : enveloppe, PPR, TNF budget ;
- **économie SSP** : budget alloué, prod, TNF — repris de la chaîne du Suivi annuel, même
  définition, déjà testée.

Un CP voit les **charges** de tout l'espace (elles ne sont pas confidentielles) mais **l'argent des
seuls périmètres qu'il pilote** — et aucun total d'argent n'est affiché tant qu'une ligne est
masquée : un total partiel se lirait comme un total complet.

**Pas de filtre de période, volontairement.** La partie économie est cumulative par construction ;
la borner la rendrait incomparable à elle-même, et la juxtaposer à des charges bornées mettrait
deux notions différentes sur la même ligne. Le détail mois par mois vit dans le Suivi annuel.

## 6. Ce qui n'est PAS découpé par périmètre, et pourquoi

### Clôture mensuelle (`/admin/cloture`)

Le « prévu du mois » est une donnée **personne** (ouvrés − congés − formation − hors-projet), et le
« à ventiler » n'a de sens que si la **totalité** des jours d'une personne tient dans le même écran.
La découper ferait apparaître un collaborateur multi-périmètres dans N clôtures, chacune avec un
prévu partiel — et l'index unique « une seule passe DRAFT par mois » devrait devenir « par mois et
par périmètre ».

→ Les colonnes SSP sont **ordonnées et étiquetées** par périmètre. Pas de filtre de colonnes ni de
sous-total par personne : le « Total » et le « À ventiler » n'ont de sens que complets, et un total
partiel sur un écran qui part en compta se lirait comme un total tout court.

### Suivi annuel (`/admin/suivi-annuel`)

La chaîne `RAE(M) = RAE(M-1) − Prod(M)` est amorcée par `ssp.budgetDays` et **portée par le code**.
Un code partagé entre deux périmètres a un RAE non ventilable : il n'existe pas de clé de
répartition. Le curseur de mois est par ailleurs global à l'espace.

→ Les lignes sont **groupées** par périmètre, avec un cumul budget/conso/prod/TNF par groupe, de
même portée que la colonne « Cumul » donc comparable.

Dans les deux cas, un code rattaché à un **périmètre archivé** retombe en « Partagé » : son budget
existe toujours, il doit rester lisible quelque part.

## 7. Laissé de côté

- **Ventilation d'un ticket sur plusieurs périmètres** (clé de répartition %) : écartée au profit du
  périmètre transverse — tous les agrégats deviendraient pondérés.
- **Pastille de périmètre sur « Mon imputation »** : imposerait une jointure de plus sur la requête
  de la grille, l'écran le plus sollicité, pour un gain cosmétique. La feuille reste unifiée, ce qui
  était l'exigence.
- **Accès en lecture d'un CP à la clôture mensuelle** : fermé par défaut (l'écran expose le prévu et
  les absences de tout le monde). À trancher si le besoin apparaît.
- **Référentiels par périmètre** (états, activités, catégories) : restent partagés par espace.
- **Notifications / absences / support** : restent au niveau espace.
