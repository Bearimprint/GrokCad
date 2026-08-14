# GrokCAD

Éditeur CAO **3D-first** inspiré d’**ARC+** (pas un clone d’AutoCAD).

Répertoire projet : `/mnt/Raid4Tb/Program/GrokProjects/GrokCAD`

> **Reprise de session** : lire d’abord `STATUS.md` (état court + prochaine étape).

## Vision (ARC+)

| Concept ARC+ | Direction GrokCAD |
|--------------|-------------------|
| Pensé 3D dès le départ | Viewport Three.js, plan de travail XY / XZ / YZ |
| **Lignes d’aide** infinies, pointillés gris, snap, effacement global | **Implémenté** |
| **Lignes / arcs / cercles** + stylo (couleur, épaisseur, style) | **Implémenté** (v0.5) |
| **Coupe** (`/cut`) d’un élément au plus près du clic | **Implémenté** (v0.6) |
| **Murs** multi-lignes (écarts, couleurs, épaisseurs) + bibliothèque | **Implémenté** (v0.7) — voir `WALLS.md` |
| **Bibliothèque d’objets** (sanitaires, mobilier…) | `objectLibrary` dans le `.GKD` |
| Commandes clavier | Ligne de commande bas gauche ; alias `\` style ARC+ |

## État actuel (v0.20 — voir `STATUS.md`)

- Page de dessin (grille + repère, **Z vers le haut**)
- Unités monde : **centimètres** par défaut (`meta.units: "cm"`)
- **Ligne de commande** en bas à gauche
- **Stylo** (couleur · épaisseur · style) à droite de la CLI, avant les coords
- **Lignes d’aide** + **lignes / arcs / cercles** + **murs** multi-traits
- **Sélection** `/select` (cadre, ALT = désél.) · `/delete` (Suppr) · **`/d` / Ctrl+D** (désignation) · `/copy` · `/move`
- **Objets** `/obj` → `library/` · `/objets` (poser instance) · `/explode` · **Modifier** library
- **Murs** : `/murs` · `/ml` · `/ma` · **ALT** bascule le côté
- **Coupe** : `/cut` · **Snap** clic droit · **Paramètres** `/param`
- Fichiers **`.GKD`** ; prefs : `grokcad.pen` + `grokcad.app` + `grokcad.walls`

### Souris (esprit ARC+)

| Action | Effet |
|--------|--------|
| Glisser **bouton gauche** | **Pan** (`/pan`) |
| **Clic gauche** court (outil actif) | Place un point **sans** snap |
| Glisser **bouton milieu** | Pan |
| **Clic droit** (`/snap`) | Accroche dans le rayon (défaut **20 px**) — voir ci-dessous |
| **Molette** | Zoom centré sous le curseur |
| **Échap** | Annule l’outil / ferme les paramètres |

#### Snap (clic droit uniquement)

1. **Croisement / intersection** le plus proche dans le rayon (y compris aides)  
2. Sinon **extrémité** (fin de ligne / d’arc) dans le rayon — même si un point du trait est plus proche  
3. Sinon **point le plus proche** sur la courbe (segment / arc / aide)  
4. Sinon **aucune accroche** → même effet qu’un **clic gauche** (point brut si outil actif)

Pour s’accrocher *près* d’une fin sans la prendre : zoomer jusqu’à ce que les 20 px n’englobe plus l’extrémité.

Le rayon est en **pixels écran** (indépendant du zoom). Réglable : `/snap 12` ou `/param`.  
Point accroché réutilisable avec `@` dans les commandes.

### Stylo (prochain trait)

| Défaut | Valeur |
|--------|--------|
| Couleur | Noir |
| Épaisseur | 1 px |
| Style | Plein |

**7 couleurs** : Noir, Blanc, Bleu, Vert, Jaune, Rouge, Orange  
**7 épaisseurs** : 1 → 7 px  
**7 styles** : Plein, Pointillé, Pointillé espacé, Tiret, Tiret-point, Tiret-point-point, Long tiret  

Clic sur Couleur / Épaisseur / Style dans la barre d’état = valeur suivante (clic droit = précédente).  
Commandes : `/couleur`, `/epaisseur`, `/style`, `/stylo`.

Persistance : JSON dans `localStorage` (clé `grokcad.pen`), schéma dans `src/core/penPrefs.ts`.

### Commandes

| Commande | Description |
|----------|-------------|
| `/help` | Ouvre `HELP.md` (visualiseur OS) — snapshot manuel |
| `/ligne` (`/l` `/line`) | Ligne chaînée (clics · `0,0,0 dx 1.5` · `dxy 3.7,5.9` · `1,1,1 5,5,5`) |
| `/arcc` | Arc depuis le **centre** : centre → rayon → **Échap** = cercle · ou départ → fin d’arc |
| `/arc` (`/a`) | Arc **3 points** : départ → passage → fin |
| `/arccont` (`/ac`) | Arcs **continus** (tangente G1, sans cassure) |
| `/cercle` (`/c`) | Cercle : centre → rayon |
| `/murs` | Bibliothèque de murs (onglets, créer / supprimer / déplacer) |
| `/murligne` (`/ml`) | Mur **linéaire** (style courant) — **ALT** flip côté |
| `/murarc` (`/ma`) | Mur en **arc** 3 pts — **ALT** flip côté |
| `/select` (`/sl`) | Sélection **cadre** 2 clics (touche partielle) — **ALT** = désélection |
| `/delete` (`/del`) | Efface la sélection (**Suppr**) |
| `/d` (**Ctrl+D**) | Efface l’élément désigné au clic ; boucle jusqu’à **Échap** |
| `/copy` | Copie sélection (base → arrivée) |
| `/move` | Déplace sélection (base → destination) |
| `/obj` | Sélection → objet dans `library/<onglet>/` (clic = origine) |
| `/extract` (`/ext`) | Comme `/obj` mais dialogue d’emplacement |
| `/objets` | Biblio objets : **Choisir** (pose souris) · **Modifier** |
| `/explode` (`/expld`) | Dissocie une instance → éléments basiques |
| `/closelib` | Ferme l’édition d’un objet library |
| `/cut` (`/coupe`) | Coupe l’élément le plus proche (rayon snap) ; hors rayon = rien |
| `/snap` `[px\|on\|off]` | Accroche clic droit (rayon px) |
| `/param` | Fenêtre paramètres (snap + styles) |
| `/couleur` `/epaisseur` `/style` | Stylo |
| `/pan dx dy` | Décalage vue en mètres |
| `/zoom f` | Zoom par facteur |
| `/center` (`/fit` `/ze`) | Cadre tout le dessin dans le canvas (emprise 3D, vue courante) |
| `/axes [x y z \| . \| @]` | 3 axes d’aide XYZ |
| `/hx` `/hy` `/hz` | Aide // X/Y/Z : clic (boucle→Échap) ou `/hx 0,1.7,0` (axes non pertinents ignorés) |
| `/paral x 8` `/paral y 6` | Parallèles aux axes |
| `/paral 3` | Parallèle à la dernière aide |
| `/perp` | Perpendiculaire à la dernière aide |
| `/efface_aides` (`/ea`) | Efface toutes les lignes d’aide |
| `/new` `/save` `/open` | Document |
| `/dxfin` | Import `.dxf` → `.gkd` (récursif si dossier ; TEXT/blocs/styles ; skip si `.gkd` existe) |
| `/dxfout` | Export batch `.gkd` → `.dxf` (fichiers ou dossier + destination) |
| `/export` | Export du dessin courant en `.dxf` (tout / sélection) |
| `/axo` `/pers` `/plan` · **F10** | **Fait** (v0.20) — iso / perspective / plan · +45° Z |
| `/view` | État caméra |

Préfixe `\` accepté (ex. `\ligne`).

### Mini scénarios

**Aides (TP01)**  
```text
/axes
/paral x 8
/paral y 6
```
Clic droit près d’un coin → accroche. `/efface_aides` pour tout retirer.

**Dessin**  
```text
/couleur bleu
/epaisseur 2
/style tiret
/ligne
```
Puis clics (ou `0 0` Entrée, `5 0` Entrée…). Chaîne jusqu’à **Échap**.

```text
/arcc
```
Centre → rayon (cercle live). **Échap** = garder le cercle, ou 2 clics = début/fin d’arc.

```text
/arc
```
Départ → point de passage → fin (preview live).

```text
/arccont
```
Premier arc comme `/arc`, puis chaque clic ajoute un arc collé en tangente (G1). Preview masqué si position impossible.

```text
/cercle
```
Centre → point sur le rayon.

```text
/cut
```
Clic près d’une **ligne** / **arc** / **cercle** (rayon snap, défaut **20 px** écran).  
- Ligne → 2 segments (aspect inchangé si coupe au milieu)  
- Arc → 2 arcs  
- Cercle → arc plein au point de coupe (aspect inchangé ; 2ᵉ coupe → 2 arcs)  
Hors rayon ou extrémité : **aucun effet**. Échap termine l’outil.

## Format `.GKD`

```json
{
  "magic": "GKD1",
  "version": "0.6.0",
  "modified": "2026-07-20T12:00:00.000Z",
  "camera": {
    "target": [0, 0, 0],
    "position": [0, 0, 50],
    "up": [0, 1, 0],
    "mode": "ortho",
    "orthoHalfHeight": 10,
    "fov": 50,
    "workplane": "XY"
  },
  "entities": [],
  "wallLibrary": [],
  "objectLibrary": [],
  "meta": { "title": "Sans titre", "units": "m" }
}
```

Entités `line` / `arc` / `circle` portent `color`, `lineWidth`, `lineStyle`.

## Lancer

```bash
export PATH="$HOME/.local/node/bin:$PATH"
cd /mnt/Raid4Tb/Program/GrokProjects/GrokCAD
npm install
npm run dev
```

Ouvrir l’URL (souvent `http://localhost:5173` ou `http://127.0.0.1:5173`).

## Stack

- **TypeScript** + **Vite**
- **Three.js** (Line2 pour épaisseurs en pixels)
- Unités monde : **mètres**

## Docs de référence (dans ce dossier)

- `STATUS.md` — où on en est (court)
- `tutoriel_Arcplus.pdf` — exercices, L.AIDES, LIGNES, repère 3D
- `userGuide524127.pdf` — Progress 4.06

## Suite prévue

1. ~~Lignes d’aide~~ **fait**
2. ~~Lignes + arcs + stylo~~ **fait**
3. ~~Snap unifié + paramètres~~ **fait** (v0.4)
4. ~~Arcs multi-commandes + cercle~~ **fait** (v0.5)
5. ~~`/cut`~~ **fait** (v0.6)
6. ~~`/axo` et `/pers`~~ **fait** (v0.20 · F10)
7. Murs multi-traits + bibliothèque
8. Bibliothèque d’objets 2D/3D
