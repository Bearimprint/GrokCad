Avant tout, regarde les deux .PDF (sur ARC+) dans le repertoire "/mnt/Raid4Tb/Program/GrokProjects/GrokCAD" pour vérifier si le nom des commandes pour les murs existent. Si c'est le cas, utilises celles-ci par défaut. S'il n'y à rien sur le nom des commandes pour les murs on va uiliser les suivantes:
- /ml ou /murligne: Cela crée un mur linéaire.
- /ma ou /murarc: cela crée un mur en arc.

A noté que le mur qui sera déssiné est celui qui a été choisi en dernier dans la bibliothèque des murs.

Autre point important: un appui sur la touche [ALT] fait basculer le mur de gauche à droite (suivant le sens de laligne ou de l''arc). Cela permet d'avoir le mur dans le sens souhaité. 

Le plus gros du travail est la création de la bibliothèque (ou librairie). Elle dois afficher tous les types de murs créés (au départ elle sera vide) dans des petits carrés. 5 colonnes et autant de ligne que necessaires si l'on a un paquet de mur. Il serait même presque souhaitable de pouvoir avoir des onglets dans cette fenètre de bibliothèque pour classer les murs par type (interieurs, exterieurs, isolants etc.). La fenetre de la bibliothéque dois être indépendant (si cela est possible, sinon elle se dessinne par dessus le canvas actuel de GrokCad) et elle dois pouvoir être agrandis ou retrecis (toujours si cela est possible, sinon elle ocupera toute la surface du canvas et disparaitra quand on clic sur un mur (qui deviendra le mur en cours par défaut et devra être gardé pour être utilisé à la prochaine session de travail). Cette fenètre de bibliothèque dois permettre de créer, supprimer et déplacer dans les onlets, les murs. Pour la création, on ajoute un nouveau carré vide (le fond de la fentre de bibliothèque peut être d'une couleurs différente du fond de chaque carré ou sont affiché les murs existant déjà créés) et on affiche un champ qui permet de rentrer uniquement des numero (avec decimale). Ce champ dois être en bas de la fenètre de la bibliothèque, à coté ou au dessus des boutons, "ajouter/supprimer/déplacer" (déplacer propose soit de créer un nouvel onglet soit de choisir un de ceux déjà existant). La première ligne du nouveau mur se desinnera sur la gauche du carré vide en faisant un clic dans le carré. La ligne se desinnera avec les couleurs, type et épaisseurs en cours (ce qui veut dire que la zone ou ces choix sont fait, dois etre accesible et "cliquable" pour pouvoir modifier les couleurs, type et épaisseurs des lignes que l'on ajoute au nouveau mur). Après ce clic dans le carré vide ét l'affichage de la ligne sur la gauche, le reste des lignes du mur seront crée en rentrant la distance souhaité avec la première ligne.
IMPORTANT: Les unitées par défaut dans le canvas de GrokCad doivent être les centimètres (cela dois pouvoir être modifier plus tard dans la fameuse fenêtre de "Paramètres". Pour le moment, les centimètres doivent être l'unitée par défaut)
Pour en revenir à la bibliothèque de murs, l'affichage des murs dois se faire en affichant la totalité des lignes qui le compose en commençant par la première à gauche et la dernière à droite. Il faut laisser 3 pixels vides tout autour du carré d'affichage des murs pour que le dessin des lignes des murs ne soit pas "coller" aux bords.
Il faut aussi tenir compte qu'un mur d'un centimetre avec deux ligne et un mour complexe de 50 cms d'épaisseurs doivent s'afficher de façon à que toutes les ligne soient visibles et que la première et dernière soit bien à 3 pixels des bors (autant à droite qu'à gauche ou en haut et en bas).
Cela n'a pas été préciser mais les murs sont représenté dans leurs carré de la bibliothèque, à la VERTICALE, pas à l'horizontale.
Donc la fenetre de la biblithèque disparait si on choisi un mur (qui devient celui par défaut) ou si l'on fait [ESC] ou [Echap] ce qui, dans ce cas là ne change rien au mur qui était en cours.
Voilà pour le moment. Je pense que c'est un gros morceau à faire.
On verra à l'utilisation s'il y a besoin de faire des changement ou agilisé la création et/ou selection.
Groky, tu peux te lancer dans la création des murs et de sa bibliothèque.

---

## Implémentation (v0.7)

Spéc validée et codée :
- PDF ARC+ : **pas** de noms de commande de création de mur → `/ml` `/ma` + `/murs`
- Unités monde par défaut : **cm**
- Biblio : grille 5 col., onglets, ajouter / supprimer / déplacer, redimensionnable, overlay
- Création : 1ʳᵉ face au clic (offset 0, stylo + type) puis **épaisseurs de couche**
  successives (chaque valeur s’ajoute après la dernière ligne, pas depuis la 1ʳᵉ) ;
  apparence = stylo uniquement ; priorité = catalogue ; preview vertical, marge 3 px
- Sélection mur → défaut + `localStorage` `grokcad.walls` ; **Échap** ferme sans changer
- `/ml` mur ligne · `/ma` mur arc (3 pts) · **ALT** bascule le côté des offsets
- Entité `wall` + snap sur traits · `wallLibrary` dans le `.GKD`
- **Jonctions** (v0.7.1→2 → **v0.18.0** → **v0.21.0 priorités**) : chaînes → **offset de polyligne** ; nœuds T/Y → `resolveStarNodeStrokes`
  - chaque trait reste **strictement parallèle** à son segment de base
  - aux coins L : intersection avec le trait équivalent du segment voisin (onglet)
  - aux T/Y : 4 stratégies cyclables (Gauche=Oui / Droit=Non) ; défaut = 1ʳᵉ rencontre
  - géométrie stockée dans `strokeGeom` (recalculée à chaque pose / suppression / `/jonction`)
  - **Doc algo complète : `JONCTION.md`**
  - **Priorités de couches** (v0.21) : chaque trait a une `priority` (1 = plus haute importance)
    lue depuis `library/walls/layer-priorities.json` ; le raccord apparie **même priorité**
    (pas seulement le même offset) — inspiré Revit/ArchiCAD (`multi-couches-wall_Y.md`)

---

## Priorités de couches (v0.21)

| Élément | Détail |
|---------|--------|
| Fichier catalogue | `library/walls/layer-priorities.json` |
| Module | `src/core/wallLayerCatalog.ts` |
| Champ stocké | `WallLineDef.priority` + `layerTypeId` |
| UI | liste **Couche / priorité** dans `/murs` (bibliothèque) |
| Règle | prio 1 (structure) se raccorde avant prio 5 (placo) ; matching inter-murs par priorité + rang |

Exemples dans le catalogue :

- `1 — mur porteur en béton armé`
- `3 — isolant thermique`
- `5 — placo-platre 13mm`

Éditer le JSON, rouvrir la biblio → les types se rechargent. Les types absents du disque
utilisent le catalogue embarqué (fallback).

