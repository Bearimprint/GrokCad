# GrokCAD — état de session

> **Lire ce fichier en premier** à la reprise.  
> Spec texte / cotations : **`Text.md`**.  
> Spec pline / fill : `pline.md`.  
> Algo `/jonction` + `/join` : **`JONCTION.md`** · priorités bandes : `multi-couches-wall_Y.md`.  
> Vision : `README.md` · aide commandes : **`HELP.md`** (à jour pour text/cote/m1/r1).

**Version courante : 0.27.1**

**Répertoire :** `/mnt/Raid4Tb/Program/GrokProjects/GrokCAD`

```bash
/mnt/Raid4Tb/Program/GrokProjects/GrokCAD/lancer-GrokCad.sh
# → http://localhost:5173/  ·  titre GrokCad v.0.27.1
export PATH="${HOME}/.local/node/bin:${PATH}"
cd /mnt/Raid4Tb/Program/GrokProjects/GrokCAD
# tsc --noEmit  (via ./node_modules/.bin/tsc si besoin)
```

---

## Session 2026-10-24 — correctif cotes en continu (→ **0.27.1**)

- **`/cotecont` + `/explode`** : effacer un libellé seul ne décale plus les autres. `labelIds` reste indexé par segment (trou `''` pour un texte effacé), conservé à la copie et dans le `.gkd`. Test : `npm run test:cotecont`.

## Session 2026-10-23 — cotes en continu (→ **0.27.0**)

- **`/cotecont`** : une seule `DimensionEntity` (`mode: 'chain'`), un texte par segment. Passage + direction comme `/cote`, puis les points du bâtiment. La valeur est la projection sur la direction, pas la distance brute entre clics. **Échap** valide toute la chaîne d’un coup (un pas d’annulation).
- Déplacer, tourner, copier ou effacer la chaîne emporte **tous** les libellés. Effacer un texte seul retire seulement ce libellé.
- **`/explode`** découpe la chaîne en cotes `/cote` (positions de textes déjà déplacés conservées).
- Pas encore : cote cumulée (totaux courant depuis l’origine).

## Session 2026-10-23 — portes, fenêtres, arcs continus, annuler (→ **0.26.0**)

- **`/porte`** **`/portedouble`** **`/fenetre`** **`/fenetredouble`** : pose directe dans un mur. Trou sur l’épaisseur, battant (calque −10) qui suit la largeur et tourne avec le mur. **[ALT]** côté, **[CTRL]** miroir, souris ou `dx 0.9`. Près de l’ancre : largeur par défaut (**Paramètres**).
- Symboles : `library/insertions/doors/porte.gkd`, `porte_double.gkd`, `windows/fenetre.gkd`, `fenetre_double.gkd`.
- **`/arccont`** : une seule polyligne, continuité tangente, plus de cassure entre arcs séparés.
- **`/undo`** **`/redo`** (Ctrl+Z, Ctrl+Y). **`/mc`** : calque courant = calque de l’élément cliqué.
- Test : `scripts/test-openings.mts`.

## Session 2026-10-18 — correctif calques masqués (→ **0.25.6**)

- Masquer, isoler, la case du dialogue, ou `/verscalque` vers un calque masqué retire ces éléments de la sélection et de la désignation. `/delete` ne les efface pas.
- **Alt+F1…F12** filtre le rappel avec `entitiesOnVisibleLayers`.
- Test : `scripts/test-layer-style.mts`.

## Session 2026-10-17 — Étape 1, calques complets (→ **0.25.5**)

- Attributs des calques 1–127 dans `drawLayers` : couleur (blanc), épaisseur 1 px, style plein, police Tahoma, gras, italique, visible. Anciens `.gkd` reçoivent ces défauts sans perdre leurs entités ni leurs couleurs déjà posées.
- **DuCalque** : un trait ou un texte sans choix explicite suit le calque. `/couleur`, `/epaisseur`, `/style` et la barre de styles figent l’attribut. Les nouveaux textes prennent la police du calque courant.
- Un calque masqué n’est ni dessiné, ni accroché, ni sélectionnable (clic ou fenêtre). Le calque courant ne peut pas être masqué.
- `/calques afficher|masquer|toutafficher|isoler|couleur|epaisseur|police|nom`. Dialogue : case visible, couleur, épaisseur, police, libellé. `/selcalque` (`/layersel`, `/sc`) et `/verscalque`.
- Les calques négatifs d’insertion ne changent pas.
- Test : `scripts/test-layer-style.mts`.

## Session 2026-10-16 — Étape 0, unités et corrections (→ **0.25.4**)

- **Unités.** Les coordonnées restent dans l’unité du document. Les tolérances physiques sont dans `src/core/tolerances.ts` (mètres) et passent par `metersToDoc` au moment de la comparaison. En mètres le facteur vaut 1. Un `snapTol` explicite n’est pas reconverti. Seuils d’angle nommés : `ANG.antiparallelDot` (−0,95), `ANG.yInLPerpDot` (0,4).
- **Pieds et pouces** dans `UnitId`. Export DXF `$INSUNITS` : in 1, ft 2, mm 4, cm 5, m 6, km 7.
- **INSERT** : `insertDepth` est incrémenté ; un bloc déjà en cours d’expansion est signalé comme référence circulaire.
- **Outils.** `DrawingTools` reste la façade. Clics (canvas et `acceptPoint`) passent par `dispatchPoint`. Un seul `ModifierTracker` (`dispose()` sur `beforeunload`). Contraintes, aperçu d’entité, entrée de chaîne et outils simples (`/cut`, `/d`, aides, `/point`, `/dist`) sont dans `src/core/tools/`. Les machines copy/move/m1/r1 et les murs restent sur la façade ; leur aperçu utilise le traceur commun.
- Messages de longueur (`formatLength`, unité du document). `/pan` aussi. `window.prompt` de `/obj` et `/extract` remplacé par le dialogue (une ligne, Entrée confirme).
- Test : `scripts/test-units.mts`. `tsc --noEmit` et tous les `scripts/test-*.mts` passent.

## Session 2026-10-03 — ouverture `/iw` (→ **0.25.3**)

- Longueur : la souris étire depuis l’ancre (cote `dx 1.2`) jusqu’au clic, ou `dx 1.2` / `1.2` valide tout de suite. Sens inverse si la souris (ou un `dx` négatif) part de l’autre côté.
- Largeur : sur un mur, Y étirable (ou symbole tout entier s’il n’a que des calques fixes, ex. `text_rect_Vide` sur −1) est calé sur l’épaisseur (min→max des offsets).
- Trou : les traits du mur dans cette empreinte sont coupés (rendu, snap, sélection, DXF).
- Test : `scripts/test-insert-opening.mts`.

## Session 2026-09-06 — `/ancrage` (→ **0.25.2**)

- `/ancrage` `/anchorpoint` `/anchor` `/ap` : force le calque spécial **−9**, pose un unique point d’ancrage (clic G/D ou `X,Y,Z` complet). Pas de vecteur relatif.

---

## Session 2026-09-06 — Portes / Fenêtres / Autres (→ **0.25.1**)

- `library/insertions/{doors,windows,others}/`
- `/od` `/opendoor` `/insertdoor` `/id` → onglet Portes. `/ow` `/openwindow` `/insertwindow` → Fenêtres. `/oo` `/openother` `/insertother` `/io` → Autres.
- **`/iw` non réutilisé** (déjà insertion dans un mur).
- Créer / Modifier : save du dessin, canvas cadre rouge 3 px, liste calques spéciaux (gauche/droite, Paramètres). ID spécial barre ⇄ liste canvas, même source.
- `/save` insertion : nom seulement ; refuse sans ancre −9 (bouton unique, force −9) ; puis réouvre le .gkd d’origine.

---

## Session 2026-09-06 — calques + insertions mur (→ **0.25.0**)

- **Calques 1–127** (pas de 0) : ordre de dessin, libellé 255 car. Défaut `Couche numero N`, couche 1 = **Bedrock layer**.
- Champ `drawLayer` sur chaque entité `.gkd` + table `drawLayers` + `currentDrawLayer`. Anciens fichiers → tout en **1**, **sans** calques négatifs.
- UI : n° dans la barre supérieure, clic = liste n° + libellé. `/calques` `/layers` `/couche n`.
- **Calques −1…−127** (objets `library/insertions/`) : fixe / étirable X Y Z / ancre −9 (rond orange). Visibles dans la barre seulement en édition insertions.
- **`/iw` `/insertinwall` `/iiw`** : biblio insertions → désigner mur/ligne/arc → [ALT] intérieur/extérieur, [CTRL] miroir le long de l’hôte → étirer X (souris ou `0.65`). Ancre −9 obligatoire.

---

## Session 2026-08-15 — `/grid` + `/gridsnap` (→ **0.24.16**)

- **`/grid on|off`** : affiche / masque la grille (écart Paramètres, 1 u. = 1 m réel).
- **`/gridsnap on|off`** : accroche nœud de grille au clic droit. `/gridsnap on` si grille cachée → *« impossible d'activer la grille quand celle-ci est cachée »*.
- Barre du bas : **Grid ON/OFF** + **Grid Snap ON/OFF** (ON vert gras, OFF rouge gras), clic = bascule. Grille cachée → Grid Snap OFF grisé, non cliquable.
- Paramètres : case *« Grid Off désactive automatiquement le snap de la grille »* (cochée par défaut).

---

## Session 2026-08-15 — `/corner` + L flip [ALT] (→ **0.24.15**)

- **`/corner`** (`/coin`) : 2 clics, **toujours un L**, jamais un T. Un mur long qui « passe devant » est coupé au coin. Si les 2 murs se croisent (X), le clic sur chacun choisit le quadrant à garder.
- L avec un mur `[ALT]` : le offset-polyligne mettait les couches à l’envers. Appariement extérieur→intérieur du L.
- **`/paral 1.2`** : désigner un objet, clic = côté, copie à 1,2 u., enchaîne jusqu’à Échap. `/help` à jour (toutes les commandes).

---

## Session 2026-08-15 — micro-trous peigne (→ **0.24.14**)

Après ouverture de la barre, un hit du pied (placo / face0) restait 8–12 mm avant le remnant. Recalage du bout de barre sur le hit (max 4 cm), sans changer le BIM.

---

## Session 2026-08-15 — trim perp + Y ouvre les 2 bras (→ **0.24.13**)

`/trim` étape 2 : n’importe quel clic gauche, même loin — la **perpendiculaire** donne le point de coupe. Si le pied tombe hors du trait : *« point hors de l’objet »*.

`/jonction` Y : le peigne ouvrait la barre aux offsets théoriques du pied (souvent *à gauche* du L). Désormais les ouvertures se font aux **hits réels**, y compris sur l’autre bras du L, pour que béton↔béton se voie.

---

## Session 2026-08-15 — `/openlast` + `/trim` (→ **0.24.12**)

- **`/openlast`** (`/dernier` `/last`) : rouvre le dernier `.GKD` ouvert ou enregistré. Historique de **7** chemins (localStorage `grokcad.app.recentFiles`), un même fichier n’apparaît qu’une fois (remonté en tête). Fichier manquant → retiré, on essaie le suivant.
- **`/trim`** (`/ajuster` `/tr`) : 1) objet 2) endroit 3) côté à garder (aperçu). Ligne, arc, mur, polyligne **ouverte**. Refus : polyligne/polymur fermé, instance library.

---

## Session 2026-08-15 — `/jonction` Y ne casse plus le L (→ **0.24.11**)

`/jonction` attirait le 45° dans le coin du L (snap 65 cm) et traitait les 3 murs comme une étoile : axes du L déplacés, onglet détruit, couches en trou.

Désormais : si un L est déjà collé et que la 1ʳᵉ intersection d’axes du 3ᵉ mur n’est **pas** le coin, ce mur reste un **pied** (T/BIM). Le L ne se raccorde qu’entre soi. Tol. de nœud après snap plafonnée à 8 cm.

---

## Session 2026-08-15 — BIM priorités restauré (→ **0.24.10**)

Le 0.24.9 forçait une **butée d’enveloppe** dès qu’un T/`/join` touchait une barre déjà en L (Y, cadre U, T mid sur un L). Toutes les couches s’arrêtaient sur la face ext. : le béton (1) ne rejoignait pas le béton, l’isolant (3) laissait un vide, le placo (5) traversait visuellement le noyau.

Désormais, **chaque trait** :

1. choisit le mur du L dont il rencontre l’enveloppe en premier ;
2. applique le BIM **sur ce mur seul** — prio P traverse seulement prio > P.

| Couche | Comportement |
|--------|----------------|
| Structure béton (1) | rejoint le béton d’entrée du mur rencontré |
| Isolant (3) | rejoint l’isolant s’il n’a pas à traverser le béton ; sinon **stop net** contre la face béton (pas de vide) |
| Placo / enduit (5) | stop à la 1ʳᵉ face ≤ 5 (enduit ou béton) |

`/join` + `[ALT]` (flip) et T depuis la face 0 : même règles. Un mur collé à l’autre bout de la barre n’est plus un obstacle.

---

## Session 2026-08-14 — `/jonction` Y butée face ext. (→ **0.24.9**)

Le 0.24.8 perçait encore le L (0,02 → béton intérieur du vertical, isolant → béton H). `Y_jonction_OK.png` est une **butée** : chaque trait du 45° s’arrête sur la **face extérieure** du mur du L qu’il rencontre en premier (2 contre le vertical, le reste contre l’horizontal). Pas d’onglet, pas de perçage. Le T simple (`/join`) garde le BIM couches.

---

## Session 2026-08-14 — `/jonction` Y enveloppe du L (→ **0.24.8**)

Le béton extérieur du 45° (offset 0,02, prio 1) s’arrêtait au **béton intérieur** de l’horizontal (t un peu plus petit que le vertical). Trou dans le faisceau, 2 traits qui n’atteignent pas le vertical, 3 traits sous le L.

Désormais : 1ʳᵉ rencontre = **face d’entrée** du L (enveloppe), puis BIM **sur ce mur seul**. Résultat attendu (`Y_jonction_OK.png`) : 2 traits → vertical, isolant/placo → horizontal, pas de trou.

---

## Session 2026-08-14 — `/jonction` Y sans trou (→ **0.24.7**)

Le béton du 45° s’arrêtait au **coin** du L (hit sur le bout du vertical) et ouvrait un trou dans le faisceau. Les hits sur le partenaire à moins de 8 cm du coin sont ignorés : ce trait continue jusqu’à l’horizontal (comme `Y_jonction_OK.png`).

---

## Session 2026-08-14 — `/jonction` parallèles réelles (→ **0.24.6**)

L’intersection se faisait depuis le coin (faux vertical décalé). Désormais chaque couche du 45° coupe les **traits réels** du L : celles qui voient le vertical s’y arrêtent, celles qui voient l’horizontal (isolant→béton, placo→enduit) s’y arrêtent.

---

## Session 2026-08-14 — `/jonction` L+diag first-hit 2 murs (→ **0.24.5**)

Les couches décalées du 45° traversaient le **vertical** du L pour rejoindre l’horizontal. First-hit contre **les deux** murs du L : isolant / placo s’arrêtent à la 1ʳᵉ face béton / enduit rencontrée (H ou V). Pas d’allongement d’un mur déjà en T mid-span.

---

## Session 2026-08-14 — `/jonction` 1ʳᵉ barre (→ **0.24.4**)

Un 45° + L collait le pied au **vertical** (T sur le segment) au lieu de l’**horizontal** rencontré en premier. Isolant / placo s’arrêtaient trop tôt.

| Règle | Comportement |
|-------|----------------|
| Cible | 1ʳᵉ intersection d’axes le long du pied (pas « T préféré ») |
| Isolant | stop sur le béton de cette barre (pas d’onglet) |
| Placo | stop sur l’enduit de cette barre (pas d’onglet) |

---

## Session 2026-08-14 — `/ml` plus d’accroche au clic gauche (→ **0.24.3**)

Le preview `/ml` enchaînait un mur existant jusqu’à **50 cm** du départ (≈ 100 px zoomé) et dessinait l’onglet comme si on s’était accroché. Clic gauche = point brut ; seul le clic droit accroche (20 px).

---

## Session 2026-08-14 — `/jonction` cadre 3 murs (0.24.1 → **0.24.2**)

`/join` OK ; `/jonction` ignorait un pied à ~1 m d’un L déjà collé (tol. snap 65 cm) et classait en L un T à 20 cm du bout (zone = épaisseur 29 cm).

| Correctif | Détail |
|-----------|--------|
| Zone L/T | 5–10 cm (plus l’épaisseur entière) |
| Cadre | bout **pendant** allongé jusqu’à l’axe d’un autre mur du cadre |

---

## Session 2026-08-13 — correctifs joints (0.24.0 → **0.24.1**)

Revue `/jonction` + `/join` : bugs de snap T/Y, peigne, zone L, stratégie Y/N.

| Correctif | Détail |
|-----------|--------|
| Snap T/Y | plus de barycentre : chaque bout glisse sur son axe |
| Peigne | le `strokeGeom` loin du pied (L / 2ᵉ T) est conservé |
| `/join` L/T | zone L = épaisseur des murs (plus 8 % de la barre) |
| Stratégie Y/N | `joinStrategy` persisté sur le mur ; `rejoinWalls()` ne l’écrase plus |
| Structure | prio min sur la barre (parpaing 2), pas un `1` figé |
| Y/N | autre commande / `resetState` restaure le snapshot (sauf Oui) |

---

## Session 2026-08-09 — livré (0.23 → **0.24.0**)

### Texte & barre de styles
| Commande / UI | Rôle |
|---------------|------|
| `/text` · `/txt` | Texte simple ; dialogue si pas de contenu ; départ + direction |
| `/textbox` | Texte + rectangle (décalage dans `/param`, défaut 0,03) |
| Barre du **haut** | Trait (couleur/épaisseur/style) · texte (police, couleurs, fond transparent, taille, B/I) · style de cotation |
| Baseline | Point d’insertion = **baseline** des caractères (plus le milieu) |

### Rectangle
| `/rect` | Polyligne **fermée** rectangle ; **[Shift]** = carré ; CLI `0,0,0 dxy …` |

### Cotations `/cote`
- **1 segment = 1 `DimensionEntity` + 1 `TextEntity`** (libellé réel, sélectionnable).
- Commit **immédiat** à chaque segment ; **Échap / autre commande** : segments déjà posés **conservés**.
- Direction après 1er clic : rubber-band + **[Shift]** H/45°/V.
- Style : `textOffset` (écart ligne ↔ baseline), listes via `/cotations` ou ⚙ barre haut.
- `labelId` sur la dim · `dimId` sur le texte (liaison pour move/delete/copy).

### Déplacement / rotation un objet
| Commande | Rôle |
|----------|------|
| `/m1` | Désigner → base → dest. Dim (ligne) = segment + texte lié ; texte = libellé seul |
| `/r1` · `/rotation` | Désigner → pivot → réf → angle. Même règle dim/texte |
| `/move` | Sélection multi (inchangé) |
| **[Shift]** | Sur `/move`, `/m1`, `/copy` : vecteur H/45°/V comme `/ligne` |

### Fichiers clés ajoutés / touchés
- `src/core/textPrefs.ts`, `dimPrefs.ts`, `dimension.ts`, `textMeasure.ts`
- `src/ui/StyleBar.ts`, `TextInputDialog.ts`, `DimStyleDialog.ts`
- `src/core/tools.ts`, `commands/registry.ts`, `EntityLayer.ts`, `document.ts`, `entityOps.ts`
- Spec source : `Text.md` · aide : `HELP.md`

### Non fait (prochaine session cotations)
| Item | Notes |
|------|--------|
| **`/cotecont`** | Chaîne continue = 1 entité multi-segments ; utile pour plans de bâtiment |
| Cumul sur chaîne | Ligne de côte avec total des segments continus |
| **`/explode`** sur `/cotecont` | Découper en segments `/cote` pour modifier un morceau |
| Ajustements UI | Affiner hit-test / styles selon retours terrain |

---

## Prochaine session — à faire en priorité

### A. Cotations suite (`Text.md` + retours 09/08)
1. **`/cotecont`** — chaîne multi-segments (1 entité), déplacement/effacement global.
2. Cumul optionnel des valeurs sur la chaîne.
3. **`/explode`** sur chaîne → segments `/cote` individuels.

### B. Grille
**Fait en 0.24.16** — `/grid` · `/gridsnap` · pastilles barre du bas · case Paramètres.

---

## Checklist reprise 30 s

1. `lancer-GrokCad.sh` → **GrokCad v.0.25.4**
2. Smoke texte : `/txt Cuisine` · `/rect` + Shift · `/textbox`
3. Smoke cote : `/cote` (2+ segments, Échap, sélection texte seul, `/m1` ligne vs texte)
4. Smoke move : `/move` et `/m1` avec **[Shift]** H/45°/V
5. Puis : `/cotecont` **ou** `/grid` / `/gridsnap` selon priorité métier

---

## Session 2026-08-08 — résumé (0.21.x → 0.22.5)

### `/join` — peigne BIM multi-couches (validé UI)

Modèle **bandes matériaux** (`wallLineJoinPriority`) :
- trait 0 = 1ʳᵉ face (géométrie) ; matériaux = bandes entre traits ;
- prio raccord mur test : `5,1,1,3,5` (deux faces béton = prio 1).

**T mid-span** (`joinStemToBarPeigne` dans `recomputeLinearWallJoints`) :

| Règle | Comportement |
|-------|----------------|
| Pied | first-hit : prio P traverse seulement prio **> P** ; prio **≤ P** = barrière |
| Béton | bande matériau : faces du pied stoppent sur la **face d’entrée** de la barre (pas de traverse de l’épaisseur béton) |
| Barre face entrée béton | **ouverte** entre les 2 faces béton du pied |
| Face0 enduit barre | **continue** (pas de « grand vide ») |
| Peaux ext. (isolant/placo) | ouvertes ; bords exacts (plus de clear 8 mm) |

Coins **L** : `resolveStarNodeStrokes` / offset polyligne (inchangé pour L pur).

### `/jonction`

- Snap extrémités dans le cadre : tol. **65 cm** (`WALL_REJOIN_SNAP_TOL`).
- Si aucun snap : feedback avec **distance des plus proches extrémités**.
- L diagonaux OK si bouts ≤ 65 cm.

### `/dist` (nouveau)

- Interactif : 1er point → 2ᵉ point → distance dans l’**unité document** + Δx/Δy/Δz.
- Alias : `/distance` `/mesure` `/measure` `/di` · enchaîne jusqu’à Échap.
- Code : `DrawingTools.startDist` · commande dans `registry.ts`.

### `/open` UX

- **Entrée** valide OK quand un fichier est sélectionné dans le navigateur de fichiers.

### Fichiers touchés (principaux)

| Fichier | Rôle |
|---------|------|
| `src/core/walls.ts` | peigne T, snap `/jonction`, joints |
| `src/core/wallLayerCatalog.ts` | `wallLineJoinPriority` (bandes) |
| `src/core/tools.ts` | `/dist`, feedback jonction |
| `src/commands/registry.ts` | commandes |
| `src/ui/FileBrowserDialog.ts` | Enter → confirm |
| `scripts/test-join.mts` · `test-layer-priority.mts` | non-régression |

---

## Tableau d’avancement

| Étape | État | Version |
|-------|------|---------|
| Phases 1–4 (pline, pmur, point, stretch, save, open…) | **fait** | — |
| `/open` dernier dossier + Enter = OK | **fait** | 0.22.x |
| `/ligne` · `/pline` multi-args | **fait** | — |
| `/jonction` L (axes préservés) | **OK** | 0.18+ |
| `/jonction` snap tol. 65 cm + feedback nearest | **OK** | **0.22.5** |
| `/join` peigne bandes / béton / peaux ext. | **validé UI** | **0.22.4–0.22.5** |
| `/dist` mesure 2 points | **fait** | **0.22.5** |
| `/grid` on\|off · `/gridsnap` on\|off | **fait** | **0.24.16** |
| Étape 0 — tolérances, unités, DXF, découpe outils | **fait** | **0.25.4** |
| Étape 1 — calques (attributs, DuCalque, visibilité, /selcalque) | **fait** | **0.25.5** |
| Correctif — sélection / désignation quittent un calque masqué | **fait** | **0.25.6** |
| `/join` + `/jonction` Y : BIM priorités (béton↔béton, isolant stop net) | **OK** | **0.24.10** |
| `/jonction` T/Y multi-extrémités (cadre) | partiel | 0.18.x |
| `/extrude` · Undo | pas commencé | — |

---

## Décisions stables

| Sujet | Décision |
|-------|----------|
| Unités | coordonnées dans l’unité du document ; tolérances en mètres (`tolerances.ts` + `metersToDoc`) ; grille en **mètres réels** ; changer d’unité met le dessin à l’échelle |
| Vecteurs ligne | forme décollée : `dx 1.5` |
| Jonction L | snap = intersection des **axes** |
| `/join` T mid | peigne bandes : béton = entrée ouverte, face0 continue |
| Priorité | 1 = plus forte ; P ne traverse pas prio ≤ P |
| `/jonction` snap extrémités | **65 cm** |
| F10 | rotation caméra +45° Z |

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `STATUS.md` | **Ce fichier** |
| `JONCTION.md` | Algo L/T/Y |
| `multi-couches-wall_Y.md` | règles BIM priorités |
| `HELP.md` | tableau commandes |
| `src/core/walls.ts` | joints murs |
| `src/core/appPrefs.ts` | prefs snap / grille (à étendre pour grid visible + gridsnap) |
| `src/viewport/Viewport.ts` | grille `GridHelper`, unités, caméra |
| `src/core/tools.ts` | outils interactifs dont `/dist` |
| `scripts/test-*.mts` | `npm run test:jonction` |

---

*2026-08-08 fin de session — v0.22.5 ; prochaine = `/grid` + `/gridsnap`.*
