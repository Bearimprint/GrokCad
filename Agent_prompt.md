# Mission : faire évoluer GrokCad (v0.24.16) vers un logiciel DAO/CAO complet

Contexte : GrokCad est une appli web locale en TypeScript strict, Vite et Three.js, avec une ligne de commande de type Arc+ (`src/commands/registry.ts`, tableau `commands: CommandDef[]`). Elle a 76 commandes. Les outils interactifs sont dans `src/core/tools.ts`, les murs multicouches dans `src/core/walls.ts`, le DXF dans `src/core/dxf.ts`, le modèle dans `src/core/types.ts`. Le format `.GKD` est du JSON. Lis d'abord `STATUS.md`, `HELP.md`, `WALLS.md`, `JONCTION.md`.

## Règles de travail
- Une étape à la fois, dans l'ordre ci-dessous, sans casser l'API publique de `DrawingTools` ni `registry.ts`.
- Pour chaque nouvelle commande : (1) entrée dans `registry.ts` ; (2) outil `startXxx` ; (3) géométrie pure dans `src/core/<feature>.ts` avec un test `scripts/test-<feature>.mts` ; (4) mise à jour de `HELP.md` et `STATUS.md` ; (5) incrément d'`APP_VERSION`.
- Commence chaque étape par vérifier les points marqués (?) et ajoute les numéros de ligne manquants avec `rg -n`.
- Fais tourner tous les tests `scripts/test-*.mts` avant de conclure une étape.

## Étape 0 : corrections de base
1. **Unités.** Trancher : coordonnées en mètres ou en unités du document ? `dxf.ts` convertit avec `dxfScaleToDoc`, alors que `walls.ts` et `tools.ts` supposent des mètres (`WALL_JOIN_TOL = 0.005`, `WALL_REJOIN_SNAP_TOL = 0.65`, `nearR = 1.5`, `maxSnap = 0.04`, `onLine = 0.003`…). Vérifier `units.ts`, centraliser toutes les tolérances dans une config en mètres, remplacer les « m » en dur (`handleEscape`, `onJoinPoint`) et les `Δ=(x, y)` sans unité par `formatLength`. Nommer les seuils d'angle (`dot <= -0.95`, `bestPerp <= 0.4`).
2. **Petits bugs.** `insUnits()` (km mappé sur 0 à l'export, pouces et pieds non gérés) ; `ctx.insertDepth` jamais incrémenté dans `dxf.ts` ; 3 écouteurs `window` jamais retirés dans le constructeur de `DrawingTools` ; `window.prompt` dans `onObjOrigin` ; HELP.md encore en v0.24.15 ; `/pan` en mètres.
3. **Découpage de `tools.ts`** (157 ko) dans `src/core/tools/` : `types.ts`, `ToolManager.ts`, `modifiers.ts` (écouteurs uniques avec `dispose()`), `constraints.ts`, `preview/entityPreview.ts` (une seule fonction qui remplace `previewTransform`, `pushEntityPreviewStrokes`, `previewOneEntityOffset` et `previewStretchTool`), `shared/PolyBuilder.ts` (fusion de `enterPolyTool` et `enterPolyWallTool`). Contrat d'outil : `start`, `onPoint`, `preview`, `onEscape`, `dispose`. `DrawingTools` reste une façade. Migrer d'abord les outils simples (`cut`, `deletepick`, `helperaxis`, `point`, `dist`), puis `copy`/`move`/`m1`/`r1`, puis les outils poly, les murs en dernier. Unifier les trois chemins d'entrée d'un clic (pick handler, `onPoint`, `acceptPoint`) en un `ToolManager.dispatchPoint`.

## Étape 1 : Undo/Redo
Transactions `{before[], after[]}` dans `CadDocument` (`addEntity`, `replaceEntity`, `removeEntities`), `beginTx/commitTx` autour de chaque commande, Ctrl+Z et Ctrl+Y, commandes `/undo [n]` et `/redo`. Remplacer le snapshot de `/rejoin` (`rejoinPreEntities`) par ce mécanisme.

## Étape 2 : calques et propriétés
- `layers: LayerDef[]` dans le `.GKD` (nom, couleur, type de ligne, épaisseur, visible, gelé, verrouillé) ; `EntityBase.layer` existe déjà mais n'est pas exploité.
- Filtrage de l'affichage et de la sélection ; `/calque nouveau|courant|off|on|geler|verrou`.
- Panneau de propriétés, `/props`, `/matchprop`, `/liste`, `/id`.

## Étape 3 : commandes de modification
Mirror (miroir, avec flip des murs et inversion des angles d'arcs), scale (échelle ; ajouter `scale` à `ObjectInstanceEntity`), rotation et copie de la sélection entière (généraliser `startRotateOne`), array (`/reseau rect nx ny dx dy`, `/reseau polar n angle`), fillet et chamfer (rayon 0 = coin vif), `/offset` en alias de `/paral` avec support des polylignes fermées, `join` de lignes en polyligne, `pedit` (ajout et suppression de sommet), `break` au point. Sélection par fenêtre et par capture, par type ou par calque.

## Étape 4 : accroches objet
Étendre `snap.ts` avec une liste priorisée et configurable : milieu, centre, perpendiculaire, tangente, quadrant, insertion, nœud. Mode orthogonal et polaire permanents (choisir une touche libre, F10 est déjà pris). Commande `/snap mid on`.

## Étape 5 : DXF
- **Export** : écrire les polylignes (LWPOLYLINE avec bulge), les couleurs (62 ou 420), les types de ligne (table LTYPE), les épaisseurs (370), la table LAYER complète (aujourd'hui seuls `0` et `DESSIN` sont déclarés), convertir `°∅±` en `%%d/%%c/%%p`, gérer l'encodage, le group 210, et signaler par un avertissement toute entité ignorée (cotes, points).
- **Import** : gérer le bulge (group 42), le group 210, ELLIPSE, SPLINE, HATCH, DIMENSION et POINT ; avertir pour les types ignorés ; respecter les calques éteints, gelés et verrouillés ; corriger `transformEntity` (coordonnées des polylignes, cotes, points et aides, `strokeGeom` des murs).

## Étape 6 : murs, ouvertures et 3D
1. **Raccords manquants** : arc/arc et arc/droit (un mur en arc n'a pas de `strokeGeom`), T en milieu de mur pour polymurs et arcs, `/join` et `/corner` sur polymurs et arcs, croisement en X sans extrémité commune, garde-fou sur les angles très aigus. Recalcul incrémental par composante connexe touchée à la place du recalcul global en O(n²). Mettre les préférences de jonction (`grokcad.jonctionPrefs`, aujourd'hui en `localStorage`) dans le `.GKD`.
2. **Ouvertures** : ajouter `openings?: WallOpening[]` à `WallEntity` avec `{id, type: 'door'|'window'|'niche', s, width, sill, height, hinge, swing}`, `s` étant une distance le long de l'axe et non `t ∈ [0,1]` ; pour un polymur `{segIdx, s}`. Brancher `applyOpeningsToGeoms(wall, geoms)` à la fin de `recomputeLinearWallJoints`, en réutilisant `cutBarGeomsInBand` pour couper les traits, puis ajouter les tableaux et le symbole (vantail et arc de débattement, ou vitrage). Clamper à distance d'au moins `joinEndZone` des nœuds et hors de la bande d'un pied de T. Propager dans `explodePolyWall`, translate/rotate/mirror, trim, stretch, copie, export DXF. Bibliothèque de portes et fenêtres comme pour les murs.
3. **Hauteur 3D** : `height`, `baseZ`, éventuellement `levelId` sur `WallEntity`. Maillage construit à partir de `strokeGeom` : un prisme par bande de couche, coupé en 3 tronçons sur les ouvertures (bas jusqu'à `sill`, haut à partir de `sill+height`). Matériaux pilotés par `wallLayerCatalog`.

## Étape 7 : surfaces et cotation
- `/aire` sur polyligne fermée ; `/piece` avec détection du contour intérieur des murs et étiquette « Nom / xx,xx m² » ; export CSV.
- Cotation continue et cumulée (`/cotecont`, `mode:'chain'` déjà typé, `/explode` vers des cotes simples), cotes alignée, angulaire, radiale, diamètre, cotation automatique le long d'un mur.
- Texte multiligne (MTEXT), lignes de rappel (MLEADER), édition de texte.

## Étape 8 : architecture avancée
Dalles (`slab`), toitures depuis une polyligne, escaliers paramétriques (formule de Blondel), niveaux et étages (`levels[]`), coupes et façades (plan de coupe Three.js et extraction d'arêtes), hachure par point intérieur et pochage des murs, ellipse, spline, polygone, blocs avec échelle et attributs, vues nommées, UCS et plans de travail XZ/YZ.

## Étape 9 : sortie et confort
Impression PDF à l'échelle (SVG puis jsPDF, cartouche, mises en page), nomenclature CSV (portes, fenêtres, murs, surfaces), `/script fichier.txt` pour des macros, sauvegarde automatique `.bak`, PURGE/AUDIT/UNITS, DWG (ODA File Converter ou LibreDWG), IFC (web-ifc), solides et booléens (three-bvh-csg), rendu.
