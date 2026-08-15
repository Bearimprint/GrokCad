/** Unités monde : mètres par défaut. */

export type Vec3 = [number, number, number];

/** Plan de travail courant (repère ARC+). */
export type Workplane = 'XY' | 'XZ' | 'YZ';

export type CameraMode = 'ortho' | 'persp';

/** Unité d'affichage / saisie (monde stocké dans cette unité). */
export type { UnitId } from './units';
import type { UnitId } from './units'; // used in GkdDocument.meta

/** État caméra sérialisable — restauré à l'identique à l'ouverture .GKD. */
export interface CameraState {
  /** Point regardé (cible orbit / plan). */
  target: Vec3;
  /** Position caméra. */
  position: Vec3;
  up: Vec3;
  /** Mode projection. */
  mode: CameraMode;
  /**
   * Demi-hauteur visible en unités monde (orthographique).
   * Plus la valeur est grande, plus on voit loin (zoom out).
   */
  orthoHalfHeight: number;
  /** FOV vertical en degrés (perspective). */
  fov: number;
  workplane: Workplane;
}

export type EntityKind =
  | 'line'
  | 'arc'
  | 'circle'
  | 'polyline'
  | 'wall'
  | 'object'
  | 'helper'
  | 'text'
  | 'point'
  | 'dimension';

/** Style de trait (catalogue dans penPrefs). */
export type LineStyleId =
  | 'plein'
  | 'pointille'
  | 'pointille_espace'
  | 'tiret'
  | 'tiret_point'
  | 'tiret_point_point'
  | 'long_tiret';

export interface EntityBase {
  id: string;
  kind: EntityKind;
  layer: string;
  /** true = ligne d'aide (sous-couche, snap, effaçable en masse). */
  isHelper?: boolean;
}

export interface StrokeStyle {
  color: string;
  /** Épaisseur en pixels écran. */
  lineWidth: number;
  lineStyle: LineStyleId;
}

export interface LineEntity extends EntityBase, StrokeStyle {
  kind: 'line';
  start: Vec3;
  end: Vec3;
}

/** Arc circulaire dans un plan (normal + centre). Angles en radians. */
export interface ArcEntity extends EntityBase, StrokeStyle {
  kind: 'arc';
  center: Vec3;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Normale du plan (défaut Z pour plan XY). */
  normal: Vec3;
}

/** Cercle complet (plan XY, Z = center.z). */
export interface CircleEntity extends EntityBase, StrokeStyle {
  kind: 'circle';
  center: Vec3;
  radius: number;
  /** Normale du plan (défaut Z). */
  normal: Vec3;
}

/**
 * Segment de polyligne — style figé à la pose (couleur / épaisseur / style
 * du stylo au moment du clic, indépendant des segments voisins).
 */
export interface PolylineLineSeg {
  type: 'line';
  start: Vec3;
  end: Vec3;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

export interface PolylineArcSeg {
  type: 'arc';
  center: Vec3;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Normale du plan (défaut Z). */
  normal: Vec3;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

export type PolylineSegment = PolylineLineSeg | PolylineArcSeg;

/**
 * Remplissage d’une polyligne (/fill) via un motif hachure (/hatch).
 * Motif = .gkd 1 m × 1 m dans library/hatch/.
 */
export interface HatchFill {
  /** Nom du fichier .gkd (sans extension) dans library/hatch/. */
  hatchName: string;
  /** Échelle du motif (1 = 1 m motif → 1 m monde). */
  scale: number;
  /** Rotation du motif en degrés (0–360). */
  rotationDeg: number;
}

/**
 * Polyligne / polygone : chaîne de lignes et d’arcs = **une seule entité**.
 * Sélectionner n’importe quel segment sélectionne toute la polyligne.
 */
export interface PolylineEntity extends EntityBase {
  kind: 'polyline';
  segments: PolylineSegment[];
  /**
   * true si le dernier point est accroché au premier (fermeture géométrique).
   * Calculé à la pose / au fill ; pas strictement requis pour le rendu.
   */
  closed?: boolean;
  /** Remplissage hachure (phase 5 /fill). */
  hatch?: HatchFill;
}

/**
 * Point d’accroche / motif de hachure.
 * Taille écran fixe = `lineWidth` × `lineWidth` px (indépendant du zoom).
 * Le style de trait n’est pas pris en compte.
 */
export interface PointEntity extends EntityBase {
  kind: 'point';
  position: Vec3;
  color: string;
  /** Épaisseur stylo 1–7 → taille écran en px (1×1 … 7×7). */
  lineWidth: number;
}

/**
 * Texte 2D (import DXF TEXT/MTEXT, /text, /textbox).
 * `position` = point d’insertion / d’alignement (selon hAlign/vAlign).
 * `height` = hauteur des caractères en unités monde.
 */
export interface TextEntity extends EntityBase {
  kind: 'text';
  position: Vec3;
  /** Hauteur des caractères (unités monde). */
  height: number;
  /** Contenu affiché (plain text, peut être multiligne). */
  content: string;
  /** Rotation autour de Z (radians). */
  rotation: number;
  color: string;
  /**
   * Alignement horizontal DXF (0=gauche, 1=centre, 2=droite,
   * 3=aligné, 4=milieu, 5=fit) — rendu approx. 0/1/2.
   */
  hAlign: number;
  /**
   * Alignement vertical DXF (0=baseline, 1=bas, 2=milieu, 3=haut).
   */
  vAlign: number;
  /** Famille de police CSS (ex. "Arial", "sans-serif"). */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  /**
   * Couleur de fond du cartouche. `null` / absent = transparent.
   */
  background?: string | null;
  /** true = rectangle autour du texte (/textbox). */
  boxed?: boolean;
  /**
   * Décalage texte ↔ rectangle (unités monde).
   * Si absent et boxed, utiliser les préférences app (défaut 0.03).
   */
  boxPadding?: number;
  /**
   * Si ce texte est le libellé d’une cotation : id de la DimensionEntity liée.
   * Permet de sélectionner / déplacer le texte indépendamment de la ligne.
   */
  dimId?: string;
}

/**
 * Style de cotation (liste « Cotations », snapshot à la pose).
 * Toutes les distances sont en unités monde courantes.
 */
export interface DimensionStyle {
  id: string;
  name: string;
  /** Typographie du texte de cotation. */
  fontFamily: string;
  textColor: string;
  /** `null` = fond transparent. */
  textBackground: string | null;
  /** Hauteur des chiffres (unités monde). */
  textHeight: number;
  bold: boolean;
  italic: boolean;
  lineColor: string;
  lineWidth: number;
  lineStyle: LineStyleId;
  /**
   * Écart entre le point désigné et le début de la ligne d’attache.
   * 0 = la perpendiculaire touche le dessin.
   */
  extensionOffset: number;
  /** Dépassement de la ligne d’attache au-delà de la ligne de côte. */
  extensionOverhang: number;
  /** Longueur de la petite barre à 45° au croisement. */
  tickSize: number;
  /**
   * Distance entre la ligne de côte et la **baseline** du texte
   * (perpendiculaire à la ligne, unités monde).
   */
  textOffset: number;
}

/**
 * Cotation linéaire.
 *
 * **`/cote` (mode `single`)** : **un seul segment** = une entité.
 * Le libellé est une **TextEntity séparée** (`labelId`) — sélectionnable / déplaçable.
 *
 * **`/cotecont` (mode `chain`, futur)** : chaîne multi-segments en une entité
 * (explosable en singles).
 *
 * Ligne de côte // `direction`, passant par `lineAnchor`.
 * Distance = projection des defPoints sur `direction`.
 */
export interface DimensionEntity extends EntityBase {
  kind: 'dimension';
  /** Snapshot du style à la création. */
  style: DimensionStyle;
  /** Point par lequel passe la ligne de côte (1er clic). */
  lineAnchor: Vec3;
  /** Direction unitaire de la ligne de côte (plan XY). */
  direction: Vec3;
  /**
   * Points de définition.
   * `/cote` (single) : exactement **2** points = un morceau.
   * `/cotecont` (chain) : n ≥ 2 points.
   */
  defPoints: Vec3[];
  /**
   * Id de la TextEntity du libellé (entité réelle dans le document).
   * Absent uniquement pour anciens fichiers (libellé virtuel legacy).
   */
  labelId?: string;
  /**
   * `single` = /cote (1 segment) · `chain` = /cotecont (chaîne).
   * Défaut `single`.
   */
  mode?: 'single' | 'chain';
  /**
   * @deprecated Legacy multi-libellés sans TextEntity.
   * Conservé pour ouvrir d’anciens .gkd ; non utilisé par /cote actuel.
   */
  labelPositions?: Vec3[];
  /** @deprecated Voir labelPositions. */
  labelRotations?: number[];
}

export interface HelperLineEntity extends EntityBase {
  kind: 'helper';
  /** Ligne infinie : point + direction unitaire. */
  origin: Vec3;
  direction: Vec3;
  color: string;
}

/**
 * Un trait du profil de mur (offset depuis la 1ʳᵉ face, en unités monde).
 *
 * **Modèle matériaux = bandes entre traits** (pas le trait seul) :
 * - trait offset 0 = 1ʳᵉ face : en principe **sans** priority/layerTypeId ;
 * - chaque trait suivant porte le type/prio du **matériau de la bande** qu’il ferme
 *   (entre le trait précédent et lui) ;
 * - un trait intermédiaire est **partagé** par 2 matériaux
 *   (ex. fin béton = début isolant). Le raccord utilise alors la prio la plus
 *   importante des deux (voir `wallLineJoinPriority`).
 */
export interface WallLineDef {
  /** Distance à la première face (0 pour la 1ʳᵉ). */
  offset: number;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
  /**
   * Priorité du matériau de la bande fermée par ce trait (1 = structure…).
   * Absent sur la 1ʳᵉ face. Pour le raccord effectif d’un trait partagé,
   * utiliser `wallLineJoinPriority(lines, line)`.
   */
  priority?: number;
  /**
   * Type catalogue du matériau de la bande fermée par ce trait
   * (ex. `structure-beton`, `placo-13`). Absent sur la 1ʳᵉ face.
   */
  layerTypeId?: string;
}

/** Stratégie de raccord T/Y (`/jonction`). Persistée sur le mur. */
export type JonctionStrategyId =
  | 'first-hit'
  | 'first-hit-cover'
  | 'l-pair-stem'
  | 'max-t';

/** Style de mur réutilisable (bibliothèque). */
export interface WallStyle {
  id: string;
  name: string;
  /** Onglet / catégorie (intérieurs, extérieurs…). */
  tab: string;
  lines: WallLineDef[];
}

/**
 * Géométrie d'un trait de mur déjà résolue (parallèle à la base, coins en onglet).
 * Calculée par chaîne de segments collés.
 */
export interface WallStrokeGeom {
  offset: number;
  start: Vec3;
  end: Vec3;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

/** Segment de mur (chemin de référence offset 0) — pour path === 'poly'. */
export interface WallSegLine {
  type: 'line';
  start: Vec3;
  end: Vec3;
}

export interface WallSegArc {
  type: 'arc';
  center: Vec3;
  radius: number;
  startAngle: number;
  endAngle: number;
  normal: Vec3;
}

export type WallSegment = WallSegLine | WallSegArc;

/**
 * Mur posé dans le dessin.
 * Le chemin de référence est l'offset 0 ; les autres traits sont décalés.
 * `lines` = snapshot du style à la pose.
 *
 * - path `line` / `arc` : un seul segment (start/end [+ centre arc])
 * - path `poly` : plusieurs segments (`segments`) = **une seule entité** (/pmur…)
 */
export interface WallEntity extends EntityBase {
  kind: 'wall';
  styleId: string;
  path: 'line' | 'arc' | 'poly';
  /** ALT : bascule le côté des offsets. */
  flip: boolean;
  lines: WallLineDef[];
  /** Extrémités du chemin de référence (offset 0) — pour poly = début 1er / fin dernier. */
  start: Vec3;
  end: Vec3;
  /**
   * Traits linéaires précalculés (parallèles + jonctions).
   * Rempli par `recomputeLinearWallJoints` ; absent = offset simple.
   * Utilisé aussi pour les segments line des polymurs (les arcs restent calculés à part).
   */
  strokeGeom?: WallStrokeGeom[];
  /**
   * Stratégie T/Y retenue pour les nœuds de degré ≥ 3 de ce mur.
   * Relue par `recomputeLinearWallJoints` pour ne pas écraser un choix Y/N.
   */
  joinStrategy?: JonctionStrategyId;
  /** Présents si path === 'arc'. */
  center?: Vec3;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  normal?: Vec3;
  /** Présents si path === 'poly' (multi-segments /pmur /pmarc /pmarct). */
  segments?: WallSegment[];
  /** true si dernier point ≈ premier (fermeture). */
  closed?: boolean;
}

/**
 * Instance d'objet de bibliothèque (référence live).
 * `library/<libTab>/<libName>.gkd` — si le fichier library change,
 * toutes les instances se mettent à jour (cache + re-rendu).
 * Le point `origin` = (0,0,0) de l'objet dans le dessin courant.
 */
export interface ObjectInstanceEntity extends EntityBase {
  kind: 'object';
  libTab: string;
  libName: string;
  origin: Vec3;
  /** Rotation autour de Z (radians), défaut 0. */
  rotation: number;
}

export type Entity =
  | LineEntity
  | ArcEntity
  | CircleEntity
  | PolylineEntity
  | PointEntity
  | TextEntity
  | DimensionEntity
  | HelperLineEntity
  | WallEntity
  | ObjectInstanceEntity;

export interface ObjectDef {
  id: string;
  name: string;
  category: string;
  /** Empreinte 2D / mesh 3D (placeholder pour plus tard). */
  data: unknown;
}

export interface GkdDocument {
  /** Numéro magique — doit être GKD1. */
  magic: 'GKD1';
  /** Version du format / application ayant créé le fichier. */
  version: string;
  /** Date de dernière modification (ISO 8601). */
  modified: string;
  camera: CameraState;
  entities: Entity[];
  wallLibrary: WallStyle[];
  objectLibrary: ObjectDef[];
  meta?: {
    title?: string;
    /** Unité monde (défaut m). */
    units?: UnitId;
  };
}

export const APP_VERSION = '0.24.16';
export const GKD_MAGIC = 'GKD1' as const;
