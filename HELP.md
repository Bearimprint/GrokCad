# GrokCAD — Aide des commandes

> Version de référence : **0.27.3**  
> Ouvrir depuis l’appli : `/help` (ou `/?` · `/h`).

Répertoire : `/mnt/Raid4Tb/Program/GrokProjects/GrokCAD`  
Ligne de commande : bas gauche (`GrokCAD>`). Préfixe `/` ou `\` (ex. `\ligne`).

---

## Souris (esprit ARC+)

| Action | Effet |
|--------|--------|
| Glisser **bouton gauche** | **Pan** de la vue |
| **Clic gauche** court (outil actif) | Place un point **sans** snap |
| Glisser **bouton milieu** | Pan |
| **Clic droit** | **Snap** dans le rayon (défaut **20 px**) — objets, puis nœud de grille si `/gridsnap on` |
| **Molette** | Zoom centré sous le curseur |
| **Échap** | Annule l’outil / ferme les dialogues |
| **Suppr** | Efface la sélection (si pas dans un champ) |
| **F10** | Pivote la caméra de **+45°** autour de Z |

### Snap (clic droit uniquement)

1. **Croisement / intersection** le plus proche dans le rayon (y compris aides)  
2. Sinon **extrémité** (fin de ligne / d’arc)  
3. Sinon **point le plus proche** sur la courbe  
4. Sinon **nœud de grille** si `/gridsnap on` et grille visible (`/grid on`)  
5. Sinon aucune accroche → même effet qu’un clic gauche  

Point accroché réutilisable avec `@`. Souris courante : `.` (ou `m` / `souris`).

---

## Aide

| Commande | Alias | Description |
|----------|-------|-------------|
| `/help` | `/?` `/h` | Ouvre ce fichier avec le visualiseur par défaut de l’OS |

---

## Navigation & vue

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/pan` | | `<dx> <dy>` | Décalage de vue en **unités du document** |
| `/zoom` | | `<facteur>` | Zoom (`>1` éloigne, `<1` rapproche) |
| `/center` | `/centrer` `/fit` `/ze` `/extents` | | Cadre tout le dessin |
| `/view` | | | Position caméra courante |
| `/axo` | `/iso` | | Vue axonométrique isométrique |
| `/pers` | `/persp` `/perspective` | | Vue perspective |
| `/plan` | `/top` `/dessus` | | Vue en plan XY |

---

## Fichier

| Commande | Alias | Description |
|----------|-------|-------------|
| `/new` | `/nouveau` | Nouveau dessin (biblio murs conservée) |
| `/save` | `/sauver` `/enregistrer` | Enregistre le `.GKD` (chemin connu) ou l’objet library en cours |
| `/saveas` | `/enregistrer_sous` `/sauveras` | Enregistrer sous… (devient le chemin pour `/save`) |
| `/open` | `/ouvrir` | Ouvre un `.GKD` (restaure la caméra) |
| `/openlast` | `/ouvrirdernier` `/last` `/reopen` `/dernier` | Rouvre le **dernier** fichier ouvert/enregistré (historique de **7**, sans doublon) |
| `/dxfin` | `/dxfimport` `/importdxf` | Import DXF → `.GKD` |
| `/dxfout` | `/dxfexport` `/exportdxf` | Export DXF |
| `/export` | `/exp` | Export (dialogue) |

---

## Lignes d’aide

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/axes` | `/xyz` | `[x y z \| . \| @]` | 3 axes d’aide XYZ |
| `/hx` | | clics ou point | Aide // **X** |
| `/hy` | | clics ou point | Aide // **Y** |
| `/hz` | | clics ou point | Aide // **Z** |
| `/paral` | `/parallele` `/parallel` `/par` | voir ci-dessous | Copie **//** d’un élément désigné (orange ≠ sélection) |
| `/perp` | `/perpendiculaire` `/orthogonal` | `[x y z]` · `.` · `@` | Perpendiculaire d’aide à la dernière aide |
| `/efface_aides` | `/clear_helpers` `/ea` `/cls_aides` `/effaides` `/dh` | | Efface toutes les aides |

### `/paral`

1. Désigner un élément (ligne, arc, cercle, mur, aide).  
2. Clic = côté / emplacement.  
3. La **copie devient désignée** → recliquer pour enchaîner. **Échap** = fin.

| Saisie | Comportement |
|--------|----------------|
| `/paral` | 2ᵉ clic = emplacement (distance + sens) |
| `/paral 1.2` | Distance **fixe** 1,2 (unité document). 2ᵉ clic = **côté**. Puis chaque clic refait une copie à 1,2 du **dernier** objet |
| `/paral dx 1.4` | Distances d’axe fixes ; clic = sens |
| `/paral dxy 1.5,3` | Idem, plusieurs axes |
| `/paral x 8` | Compat. : aide // X à Y=8 (pas une copie d’objet) |

---

## Dessin (stylo courant)

| Commande | Alias | Description |
|----------|-------|-------------|
| `/ligne` | `/l` `/line` `/li` | Ligne chaînée. **Shift** = H/45°/V |
| `/arcc` | `/acentre` `/arccen` | Arc depuis le centre |
| `/arc` | `/a` | Arc 3 points |
| `/arccont` | `/ac` `/arccontinu` | Arcs continus **sans cassure** : 1er arc 3 pts, puis suite tangente, **une seule polyligne** |
| `/cercle` | `/c` `/circle` `/cir` | Cercle : centre → rayon |
| `/point` | `/pt` `/points` | Point(s) |
| `/cut` | `/coupe` `/break` `/scinder` | Coupe ligne/arc/cercle au clic |
| `/trim` | `/ajuster` `/tr` | **1)** objet **2)** perpendiculaire = coupe (même loin) **3)** côté à garder. Ligne, arc, mur, pline **ouverte**. Pas d’objet library ni pline fermée |
| `/extend` | `/allonge` `/prolonger` `/ex` | Allonge ligne/arc/bout de pline ouverte jusqu’à une limite |
| `/pline` | `/polyligne` `/polyline` `/pl` | Polyligne (1 entité). **Shift** = H/45°/V |
| `/parc` | | Segment d’arc dans une polyligne |
| `/parct` | | Arc tangent dans une polyligne |
| `/rect` | `/rectangle` `/rec` | Rectangle = polyligne **fermée**. **Shift** = carré |
| `/text` | `/txt` `/texte` | Texte. Style barre du haut |
| `/textbox` | `/txb` `/cartouche` | Texte + rectangle |
| `/cote` | `/dim` `/dimension` `/cotation` | 1 segment = 1 cote + texte lié |
| `/cotecont` | `/cotcont` `/dimcont` | **Une** chaîne : passage, direction, puis les points. **Échap** valide. `/explode` sépare |
| `/cotations` | `/dimstyles` | Styles de cotation |
| `/hatch` | `/hachure` `/hachures` `/motif` | Bibliothèque de hachures |
| `/fill` | `/remplir` `/hachurer` | Remplit une polyligne avec la hachure courante |
| `/delh` | `/delhatch` `/unhatch` | Enlève le hachurage d’une polyligne |

**Barre du haut** : trait · texte · style de cotation.

---

## Murs

| Commande | Alias | Description |
|----------|-------|-------------|
| `/murs` | `/biblio` `/libmurs` `/walllib` `/walls` | Bibliothèque de murs |
| `/murligne` | `/ml` `/wallline` `/wl` | Mur linéaire. **[ALT]** = flip côté |
| `/murarc` | `/ma` `/wallarc` `/wa` | Mur arc 3 pts. **[ALT]** = flip |
| `/pmur` | `/polymur` | Polymur linéaire (chaîne) |
| `/pmarc` | | Polymur : segment d’arc |
| `/pmarct` | | Polymur : arc tangent |
| `/jonction` | `/rejoin` `/raccord` | Cadre 2 clics : snap extrémités + onglets L/T/Y |
| `/join` | `/joindre` | 1) mur à prolonger 2) cible → T ou L selon le cas |
| `/corner` | `/coin` `/cn` `/angle` | **Coin L forcé** (jamais T). Clic = côté à garder si les murs se croisent |

`/join` : clic près du bout à allonger, puis la cible.  
`/jonction` : cadre autour d’extrémités proches (tol. **65 cm**).  
`/corner` : toujours un L ; un mur long qui « passe devant » est coupé au coin.  
Détails : `WALLS.md` · `JONCTION.md`.

---

## Mesure

| Commande | Alias | Description |
|----------|-------|-------------|
| `/dist` | `/distance` `/mesure` `/di` | Distance 2 points + Δx Δy Δz. Enchaîne jusqu’à Échap |

---

## Déplacement, rotation, stretch

| Commande | Alias | Description |
|----------|-------|-------------|
| `/m1` | `/move1` | Un objet : désigner → base → dest. **[Shift]** = H/45°/V |
| `/r1` | `/rot1` `/rotation` | Un objet : désigner → pivot → réf. → angle |
| `/move` | `/mv` `/deplacer` `/déplacer` | Déplace la **sélection**. **[Shift]** = H/45°/V |
| `/stretch` | `/etirer` | Cadre puis vecteur : étire les extrémités dans le cadre |

---

## Sélection & édition

| Commande | Alias | Description |
|----------|-------|-------------|
| `/select` | `/sl` `/sel` | Cadre 2 clics. **[ALT]** = retirer |
| `/deselect` | `/dsel` `/unsel` `/clear_sel` | Vide la sélection |
| `/delete` | `/del` `/effacer` `/erase` | Efface la sélection (**Suppr**) |
| `/d` | `/delpick` · **Ctrl+D** | Efface l’élément au clic ; enchaîne jusqu’à Échap |
| `/copy` | `/cp` `/copier` | Sans sél. : désigner → coller (enchaîne). Avec sél. : base → arrivée. **[Shift]** = H/45°/V |
| Slots | **Shift+F1…F12** / **Alt+F1…F12** | Mémorise / rappelle une sélection (session). Alt+F ne rappelle pas un calque masqué |

---

## Calques (1–127 + insertions −1…−127)

Pas de couche **0**. Le numéro = ordre de dessin : **1** en premier (fond), **127** en dernier (devant). Un grand rectangle plein blanc sur 127 masque tout ce qui est en dessous.

Chaque calque a un **libellé de 255 caractères** max. Défaut : `Couche numero 7` (pour 7). La couche 1 s’appelle **Bedrock layer**. Anciens `.gkd` sans calques : toutes les entités → couche **1**, **sans** calques négatifs. Leurs couleurs déjà enregistrées sont conservées.

Attributs de chaque calque normal (1–127), défauts identiques : couleur **blanche**, épaisseur **1 px**, trait **plein**, police **Tahoma** (ni gras ni italique), **visible**. Un objet sans choix explicite de stylo ou de texte suit son calque (**DuCalque**). `/couleur`, `/epaisseur`, `/style` ou la barre de styles figent cet attribut. Les calques négatifs d’insertion ne changent pas.

Un calque masqué n’est ni dessiné, ni accroché, ni sélectionnable. Rien n’est effacé. Le **calque courant ne peut pas être masqué**. Masquer, isoler, décocher la case du dialogue, ou `/verscalque` vers un calque masqué retire ces éléments de la sélection et de la désignation : `/delete` ne les efface pas. **Alt+F1…F12** ne rappelle que les éléments d’un calque visible.

| Commande | Alias | Description |
|----------|-------|-------------|
| `/calques` | `/layers` `/couches` | Sans argument : dialogue (visible, couleur, épaisseur, police, libellé) |
| `/calques afficher n` | | Affiche `n`, plusieurs numéros, ou une plage `5-10` |
| `/calques masquer n` | | Masque. `masquer n m`, `masquer 5-10`. Le courant est refusé |
| `/calques toutafficher` | | Réaffiche tous les calques |
| `/calques isoler n` | | Masque tous les autres. Le courant, s’il est différent, reste affiché |
| `/calques couleur n #RRGGBB` | | Couleur du calque (`blanc`, `noir`, `rouge`… acceptés) |
| `/calques epaisseur n px` | | Épaisseur 1–7. Ex. `/calques epaisseur 3 2` |
| `/calques police n Tahoma` | | Police des textes DuCalque |
| `/calques nom n libellé` | | Libellé |
| `/couche` | `/layer` `/calque` `/cl` | `[n°]` = calque courant, sans arg = dialogue. Les verbes ci-dessus marchent aussi |
| `/mc` | `/calquecourant` `/laycur` | Clic sur un élément → son calque devient le calque courant |
| `/selcalque` | `/layersel` `/sc` | Sélectionne les éléments **visibles** du ou des calques (`n`, `n m`, `5-10`) |
| `/verscalque` | `/vers-calque` | Envoie la sélection sur le calque `n` |

Dans la **barre supérieure** : n° de calque. Clic = liste (n° + libellé). Le prochain objet prend ce calque. **DuCalque** est le premier choix de couleur, d’épaisseur, de style et de police.

### Calques d’insertion (−1…−127)

L’**ID spécial** apparaît à droite de l’ID standard (1–127) dès que la biblio insertions (Portes / Fenêtres / Autres) est ouverte, et pendant le canvas de création / modification (cadre **rouge 3 px**).

Une **liste verticale** des calques spéciaux (hauteur = canvas) s’affiche à **gauche** (défaut) ou à **droite** : Paramètres → *Emplacement de la liste des couches spéciales*.

L’ID spécial de la barre et la ligne surlignée de la liste sont **toujours le même** calque (une seule source).

| Calque | Rôle |
|--------|------|
| **−1** | Fixe (taille inchangée) |
| **−2** | Étirable **X** |
| **−3** | Étirable **Y** |
| **−4** | Étirable **Z** |
| **−5** | XY |
| **−6** | XZ |
| **−7** | YZ |
| **−8** | XYZ |
| **−9** | **Point d’ancrage** (gros rond orange) — **obligatoire**. `/ancrage` |
| −10…−127 | Réservés |

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/ancrage` | `/anchorpoint` `/anchor` `/ap` | `[x,y,z]` | Pose **le** point d’ancrage (calque **−9** forcé). Sans arg : clic gauche ou droit. Avec arg : coordonnée **complète** X,Y,Z uniquement (`0,0,0` ou `0 0 0`). Pas de `dx` / `dxy` / `.` / `@`. Remplace l’ancre précédente. |

À lancer dans le **canvas d’insertion** (Créer / Modifier). Sans ancre −9, `/save` est refusé.

Les parties étirables se dessinent à **1 m** sur l’axe concerné (échelle simple : `0,65` → 0,65 m). Les parties **fixes** ne changent jamais.

| Commande | Alias utilisables | Description |
|----------|-------------------|-------------|
| `/iw` | `/insertinwall` `/iiw` `/insertin` | Pose un objet insertions **dans un mur / une ligne / un arc** |
| `/porte` | `/door` `/porte1` | Porte simple : trou + battant. Souris = largeur, près de l’ancre = largeur **/param** (0,90 m). `dx 0.8` valide. **[ALT]** côté, **[CTRL]** miroir |
| `/portedouble` | `/porte2` `/door2` | Porte deux vantaux (largeur = les deux) |
| `/fenetre` | `/fenêtre` `/window` `/fen` | Fenêtre simple (vitrage + trou). Défaut 1,20 m |
| `/fenetredouble` | `/fenêtre2` `/fen2` `/window2` | Fenêtre deux travées |
| `/od` | `/opendoor` `/insertdoor` `/id` | Biblio insertions → onglet **Portes** (`library/insertions/doors/`) |
| `/ow` | `/openwindow` `/insertwindow` | Biblio insertions → onglet **Fenêtres** (`library/insertions/windows/`) |
| `/oo` | `/openother` `/insertother` `/io` | Biblio insertions → onglet **Autres** (`library/insertions/others/`) |

**Alias non pris** (déjà utilisés ailleurs) : **`/iw`** n’ouvre **pas** les fenêtres — c’est l’insertion dans un mur. Pour les fenêtres : `/ow` `/openwindow` `/insertwindow`.

`/iw` : si aucun objet n’est choisi, ouvre la biblio Insertions (onglet Portes). Puis désigner l’hôte. **[ALT]** = autre côté de la ligne de référence. **[CTRL]** = miroir le long de l’hôte.

Ensuite la **longueur** suit la souris à partir de l’ancre (cote à l’écran `dx 1.2`) jusqu’au clic, ou se valide tout de suite avec `dx 1.2` / `dx 1,2` / `1.2` (négatif = autre sens).

Sur un **mur**, les parties étirables en Y (calques −3, −5, −7, −8) prennent l’épaisseur du mur (du plus petit offset au plus grand). Un symbole qui n’a **que** des calques fixes (−1) est traité comme l’ouverture entière : le rectangle de test s’étire en longueur et en largeur. Les traits du mur dont l’offset tombe dans cette empreinte sont **coupés** sur la longueur de l’ouverture (rendu, accroche, export DXF). Les calques fixes (−1) mélangés à un cadre étirable ne bougent pas : seul le cadre étirable s’adapte et perce le mur.

**Créer** / **Modifier** : enregistre d’abord le dessin en cours (`/save` ou `/saveas` si jamais sauvé), puis canvas vide (ou l’objet) avec cadre rouge + liste des calques spéciaux. `/save` ne demande que le **nom** (le dossier est celui de la commande : doors / windows / others). Sans point d’ancrage −9 : message unique *« Revenir au dessin d’insertion et définir le point d’ancrage »*, calque −9 forcé (barre + liste). Après un `/save` réussi : réouverture du dessin d’origine.

## Bibliothèque d’objets (`library/`)

Onglets meubles : `sanitaire`, `electrique`, `salon`, `chambre`. Insertions : `insertions/doors`, `insertions/windows`, `insertions/others` (via `/od` `/ow` `/oo` `/iw`, pas dans `/objets`).

| Commande | Alias | Description |
|----------|-------|-------------|
| `/objets` | `/libobj` `/biblioobj` `/objectlib` | Biblio meubles : Choisir/Poser · Modifier |
| `/obj` | `/objet` `/object` | Sélection → `library/<onglet>/<nom>.gkd` |
| `/extract` | `/ext` `/extraire` | Comme `/obj` hors library |
| `/explode` | `/expld` `/disassociate` `/dissocier` | Instance → éléments basiques (irréversible) |
| `/closelib` | `/fermerlib` `/libclose` | Ferme l’édition library |

Une instance `object` référence le fichier library. `/save` dans l’éditeur d’insertion enregistre l’objet puis revient au dessin principal.

---

## Stylo

Défauts : **Noir** · **1 px** · **Plein**.

| Commande | Alias | Usage |
|----------|-------|-------|
| `/couleur` | `/color` `/coul` `/co` | `[nom\|id\|#hex\|n°]` |
| `/epaisseur` | `/épaisseur` `/ep` `/width` `/lw` `/epaiss` | `[1-7\|id]` |
| `/style` | `/st` `/linetype` `/trait` | `[plein\|pointille\|tiret\|…]` |
| `/stylo` | `/pen` | Résumé |

**7 couleurs** : Noir, Blanc, Bleu, Vert, Jaune, Rouge, Orange  
**7 épaisseurs** : 1 → 7 px  
**7 styles** : Plein, Pointillé, Pointillé espacé, Tiret, Tiret-point, Tiret-point-point, Long tiret  

Clic barre d’état = suivante (clic droit = précédente). Prefs : `grokcad.pen`.

---

## Snap & paramètres

| Commande | Alias | Usage |
|----------|-------|-------|
| `/snap` | `/accroche` | `[px \| on \| off \| ?]` |
| `/grid` | `/grille` | `on \| off` — affiche / masque la grille (écart = Paramètres, 1 u. = 1 m) |
| `/gridsnap` | `/gsnap` | `on \| off` — accroche clic droit sur un nœud de grille. Impossible si `/grid off` |
| `/param` | `/params` `/settings` `/prefs` | Fenêtre Paramètres (unités, grille, snap, largeurs porte/fenêtre, styles) |
| `/undo` | `/u` `/annuler` | Annule la dernière modification (aussi Ctrl+Z) |
| `/redo` | `/retablir` `/rétablir` `/refaire` | Rétablit (Ctrl+Y ou Ctrl+Shift+Z) |

Barre du bas : **Grid ON/OFF** et **Grid Snap ON/OFF** (ON vert gras, OFF rouge gras). Clic = bascule. Si la grille est cachée, **Grid Snap OFF** est grisé et non cliquable. `/grid off` force l’affichage **Grid Snap OFF** grisé. Case Paramètres *« Grid Off désactive automatiquement le snap de la grille »* (cochée par défaut) : masquer la grille écrit aussi `gridsnap = off`.

---

## Points dans les commandes

| Token | Signification |
|-------|----------------|
| `x,y` ou `x,y,z` | Coordonnées monde (unité document) |
| `.` · `m` · `souris` | Position souris |
| `@` · `snap` | Dernier point accroché (clic droit) |

---

## Unités & fichiers

| Concept | Valeur |
|---------|--------|
| Unités | Unité document (`/param`) — distances tapées dans cette unité |
| Axe vertical | **Z vers le haut** |
| Fichier projet | **`.GKD`** (JSON, magique `GKD1`) |
| Prefs | `grokcad.pen` · `grokcad.app` (snap + 7 fichiers récents) · `grokcad.walls` |

---

## Lancer

```bash
/mnt/Raid4Tb/Program/GrokProjects/GrokCAD/lancer-GrokCad.sh
# → http://localhost:5173/  ·  titre GrokCad v.0.25.6
```

---

*GrokCAD v0.25.6 — aide commandes*
