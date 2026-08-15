# GrokCAD — Aide des commandes

> Version de référence : **0.24.15**  
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
| **Clic droit** | **Snap** dans le rayon (défaut **20 px**) |
| **Molette** | Zoom centré sous le curseur |
| **Échap** | Annule l’outil / ferme les dialogues |
| **Suppr** | Efface la sélection (si pas dans un champ) |
| **F10** | Pivote la caméra de **+45°** autour de Z |

### Snap (clic droit uniquement)

1. **Croisement / intersection** le plus proche dans le rayon (y compris aides)  
2. Sinon **extrémité** (fin de ligne / d’arc)  
3. Sinon **point le plus proche** sur la courbe  
4. Sinon aucune accroche → même effet qu’un clic gauche  

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
| `/pan` | | `<dx> <dy>` | Décalage de vue en **mètres** |
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
| `/efface_aides` | `/clear_helpers` `/ea` `/cls_aides` `/effaides` | | Efface toutes les aides |

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
| `/arccont` | `/ac` `/arccontinu` | Arcs continus (tangente G1) |
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
| Slots | **Shift+F1…F12** / **Alt+F1…F12** | Mémorise / rappelle une sélection (session) |

---

## Bibliothèque d’objets (`library/`)

Onglets : `sanitaire`, `electrique`, `salon`, `chambre`.

| Commande | Alias | Description |
|----------|-------|-------------|
| `/objets` | `/libobj` `/biblioobj` `/objectlib` | Biblio : Choisir/Poser · Modifier |
| `/obj` | `/objet` `/object` | Sélection → `library/<onglet>/<nom>.gkd` |
| `/extract` | `/ext` `/extraire` | Comme `/obj` hors library |
| `/explode` | `/expld` `/disassociate` `/dissocier` | Instance → éléments basiques (irréversible) |
| `/closelib` | `/fermerlib` `/libclose` | Ferme l’édition library |

Une instance `object` référence le fichier library. `/save` dans l’éditeur met à jour toutes les instances.

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
| `/param` | `/params` `/settings` `/prefs` | Fenêtre Paramètres |

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
# → http://localhost:5173/  ·  titre GrokCad v.0.24.15
```

---

*GrokCAD v0.24.15 — aide commandes*
