# Mission : GrokCad v0.25.4 → logiciel DAO/CAO complet (suite)

Contexte : appli web locale TypeScript strict, Vite, Three.js, avec une ligne de commande de type Arc+. Lis d'abord `STATUS.md`, `HELP.md`, `JONCTION.md`, `Agent_prompt.md`. Déjà fait en 0.25.x : calques de dessin 1 à 127 (`drawLayers.ts`, `/calques`, `/couche n`), calques spéciaux négatifs pour les insertions, bibliothèques portes, fenêtres et autres, `/iw` (insertion dans un mur qui coupe les traits du mur hôte), `/ancrage`, unités du document avec tolérances en mètres (`tolerances.ts`, `metersToDoc`), pieds et pouces, `$INSUNITS`, début du découpage de `tools.ts` dans `src/core/tools/` (façade `DrawingTools` conservée).

## Règles de travail
- Une étape à la fois, dans l'ordre. Commit et push à la fin de chaque étape (un commit par étape, version incrémentée).
- Ne casse pas `registry.ts` ni l'API publique de `DrawingTools`. Garde la compatibilité des anciens `.gkd`.
- Pour chaque commande : entrée dans `registry.ts`, outil `startXxx`, géométrie pure dans `src/core/<feature>.ts`, test `scripts/test-<feature>.mts`, mise à jour de `HELP.md` et `STATUS.md`.
- Avant de conclure : `tsc --noEmit` et tous les `scripts/test-*.mts`.

## Étape 1 : calques complets (priorité)
Les calques 1 à 127 sont les calques « normaux » ; les calques négatifs restent réservés aux insertions et ne changent pas.
1. **Attributs par calque**, stockés dans la table `drawLayers` du `.gkd` : `color`, `lineWidth` (px), `lineStyle`, `fontFamily`, `fontBold`, `fontItalic`, `visible`. Valeurs par défaut identiques pour tous au début : couleur de ligne blanche, épaisseur 1 px, police `Tahoma` sans gras ni italique ni autre style, `visible = true`. Les anciens fichiers reçoivent ces valeurs par défaut sans perdre leurs données.
2. **Héritage** : une entité sans choix explicite (stylo, texte) prend les attributs de son calque (« DuCalque »). Un réglage explicite de l'utilisateur (`/couleur`, `/epaisseur`, `/style`, barre de styles) prime sur le calque. Les nouveaux textes prennent la police du calque courant.
3. **Visibilité** : un calque masqué n'est ni dessiné, ni accroché (snap), ni sélectionnable au clic ou par fenêtre. Rien n'est effacé. Le masquage est enregistré dans le `.gkd`. Le calque courant ne peut pas être masqué (message clair).
4. **Commandes** : `/calque` (ou `/calques`) avec `afficher n`, `masquer n`, `masquer n m` et plages `masquer 5-10`, `toutafficher`, `isoler n` (masque tous les autres), `couleur n #RRGGBB`, `epaisseur n px`, `police n Tahoma`, `nom n libellé`. Dans la boîte de dialogue `LayersDialog` : colonnes visible (case à cocher), couleur, épaisseur, police, libellé.
5. **`/selcalque n`** (alias `/layersel`, `/sc`) : sélectionne tous les éléments visibles du calque n. Ensuite l'utilisateur peut les traiter comme n'importe quelle sélection : supprimer, déplacer, copier, tourner, mettre à l'échelle, etc. Variante `/selcalque n m` pour plusieurs calques. Prévoir aussi `/versCalque n` pour envoyer la sélection vers un autre calque.
6. Tests : héritage couleur, épaisseur et police, masquage (rendu, snap, sélection), sélection par calque, rétrocompatibilité des anciens `.gkd`.

## Étape 2 : Undo / Redo
Transactions `{before[], after[]}` dans `CadDocument` (`addEntity`, `replaceEntity`, `removeEntities`), `beginTx` et `commitTx` autour de chaque commande, Ctrl+Z et Ctrl+Y, `/undo [n]`, `/redo`. Inclure les changements de calques (attributs, visibilité). Remplacer le snapshot de `/rejoin` (`rejoinPreEntities`) par ce mécanisme.

## Étape 3 : fin du découpage de `tools.ts`
Migrer les machines restantes vers `src/core/tools/` : `copy`, `move`, `m1`, `r1`, `stretch`, `paral`, `trim`, `extend`, puis les outils polylignes et polymurs via `PolyBuilder`, et les murs en dernier (`wallline`, `wallarc`, `join`, `corner`, `rejoin`). Contrat commun : `start`, `onPoint`, `preview`, `onEscape`, `dispose`. `DrawingTools` reste la façade.

## Étape 4 : commandes de modification
Mirror (flip des murs et inversion des angles d'arcs), scale (ajouter `scale` à `ObjectInstanceEntity`), rotation et copie de toute la sélection (généraliser `startRotateOne`), array (`/reseau rect nx ny dx dy`, `/reseau polar n angle`), fillet et chamfer (rayon 0 = coin vif), `/offset` en alias de `/paral` avec polylignes fermées, `join` de lignes en polyligne, `pedit`, break au point. Sélection par fenêtre et par capture, par type.

## Étape 5 : accroches objet
Étendre `snap.ts` avec une liste priorisée et configurable : milieu, centre, perpendiculaire, tangente, quadrant, insertion, nœud. Mode orthogonal et polaire permanents (F10 est déjà pris : choisir une autre touche). `/snap mid on`.

## Étape 6 : DXF
- **Export** : écrire les polylignes (LWPOLYLINE avec bulge), les couleurs, les types de ligne (LTYPE), les épaisseurs (370), la table LAYER complète à partir de `drawLayers` (nom, couleur, visibilité), `°∅±` en `%%d/%%c/%%p`, le group 210, et un avertissement pour toute entité ignorée (cotes, points).
- **Import** : bulge (group 42), group 210, ELLIPSE, SPLINE, HATCH, DIMENSION, POINT ; avertissement pour les types ignorés ; créer les calques depuis la table LAYER en respectant couleur et calques éteints ; corriger `transformEntity` pour les polylignes, cotes, points, aides et `strokeGeom` des murs.

## Étape 7 : murs
1. Raccords manquants : arc/arc et arc/droit (un mur en arc n'a pas de `strokeGeom`), T en milieu de mur pour polymurs et arcs, `/join` et `/corner` sur polymurs et arcs, croisement en X sans extrémité commune, garde-fou sur les angles très aigus.
2. Recalcul incrémental par composante connexe touchée à la place du recalcul global en O(n²).
3. Préférences de jonction (`grokcad.jonctionPrefs`, aujourd'hui en `localStorage`) à enregistrer dans le `.gkd`.
4. `/iw` sur murs en arc et polymurs, avec propagation lors de move, rotate, mirror, trim, stretch et copie (la position de l'insertion doit suivre le mur hôte).
5. Hauteur 3D : `height` et `baseZ` (éventuellement `levelId`) sur `WallEntity`. Maillage construit à partir de `strokeGeom`, un prisme par bande de couche, coupé sur les ouvertures de `/iw` (bas jusqu'à l'allège, haut à partir de l'allège plus la hauteur). Ajouter allège et hauteur aux insertions de portes et fenêtres.

## Étape 8 : surfaces, cotation, texte
- `/aire` sur polyligne fermée ; `/piece` avec détection du contour intérieur des murs et étiquette « Nom / xx,xx m² » ; export CSV.
- `/cotecont` (déjà typé `mode:'chain'`) avec cumul et `/explode` en cotes simples ; cotes alignée, angulaire, radiale, diamètre ; cotation automatique le long d'un mur.
- Texte multiligne, lignes de rappel, édition de texte ; panneau de propriétés, `/props`, `/matchprop`, `/liste`, `/id`.

## Étape 9 : architecture avancée
Dalles, toitures depuis une polyligne, escaliers paramétriques (formule de Blondel), niveaux et étages (`levels[]`), coupes et façades, hachure par point intérieur et pochage des murs, ellipse, spline, polygone, blocs avec échelle et attributs, vues nommées, UCS et plans de travail XZ et YZ.

## Étape 10 : sortie et confort
Impression PDF à l'échelle (SVG puis jsPDF, cartouche, mises en page), nomenclature CSV (portes, fenêtres, murs, surfaces), `/script fichier.txt` pour des macros, sauvegarde automatique `.bak`, PURGE, AUDIT, DWG (ODA File Converter ou LibreDWG), IFC (web-ifc), solides et booléens, rendu.
