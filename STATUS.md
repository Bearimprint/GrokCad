# GrokCAD — état de session

> **Lire ce fichier en premier** à la reprise.  
> Spec texte / cotations : **`Text.md`**.  
> Spec pline / fill : `pline.md`.  
> Algo `/jonction` + `/join` : **`JONCTION.md`** · priorités bandes : `multi-couches-wall_Y.md`.  
> Vision : `README.md` · aide commandes : **`HELP.md`** (à jour pour text/cote/m1/r1).

**Version courante : 0.24.1**

**Répertoire :** `/mnt/Raid4Tb/Program/GrokProjects/GrokCAD`

```bash
/mnt/Raid4Tb/Program/GrokProjects/GrokCAD/lancer-GrokCad.sh
# → http://localhost:5173/  ·  titre GrokCad v.0.24.1
export PATH="${HOME}/.local/node/bin:${PATH}"
cd /mnt/Raid4Tb/Program/GrokProjects/GrokCAD
# tsc --noEmit  (via ./node_modules/.bin/tsc si besoin)
```

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

### B. Grille (déjà prévu avant)
1. **`/grid` on|off** — affichage grille (`Viewport.rebuildGrid` + pref `gridVisible`).
2. **`/gridsnap` on|off** — accroche grille au clic droit (si grille visible).

---

## Checklist reprise 30 s

1. `lancer-GrokCad.sh` → **GrokCad v.0.24.1**
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
| `/grid` on\|off · `/gridsnap` on\|off | **prochaine session** | — |
| `/jonction` T/Y multi-extrémités (cadre) | partiel | 0.18.x |
| `/extrude` · Undo | pas commencé | — |

---

## Décisions stables

| Sujet | Décision |
|-------|----------|
| Unités | stockées en unité doc ; grille espacée en **mètres réels** |
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
