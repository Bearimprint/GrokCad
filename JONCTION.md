# `/jonction` & `/join` — raccords multi-couches (L / T / Y)

> Doc technique pour reprendre sans re-expliquer.  
> Code : `src/core/walls.ts` → `resolveStarNodeStrokes`, `snapAndRejoinWallsInBox`, `joinWallToWall`.  
> Version de référence : **0.24.11** (Y dans un L : le L reste un L ; le pied fait le BIM).

---

## `/join` (v0.21) — désignation 2 murs

Pour coller un mur horizontal sur le **flanc** d’un vertical (ou L coin) :

1. `/join`
2. Clic sur le mur **à prolonger** (près du bout voulu)
3. Clic sur le mur **cible**
4. L’axe du 1er est allongé jusqu’à l’axe du 2e ; `strokeGeom` recalculé **couche par priorité**
5. Mode **T** si l’intersection est au milieu de la cible ; **L** si près d’une extrémité

Ne remplace pas `/jonction` (cadre multi-extrémités) : les deux coexistent.

Algo : `joinWallToWall` (allonge l’axe) + `joinStemToBarPeigne` (**priorités + découpe peaux ext.**) :
- le **pied** : first-hit selon `priority` —
  - prio P traverse prio **> P** ; stop prio **≤ P** (1ʳᵉ rencontre) ;
  - même prio + même `layerTypeId` (isolant↔isolant) : joint la jumelle (sans traverser un prio ≤ P) ;
  - même prio + type différent (enduit↔placo) : stop (face ext.) ;
  - béton (1) → béton d’entrée (ne traverse pas l’épaisseur) ;
  - Y dans un L : 1ʳᵉ enveloppe = quel mur, puis BIM **sur ce mur seul** ;
- la **barre** : peaux **extérieures** à la structure **coupées** dans la bande du pied ;
  structure + face lointaine **continues**.

---

## Ce que fait `/jonction`

1. Cadre **2 clics** autour des extrémités à raccorder.
2. **Snap** extrémités (murs + polymurs) ≤ **65 cm**, puis **allonge** les bouts
   encore pendants jusqu’à l’axe d’un autre mur du cadre (comme `/join`) :

   - **L (2 murs)** → **intersection des axes support** (allonge/raccourcit seulement, **ne tourne pas** les murs).  
     Bug 0.18.0 : barycentre → murs hors de leurs lignes d’origine (aides vertes).
   - **Colinéaires** → milieu projeté sur l’axe commun.
   - **T/Y (3+)** → intersection pied ∩ barre si barre colinéaire ; sinon moyenne des intersections 2-à-2, chaque bout glisse **sur son axe** (pas de rotation).
3. Recalcul `strokeGeom` : chaque couche reste // à sa base.
4. Si nœud **T/Y** (degré ≥ 3) : **cycle de solutions** Oui/Non (voir ci-dessous).
5. Si nœud **L** seulement (degré 2) : validation immédiate (first-hit / préférence).

---

## Règles utilisateur (à respecter absolument)

1. **Parallélisme** : un trait ne quitte jamais sa droite // à la base.
2. **Même couche → même couche** : d’abord par **priorité** (`WallLineDef.priority`,
   catalogue `library/walls/layer-priorities.json`) ; repli historique = même offset.
   Priorité **1** = plus haute importance (structure) ; **5** = finition (placo…), etc.
   Plusieurs couches de même priorité s’apparient par **rang** (ordre des offsets).
3. Une couche de prio **P** **peut traverser** les couches partenaires de prio **> P**
   (plus faibles) pour rejoindre sa correspondante.
4. Elle **ne traverse pas** une couche de prio **≤ P** (égale ou plus importante) :
   1ʳᵉ rencontre (min-t) = stop. Ex. placo (5) s’arrête au béton (1) — **pas de stubs**
   qui traversent le porteur.
5. Cover partenaire (allonger B jusqu’au hit de A) : seulement si joint **même priorité**
   (évite d’étirer le béton pour coller une finition).
6. Les priorités sont traitées de **1 → N** (structure d’abord, finitions ensuite).

---

## Mode interactif T/Y : « Solution à garder Y/N ? » (v0.18.0)

Quand le nœud a **3+ extrémités** snappées ensemble (T/Y/croix), après calcul de la 1ʳᵉ solution :

1. Feedback : `JONCTION — Solution k/4 « … » — garder ? Clic GAUCHE = Oui · Clic DROIT = Non`
2. **Clic gauche (Yes)** → valider, mémoriser la préférence pour cette signature, terminer.
3. **Clic droit (No)** → solution suivante, re-afficher, re-demander.
4. Tant que Non → cycle les 4 solutions.
5. **Échap** → annule et **restaure** le document d’avant `/jonction`.
6. La solution choisie est **mémorisée** (`localStorage` `grokcad.jonctionPrefs`) et **proposée en premier** la prochaine fois pour la même signature.

### Les 4 solutions

| # | Id | Label UI | Idée |
|---|-----|----------|------|
| 1 | `first-hit` | 1ʳᵉ rencontre | min-t, trim stubs, cover prudent (défaut 0.17.9) |
| 2 | `first-hit-cover` | 1ʳᵉ + cover | min-t, allonger le partenaire même au-delà de sa 1ʳᵉ |
| 3 | `l-pair-stem` | L + pied | partenaire le + perpendiculaire ; pied regarde la barre |
| 4 | `max-t` | enveloppe max | chaque mur va au hit le plus loin |

Stockage : `localStorage` clé `grokcad.jonctionPrefs`  
`[{ "signature": "3w/3L/-90,0,90", "solutionId": "first-hit" }, …]` (max 40).

Signature = `NbExtrémités w / NbCouches L / angles leave quantifiés 5°`.

### Implémentation UI

- `Viewport.setPickHandler(fn, { rightClickAsPick: true })` → clic droit = `source: 'right'` (pas de snap).
- `DrawingTools` step 2 = phase Y/N ; snapshot `rejoinPreEntities` / `rejoinSnappedEntities`.

---

## Algo « première rencontre même couche » (`first-hit`)

Pour chaque nœud de degré ≥ 2, pour chaque offset brut `o` :

1. Pour chaque mur incident W :
   - Collecter les intersections de `//_W(o)` avec `//_V(o)` pour tout autre mur V.
   - Paramétrer depuis le **far** vers le nœud : garder le hit de **t minimal** (première rencontre).
   - Placer le bout de W sur ce hit (projection sur // de base).
2. **Barre T colinéaire** (leaveDir opposés) : pas d’intersection 2D → forcer le même bout (moyenne des hits pied) pour continuité de barre.
3. **Couverture partenaire** : si A s’arrête sur B en H, allonger B jusqu’à H **seulement** si H n’est **pas au-delà** de la 1ʳᵉ rencontre de B (sinon B traverserait sa propre couche).  
   Variante `first-hit-cover` / `max-t` / `l-pair-stem` : cover plus agressif.

### Conséquences géométriques

| Effet | Attendu |
|-------|---------|
| Stubs L au-delà du pied (orange) | **Supprimés** en `first-hit` |
| Pied s’arrête à 1ʳᵉ face même couche | **Oui** (min-t) |
| Petit **gap** le long d’une // si B ne peut pas s’allonger | Possible → essayer `first-hit-cover` |
| L pur (2 murs) | min-t = seul partenaire = miter classique |

---

## Plan B (si Y/N + algos auto ne suffisent pas) — **clic par couche**

Idée utilisateur (2026-08-06 soir) : autre paradigme pour `/jonction` :

1. Cadre de sélection des murs (comme aujourd’hui), **ou** désignation mur par mur.
2. Pour chaque raccord voulu : **cliquer sur chaque trait/couche** à relier entre eux  
   (3 ou 4 murs → un clic par couche concernée).
3. **Difficulté** : retrouver quelle couche (index d’offset dans `lines[]` / `strokeGeom`) a reçu le clic  
   → hit-test sur les segments de stroke, tolérance px écran.
4. **Fallback manuel** : dans le feedback / dialogue, indiquer les **numéros de couches**  
   à relier pour les murs du cadre  
   ex. `mur A couche 3 ↔ mur B couche 3 ↔ mur C couche 3`.
5. Une fois les paires/groupes de couches connus : intersection des // correspondantes + trim,  
   **sans** deviner le T/Y global.

Avantage : contrôle total, cas exotiques (flips, 4 murs, couches décalées).  
Inconvénient : plus de clics, UX à soigner.

**Ne pas coder tant que first-hit + Y/N n’ont pas été jugés en UI.**

---

## Fichiers & tests

```bash
export PATH="${HOME}/.local/node/bin:${PATH}"
cd /mnt/Raid4Tb/Program/GrokProjects/GrokCAD
npm run test:jonction
```

| Script | Rôle |
|--------|------|
| `scripts/test-jonction.mts` | L, T barre, snap, 4 stratégies |
| `scripts/test-jonction-diagonal.mts` | T diagonal |
| `scripts/test-mur2-regression.mts` | `test_mur2/4.gkd` + // |

Repro UI : `~/Téléchargements/test_mur4.gkd`.

---

## Checklist test UI

1. Titre **GrokCad v.0.18.0**
2. Ouvrir `test_mur4.gkd` → `/jonction` sur le coin T
3. **OK si** :
   - traits toujours // ;
   - feedback Solution k/4 sur T/Y ;
   - Gauche valide, Droit change de géométrie ;
   - une des 4 solutions enlève les stubs orange / comble le gap selon le cas ;
   - re-jonction du même type propose d’abord le choix mémorisé.
4. Si encore faux pour tous les modes → Plan B (clic par couche).

---

## Historique des pièges

1. Offset polyligne jeté / 1 voisin seul.
2. Pied collé sur **M** hors // → non-//.
3. Axe de projection tiré des strokes foirés.
4. Écraser le **far** en simple-offset (annule l’autre joint).
5. **Cover agressif** : allonger B au-delà de sa 1ʳᵉ rencontre → pied traverse sa couche / stubs orange.
6. Exiger « 3 murs, 1 seul point pour toutes les couches » → faux pour multi-traits.
7. Clic droit = snap pendant Y/N → il fallait `rightClickAsPick` sur le Viewport.
8. **Snap barycentre** sur L → les axes bougent (murs « glissent » hors des aides).  
   Fix 0.18.1 : intersection des droites support pour 2 murs.

---

## Doc externe

Quasi inexistante pour ce cas précis (voir STATUS / discussion).  
Proches : offset polyligne (Clipper2), wall joins BIM (comportement, pas code).
