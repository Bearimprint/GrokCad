Les logiciels de CAO/DAO purs (AutoCAD standard, etc.) gèrent rarement les raccords automatiques de couches sur des murs multi-couches. Ces opérations sont surtout le domaine des logiciels BIM (Revit, ArchiCAD, BricsCAD BIM, parfois Vertex BD ou équivalents), où les murs composés/composites/multi-skin sont des objets intelligents avec des règles de priorité et de jonction.
Voici comment cela fonctionne concrètement dans les principaux outils.
Autodesk Revit (murs composés / compound walls)
Les murs multi-couches sont définis dans les propriétés de type via l’éditeur d’assemblage (Edit Assembly). Chaque couche a :

Une fonction (Structure [1], Substrate [2], Thermal/Air Layer [3], Finish 1 [4], Finish 2 [5], Membrane) qui impose historiquement une priorité.
Un matériau et une épaisseur.
Depuis Revit 2026, une priorité de couche personnalisable indépendamment de la fonction, ce qui donne beaucoup plus de flexibilité.

Règles de raccord des couches (automatiques) :

Revit joint d’abord les couches de priorité haute. Une couche de priorité 1 rejoint sa correspondante de priorité 1 en traversant les couches de priorité inférieure. Une couche de priorité plus basse ne peut pas traverser une couche de priorité égale ou supérieure.
Si les deux couches jointes ont le même matériau, le raccord est « clean » (pas de ligne de séparation). Sinon, une ligne apparaît.
Les couches à l’intérieur du core (noyau) d’un mur ont un comportement particulier : elles peuvent traverser des couches de priorité plus élevée situées hors du core de l’autre mur, et elles s’étendent jusqu’au core de l’autre mur.
Chaque couche doit avoir une fonction assignée pour que le matching fonctionne correctement.

Commandes / outils pour les jonctions en T ou Y :

La jonction est automatique dès que les murs se croisent (ou se touchent correctement).
Outil Wall Joins (onglet Modify) : cliquez sur le carré gris à la jonction pour changer le type (Butt = défaut pour un T, Miter, Square-off) et l’ordre de jonction (Next/Previous ou Switch Join Order).
On peut aussi Disallow Join sur une extrémité, puis forcer avec Join Geometry.
Pour des cas complexes (ex. : faire passer une cavité d’un mur mitoyen à travers un mur extérieur), on ajuste manuellement les fonctions/priorités des couches pour que la couche désirée (souvent la cavité/air) ait une priorité suffisamment haute.

Oui, les raccords de couches se créent automatiquement selon ces règles de priorité/fonction dès que la jonction de mur est active. Ce n’est pas un « magic button » isolé, mais le résultat du système de priorités + de l’outil Wall Joins.
Graphisoft ArchiCAD (murs composites)
Les peaux (skins) des murs composites sont définies par des Building Materials, chacun ayant une Intersection Priority (priorité d’intersection / force).
Fonctionnement :

Connexion basée sur les priorités (Priority Based Connection / PBC) : la peau de priorité plus élevée coupe celle de priorité plus basse. Même priorité + même matériau → nettoyage propre.
Conditions pour que ça se fasse automatiquement :
Les lignes de référence des murs doivent se rejoindre ou s’intersecter correctement (pas seulement se chevaucher).
Les calques doivent avoir le même Layer Intersection Number/Group (sinon pas de jonction).

Junction Order (0 à 16, défaut 8) dans les paramètres du mur (onglet Model) : contrôle l’ordre de priorité quand 3 murs ou plus se rencontrent.
Pour un T : si deux peaux ont la même priorité, la peau de la « jambe » du T est généralement coupée. On ajuste les priorités des matériaux ou le Junction Order pour forcer le résultat voulu.

Les raccords de couches sont donc automatiques dès que les conditions de référence + calques + priorités sont remplies. On peut forcer avec la commande Intersect si besoin.
BricsCAD BIM
Les murs sont des solides 3D avec des compositions (plies/couches).

Commande TCONNECT (ou Connect with Nearest) : crée une connexion en T entre faces de solides (extrude la face mineure jusqu’à la face majeure).
Pour les couches individuellement : ce n’est pas totalement automatique comme dans Revit/ArchiCAD. On travaille souvent couche par couche dans une coupe BIM (Show Composition activé) avec Push/Pull ou BimDrag pour étendre une ply jusqu’à l’autre et la soustraire. On peut propager avec BIMPROPAGATEPLANAR.

Autres logiciels

Vertex BD : commande dédiée T Connection (automatique à la pose si on clique sur un mur existant ; options DET ON/OFF pour le détail du joint).
TurboCAD, FreeCAD (Arch), etc. : jonctions plus basiques (healing, boolean, ou priorités manuelles limitées). Les multi-couches et raccords de peaux ne sont pas aussi sophistiqués.
En CAO pure (AutoCAD classique) : on dessine souvent les couches manuellement (hachures, polylignes) et on trimme/étend à la main. Pas de système de priorités intelligent.

En résumé
Oui, dans les logiciels BIM majeurs (surtout Revit et ArchiCAD), la commande/outil de jonction de murs (ou la jonction automatique) crée les raccords de couches automatiquement. Le mécanisme repose presque toujours sur un système de priorités (fonction/priorité de couche dans Revit, Intersection Priority des Building Materials dans ArchiCAD) :

Priorité haute = traverse et coupe les couches de priorité inférieure pour rejoindre sa correspondante.
Même matériau = nettoyage propre.
Le core/noyau et l’ordre de jonction (Junction Order / Join Order) affinent le résultat pour les T et Y.

Les détails exacts sont bien documentés dans l’aide officielle de chaque logiciel (pages « About Applying a Function to a Layer… » et « Wall Joins » pour Revit ; « Priority Based Connection » et « How Walls are Connected » pour ArchiCAD). Les cas complexes (cavités continues, multi-matériaux différents) demandent souvent d’ajuster manuellement les priorités pour obtenir exactement le raccord voulu.

---

## Implémentation GrokCAD (v0.21)

Transposition dans GrokCAD du modèle de priorités :

| Concept BIM | GrokCAD |
|-------------|---------|
| Intersection Priority / Function | `WallLineDef.priority` (1 = plus haute) |
| Building Material | type dans `library/walls/layer-priorities.json` (`layerTypeId`) |
| Matching peaux | `findPartnerLayer` : même priorité + rang, sinon offset |
| Ordre de raccord | priorités croissantes (structure avant finition) |
| UI création | liste **Couche / priorité** dans la bibliothèque `/murs` |

Fichiers : `src/core/wallLayerCatalog.ts`, `WallLibraryDialog.ts`, `walls.ts` (`resolveStarNodeStrokes`).  
Algo détaillé : `JONCTION.md` · spec murs : `WALLS.md`.
