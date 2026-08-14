# GrokCAD — Aide des commandes

> **Snapshot manuel** (v0.9) — ce fichier n’est **pas** régénéré à chaque nouvelle commande.  
> On le mettra à jour par lots quand plusieurs commandes auront été ajoutées.  
> Ouvrir depuis l’appli : taper `/help` (ou `/?` · `/h`) dans la ligne de commande.

Répertoire projet : `/mnt/Raid4Tb/Program/GrokProjects/GrokCAD`  
Ligne de commande : bas gauche (`GrokCAD>`). Préfixe `/` ou `\` accepté (ex. `\ligne`).

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

### Snap (clic droit uniquement)

1. **Croisement / intersection** le plus proche dans le rayon (y compris aides)  
2. Sinon **extrémité** (fin de ligne / d’arc) dans le rayon — même si un point du trait est plus proche  
3. Sinon **point le plus proche** sur la courbe dans le rayon  
4. Sinon **aucune accroche** → même effet qu’un clic gauche (point brut si outil actif)

Pour s’accrocher *près* d’une fin sans la prendre : zoomer pour que le rayon n’englobe plus l’extrémité.

Point accroché réutilisable avec `@` dans les commandes.  
Souris courante : `.` (ou `m` / `souris`).

---

## Aide

| Commande | Alias | Description |
|----------|-------|-------------|
| `/help` | `/?` `/h` | Ouvre ce fichier `HELP.md` avec le visualiseur par défaut de l’OS |

---

## Navigation & vue

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/pan` | | `<dx> <dy>` | Décalage de vue en **mètres** (le glisser-gauche panne déjà) |
| `/zoom` | | `<facteur>` | Zoom (`>1` éloigne, `<1` rapproche). Ex. `/zoom 0.5` |
| `/center` | `/centrer` `/fit` `/ze` `/extents` | — | Cadre **tout le dessin** dans le canvas (emprise X,Y,Z) selon la vue courante (plan / axo / persp / face…). Les aides infinies sont ignorées. |
| `/view` | | | Affiche la position caméra courante |
| `/axo` | `/iso` | | Vue axonométrique isométrique (ortho, Z-up) |
| `/pers` | `/persp` | | Vue perspective (garde la direction de vue) |
| `/plan` | `/top` `/dessus` | | Vue en plan XY (dessus) |
| **F10** | | | Pivote la caméra de **+45°** autour de l’axe Z vertical (toute vue) |
| `/pers` | `/persp` `/perspective` | | Vue perspective — **prévu** |

---

## Fichier

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/new` | `/nouveau` | | Nouveau dessin vide (biblio murs conservée) |
| `/save` | `/sauver` `/enregistrer` | `[nom]` | Enregistre le `.GKD` (téléchargement) ou l’objet library en cours d’édition |
| `/open` | `/ouvrir` | | Ouvre un fichier `.GKD` (restaure la caméra) |

---

## Lignes d’aide

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/axes` | `/xyz` | `[x y z \| . \| @]` | 3 axes d’aide XYZ par un point (défaut 0 0 0) |
| `/hx` | | sans arg = **clics** jusqu’Échap · `0,1.7,0` · `@` · `.` | Aide // **X** : **Y et Z** du point (X ignoré) |
| `/hy` | | sans arg = **clics** jusqu’Échap · `3,0,5` · `@` · `.` | Aide // **Y** : **X et Z** du point (Y ignoré) |
| `/hz` | | sans arg = **clics** jusqu’Échap · `4,7.2,0` · `@` · `.` | Aide // **Z** : **X et Y** (Z ignoré ; point en vue de dessus) |
| `/paral` | `/parallele` `/parallel` `/par` | (vide) · `dx 1,2` · `dxy 1.5,3` · `dy` · `dz` · `DXY a,b,c,d` | **Désigner** (orange, **≠ sélection**) un élément puis copie parallèle. La **copie devient désignée** → enchaîner sans retaper. **Échap** = fin. Sans arg : emplacement. Avec `D…` : distances fixes, clic = sens. Compat. aides : `x\|y\|z <d>` · `<d>` |
| `/perp` | `/perpendiculaire` `/orthogonal` | `[x y z]` · `.` · `@` | Perpendiculaire d’aide à la dernière aide, par un point |
| `/efface_aides` | `/clear_helpers` `/ea` `/cls_aides` `/effaides` | | Efface **toutes** les lignes d’aide |

Exemples :

```text
/axes
/paral x 8
/paral y 6
/paral 3
/perp .
/efface_aides
```

---

## Dessin (stylo courant)

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/ligne` | `/l` `/line` `/li` | interactif · `0,0,0 dx 1.5` · `dxy 3.7,5.9` · `1,1,1 5,5,5` | Ligne **chaînée**. XYZ : `x,y,z` (`,`=axes, `.`=décimale). `dx`/`dy`/`dz`/`dxy`/`dxz`/`dxyz`… = **relatif** au dernier point (signe conservé). **Shift** = H/45°/V |
| `/arcc` | `/acentre` `/arccen` | coords ou interactif | Arc depuis le **centre** : centre → rayon → **Échap** = cercle · ou départ → fin d’arc |
| `/arc` | `/a` | coords ou interactif | Arc **3 points** : départ → passage → fin (plan XY) |
| `/arccont` | `/ac` `/arccontinu` | interactif | Arcs **continus** (tangente G1, sans cassure) |
| `/cercle` | `/c` `/circle` `/cir` | coords ou interactif | Cercle : centre → rayon |
| `/cut` | `/coupe` `/break` `/scinder` | interactif | Coupe ligne/arc/cercle au plus près du clic (rayon snap) ; hors rayon = rien |
| `/pline` | `/polyligne` `/polyline` `/pl` | interactif · chemin comme `/line` | Polyligne (1 entité). **Shift** = H/45°/V · **Échap** = fin |
| `/rect` | `/rectangle` `/rec` | interactif · `0,0,0 dxy 7.3,3.7` | Rectangle = **polyligne fermée**. **Shift** = carré (côté = min dx,dy) |
| `/text` | `/txt` `/texte` | `Cuisine` · `Cuisine 0,0,0 dx 1` | Texte. Style dans la **barre du haut**. Sans texte → fenêtre. 1er clic = départ, 2e = direction |
| `/textbox` | `/txb` `/cartouche` | idem `/text` | Texte + rectangle (décalage dans `/param`, défaut 0,03) |
| `/cote` | `/dim` `/dimension` `/cotation` | interactif | **1 segment = 1 entité** + **texte séparé**. Chaque morceau est indépendant (sélection / /m1). Segments déjà posés **conservés** si on change de commande ou Échap. Style : barre haut / `/cotations` |
| `/cotations` | `/dimstyles` | | Styles : typo, lignes, écarts, tick 45°, **écart texte** |
| `/cotecont` | | | *(prévu)* chaîne continue + cumul, explosable en singles via `/explode` |

**Barre du haut** : couleur/épaisseur/style de trait · police/couleur/fond/taille/Bold/Italic du texte · style de cotation.

---

## Murs

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/murs` | `/biblio` `/libmurs` `/walllib` `/walls` | | Bibliothèque de murs (créer / choisir un style) |
| `/murligne` | `/ml` `/wallline` `/wl` | interactif · **ALT** flip côté | Mur **linéaire** (style courant) |
| `/murarc` | `/ma` `/wallarc` `/wa` | interactif · **ALT** flip côté | Mur en **arc** 3 pts (style courant) |
| `/jonction` | `/rejoin` `/raccord` | cadre 2 clics | Snap extrémités proches + onglets multi-couches (L/T/Y) |
| `/join` | `/joindre` | 1) mur source 2) mur cible | Prolonge le mur **A** jusqu’à l’axe de **B** (T bout→flanc ou L coin) ; raccords par **priorité** de couche |

**`/join`** : cliquer d’abord le mur à allonger (près du bout voulu), puis le mur cible.  
**`/jonction`** : cadre autour d’extrémités déjà proches (tol. **65 cm**).  
Détails : `WALLS.md` · `JONCTION.md`.

---

## Mesure

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/dist` | `/distance` `/mesure` `/di` | interactif | Distance entre **2 points** (unité document, `/param`). Affiche aussi Δx Δy Δz. Enchaîne jusqu’à **Échap** |

---

## Déplacement & rotation (un objet)

| Commande | Alias | Description |
|----------|-------|-------------|
| `/m1` | `/move1` | Déplace **un** objet : désigner → base → dest. **Cote (ligne)** → segment + son texte lié. **Texte de côte** → libellé seul |
| `/r1` | `/rot1` `/rotation` | Rotation d’**un** objet : désigner → pivot → réf. → angle. Même règle ligne/texte de côte |

---

## Sélection & édition

| Commande | Alias | Description |
|----------|-------|-------------|
| `/select` | `/sl` `/sel` | Sélection par **cadre** (2 clics). **ALT** = retirer du cadre |
| `/deselect` | `/dsel` `/unsel` `/clear_sel` | Vide la sélection |
| `/delete` | `/del` `/effacer` `/erase` | Efface les entités **sélectionnées** (aussi touche **Suppr**) |
| `/d` | `/delpick` · **Ctrl+D** | Efface l’élément **désigné** au clic (rayon snap) ; enchaîne jusqu’à **Échap** (pas de sélection préalable) |
| `/copy` | `/cp` `/copier` | **Sans sél.** : 1 clic désigner (orange + suit la souris) → 1 clic coller ; la copie suit pour enchaîner. **Avec sél.** : base → arrivée ; copies = nvelle sél. **Échap** = fin |
| Slots sél. | — | **Shift+F1…F12** mémorise la sélection (ids) · **Alt+F1…F12** la rappelle (session) |
| `/move` | `/mv` `/deplacer` `/déplacer` | Déplace la sélection (clic base → clic destination) |

---

## Bibliothèque d’objets (`library/`)

Onglets par défaut : `sanitaire`, `electrique`, `salon`, `chambre` (sous-dossiers de `library/`).

| Commande | Alias | Description |
|----------|-------|-------------|
| `/objets` | `/libobj` `/biblioobj` `/objectlib` | Ouvre la biblio objets : **Choisir/Poser** · **Modifier** |
| `/obj` | `/objet` `/object` | Sélection → objet `library/<onglet>/<nom>.gkd` (clic = origine 0,0,0) |
| `/extract` | `/ext` `/extraire` | Comme `/obj` mais dialogue d’emplacement (hors library) |
| `/explode` | `/expld` `/disassociate` `/dissocier` | Instance library → éléments basiques (**irréversible**) |
| `/closelib` | `/fermerlib` `/libclose` | Ferme l’édition d’un objet library et revient au dessin |

### Instances (réf. live)

- Une entité `object` référence `library/<tab>/<name>.gkd` + une origine.
- Modifier le fichier library puis `/save` → toutes les instances se mettent à jour.
- `/explode` casse le lien (lignes / arcs / murs indépendants).

---

## Stylo (prochain trait)

Défauts : **Noir** · **1 px** · **Plein**.

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/couleur` | `/color` `/coul` `/co` | `[nom\|id\|#hex\|n°]` | Couleur du prochain trait (sans arg = liste / cycle) |
| `/epaisseur` | `/épaisseur` `/ep` `/width` `/lw` `/epaiss` | `[1-7\|id]` | Épaisseur 1–7 px |
| `/style` | `/st` `/linetype` `/trait` | `[plein\|pointille\|tiret\|…]` | Style de trait |
| `/stylo` | `/pen` | | Résumé du stylo courant |

**7 couleurs** : Noir, Blanc, Bleu, Vert, Jaune, Rouge, Orange  
**7 épaisseurs** : 1 → 7 px  
**7 styles** : Plein, Pointillé, Pointillé espacé, Tiret, Tiret-point, Tiret-point-point, Long tiret  

Clic sur Couleur / Épaisseur / Style dans la barre d’état = valeur suivante (clic droit = précédente).  
Persistance : `localStorage` clé `grokcad.pen`.

---

## Snap & paramètres

| Commande | Alias | Usage | Description |
|----------|-------|-------|-------------|
| `/snap` | `/accroche` | `[px \| on \| off \| ?]` | Accroche clic droit (rayon en **pixels** écran) |
| `/param` | `/params` `/parametres` `/paramètres` `/settings` `/prefs` `/preferences` | | Fenêtre Paramètres (snap, styles de ligne) |

Exemples : `/snap 12` · `/snap on` · `/snap off` · `/param`

---

## Points dans les commandes

| Token | Signification |
|-------|----------------|
| nombres `x y` ou `x y z` | Coordonnées monde (**cm** par défaut) |
| `.` · `m` · `souris` | Position souris sur le canevas |
| `@` · `snap` | Dernier point accroché (clic droit) |

---

## Unités & conventions

| Concept | Valeur |
|---------|--------|
| Unités monde | **centimètres** (`meta.units: "cm"`) |
| Axe vertical | **Z vers le haut** |
| Plan de travail défaut | **XY** |
| Fichier projet | **`.GKD`** (JSON, magique `GKD1`) |
| Prefs stylo | `grokcad.pen` |
| Prefs app / snap | `grokcad.app` |
| Prefs murs | `grokcad.walls` + `wallLibrary` dans le `.GKD` |

---

## Lancer l’application

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd /mnt/Raid4Tb/Program/GrokProjects/GrokCAD
npm run dev
# → http://localhost:5173/
```

> `/help` ouvre ce fichier via le **serveur de dev** (xdg-open sous Linux, `open` sous macOS, association par défaut sous Windows).  
> Sans serveur dev, la commande affiche une erreur dans la barre de feedback.

---

*GrokCAD v0.9 — aide commandes (snapshot manuel)*
