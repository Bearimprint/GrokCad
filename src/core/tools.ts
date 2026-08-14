import { applyCut, findNearestCuttable } from './cut';
import {
  applyExtend,
  findNearestBoundary,
  findNearestExtendable,
  type ExtendSourceHit,
} from './extend';
import {
  applyHatchToPolyline,
  clearHatchFromPolyline,
  isPolylineClosedGeom,
} from './fill';
import { ensureHatchPattern } from './hatchCache';
import type { HatchPrefsManager } from './hatchPrefs';
import {
  arcEndPoint,
  arcEndTangent,
  arcFrom3Points,
  arcFromCenterStartEnd,
  arcFromTangentContinue,
  createCircleEntity,
  createLineEntity,
  createPointEntity,
  createTextEntity,
  isDegenerateLine,
  isDegenerateRadius,
  sampleArc,
  sampleCircle,
  sampleCircleFromCenterPoint,
} from './drawing';
import type { PenManager } from './penPrefs';
import type { CadDocument } from './document';
import {
  buildDimensionGeom,
  createSingleCoteSegment,
  normalizeDimDir,
} from './dimension';
import type { DimPrefsManager } from './dimPrefs';
import {
  extractAtOrigin,
  rotateEntityAround,
  translateEntity,
} from './entityOps';
import { objectDefCache } from './objectCache';
import {
  createObjectInstance,
  expandObjectEntities,
  objectInstanceStrokes,
  previewObjectStrokes,
} from './objectInstance';
import {
  buildObjectDocument,
  saveExtractDialog,
  saveLibraryObject,
} from './objectLibrary';
import {
  deltaParalTranslations,
  findNearestDesignatable,
  freeParalTranslation,
  makeParalCopies,
  type Designatable,
  type ParalDelta,
} from './paral';
import {
  findNearestEntity,
  type DesignationManager,
} from './designation';
import type { Aabb2, SelectionManager } from './selection';
import { normalizeAabb } from './selection';
import { previewStretch } from './stretch';
import type { TextPrefsManager } from './textPrefs';
import type { ArcEntity, Entity, PolylineEntity, Vec3, WallEntity } from './types';
import { APP_VERSION } from './types';
import type { WallLibraryManager } from './wallPrefs';
import {
  appendWallSegment,
  arcWallStrokes,
  createArcWallEntity,
  createEmptyPolyWall,
  createLinearWallEntity,
  explodePolyWall,
  JONCTION_STRATEGY_LABELS,
  offsetPolylineOpen,
  orderedJonctionStrategies,
  polyWallEnd,
  polyWallEndTangent,
  polyWallStart,
  saveJonctionPref,
  applyJoinWallsToEntities,
  findNearestWall,
  wallEntityStrokes,
  wallSegFromArcEntity,
  wallSegLineFrom,
  type JonctionStrategyId,
} from './walls';
import {
  helperParallelX,
  helperParallelY,
  helperParallelZ,
} from './helpers';
import {
  appendSegment,
  arcSegFromArc,
  createEmptyPolyline,
  createRectPolyline,
  explodePolyline,
  lineSegFromPoints,
  closestOnPolyline,
  polylineEnd,
  polylineEndTangent,
  polylineStart,
  polylineStrokes,
} from './polyline';
import { dist } from './geometry';
import { formatLength } from './units';
import { showConfirm } from '../ui/ConfirmDialog';
import type { Viewport } from '../viewport/Viewport';

/** Tolérance de fermeture polyligne (dernier ≈ premier), en mètres. */
const POLY_CLOSE_TOL = 0.001;

export type HelperAxis = 'x' | 'y' | 'z';

export type ToolKind =
  | 'line'
  | 'arcc'
  | 'arc'
  | 'arccont'
  | 'circle'
  | 'pline'
  | 'parc'
  | 'parct'
  | 'pmur'
  | 'pmarc'
  | 'pmarct'
  | 'point'
  | 'stretch'
  | 'rejoin'
  | 'join'
  | 'cut'
  | 'extend'
  | 'fill'
  | 'delh'
  | 'deletepick'
  | 'helperaxis'
  | 'wallline'
  | 'wallarc'
  | 'select'
  | 'copy'
  | 'move'
  | 'obj'
  | 'extract'
  | 'placeobj'
  | 'paral'
  | 'dist'
  | 'rect'
  | 'text'
  | 'textbox'
  | 'cote'
  | 'm1'
  | 'r1'
  | null;

/** Outils de la famille polyligne (switch sans couper le dessin). */
export type PolyToolKind = 'pline' | 'parc' | 'parct';

/** Outils de la famille polymur (switch sans couper). */
export type PolyWallToolKind = 'pmur' | 'pmarc' | 'pmarct';

export type ToolFeedback = (
  msg: string,
  level?: 'ok' | 'err' | 'warn' | 'info',
) => void;

/**
 * Outils interactifs multi-étapes (ligne, arcc, arc 3 pts, arccont G1, cercle).
 */
export class DrawingTools {
  private kind: ToolKind = null;
  private step = 0;
  private p0: Vec3 | null = null;
  private p1: Vec3 | null = null;
  /** Rayon figé pour /arcc après le 2ᵉ clic. */
  private radius = 0;
  /** Continuité G1 pour /arccont. */
  private contPoint: Vec3 | null = null;
  private contTangent: Vec3 | null = null;
  /** Mur : bascule côté offsets (touche ALT). */
  private wallFlip = false;
  private altHandler: ((e: KeyboardEvent) => void) | null = null;
  private altDown = false;
  private altTrack: ((e: KeyboardEvent) => void) | null = null;
  /** Shift : verrouille H / 45° / V pour /ligne et /ml. */
  private shiftDown = false;
  private feedback: ToolFeedback = () => undefined;
  private walls: WallLibraryManager | null = null;
  private hatch: HatchPrefsManager | null = null;
  private selection: SelectionManager | null = null;
  private designation: DesignationManager | null = null;
  private textPrefs: TextPrefsManager | null = null;
  private dimPrefs: DimPrefsManager | null = null;
  /** Contenu en cours pour /text · /textbox. */
  private pendingText = '';
  private textBoxed = false;
  /** /cote — points de définition accumulés. */
  private coteDefPoints: Vec3[] = [];
  private coteDir: Vec3 | null = null;
  /** /m1 · /r1 — cible unique désignée. */
  private oneTargetId: string | null = null;
  /** Compteur de segments /cote déjà posés (pour message de fin). */
  private cotePlacedCount = 0;
  /** Callback async pour /obj (choix onglet + nom) fourni par l'UI. */
  private objSavePrompt:
    | ((suggested: string) => Promise<{ tab: string; name: string } | null>)
    | null = null;
  /** Placement objet library en cours. */
  private placeTab: string | null = null;
  private placeName: string | null = null;
  /** /paral */
  private paralDeltas: ParalDelta[] | null = null;
  private paralTarget: Designatable | null = null;
  private paralDesignatePt: Vec3 | null = null;
  /**
   * /copy :
   * - 'selection' : utilise la sélection (plusieurs élém.)
   * - 'designate' : un (ou n) élément(s) désigné(s), sans toucher à la sélection
   */
  private copyMode: 'selection' | 'designate' | null = null;
  /** /hx · /hy · /hz interactifs */
  private helperAxis: HelperAxis | null = null;
  /** Polyligne en cours de construction (entité déjà dans le doc dès le 1er segment). */
  private polyId: string | null = null;
  /** Polymur en cours (path === 'poly'). */
  private pwallId: string | null = null;
  /** /stretch — cadre de sélection des extrémités. */
  private stretchBox: Aabb2 | null = null;
  /** /extend — objet à allonger (1er clic). */
  private extendSource: ExtendSourceHit | null = null;
  /**
   * /jonction — phase confirmation Y/N (T/Y, degré ≥ 3).
   * step 0–1 = cadre ; step 2 = choisir solution.
   */
  private rejoinPreEntities: Entity[] | null = null;
  private rejoinSnappedEntities: Entity[] | null = null;
  private rejoinStrategies: JonctionStrategyId[] = [];
  private rejoinStrategyIndex = 0;
  private rejoinSignature: string | null = null;
  private rejoinWallsInBoxCount = 0;
  private rejoinClusters = 0;
  /**
   * /join — 1er mur (à prolonger) : id + clic (choix d’extrémité).
   */
  private joinStem: { wallId: string; click: Vec3 } | null = null;

  constructor(
    private doc: CadDocument,
    private viewport: Viewport,
    private pen: PenManager,
  ) {
    // État Shift global (même si enfoncé avant le démarrage de l’outil)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') {
        this.shiftDown = true;
        if (
          this.kind === 'line' ||
          this.kind === 'wallline' ||
          this.kind === 'pline' ||
          this.kind === 'pmur' ||
          this.kind === 'rect' ||
          this.kind === 'cote' ||
          this.kind === 'move' ||
          this.kind === 'm1' ||
          this.kind === 'copy'
        ) {
          this.updatePreview();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        this.shiftDown = false;
        if (
          this.kind === 'line' ||
          this.kind === 'wallline' ||
          this.kind === 'pline' ||
          this.kind === 'pmur' ||
          this.kind === 'rect' ||
          this.kind === 'cote' ||
          this.kind === 'move' ||
          this.kind === 'm1' ||
          this.kind === 'copy'
        ) {
          this.updatePreview();
        }
      }
    });
    window.addEventListener('blur', () => {
      this.shiftDown = false;
    });
  }

  private isPolyTool(k: ToolKind = this.kind): k is PolyToolKind {
    return k === 'pline' || k === 'parc' || k === 'parct';
  }

  private isPolyWallTool(k: ToolKind = this.kind): k is PolyWallToolKind {
    return k === 'pmur' || k === 'pmarc' || k === 'pmarct';
  }

  private getActivePolyline(): PolylineEntity | null {
    if (!this.polyId) return null;
    const e = this.doc.entities.find((x) => x.id === this.polyId);
    return e && e.kind === 'polyline' ? e : null;
  }

  private getActivePolyWall(): WallEntity | null {
    if (!this.pwallId) return null;
    const e = this.doc.entities.find((x) => x.id === this.pwallId);
    return e && e.kind === 'wall' && e.path === 'poly' ? e : null;
  }

  setWallLibrary(walls: WallLibraryManager): void {
    this.walls = walls;
  }

  setHatchPrefs(hatch: HatchPrefsManager): void {
    this.hatch = hatch;
  }

  setSelection(sel: SelectionManager): void {
    this.selection = sel;
  }

  setDesignation(des: DesignationManager): void {
    this.designation = des;
  }

  setTextPrefs(tp: TextPrefsManager): void {
    this.textPrefs = tp;
  }

  setDimPrefs(dp: DimPrefsManager): void {
    this.dimPrefs = dp;
  }

  /**
   * /rect — rectangle (polyligne fermée). Shift = carré.
   * Peut aussi être finalisé via commitRect(p0, p1, square).
   */
  startRect(): void {
    this.resetState();
    this.kind = 'rect';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'RECT — 1er coin…  [Shift] = carré  ·  Échap = annuler',
      'info',
    );
  }

  /** Pose immédiate d’un rectangle (ligne de commande complète). */
  commitRect(p0: Vec3, p1: Vec3, square = false): boolean {
    const poly = createRectPolyline(p0, p1, this.pen.strokeFields(), square);
    if (!poly) {
      this.feedback('Rectangle invalide (coins confondus).', 'warn');
      return false;
    }
    this.doc.addEntity(poly);
    this.feedback(
      `Rectangle${square ? ' (carré)' : ''} posé — polyligne fermée (${poly.segments.length} seg.).`,
      'ok',
    );
    return true;
  }

  /**
   * /text ou /textbox — place un texte (point de départ puis direction).
   * `content` déjà connu ; boxed = true pour /textbox.
   */
  startText(content: string, boxed: boolean): void {
    this.resetState();
    this.kind = boxed ? 'textbox' : 'text';
    this.pendingText = content;
    this.textBoxed = boxed;
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      `${boxed ? 'TEXTBOX' : 'TEXT'} « ${shortText(content)} » — point de départ…  ·  Échap = annuler`,
      'info',
    );
  }

  /** Pose texte complète (position + direction connue). */
  commitText(
    content: string,
    origin: Vec3,
    direction: Vec3,
    boxed: boolean,
  ): boolean {
    const rot = Math.atan2(direction[1], direction[0]);
    const ent = this.makeTextEntity(content, origin, rot, boxed);
    this.doc.addEntity(ent);
    this.feedback(
      `${boxed ? 'Textbox' : 'Texte'} « ${shortText(content)} » posé.`,
      'ok',
    );
    return true;
  }

  /**
   * /cote — cotation multi-segments.
   * step 0 : ancre ligne · 1 : direction · 2+ : points de définition.
   */
  startCote(): void {
    if (!this.dimPrefs) {
      this.feedback('Styles de cotation non initialisés.', 'err');
      return;
    }
    this.resetState();
    this.kind = 'cote';
    this.coteDefPoints = [];
    this.coteDir = null;
    this.cotePlacedCount = 0;
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      `COTE « ${this.dimPrefs.current.name} » — 1 segment = 1 entité + texte. Passage de la ligne…  ·  Échap = fin (segments déjà posés conservés)`,
      'info',
    );
  }

  setObjSavePrompt(
    fn: (suggested: string) => Promise<{ tab: string; name: string } | null>,
  ): void {
    this.objSavePrompt = fn;
  }

  setFeedback(fn: ToolFeedback): void {
    this.feedback = fn;
  }

  get active(): ToolKind {
    return this.kind;
  }

  get isActive(): boolean {
    return this.kind !== null;
  }

  startLine(): void {
    this.resetState();
    this.kind = 'line';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'LIGNE — départ…  [Shift] = H / 45° / V  ·  Échap = fin',
      'info',
    );
  }

  /**
   * /dist — mesure la distance entre 2 points (unité document courante).
   * Enchaîne jusqu’à Échap.
   */
  startDist(): void {
    this.resetState();
    this.kind = 'dist';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    const u = this.viewport.getUnits();
    this.feedback(
      `DIST — 1er point…  (unité : ${u})  ·  Échap = fin`,
      'info',
    );
  }

  /**
   * /pline — segments de ligne chaînés = une seule entité.
   * Switchable vers /parc · /parct sans couper la polyligne.
   */
  startPline(): void {
    this.enterPolyTool('pline');
  }

  /**
   * /parc — arcs 3 pts chaînés dans la même polyligne.
   * Switchable vers /pline · /parct.
   */
  startParc(): void {
    this.enterPolyTool('parc');
  }

  /**
   * /parct — arcs tangents G1 (comme /arccont) dans la polyligne.
   * 1er arc = 3 pts si polyligne vide ; sinon 1 clic (fin) tangent au précédent.
   */
  startParct(): void {
    this.enterPolyTool('parct');
  }

  private enterPolyTool(mode: PolyToolKind): void {
    const switching = this.isPolyTool();
    // Conserver la pointe si on bascule entre pline/parc/parct
    let tip: Vec3 | null = null;
    let polyId = this.polyId;
    if (switching) {
      tip = this.currentPolyTip();
      // Abandonne le point de passage en cours (arc incomplet)
      this.p1 = null;
      this.contPoint = null;
      this.contTangent = null;
    } else {
      this.resetState();
      polyId = null;
    }

    this.kind = mode;
    this.polyId = polyId;
    this.viewport.setPickHandler((pt) => this.onPoint(pt));

    if (tip) {
      this.p0 = tip;
      this.setupPolyAfterTip(mode, tip);
    } else {
      this.p0 = null;
      this.p1 = null;
      this.step = 0;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(this.polyStartMsg(mode), 'info');
    }
  }

  private polyStartMsg(mode: PolyToolKind): string {
    if (mode === 'pline') {
      return 'PLINE — départ…  [Shift]=H/45°/V  ·  /parc /parct pour basculer  ·  Échap = fin';
    }
    if (mode === 'parc') {
      return 'PARC — départ de l’arc…  /pline /parct pour basculer  ·  Échap = fin';
    }
    return 'PARCT — 1er arc : départ → passage → fin. Puis arcs tangents. /pline /parc · Échap = fin';
  }

  /** Après un tip connu : prépare l’étape suivante selon le mode. */
  private setupPolyAfterTip(mode: PolyToolKind, tip: Vec3): void {
    this.p0 = tip;
    this.p1 = null;
    if (mode === 'pline') {
      this.step = 1;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(
        `PLINE — suite depuis (${fmt(tip)})  [Shift]=H/45°/V  ·  /parc /parct · Échap = fin`,
        'info',
      );
      return;
    }
    if (mode === 'parc') {
      // Départ = tip, prochain clic = passage
      this.step = 1;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(
        `PARC — départ = (${fmt(tip)}). Point de passage…  /pline /parct · Échap = fin`,
        'info',
      );
      return;
    }
    // parct : G1 si un segment existe déjà, sinon 3 pts
    const poly = this.getActivePolyline();
    if (poly && poly.segments.length > 0) {
      const tan = polylineEndTangent(poly);
      if (tan) {
        this.contPoint = tip;
        this.contTangent = tan;
        this.step = 0;
        this.feedback(
          `PARCT — arc tangent depuis (${fmt(tip)}). Point de fin…  /pline /parc · Échap = fin`,
          'info',
        );
        return;
      }
    }
    // Pas de tangente : 1er arc 3 pts (départ déjà posé)
    this.step = 1;
    this.contPoint = null;
    this.contTangent = null;
    this.feedback(
      `PARCT — départ = (${fmt(tip)}). Passage… (1er arc = 3 pts)  ·  Échap = fin`,
      'info',
    );
  }

  private currentPolyTip(): Vec3 | null {
    if (this.contPoint) return [...this.contPoint] as Vec3;
    if (this.p0 && this.step >= 1) return [...this.p0] as Vec3;
    const poly = this.getActivePolyline();
    if (poly) {
      const end = polylineEnd(poly);
      if (end) return end;
    }
    return this.p0 ? ([...this.p0] as Vec3) : null;
  }

  // ── Polymurs /pmur /pmarc /pmarct ──────────────────────────────────────────

  /** /pmur — murs linéaires chaînés = 1 entité. */
  startPmur(): void {
    this.enterPolyWallTool('pmur');
  }

  /** /pmarc — murs en arc 3 pts chaînés = 1 entité. */
  startPmarc(): void {
    this.enterPolyWallTool('pmarc');
  }

  /** /pmarct — murs arc G1 dans le polymur. */
  startPmarct(): void {
    this.enterPolyWallTool('pmarct');
  }

  private enterPolyWallTool(mode: PolyWallToolKind): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback(
        'Aucun mur sélectionné (ou mur vide). Ouvrez /murs pour créer/choisir un style.',
        'err',
      );
      return;
    }

    const switching = this.isPolyWallTool();
    let tip: Vec3 | null = null;
    let pwallId = this.pwallId;
    let flip = this.wallFlip;

    if (switching) {
      tip = this.currentPolyWallTip();
      flip = this.wallFlip;
      this.p1 = null;
      this.contPoint = null;
      this.contTangent = null;
    } else {
      // Quitte polyligne ou autre outil
      this.resetState();
      pwallId = null;
      flip = false;
    }

    this.kind = mode;
    this.pwallId = pwallId;
    this.wallFlip = flip;
    this.bindAltFlip();
    this.viewport.setPickHandler((pt) => this.onPoint(pt));

    if (tip) {
      this.p0 = tip;
      this.setupPolyWallAfterTip(mode, tip, style.name);
    } else {
      this.p0 = null;
      this.p1 = null;
      this.step = 0;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(this.polyWallStartMsg(mode, style.name), 'info');
    }
  }

  private polyWallStartMsg(mode: PolyWallToolKind, styleName: string): string {
    if (mode === 'pmur') {
      return `PMUR « ${styleName} » — départ…  [Shift]=H/45°/V  [ALT]=côté  ·  /pmarc /pmarct  ·  Échap = fin`;
    }
    if (mode === 'pmarc') {
      return `PMARC « ${styleName} » — départ d’arc…  [ALT]=côté  ·  /pmur /pmarct  ·  Échap = fin`;
    }
    return `PMARCT « ${styleName} » — 1er arc 3 pts puis tangents. [ALT]=côté  ·  /pmur /pmarc  ·  Échap = fin`;
  }

  private setupPolyWallAfterTip(
    mode: PolyWallToolKind,
    tip: Vec3,
    styleName: string,
  ): void {
    this.p0 = tip;
    this.p1 = null;
    if (mode === 'pmur') {
      this.step = 1;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(
        `PMUR « ${styleName} » — suite (${fmt(tip)})  [Shift] [ALT]  ·  /pmarc /pmarct  ·  Échap`,
        'info',
      );
      return;
    }
    if (mode === 'pmarc') {
      this.step = 1;
      this.contPoint = null;
      this.contTangent = null;
      this.feedback(
        `PMARC — départ = (${fmt(tip)}). Passage…  [ALT]  ·  Échap`,
        'info',
      );
      return;
    }
    const wall = this.getActivePolyWall();
    if (wall && (wall.segments?.length ?? 0) > 0) {
      const tan = polyWallEndTangent(wall);
      if (tan) {
        this.contPoint = tip;
        this.contTangent = tan;
        this.step = 0;
        this.feedback(
          `PMARCT — arc tangent depuis (${fmt(tip)}). Fin…  [ALT]  ·  Échap`,
          'info',
        );
        return;
      }
    }
    this.step = 1;
    this.contPoint = null;
    this.contTangent = null;
    this.feedback(
      `PMARCT — départ = (${fmt(tip)}). Passage… (1er arc 3 pts)  ·  Échap`,
      'info',
    );
  }

  private currentPolyWallTip(): Vec3 | null {
    if (this.contPoint) return [...this.contPoint] as Vec3;
    if (this.p0 && this.step >= 1) return [...this.p0] as Vec3;
    const wall = this.getActivePolyWall();
    if (wall) {
      const end = polyWallEnd(wall);
      if (end) return end;
    }
    return this.p0 ? ([...this.p0] as Vec3) : null;
  }

  /**
   * /arcc — centre → rayon (cercle live).
   * Échap = commit cercle · sinon départ → fin d'arc.
   */
  startArcc(): void {
    this.resetState();
    this.kind = 'arcc';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'ARCC — centre (clic, . , @ ou x y [z]). Puis rayon. Ensuite Échap = cercle, ou 2 clics = arc.',
      'info',
    );
  }

  /** /arc — départ → passage → fin (3 points). */
  startArc(): void {
    this.resetState();
    this.kind = 'arc';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'ARC — point de départ. Puis point de passage, puis fin. Échap = annuler.',
      'info',
    );
  }

  /**
   * /arccont — premier arc comme /arc, puis arcs G1 enchaînés.
   */
  startArcCont(): void {
    this.resetState();
    this.kind = 'arccont';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'ARCCONT — 1er arc : départ → passage → fin. Puis point suivant (continuité tangente). Échap = terminer.',
      'info',
    );
  }

  /** /cercle — centre → rayon. */
  startCircle(): void {
    this.resetState();
    this.kind = 'circle';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'CERCLE — centre (clic, . , @ ou x y [z]). Puis un point sur le rayon. Échap = annuler.',
      'info',
    );
  }

  /**
   * /point — place des points (couleur + épaisseur stylo, style ignoré).
   * Taille écran = épaisseur px. Clics enchaînés jusqu’à Échap.
   */
  startPoint(): void {
    this.resetState();
    this.kind = 'point';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    const w = this.pen.resolved.lineWidth;
    this.feedback(
      `POINT — clic pour placer (${this.pen.resolved.colorLabel}, ${w}×${w} px écran). Clics enchaînés · Échap = fin`,
      'info',
    );
  }

  /** Place un point immédiatement (usage CLI : /point x,y,z). */
  placePoint(pt: Vec3): void {
    const r = this.pen.resolved;
    const ent = createPointEntity(pt, {
      color: r.color,
      lineWidth: r.lineWidth,
    });
    this.doc.addEntity(ent);
    this.feedback(
      `Point @ (${fmt(pt)})  [${r.colorLabel}, ${r.lineWidth}×${r.lineWidth} px]`,
      'ok',
    );
  }

  /**
   * /cut — coupe l'élément le plus proche du clic (rayon snap en px).
   * Clics enchaînés jusqu'à Échap. Rien si hors rayon.
   */
  startCut(): void {
    this.resetState();
    this.kind = 'cut';
    this.viewport.setPickHandler((pt) => this.onCutPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `CUT — clic près d’une ligne / arc / cercle (≤ ${px} px). Échap = terminer.`,
      'info',
    );
  }

  /**
   * /extend — prolonge une ligne/arc (ou bout de polyligne ouverte)
   * jusqu’à une limite (ligne / arc / cercle).
   * 1) objet à allonger  2) limite. Enchaîne jusqu’à Échap.
   */
  startExtend(): void {
    this.resetState();
    this.kind = 'extend';
    this.extendSource = null;
    this.viewport.setPickHandler((pt) => this.onExtendPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `EXTEND — 1) objet à allonger (ligne / arc / bout de polyligne ouverte, ≤ ${px} px)… Échap = fin`,
      'info',
    );
  }

  /**
   * /fill — désigner une polyligne à remplir avec la hachure courante.
   */
  startFill(): void {
    this.resetState();
    this.kind = 'fill';
    this.viewport.setPickHandler((pt) => void this.onFillPoint(pt));
    const name = this.hatch?.currentName ?? '?';
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `FILL — cliquez une polyligne (≤ ${px} px) · motif « ${name} » · Échap = annuler`,
      'info',
    );
  }

  /**
   * /delh — désigner une polyligne et enlever son hachurage (si présent).
   */
  startDelHatch(): void {
    this.resetState();
    this.kind = 'delh';
    this.viewport.setPickHandler((pt) => this.onDelHatchPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `DELH — cliquez une polyligne pour enlever le hachurage (≤ ${px} px) · Échap = fin`,
      'info',
    );
  }

  /** Applique la hachure courante sur une polyligne (sélection ou outil). */
  async fillPolyline(poly: PolylineEntity): Promise<void> {
    if (!this.hatch?.currentName) {
      this.feedback('Aucune hachure. /hatch d’abord.', 'warn');
      return;
    }
    const name = this.hatch.currentName;
    const pattern = await ensureHatchPattern(name);
    if (!pattern || pattern.length === 0) {
      this.feedback(
        `Motif « ${name} » introuvable ou vide (library/hatch/).`,
        'err',
      );
      return;
    }
    const hatch = {
      hatchName: name,
      scale: this.hatch.scale,
      rotationDeg: this.hatch.rotationDeg,
    };
    const next = applyHatchToPolyline(poly, hatch);
    const virt = !isPolylineClosedGeom(poly);
    this.doc.replaceEntity(poly.id, [next]);
    this.feedback(
      virt
        ? `FILL « ${name} » (fermeture virtuelle) · éc. ${hatch.scale} · ${Math.round(hatch.rotationDeg)}°.`
        : `FILL « ${name} » · éc. ${hatch.scale} · ${Math.round(hatch.rotationDeg)}°.`,
      'ok',
    );
    this.resetState();
  }

  /**
   * Suppression par désignation (Ctrl+D · /d) :
   * chaque clic efface l’élément le plus proche dans le rayon snap.
   * Pas besoin de sélection. Continue jusqu’à Échap.
   */
  startDeletePick(): void {
    this.resetState();
    this.kind = 'deletepick';
    this.viewport.setPickHandler((pt) => this.onDeletePickPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `DELETE — désignez l’élément à effacer (≤ ${px} px). Clics enchaînés · Échap = terminer.`,
      'info',
    );
  }

  /**
   * /hx · /hy · /hz interactifs :
   * chaque clic place une aide // axe au point cliqué. Échap = fin.
   */
  startHelperAxis(axis: HelperAxis): void {
    this.resetState();
    this.kind = 'helperaxis';
    this.helperAxis = axis;
    this.viewport.setPickHandler((pt) => this.onHelperAxisPoint(pt));
    const label =
      axis === 'x'
        ? '// X (Y et Z du clic)'
        : axis === 'y'
          ? '// Y (X et Z du clic)'
          : '// Z (X et Y du clic — point en vue de dessus)';
    this.feedback(
      `HX${axis.toUpperCase()} — clic pour placer une aide ${label}. Clics enchaînés · Échap = terminer.`,
      'info',
    );
  }

  /** Place une aide // axe au point donné (usage CLI direct aussi). */
  placeHelperAxis(axis: HelperAxis, pt: Vec3): void {
    const n = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(3);
    if (axis === 'x') {
      this.doc.addHelper(helperParallelX(pt[1], pt[2]));
      this.feedback(
        `Aide // X  à Y=${n(pt[1])} Z=${n(pt[2])}  (X ignoré)`,
        'ok',
      );
    } else if (axis === 'y') {
      this.doc.addHelper(helperParallelY(pt[0], pt[2]));
      this.feedback(
        `Aide // Y  à X=${n(pt[0])} Z=${n(pt[2])}  (Y ignoré)`,
        'ok',
      );
    } else {
      this.doc.addHelper(helperParallelZ(pt[0], pt[1]));
      this.feedback(
        `Aide // Z  en X=${n(pt[0])} Y=${n(pt[1])}  (Z ignoré)`,
        'ok',
      );
    }
  }

  /**
   * /ml · /murligne — mur linéaire avec le style courant de la biblio.
   * ALT bascule le côté des traits.
   */
  startWallLine(): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback(
        'Aucun mur sélectionné (ou mur vide). Ouvrez /murs pour créer/choisir un style.',
        'err',
      );
      return;
    }
    this.resetState();
    this.kind = 'wallline';
    this.wallFlip = false;
    this.bindAltFlip();
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      `MUR LIGNE — « ${style.name} » (${style.lines.length} trait(s)). Départ…  [Shift]=H/45°/V  [ALT]=côté  ·  Échap = fin`,
      'info',
    );
  }

  /**
   * /ma · /murarc — mur en arc (3 points comme /arc) avec le style courant.
   * ALT bascule le côté des traits.
   */
  startWallArc(): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback(
        'Aucun mur sélectionné (ou mur vide). Ouvrez /murs pour créer/choisir un style.',
        'err',
      );
      return;
    }
    this.resetState();
    this.kind = 'wallarc';
    this.wallFlip = false;
    this.bindAltFlip();
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      `MUR ARC — « ${style.name} ». Départ → passage → fin.  [ALT] = bascule côté · Échap = fin`,
      'info',
    );
  }

  /** /select · /sl — cadre 2 clics. ALT = désélection. */
  startSelect(): void {
    this.resetState();
    this.kind = 'select';
    this.bindAltTrack();
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'SELECT — 1er coin du cadre…  [ALT] maintenu = désélectionner · Échap = annuler',
      'info',
    );
  }

  /**
   * /copy — mode dual, répétable jusqu’à Échap :
   * - **sélection** : 1er clic = base, 2ᵉ = arrivée ; copies = nvelle sélection.
   * - **sans sélection** : 1er clic = désigner (orange) + base implicite,
   *   l’objet **suit déjà la souris** ; 2ᵉ clic = placement de la copie
   *   (qui devient désignée et suit à nouveau pour enchaîner).
   */
  startCopy(): void {
    this.resetState();
    this.kind = 'copy';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));

    if (this.selection && this.selection.size > 0) {
      this.copyMode = 'selection';
      this.designation?.clear();
      this.step = 0;
      this.feedback(
        `COPY — ${this.selection.size} élém. sélectionné(s). Point de base… puis arrivée. Les copies deviennent la sélection. Échap = fin`,
        'info',
      );
      return;
    }

    this.copyMode = 'designate';
    this.step = 0;
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `COPY — désignez un objet (≤ ${px} px) : il devient orange et suit la souris ; clic suivant = coller. Échap = fin`,
      'info',
    );
  }

  /** /move — 2 clics : base → arrivée (déplace la sélection). */
  startMove(): void {
    if (!this.selection || this.selection.size === 0) {
      this.feedback('Rien de sélectionné. Utilisez /select d’abord.', 'err');
      return;
    }
    this.resetState();
    this.kind = 'move';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      `MOVE — ${this.selection.size} élém. Point de base… puis destination  [Shift]=H/45°/V  ·  Échap = annuler`,
      'info',
    );
  }

  /**
   * /m1 — déplace UN objet désigné (pas la sélection).
   * Cotation : ligne → toute la cotation ; texte → libellé seul.
   * step 0 = désigner · 1 = base · 2 = destination.
   */
  startMoveOne(): void {
    this.resetState();
    this.kind = 'm1';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `M1 — désignez un objet (≤ ${px} px)…  [Shift]=H/45°/V à la dest. · Échap = annuler`,
      'info',
    );
  }

  /**
   * /r1 — rotation d’UN objet désigné autour d’un pivot.
   * step 0 = désigner · 1 = pivot · 2 = référence · 3 = angle final.
   */
  startRotateOne(): void {
    this.resetState();
    this.kind = 'r1';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `R1 — désignez un objet (≤ ${px} px)…  Cote : ligne = tout · texte = libellé seul. Échap = annuler`,
      'info',
    );
  }

  /**
   * /stretch — cadre (2 clics) → base → destination.
   * Extrémités dans le cadre bougent ; objets entièrement inclus se déplacent.
   * Objets library : uniquement s’ils sont entièrement dans le cadre.
   */
  startStretch(): void {
    this.resetState();
    this.kind = 'stretch';
    this.stretchBox = null;
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'STRETCH — 1er coin du cadre… (extrémités incluses seront déplacées). Échap = annuler',
      'info',
    );
  }

  /**
   * /jonction · /rejoin — cadre 2 clics : fusionne les bouts de murs proches
   * dans le cadre et recalcule les onglets (y compris 3+ murs au même nœud).
   * Si nœud T/Y (degré ≥ 3) : cycle solutions — Gauche = Oui · Droit = Non.
   */
  startRejoin(): void {
    this.resetState();
    this.kind = 'rejoin';
    this.viewport.setPickHandler((pt) => this.onPoint(pt));
    this.feedback(
      'JONCTION — 1er coin du cadre (englober les extrémités de murs à raccorder)… Échap = annuler',
      'info',
    );
  }

  /**
   * /join — désigner mur A (à prolonger) puis mur B (cible).
   * Prolonge l’axe de A jusqu’à l’axe de B + raccord multi-couches (priorités).
   * Cas T bout→flanc et L coin.
   */
  startJoin(): void {
    this.resetState();
    this.kind = 'join';
    this.joinStem = null;
    this.viewport.setPickHandler((pt) => this.onJoinPoint(pt));
    const px = this.viewport.snapRadiusPx();
    this.feedback(
      `JOIN — 1) mur à prolonger (clic près du bout voulu, ≤ ${px} px)… Échap = fin`,
      'info',
    );
  }

  /**
   * /paral — copie parallèle d’un élément **désigné** (≠ sélection).
   * Mode continu : la copie devient l’objet désigné ; recliquer pour enchaîner.
   * @param deltas vide = mode libre (désigner → clic placement distance+sens)
   *               sinon deltas D… (désigner → 2ᵉ clic = **sens** uniquement ;
   *               les valeurs dx/dy/dz sont des distances absolues)
   */
  startParal(deltas: ParalDelta[] = []): void {
    this.resetState();
    this.kind = 'paral';
    this.paralDeltas = deltas.length > 0 ? deltas : null;
    this.paralTarget = null;
    this.paralDesignatePt = null;
    this.designation?.clear();
    this.viewport.setPickHandler((pt) => this.onParalPoint(pt));
    const px = this.viewport.snapRadiusPx();
    if (this.paralDeltas) {
      const n = this.paralDeltas.length;
      this.feedback(
        `PARAL — 1) désignez un élément (≤ ${px} px, orange ≠ sélection)  2) clic = sens → ${n} copie(s). Enchaînement auto. Échap = fin`,
        'info',
      );
    } else {
      this.feedback(
        `PARAL — 1) désignez un élément (≤ ${px} px, orange ≠ sélection)  2) clic = emplacement. Enchaînement auto. Échap = fin`,
        'info',
      );
    }
  }

  /**
   * /obj · /objet — enregistre la sélection dans library/<onglet>/.
   * Clic = origine (0,0,0) du fichier objet.
   */
  startObj(): void {
    if (!this.selection || this.selection.size === 0) {
      this.feedback('Rien de sélectionné. /select puis /obj.', 'err');
      return;
    }
    this.resetState();
    this.kind = 'obj';
    this.viewport.setPickHandler((pt) => void this.onObjOrigin(pt, false));
    this.feedback(
      `OBJ — ${this.selection.size} élém. Cliquez l’origine (0,0,0) du futur objet…`,
      'info',
    );
  }

  /**
   * /extract · /ext — comme /obj mais dialogue d’emplacement (pas library/).
   */
  startExtract(): void {
    if (!this.selection || this.selection.size === 0) {
      this.feedback('Rien de sélectionné. /select puis /extract.', 'err');
      return;
    }
    this.resetState();
    this.kind = 'extract';
    this.viewport.setPickHandler((pt) => void this.onObjOrigin(pt, true));
    this.feedback(
      `EXTRACT — ${this.selection.size} élém. Cliquez l’origine (0,0,0) du fichier extrait…`,
      'info',
    );
  }

  /**
   * Place une instance d'objet library (attaché à la souris par son 0,0,0).
   * Appelé après « Choisir » dans /objets.
   */
  startPlaceObject(tab: string, name: string): void {
    this.resetState();
    this.kind = 'placeobj';
    this.placeTab = tab;
    this.placeName = name;
    void objectDefCache.ensure(tab, name).then((doc) => {
      if (!doc) {
        this.feedback(`Impossible de charger library/${tab}/${name}.gkd`, 'err');
        this.resetState();
        return;
      }
      this.feedback(
        `POSE « ${name} » — l’objet suit la souris (origine 0,0,0). Clic = placer · Échap = annuler`,
        'info',
      );
      this.updatePreview();
    });
    this.viewport.setPickHandler((pt) => this.onPlaceObjectPoint(pt));
  }

  /**
   * /explode · /expld — convertit :
   * - instances library → éléments basiques
   * - polylignes → lignes / arcs
   * - polymurs → murs unitaires (line/arc)
   */
  explodeSelection(): number {
    if (!this.selection || this.selection.size === 0) {
      this.feedback(
        'Rien de sélectionné. /select objets, polylignes ou polymurs puis /explode.',
        'err',
      );
      return 0;
    }
    const selected = this.selection.selectedEntities(this.doc.entities);
    const objs = selected.filter((e) => e.kind === 'object');
    const polys = selected.filter((e) => e.kind === 'polyline');
    const pwalls = selected.filter(
      (e) => e.kind === 'wall' && e.path === 'poly',
    );
    if (objs.length === 0 && polys.length === 0 && pwalls.length === 0) {
      this.feedback(
        'Aucun objet library, polyligne ni polymur dans la sélection.',
        'warn',
      );
      return 0;
    }
    const removeIds: string[] = [];
    const parts: Entity[] = [];
    for (const o of objs) {
      if (o.kind !== 'object') continue;
      removeIds.push(o.id);
      parts.push(...expandObjectEntities(o));
    }
    for (const p of polys) {
      if (p.kind !== 'polyline') continue;
      removeIds.push(p.id);
      parts.push(...explodePolyline(p));
    }
    for (const w of pwalls) {
      if (w.kind !== 'wall') continue;
      removeIds.push(w.id);
      parts.push(...explodePolyWall(w));
    }
    this.doc.removeEntities(removeIds);
    this.doc.addEntities(parts);
    this.selection.set(parts.map((p) => p.id));
    const bits: string[] = [];
    if (objs.length) bits.push(`${objs.length} objet(s) library`);
    if (polys.length) bits.push(`${polys.length} polyligne(s)`);
    if (pwalls.length) bits.push(`${pwalls.length} polymur(s)`);
    this.feedback(
      `${bits.join(' + ')} explosé(s) → ${parts.length} élément(s).`,
      'ok',
    );
    return objs.length + polys.length + pwalls.length;
  }

  /** Point fourni par la ligne de commande (sans /). */
  acceptPoint(pt: Vec3): boolean {
    if (!this.kind) return false;
    if (this.kind === 'cut') {
      this.onCutPoint(pt);
      return true;
    }
    if (this.kind === 'extend') {
      this.onExtendPoint(pt);
      return true;
    }
    if (this.kind === 'fill') {
      void this.onFillPoint(pt);
      return true;
    }
    if (this.kind === 'delh') {
      this.onDelHatchPoint(pt);
      return true;
    }
    if (this.kind === 'deletepick') {
      this.onDeletePickPoint(pt);
      return true;
    }
    if (this.kind === 'helperaxis') {
      this.onHelperAxisPoint(pt);
      return true;
    }
    if (this.kind === 'paral') {
      this.onParalPoint(pt);
      return true;
    }
    if (this.kind === 'obj') {
      void this.onObjOrigin(pt, false);
      return true;
    }
    if (this.kind === 'extract') {
      void this.onObjOrigin(pt, true);
      return true;
    }
    if (this.kind === 'placeobj') {
      this.onPlaceObjectPoint(pt);
      return true;
    }
    this.onPoint(pt);
    return true;
  }

  /**
   * Échap contextuel.
   * /arcc avec rayon défini → commit cercle puis termine.
   * /pline · /parc · /parct → termine la polyligne (garde l’entité si ≥1 segment).
   * /d (deletepick) → termine sans message d’annulation.
   * Sinon annule l'outil.
   */
  handleEscape(): void {
    if (this.kind === 'arcc' && this.step >= 1 && this.p0 && this.radius > EPS) {
      const circle = createCircleEntity(this.p0, this.radius, this.pen.strokeFields());
      this.doc.addEntity(circle);
      this.feedback(
        `Cercle r=${this.radius.toFixed(3)} m (Échap) — ${this.pen.resolved.colorLabel}.`,
        'ok',
      );
      this.resetState();
      return;
    }
    if (this.isPolyTool()) {
      this.finishPolyline();
      return;
    }
    if (this.isPolyWallTool()) {
      this.finishPolyWall();
      return;
    }
    if (this.kind === 'deletepick') {
      this.resetState();
      this.feedback('Suppression terminée.', 'ok');
      return;
    }
    if (this.kind === 'helperaxis') {
      this.resetState();
      this.feedback('Placement d’aides terminé.', 'ok');
      return;
    }
    if (this.kind === 'point') {
      this.resetState();
      this.feedback('Placement de points terminé.', 'ok');
      return;
    }
    if (this.kind === 'cote') {
      this.finishCote();
      return;
    }
    this.cancel(true);
  }

  /**
   * Fin de /cote : les segments déjà posés restent dans le document
   * (chaque paire de points a déjà créé une entité).
   */
  private finishCote(): void {
    const n = this.cotePlacedCount;
    this.resetState();
    if (n > 0) {
      this.feedback(
        `COTE terminée — ${n} segment(s) conservé(s). (chaque morceau = 1 entité + texte)`,
        'ok',
      );
    } else {
      this.feedback('COTE terminée (aucun segment posé).', 'warn');
    }
  }

  /**
   * Annulation générique : pour /cote, ne pas perdre les segments déjà posés.
   */
  // cancel() est plus bas — on le spécialise via finishCote sur Échap.

  private finishPolyline(): void {
    const poly = this.getActivePolyline();
    const n = poly?.segments.length ?? 0;
    // Polyligne vide (créée par erreur) : supprimer
    if (poly && n === 0) {
      this.doc.removeEntity(poly.id);
    }
    this.resetState();
    if (n > 0) {
      this.feedback(
        `Polyligne terminée — ${n} segment(s) (1 entité). /explode pour dissocier.`,
        'ok',
      );
    } else {
      this.feedback('Polyligne annulée (aucun segment).', 'warn');
    }
  }

  private finishPolyWall(): void {
    const wall = this.getActivePolyWall();
    const n = wall?.segments?.length ?? 0;
    if (wall && n === 0) {
      this.doc.removeEntity(wall.id);
    }
    this.resetState();
    if (n > 0) {
      this.feedback(
        `Polymur terminé — ${n} segment(s) (1 entité). /explode pour dissocier en murs unitaires.`,
        'ok',
      );
    } else {
      this.feedback('Polymur annulé (aucun segment).', 'warn');
    }
  }

  cancel(announce = true): void {
    // /cote : les segments déjà posés restent — ne pas « annuler » le travail
    if (this.kind === 'cote') {
      this.finishCote();
      return;
    }
    this.resetState();
    if (announce) this.feedback('Outil annulé.', 'warn');
  }

  /** Aperçu rubber-band vers la souris. */
  updatePreview(): void {
    if (!this.kind) return;
    // /cut · /d · /hx… : pas de rubber-band (effet au clic uniquement)
    if (
      this.kind === 'cut' ||
      this.kind === 'extend' ||
      this.kind === 'join' ||
      this.kind === 'fill' ||
      this.kind === 'delh' ||
      this.kind === 'deletepick' ||
      this.kind === 'helperaxis' ||
      this.kind === 'point'
    ) {
      // Point : pas de rubber-band (effet au clic uniquement)
      this.viewport.setPreview(null);
      return;
    }
    if (this.kind === 'paral') {
      this.previewParal();
      return;
    }
    const m = this.viewport.getMouseWorld();
    if (!m) {
      this.viewport.setPreview(null);
      this.viewport.setSelectRect(null, null);
      return;
    }
    const cur: Vec3 = [m.x, m.y, m.z];
    const stroke = this.pen.strokeFields();

    if (this.kind === 'select' && this.step === 1 && this.p0) {
      const mode = this.altDown ? 'remove' : 'add';
      this.viewport.setSelectRect(this.p0, cur, mode);
      this.viewport.setPreview(null);
      return;
    }

    if ((this.kind === 'copy' || this.kind === 'move') && this.step === 1 && this.p0) {
      this.previewTransform(cur);
      return;
    }

    if (this.kind === 'm1' && this.step === 2 && this.p0 && this.oneTargetId) {
      this.previewOneMove(cur);
      return;
    }

    if (this.kind === 'r1' && this.step >= 2 && this.p0 && this.oneTargetId) {
      this.previewOneRotate(cur);
      return;
    }

    if (this.kind === 'stretch') {
      this.previewStretchTool(cur);
      return;
    }

    if (this.kind === 'rejoin' && this.step === 1 && this.p0) {
      this.viewport.setSelectRect(this.p0, cur, 'add');
      this.viewport.setPreview(null);
      return;
    }

    if (this.kind === 'placeobj' && this.placeTab && this.placeName) {
      const strokes = previewObjectStrokes(this.placeTab, this.placeName, cur);
      this.viewport.setPreviewStrokes(
        strokes.map((s) => ({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        })),
      );
      return;
    }

    if (this.kind === 'line' && this.step === 1 && this.p0) {
      const end = this.applyLineConstraint(this.p0, cur);
      this.viewport.setPreview([this.p0, end], stroke);
      return;
    }

    if (this.kind === 'dist' && this.step === 1 && this.p0) {
      this.viewport.setPreview([this.p0, cur], stroke);
      return;
    }

    if (this.isPolyTool()) {
      this.previewPoly(cur, stroke);
      return;
    }

    if (this.isPolyWallTool()) {
      this.previewPolyWall(cur);
      return;
    }

    if (this.kind === 'wallline' && this.step === 1 && this.p0) {
      this.previewWallLine(this.applyLineConstraint(this.p0, cur));
      return;
    }

    if (this.kind === 'wallarc') {
      this.previewWallArc(cur);
      return;
    }

    if (this.kind === 'arcc') {
      this.previewArcc(cur, stroke);
      return;
    }

    if (this.kind === 'arc') {
      this.previewArc3(cur, stroke);
      return;
    }

    if (this.kind === 'arccont') {
      this.previewArcCont(cur, stroke);
      return;
    }

    if (this.kind === 'circle' && this.step === 1 && this.p0) {
      const pts = sampleCircleFromCenterPoint(this.p0, cur, 64);
      this.viewport.setPreview(pts, stroke);
      return;
    }

    if (this.kind === 'rect' && this.step === 1 && this.p0) {
      this.viewport.setPreviewLabels(null);
      this.previewRect(cur, stroke);
      return;
    }

    if (
      (this.kind === 'text' || this.kind === 'textbox') &&
      this.step === 1 &&
      this.p0
    ) {
      this.viewport.setPreviewLabels(null);
      this.viewport.setPreview([this.p0, cur], stroke);
      return;
    }

    if (this.kind === 'cote') {
      this.previewCote(cur);
      return;
    }

    this.viewport.setPreview(null);
  }

  private previewRect(
    cur: Vec3,
    stroke: { color: string; lineWidth: number; lineStyle: import('./types').LineStyleId },
  ): void {
    if (!this.p0) return;
    const poly = createRectPolyline(
      this.p0,
      cur,
      stroke,
      this.shiftDown,
    );
    if (!poly) {
      this.viewport.setPreview(null);
      return;
    }
    const pts: Vec3[] = [];
    for (const s of poly.segments) {
      if (s.type === 'line') {
        if (pts.length === 0) pts.push(s.start);
        pts.push(s.end);
      }
    }
    this.viewport.setPreview(pts, stroke);
  }

  private previewCote(cur: Vec3): void {
    if (!this.dimPrefs) {
      this.viewport.setPreviewStrokes(null);
      this.viewport.setPreviewLabels(null);
      return;
    }
    const style = this.dimPrefs.current;
    // step 0 : rien · step 1 : ancre posée, direction suit souris
    // [Shift] = H / 45° / V comme /ligne · /pline
    if (this.step === 1 && this.p0) {
      const end = this.applyLineConstraint(this.p0, cur);
      this.viewport.setPreviewLabels(null);
      this.viewport.setPreviewStrokes([
        {
          points: [this.p0, end],
          color: style.lineColor,
          lineWidth: Math.max(2, style.lineWidth),
          lineStyle: 'pointille',
        },
      ]);
      return;
    }
    // step >= 2 : direction connue, points de def
    if (this.step >= 2 && this.p0 && this.coteDir) {
      const defs = [...this.coteDefPoints];
      const geom = buildDimensionGeom(
        style,
        this.p0,
        this.coteDir,
        defs,
        {
          previewEnd: defs.length >= 1 ? cur : undefined,
          unit: this.viewport.getUnits(),
        },
      );
      this.viewport.setPreviewStrokes(
        geom.strokes.map((s) => ({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        })),
      );
      this.viewport.setPreviewLabels(
        geom.labels.map((lb) => ({
          content: lb.content,
          position: lb.position,
          rotation: lb.rotation,
          height: lb.height,
          color: lb.color,
          fontFamily: lb.fontFamily,
          bold: lb.bold,
          italic: lb.italic,
          background: lb.background,
          hAlign: lb.hAlign,
          vAlign: lb.vAlign,
        })),
      );
      return;
    }
    this.viewport.setPreviewStrokes(null);
    this.viewport.setPreviewLabels(null);
  }

  private makeTextEntity(
    content: string,
    origin: Vec3,
    rotation: number,
    boxed: boolean,
  ) {
    const tp = this.textPrefs;
    const colors = this.pen.file.colors;
    const resolved = tp
      ? tp.resolveColors(colors)
      : { color: this.pen.resolved.color, background: null as string | null };
    return createTextEntity(origin, {
      content,
      height: tp?.current.height ?? 0.25,
      color: resolved.color,
      rotation,
      fontFamily: tp?.current.fontFamily,
      bold: tp?.current.bold,
      italic: tp?.current.italic,
      background: resolved.background,
      boxed,
      boxPadding: boxed ? (tp?.textboxPadding ?? 0.03) : undefined,
      hAlign: 0,
      vAlign: 0,
    });
  }

  private previewPoly(
    cur: Vec3,
    stroke: { color: string; lineWidth: number; lineStyle: import('./types').LineStyleId },
  ): void {
    if (this.kind === 'pline' && this.step === 1 && this.p0) {
      const end = this.applyLineConstraint(this.p0, cur);
      this.viewport.setPreview([this.p0, end], stroke);
      return;
    }
    if (this.kind === 'parct' && this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(
        this.contPoint,
        this.contTangent,
        cur,
        stroke,
      );
      if (arc) {
        this.viewport.setPreview(sampleArc(arc, 64), stroke);
      } else {
        this.viewport.setPreview(null);
      }
      return;
    }
    // parc / parct (1er arc 3 pts) : même rubber-band que /arc
    if (
      (this.kind === 'parc' || this.kind === 'parct') &&
      !this.contPoint
    ) {
      this.previewArc3(cur, stroke);
      return;
    }
    this.viewport.setPreview(null);
  }

  private previewPolyWall(cur: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    const stroke = this.pen.strokeFields();

    if (this.kind === 'pmur' && this.step === 1 && this.p0) {
      const end = this.applyLineConstraint(this.p0, cur);
      // Aperçu avec chaîne existante du polymur + segment courant
      const wall = this.getActivePolyWall();
      const chainPts: Vec3[] = [];
      if (wall?.segments) {
        for (const s of wall.segments) {
          if (s.type !== 'line') continue;
          if (chainPts.length === 0) {
            chainPts.push([s.start[0], s.start[1], s.start[2]]);
          }
          chainPts.push([s.end[0], s.end[1], s.end[2]]);
        }
      }
      if (chainPts.length === 0 && this.p0) {
        chainPts.push([this.p0[0], this.p0[1], this.p0[2]]);
      }
      // Si le polymur se termine par un arc, preview = simple mur linéaire isolé
      const lastSeg = wall?.segments?.[wall.segments.length - 1];
      if (lastSeg && lastSeg.type === 'arc') {
        this.previewWallLine(end);
        return;
      }
      chainPts.push([end[0], end[1], end[2]]);
      if (chainPts.length < 2) {
        this.viewport.setPreviewStrokes(null);
        return;
      }
      const side = this.wallFlip ? -1 : 1;
      const last = chainPts.length - 1;
      const strokes = style.lines.map((ln) => {
        const o = ln.offset * side;
        const miterPoly = offsetPolylineOpen(chainPts, o);
        return {
          points: [miterPoly[last - 1]!, miterPoly[last]!] as [Vec3, Vec3],
          color: ln.color,
          lineWidth: ln.lineWidth,
          lineStyle: ln.lineStyle,
        };
      });
      this.viewport.setPreviewStrokes(strokes);
      return;
    }

    if (this.kind === 'pmarct' && this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(
        this.contPoint,
        this.contTangent,
        cur,
        stroke,
      );
      if (!arc) {
        this.viewport.setPreviewStrokes(null);
        return;
      }
      const strokes = arcWallStrokes(
        arc.center,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        style.lines,
        this.wallFlip,
        64,
      );
      this.viewport.setPreviewStrokes(
        strokes.map((s) => ({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        })),
      );
      return;
    }

    if (
      (this.kind === 'pmarc' || this.kind === 'pmarct') &&
      !this.contPoint
    ) {
      this.previewWallArc(cur);
      return;
    }

    this.viewport.setPreviewStrokes(null);
  }

  private previewTransform(cur: Vec3): void {
    if (!this.p0) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    // [Shift] = H / 45° / V sur le vecteur base → destination
    const end = this.applyLineConstraint(this.p0, cur);
    const dx = end[0] - this.p0[0];
    const dy = end[1] - this.p0[1];
    const ents = this.copySourceEntities();
    if (ents.length === 0) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    const previewColor =
      this.copyMode === 'designate' || this.kind === 'paral'
        ? '#ffb74d'
        : '#4fc3f7';
    const strokes: {
      points: Vec3[];
      color: string;
      lineWidth: number;
      lineStyle: import('./types').LineStyleId;
    }[] = [];

    for (const e of ents) {
      if (e.kind === 'line') {
        strokes.push({
          points: [
            [e.start[0] + dx, e.start[1] + dy, e.start[2]],
            [e.end[0] + dx, e.end[1] + dy, e.end[2]],
          ],
          color: previewColor,
          lineWidth: e.lineWidth,
          lineStyle: e.lineStyle,
        });
      } else if (e.kind === 'arc' || e.kind === 'circle') {
        const samples =
          e.kind === 'circle' ? sampleCircle(e, 32) : sampleArc(e, 32);
        strokes.push({
          points: samples.map(
            (p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3,
          ),
          color: previewColor,
          lineWidth: e.lineWidth,
          lineStyle: e.lineStyle,
        });
      } else if (e.kind === 'wall') {
        for (const s of wallEntityStrokes(e, 16)) {
          strokes.push({
            points: s.points.map(
              (p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3,
            ),
            color: previewColor,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          });
        }
      } else if (e.kind === 'object') {
        for (const s of objectInstanceStrokes(e)) {
          strokes.push({
            points: s.points.map(
              (p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3,
            ),
            color: previewColor,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          });
        }
      } else if (e.kind === 'text') {
        // Petite croix à l’emplacement du texte déplacé
        const p: Vec3 = [
          e.position[0] + dx,
          e.position[1] + dy,
          e.position[2],
        ];
        const h = e.height * 0.5;
        strokes.push({
          points: [
            [p[0] - h, p[1], p[2]],
            [p[0] + h, p[1], p[2]],
          ],
          color: previewColor,
          lineWidth: 1,
          lineStyle: 'plein',
        });
        strokes.push({
          points: [
            [p[0], p[1] - h, p[2]],
            [p[0], p[1] + h, p[2]],
          ],
          color: previewColor,
          lineWidth: 1,
          lineStyle: 'plein',
        });
      } else if (e.kind === 'dimension') {
        const geom = buildDimensionGeom(
          e.style,
          [
            e.lineAnchor[0] + dx,
            e.lineAnchor[1] + dy,
            e.lineAnchor[2],
          ],
          e.direction,
          e.defPoints.map(
            (p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3,
          ),
        );
        for (const s of geom.strokes) {
          strokes.push({
            points: s.points,
            color: previewColor,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          });
        }
      } else if (e.kind === 'polyline') {
        for (const s of polylineStrokes(e, 24)) {
          strokes.push({
            points: s.points.map(
              (p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3,
            ),
            color: previewColor,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          });
        }
      } else if (e.kind === 'point') {
        const p: Vec3 = [
          e.position[0] + dx,
          e.position[1] + dy,
          e.position[2],
        ];
        const h = Math.max(0.02, (e.lineWidth * 0.5) * this.viewport.worldPerPixel());
        strokes.push({
          points: [
            [p[0] - h, p[1], p[2]],
            [p[0] + h, p[1], p[2]],
          ],
          color: previewColor,
          lineWidth: e.lineWidth,
          lineStyle: 'plein',
        });
        strokes.push({
          points: [
            [p[0], p[1] - h, p[2]],
            [p[0], p[1] + h, p[2]],
          ],
          color: previewColor,
          lineWidth: e.lineWidth,
          lineStyle: 'plein',
        });
      }
    }
    // Vecteur de déplacement
    strokes.push({
      points: [this.p0, cur],
      color: previewColor,
      lineWidth: 1,
      lineStyle: 'pointille',
    });
    this.viewport.setPreviewStrokes(strokes);
  }

  /** Sources du /copy (sélection ou désignation). */
  private copySourceEntities(): Entity[] {
    if (this.copyMode === 'designate' && this.designation) {
      return this.designation.designatedEntities(this.doc.entities);
    }
    if (this.selection) {
      return this.selection.selectedEntities(this.doc.entities);
    }
    return [];
  }

  private copySourceIds(): string[] {
    return this.copySourceEntities().map((e) => e.id);
  }

  private previewWallLine(cur: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style || !this.p0) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    // Preview avec onglet : polyligne = (…chaîne existante se terminant en p0) + cur
    const chainPts = this.collectChainPointsTo(this.p0, style.id, this.wallFlip);
    chainPts.push([cur[0], cur[1], cur[2]]);

    if (chainPts.length < 2) {
      this.viewport.setPreviewStrokes(null);
      return;
    }

    const side = this.wallFlip ? -1 : 1;
    const last = chainPts.length - 1;
    // Segment preview = avant-dernier → dernier
    const strokes = style.lines.map((ln) => {
      const o = ln.offset * side;
      const miterPoly = offsetPolylineOpen(chainPts, o);
      return {
        points: [miterPoly[last - 1]!, miterPoly[last]!] as [
          import('./types').Vec3,
          import('./types').Vec3,
        ],
        color: ln.color,
        lineWidth: ln.lineWidth,
        lineStyle: ln.lineStyle,
      };
    });
    this.viewport.setPreviewStrokes(strokes);
  }

  /**
   * Points de la chaîne se terminant en `tip` (même style/flip), ordre parcours.
   * Si rien : [tip] seul — l'appelant ajoute le point courant.
   */
  private collectChainPointsTo(
    tip: import('./types').Vec3,
    styleId: string,
    flip: boolean,
  ): import('./types').Vec3[] {
    const TOL = 0.5;
    // Trouver le mur qui se termine en tip
    let endWall: import('./types').WallEntity | null = null;
    let best = TOL;
    for (const w of this.doc.walls) {
      if (w.path !== 'line') continue;
      if (w.styleId !== styleId || w.flip !== flip) continue;
      const d = Math.hypot(w.end[0] - tip[0], w.end[1] - tip[1]);
      if (d <= best + 1e-12) {
        endWall = w;
        best = d;
      }
    }
    if (!endWall) return [[tip[0], tip[1], tip[2]]];

    // Remonter la chaîne
    const segs: import('./types').WallEntity[] = [endWall];
    const used = new Set<string>([endWall.id]);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const head = segs[0]!;
      let pred: import('./types').WallEntity | null = null;
      let bd = TOL;
      for (const w of this.doc.walls) {
        if (w.path !== 'line' || used.has(w.id)) continue;
        if (w.styleId !== styleId || w.flip !== flip) continue;
        const d = Math.hypot(w.end[0] - head.start[0], w.end[1] - head.start[1]);
        if (d <= bd + 1e-12) {
          pred = w;
          bd = d;
        }
      }
      if (!pred) break;
      segs.unshift(pred);
      used.add(pred.id);
    }

    const pts: import('./types').Vec3[] = [
      [segs[0]!.start[0], segs[0]!.start[1], segs[0]!.start[2]],
    ];
    for (const s of segs) {
      pts.push([s.end[0], s.end[1], s.end[2]]);
    }
    return pts;
  }

  private previewWallArc(cur: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    if (this.step === 1 && this.p0) {
      this.viewport.setPreview([this.p0, cur], this.pen.strokeFields());
      return;
    }
    if (this.step === 2 && this.p0 && this.p1) {
      const arc = arcFrom3Points(this.p0, this.p1, cur, this.pen.strokeFields());
      if (!arc) {
        this.viewport.setPreview([this.p0, this.p1, cur], this.pen.strokeFields());
        return;
      }
      const strokes = arcWallStrokes(
        arc.center,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        style.lines,
        this.wallFlip,
        64,
      );
      this.viewport.setPreviewStrokes(
        strokes.map((s) => ({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        })),
      );
      return;
    }
    this.viewport.setPreviewStrokes(null);
  }

  private previewArcc(
    cur: Vec3,
    stroke: { color: string; lineWidth: number; lineStyle: import('./types').LineStyleId },
  ): void {
    // step 0 : rien · step 1 (centre posé, rayon suit souris) · step >= 2 rayon figé
    if (this.step === 1 && this.p0) {
      const pts = sampleCircleFromCenterPoint(this.p0, cur, 64);
      this.viewport.setPreview(pts, stroke);
      return;
    }
    if (this.step === 2 && this.p0 && this.radius > EPS) {
      // Cercle figé en attendant le départ d'arc
      const pts = sampleCircle(
        createCircleEntity(this.p0, this.radius, stroke),
        64,
      );
      this.viewport.setPreview(pts, stroke);
      return;
    }
    if (this.step === 3 && this.p0 && this.p1 && this.radius > EPS) {
      // Arc centre → départ → souris (fin)
      const startOnCircle = projectOnCircle(this.p0, this.radius, this.p1);
      const endOnCircle = projectOnCircle(this.p0, this.radius, cur);
      const arc = arcFromCenterStartEnd(this.p0, startOnCircle, endOnCircle, stroke);
      if (arc) {
        this.viewport.setPreview(sampleArc(arc, 64), stroke);
      } else {
        this.viewport.setPreview(null);
      }
      return;
    }
    this.viewport.setPreview(null);
  }

  private previewArc3(
    cur: Vec3,
    stroke: { color: string; lineWidth: number; lineStyle: import('./types').LineStyleId },
  ): void {
    if (this.step === 1 && this.p0) {
      this.viewport.setPreview([this.p0, cur], stroke);
      return;
    }
    if (this.step === 2 && this.p0 && this.p1) {
      const arc = arcFrom3Points(this.p0, this.p1, cur, stroke);
      if (arc) {
        // Densité élevée pour un rubber-band fluide (départ → passage → souris)
        this.viewport.setPreview(sampleArc(arc, 96), stroke);
      } else {
        // Colinéaire : polyligne départ → passage → souris
        this.viewport.setPreview([this.p0, this.p1, cur], stroke);
      }
      return;
    }
    this.viewport.setPreview(null);
  }

  private previewArcCont(
    cur: Vec3,
    stroke: { color: string; lineWidth: number; lineStyle: import('./types').LineStyleId },
  ): void {
    // Mode continuité (après 1er arc)
    if (this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(this.contPoint, this.contTangent, cur, stroke);
      if (arc) {
        this.viewport.setPreview(sampleArc(arc, 64), stroke);
      } else {
        this.viewport.setPreview(null);
      }
      return;
    }
    // 1er arc = comme /arc
    this.previewArc3(cur, stroke);
  }

  private onPoint(pt: Vec3): void {
    if (this.kind === 'line') this.onLinePoint(pt);
    else if (this.kind === 'pline') this.onPlinePoint(pt);
    else if (this.kind === 'parc') this.onParcPoint(pt);
    else if (this.kind === 'parct') this.onParctPoint(pt);
    else if (this.kind === 'pmur') this.onPmurPoint(pt);
    else if (this.kind === 'pmarc') this.onPmarcPoint(pt);
    else if (this.kind === 'pmarct') this.onPmarctPoint(pt);
    else if (this.kind === 'point') this.onPointPlace(pt);
    else if (this.kind === 'wallline') this.onWallLinePoint(pt);
    else if (this.kind === 'wallarc') this.onWallArcPoint(pt);
    else if (this.kind === 'arcc') this.onArccPoint(pt);
    else if (this.kind === 'arc') this.onArc3Point(pt);
    else if (this.kind === 'arccont') this.onArcContPoint(pt);
    else if (this.kind === 'circle') this.onCirclePoint(pt);
    else if (this.kind === 'select') this.onSelectPoint(pt);
    else if (this.kind === 'copy') this.onCopyPoint(pt);
    else if (this.kind === 'move') this.onMovePoint(pt);
    else if (this.kind === 'm1') this.onMoveOnePoint(pt);
    else if (this.kind === 'r1') this.onRotateOnePoint(pt);
    else if (this.kind === 'stretch') this.onStretchPoint(pt);
    else if (this.kind === 'rejoin') this.onRejoinPoint(pt);
    else if (this.kind === 'join') this.onJoinPoint(pt);
    else if (this.kind === 'placeobj') this.onPlaceObjectPoint(pt);
    else if (this.kind === 'paral') this.onParalPoint(pt);
    else if (this.kind === 'dist') this.onDistPoint(pt);
    else if (this.kind === 'rect') this.onRectPoint(pt);
    else if (this.kind === 'text' || this.kind === 'textbox') this.onTextPoint(pt);
    else if (this.kind === 'cote') this.onCotePoint(pt);
  }

  private onRectPoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = [...pt] as Vec3;
      this.step = 1;
      this.feedback(
        `RECT — coin (${fmt(pt)}). 2ᵉ coin…  [Shift] = carré  ·  Échap = annuler`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const poly = createRectPolyline(
      this.p0,
      pt,
      this.pen.strokeFields(),
      this.shiftDown,
    );
    if (!poly) {
      this.feedback('Rectangle trop petit.', 'warn');
      return;
    }
    this.doc.addEntity(poly);
    this.feedback(
      `Rectangle${this.shiftDown ? ' (carré)' : ''} posé — polyligne fermée.`,
      'ok',
    );
    // Enchaîne : nouveau rectangle
    this.p0 = null;
    this.step = 0;
    this.viewport.setPreview(null);
    this.feedback('RECT — 1er coin…  [Shift] = carré  ·  Échap = annuler', 'info');
  }

  private onTextPoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = [...pt] as Vec3;
      this.step = 1;
      this.feedback(
        `${this.textBoxed ? 'TEXTBOX' : 'TEXT'} — départ (${fmt(pt)}). Direction / angle…`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const dx = pt[0] - this.p0[0];
    const dy = pt[1] - this.p0[1];
    if (Math.hypot(dx, dy) < EPS) {
      this.feedback('Direction nulle — cliquez un 2ᵉ point distinct.', 'warn');
      return;
    }
    const rot = Math.atan2(dy, dx);
    const ent = this.makeTextEntity(
      this.pendingText,
      this.p0,
      rot,
      this.textBoxed,
    );
    this.doc.addEntity(ent);
    this.feedback(
      `${this.textBoxed ? 'Textbox' : 'Texte'} « ${shortText(this.pendingText)} » posé.`,
      'ok',
    );
    this.resetState();
  }

  private onCotePoint(pt: Vec3): void {
    if (!this.dimPrefs) return;
    // step 0 : ancre de la ligne de côte
    if (this.step === 0) {
      this.p0 = [...pt] as Vec3;
      this.step = 1;
      this.feedback(
        `COTE — passage (${fmt(pt)}). Direction de la ligne de côte…  [Shift]=H/45°/V`,
        'ok',
      );
      this.updatePreview();
      return;
    }
    // step 1 : direction ([Shift] = H / 45° / V)
    if (this.step === 1) {
      if (!this.p0) return;
      const end = this.applyLineConstraint(this.p0, pt);
      const dir = normalizeDimDir([
        end[0] - this.p0[0],
        end[1] - this.p0[1],
        0,
      ]);
      if (!dir) {
        this.feedback('Direction nulle — recliquez.', 'warn');
        return;
      }
      this.coteDir = dir;
      this.step = 2;
      this.coteDefPoints = [];
      this.feedback(
        'COTE — 1er point de définition…  (chaque segment = 1 entité + texte). Échap = fin',
        'ok',
      );
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      this.viewport.setPreviewLabels(null);
      return;
    }
    // step >= 2 : points de définition — commit immédiat à chaque segment
    if (!this.p0 || !this.coteDir || !this.dimPrefs) return;
    this.coteDefPoints.push([pt[0], pt[1], pt[2]]);
    if (this.coteDefPoints.length === 1) {
      this.feedback(
        'COTE — point suivant pour le 1er segment…  Échap = fin',
        'ok',
      );
      return;
    }
    // Au moins 2 points : créer le segment entre les 2 derniers
    const a = this.coteDefPoints[this.coteDefPoints.length - 2]!;
    const b = this.coteDefPoints[this.coteDefPoints.length - 1]!;
    const created = createSingleCoteSegment(
      this.dimPrefs.snapshotCurrent(),
      this.p0,
      this.coteDir,
      a,
      b,
      { unit: this.viewport.getUnits() },
    );
    if (!created) {
      this.feedback('Segment invalide (points confondus ?).', 'warn');
      this.coteDefPoints.pop();
      return;
    }
    this.doc.addEntities([created.dim, created.text]);
    this.cotePlacedCount += 1;
    this.feedback(
      `COTE — segment ${this.cotePlacedCount} posé (entité + texte). Point suivant ou Échap = fin`,
      'ok',
    );
  }

  private onDistPoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = [...pt] as Vec3;
      this.step = 1;
      this.feedback(
        `DIST — 1er point (${fmt(pt)}). 2ᵉ point…  ·  Échap = fin`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const d = dist(this.p0, pt);
    const unit = this.viewport.getUnits();
    const digits = unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3;
    const label = formatLength(d, unit, digits);
    // Δ par axe (utile pour repérage)
    const dx = pt[0]! - this.p0[0]!;
    const dy = pt[1]! - this.p0[1]!;
    const dz = pt[2]! - this.p0[2]!;
    const f = (v: number) => formatLength(v, unit, digits);
    this.feedback(
      `DIST = ${label}   (Δx ${f(dx)}, Δy ${f(dy)}, Δz ${f(dz)})   ·  recliquer 1er point, Échap = fin`,
      'ok',
    );
    this.p0 = null;
    this.step = 0;
    this.viewport.setPreview(null);
  }

  private onJoinPoint(pt: Vec3): void {
    const maxDist = this.viewport.snapToleranceMeters();
    const px = this.viewport.snapRadiusPx();

    // Étape 1 — mur à prolonger
    if (!this.joinStem) {
      const hit = findNearestWall(pt, this.doc.entities, maxDist);
      if (!hit) {
        this.feedback(
          `Aucun mur dans ${px} px. Cliquez près d’un mur linéaire.`,
          'warn',
        );
        return;
      }
      if (hit.wall.path !== 'line') {
        this.feedback(
          'JOIN v1 : uniquement les murs linéaires (/ml). Polymur non supporté.',
          'warn',
        );
        return;
      }
      this.joinStem = { wallId: hit.wall.id, click: [...pt] as Vec3 };
      this.designation?.set([hit.wall.id]);
      const which =
        dist(pt, hit.wall.start) <= dist(pt, hit.wall.end) ? 'début' : 'fin';
      this.feedback(
        `JOIN — mur source (${which} du côté du clic). 2) cliquez le mur cible…`,
        'ok',
      );
      return;
    }

    // Étape 2 — mur cible
    const stemId = this.joinStem.wallId;
    const stemClick = this.joinStem.click;
    const liveStem = this.doc.entities.find(
      (e): e is WallEntity => e.kind === 'wall' && e.id === stemId,
    );
    if (!liveStem) {
      this.joinStem = null;
      this.designation?.clear();
      this.feedback('Mur source disparu — redésignez le 1er mur.', 'warn');
      return;
    }

    const hitT = findNearestWall(pt, this.doc.entities, maxDist, stemId);
    if (!hitT) {
      this.feedback(
        `Aucun mur cible dans ${px} px (autre que le source).`,
        'warn',
      );
      return;
    }
    if (hitT.wall.path !== 'line') {
      this.feedback('Mur cible : uniquement linéaire (/ml) en v1.', 'warn');
      return;
    }

    const { entities, result } = applyJoinWallsToEntities(
      this.doc.entities,
      stemId,
      hitT.wall.id,
      { clickOnStem: stemClick },
    );
    if (!result.ok) {
      this.feedback(`JOIN — ${result.reason}`, 'warn');
      // garder le source pour retenter une autre cible
      return;
    }

    this.doc.replaceAllEntities(entities, { rejoin: false });
    // Joints déjà appliqués dans applyJoinWallsToEntities
    this.designation?.clear();
    this.joinStem = null;
    this.feedback(
      `JOIN ${result.mode} — allongé de ${result.lengthened.toFixed(3)} m ` +
        `(${result.which === 'start' ? 'début' : 'fin'}). ` +
        `Recliquer un mur source, ou Échap.`,
      'ok',
    );
  }

  private onParalPoint(pt: Vec3): void {
    const maxDist = this.viewport.snapToleranceMeters();

    // Étape 0 : désignation
    if (this.step === 0) {
      const hit = findNearestDesignatable(pt, this.doc.entities, maxDist);
      if (!hit) {
        this.feedback(
          `Aucun élément à désigner dans ${this.viewport.snapRadiusPx()} px (ligne, arc, cercle, mur, aide).`,
          'warn',
        );
        return;
      }
      this.setParalDesignation(hit.entity, [...pt] as Vec3);
      return;
    }

    // Étape 1 : placement (libre) ou sens (mode D…)
    if (!this.paralTarget || !this.paralDesignatePt) {
      this.step = 0;
      return;
    }

    // Mode D… : 2ᵉ clic = sens uniquement (distances déjà connues)
    if (this.paralDeltas && this.paralDeltas.length > 0) {
      const ts = deltaParalTranslations(
        this.paralTarget,
        this.paralDesignatePt,
        pt,
        this.paralDeltas,
      );
      if (!ts) {
        this.feedback(
          'Sens indéterminé — cliquez clairement d’un côté de l’objet (gauche/droite, haut/bas…).',
          'warn',
        );
        return;
      }
      const copies = makeParalCopies(this.paralTarget, ts);
      if (copies.length === 0) {
        this.feedback('Décalage nul — aucune copie. Recliquez le sens, Échap = fin.', 'warn');
        return;
      }
      this.doc.addEntities(copies);
      // Enchaînement : dernière copie = nouvelle désignation (translation du point de ref.)
      const lastT = ts[ts.length - 1]!;
      const chain = this.chainParalToLastCopy(copies, lastT);
      this.feedback(
        `PARAL — ${copies.length} copie(s). « ${chain?.kind ?? 'copie'} » désigné(e) — recliquez le sens pour enchaîner, Échap = fin.`,
        'ok',
      );
      return;
    }

    // Mode libre : 2ᵉ clic = emplacement (distance + sens)
    const t = freeParalTranslation(
      this.paralTarget,
      pt,
      this.paralDesignatePt,
    );
    if (!t) {
      this.feedback('Décalage trop petit ou indéterminé — recliquez.', 'warn');
      return;
    }
    const copies = makeParalCopies(this.paralTarget, [t]);
    if (copies.length === 0) {
      this.feedback('Impossible de créer la copie.', 'err');
      return;
    }
    this.doc.addEntities(copies);
    const chain = this.chainParalToLastCopy(copies, t);
    this.feedback(
      `PARAL — copie Δ=(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}). « ${chain?.kind ?? 'copie'} » désigné(e) — recliquez l’emplacement pour enchaîner, Échap = fin.`,
      'ok',
    );
  }

  /**
   * Surbrille l’élément désigné (orange, **sans** toucher à la sélection)
   * et mémorise la cible /paral.
   */
  private setParalDesignation(entity: Designatable, designatePt: Vec3): void {
    this.paralTarget = entity;
    this.paralDesignatePt = designatePt;
    this.step = 1;
    this.designation?.set([entity.id]);

    if (this.paralDeltas && this.paralDeltas.length > 0) {
      this.feedback(
        `PARAL — « ${entity.kind} » désigné (orange). Cliquez le **sens** (gauche/droite, haut/bas…)… Échap = fin`,
        'ok',
      );
    } else {
      this.feedback(
        `PARAL — « ${entity.kind} » désigné (orange). Cliquez l’emplacement (distance // depuis la face/ligne proche). Échap = fin`,
        'ok',
      );
    }
  }

  /**
   * Après création de copies : la dernière devient la nouvelle désignation
   * (outil reste actif, prête pour un autre offset sans retaper /paral).
   * N’altère pas la sélection.
   */
  private chainParalToLastCopy(
    copies: Entity[],
    translation: Vec3,
  ): Designatable | null {
    const last = copies[copies.length - 1];
    if (!last || !this.paralDesignatePt) {
      this.paralTarget = null;
      this.paralDesignatePt = null;
      this.step = 0;
      this.designation?.clear();
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      return null;
    }
    // Seules les entités designables passent (toutes les copies /paral le sont)
    const asDesignatable = last as Designatable;
    const nextDesignate: Vec3 = [
      this.paralDesignatePt[0] + translation[0],
      this.paralDesignatePt[1] + translation[1],
      this.paralDesignatePt[2] + translation[2],
    ];
    this.paralTarget = asDesignatable;
    this.paralDesignatePt = nextDesignate;
    this.step = 1;
    this.designation?.set([last.id]);
    this.viewport.setPreview(null);
    this.viewport.setPreviewStrokes(null);
    return asDesignatable;
  }

  private previewParal(): void {
    if (this.step !== 1 || !this.paralTarget || !this.paralDesignatePt) {
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      return;
    }
    const m = this.viewport.getMouseWorld();
    if (!m) {
      this.viewport.setPreview(null);
      return;
    }
    const cur: Vec3 = [m.x, m.y, m.z];

    // Mode D… : aperçu avec distances fixes + sens selon la souris
    let t: Vec3 | null = null;
    if (this.paralDeltas && this.paralDeltas.length > 0) {
      const ts = deltaParalTranslations(
        this.paralTarget,
        this.paralDesignatePt,
        cur,
        this.paralDeltas,
      );
      t = ts && ts.length > 0 ? ts[0]! : null;
    } else {
      t = freeParalTranslation(
        this.paralTarget,
        cur,
        this.paralDesignatePt,
      );
    }
    if (!t) {
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      return;
    }
    // Aperçu simple : pour ligne, segment décalé ; sinon pointillés basiques
    const e = this.paralTarget;
    if (e.kind === 'line') {
      this.viewport.setPreview(
        [
          [e.start[0] + t[0], e.start[1] + t[1], e.start[2] + t[2]],
          [e.end[0] + t[0], e.end[1] + t[1], e.end[2] + t[2]],
        ],
        { color: e.color, lineWidth: e.lineWidth, lineStyle: e.lineStyle },
      );
      return;
    }
    if (e.kind === 'wall') {
      const strokes = wallEntityStrokes(e, 16).map((s) => ({
        points: s.points.map(
          (p): Vec3 => [p[0] + t[0], p[1] + t[1], p[2] + t[2]],
        ),
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      }));
      this.viewport.setPreviewStrokes(strokes);
      return;
    }
    if (e.kind === 'arc') {
      const pts = sampleArc(
        {
          ...e,
          center: [
            e.center[0] + t[0],
            e.center[1] + t[1],
            e.center[2] + t[2],
          ],
        },
        48,
      );
      this.viewport.setPreview(pts, {
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
      return;
    }
    if (e.kind === 'circle') {
      const pts = sampleCircle(
        {
          ...e,
          center: [
            e.center[0] + t[0],
            e.center[1] + t[1],
            e.center[2] + t[2],
          ],
        },
        48,
      );
      this.viewport.setPreview(pts, {
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
      return;
    }
    // helper : petit segment autour du point souris
    this.viewport.setPreview(
      [
        [cur[0] - 1, cur[1], cur[2]],
        [cur[0] + 1, cur[1], cur[2]],
      ],
      { color: '#888888', lineWidth: 1, lineStyle: 'pointille' },
    );
  }

  private onPlaceObjectPoint(pt: Vec3): void {
    if (!this.placeTab || !this.placeName) {
      this.resetState();
      return;
    }
    const def = objectDefCache.get(this.placeTab, this.placeName);
    if (!def) {
      this.feedback('Définition objet absente — réessayez.', 'err');
      return;
    }
    const inst = createObjectInstance(this.placeTab, this.placeName, pt, 0);
    this.doc.addEntity(inst);
    this.feedback(
      `Objet « ${this.placeName} » placé @ (${fmt(pt)}) — recliquer pour un autre, Échap = fin`,
      'ok',
    );
    // Reste en mode place pour enchaîner
    this.viewport.setPreviewStrokes(null);
  }

  private onSelectPoint(pt: Vec3): void {
    if (!this.selection) return;
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `SELECT — 2ᵉ coin…  [ALT]=${this.altDown ? 'DÉSEL' : 'SÉL'}`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const box = normalizeAabb(this.p0, pt);
    const mode = this.altDown ? 'remove' : 'add';
    const n = this.selection.applyRect(this.doc.entities, box, mode);
    this.viewport.setSelectRect(null, null);
    this.feedback(
      mode === 'add'
        ? `+${n} dans le cadre → sélection : ${this.selection.size} élém. (recliquer pour un autre cadre, Échap fin)`
        : `−${n} dans le cadre → sélection : ${this.selection.size} élém.`,
      'ok',
    );
    // Enchaîne un autre cadre
    this.p0 = null;
    this.step = 0;
  }

  private onCopyPoint(pt: Vec3): void {
    // ── Mode désignation ──────────────────────────────────────────
    // Clic 1 : désigner (= base) → fantôme suit la souris immédiatement
    // Clic 2 : coller la copie à cet endroit ; elle devient désignée et suit encore
    if (this.copyMode === 'designate') {
      if (this.step === 0) {
        const maxDist = this.viewport.snapToleranceMeters();
        const hit = findNearestEntity(pt, this.doc.entities, maxDist);
        if (!hit) {
          this.feedback(
            `Aucun élément à désigner dans ${this.viewport.snapRadiusPx()} px.`,
            'warn',
          );
          return;
        }
        this.designation?.set([hit.entity.id]);
        // Le clic de désignation = point de base (pas de 2ᵉ clic « base »)
        this.p0 = [...hit.point] as Vec3;
        this.step = 1;
        this.feedback(
          `COPY — « ${hit.entity.kind} » désigné (orange) suit la souris. Clic = coller · Échap = fin`,
          'ok',
        );
        this.updatePreview();
        return;
      }

      // step 1 : coller
      if (!this.p0) {
        this.step = 0;
        return;
      }
      const ids = this.copySourceIds();
      if (ids.length === 0) {
        this.feedback('Rien à copier — redésignez un objet.', 'warn');
        this.step = 0;
        this.p0 = null;
        this.designation?.clear();
        return;
      }
      const end = this.applyLineConstraint(this.p0, pt);
      const dx = end[0] - this.p0[0];
      const dy = end[1] - this.p0[1];
      // Clic quasi sur le point de base → ignore (évite copie nulle accidentelle)
      if (Math.hypot(dx, dy) < 1e-9) {
        this.feedback('Déplacez la souris puis cliquez pour coller.', 'warn');
        return;
      }
      const copies = this.doc.copyEntities(ids, dx, dy, 0);
      if (copies.length === 0) {
        this.feedback('Copie impossible.', 'err');
        return;
      }
      // Copie(s) désignée(s) ; base = point de collage → suit déjà pour enchaîner
      this.designation?.set(copies.map((e) => e.id));
      this.p0 = [...pt] as Vec3;
      this.step = 1;
      this.feedback(
        `${copies.length} copié(s) Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)}). Copie orange suit la souris — recliquer pour coller, Échap = fin.`,
        'ok',
      );
      this.updatePreview();
      return;
    }

    // ── Mode sélection : base → arrivée ───────────────────────────
    if (this.copyMode === 'selection') {
      if (!this.selection || this.selection.size === 0) {
        this.feedback('Sélection vide — passez en désignation : cliquez un objet.', 'warn');
        this.copyMode = 'designate';
        this.step = 0;
        this.p0 = null;
        return;
      }
      if (this.step === 0) {
        this.p0 = pt;
        this.step = 1;
        this.feedback(
          `COPY — point d’arrivée… (${this.selection.size} élém. sélectionné(s))`,
          'ok',
        );
        return;
      }
      if (!this.p0) return;
      const ids = this.copySourceIds();
      if (ids.length === 0) {
        this.feedback('Rien à copier.', 'warn');
        return;
      }
      const end = this.applyLineConstraint(this.p0, pt);
      const dx = end[0] - this.p0[0];
      const dy = end[1] - this.p0[1];
      const copies = this.doc.copyEntities(ids, dx, dy, 0);
      if (copies.length === 0) {
        this.feedback('Copie impossible.', 'err');
        return;
      }
      this.selection.set(copies.map((e) => e.id));
      this.designation?.clear();
      this.feedback(
        `${copies.length} élém. copié(s) Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)}). Copie(s) sélectionnée(s) — base → arrivée pour enchaîner, Échap = fin.`,
        'ok',
      );
      this.p0 = null;
      this.step = 0;
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
    }
  }

  private onMovePoint(pt: Vec3): void {
    if (!this.selection) return;
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback('MOVE — destination…  [Shift]=H/45°/V', 'ok');
      return;
    }
    if (!this.p0) return;
    const end = this.applyLineConstraint(this.p0, pt);
    const dx = end[0] - this.p0[0];
    const dy = end[1] - this.p0[1];
    const ids = [...this.selection.selectedIds];
    const n = this.doc.translateEntities(ids, dx, dy, 0);
    this.feedback(
      `${n} élém. déplacé(s) Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)})${this.shiftDown ? ' [Shift]' : ''}`,
      'ok',
    );
    this.resetState();
  }

  private onMoveOnePoint(pt: Vec3): void {
    // step 0 : désigner
    if (this.step === 0) {
      const maxDist = this.viewport.snapToleranceMeters();
      const hit = findNearestEntity(pt, this.doc.entities, maxDist);
      if (!hit) {
        this.feedback(
          `Aucun objet dans ${this.viewport.snapRadiusPx()} px. Recliquez près d’un élément.`,
          'warn',
        );
        return;
      }
      this.oneTargetId = hit.entity.id;
      this.designation?.set([hit.entity.id]);
      this.step = 1;
      const what = this.describeOneTarget(hit.entity);
      this.feedback(`M1 — ${what} désigné. Point de base…`, 'ok');
      return;
    }
    // step 1 : base
    if (this.step === 1) {
      this.p0 = [...pt] as Vec3;
      this.step = 2;
      this.feedback('M1 — destination…  [Shift]=H/45°/V', 'ok');
      return;
    }
    // step 2 : destination ([Shift] = H / 45° / V)
    if (!this.p0 || !this.oneTargetId) return;
    const end = this.applyLineConstraint(this.p0, pt);
    const dx = end[0] - this.p0[0];
    const dy = end[1] - this.p0[1];
    if (Math.abs(dx) < 1e-15 && Math.abs(dy) < 1e-15) {
      this.feedback('Déplacement nul — recliquez la destination.', 'warn');
      return;
    }
    const ok = this.applyOneMove(dx, dy);
    this.feedback(
      ok
        ? `M1 — déplacé Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)})${this.shiftDown ? ' [Shift]' : ''}`
        : 'M1 — objet introuvable.',
      ok ? 'ok' : 'err',
    );
    this.resetState();
  }

  private onRotateOnePoint(pt: Vec3): void {
    // step 0 : désigner
    if (this.step === 0) {
      const maxDist = this.viewport.snapToleranceMeters();
      const hit = findNearestEntity(pt, this.doc.entities, maxDist);
      if (!hit) {
        this.feedback(
          `Aucun objet dans ${this.viewport.snapRadiusPx()} px. Recliquez près d’un élément.`,
          'warn',
        );
        return;
      }
      this.oneTargetId = hit.entity.id;
      this.designation?.set([hit.entity.id]);
      this.step = 1;
      const what = this.describeOneTarget(hit.entity);
      this.feedback(`R1 — ${what} désigné. Point de pivot…`, 'ok');
      return;
    }
    // step 1 : pivot
    if (this.step === 1) {
      this.p0 = [...pt] as Vec3;
      this.step = 2;
      this.feedback('R1 — point de référence (angle de départ)…', 'ok');
      return;
    }
    // step 2 : référence
    if (this.step === 2) {
      if (!this.p0) return;
      if (Math.hypot(pt[0] - this.p0[0], pt[1] - this.p0[1]) < 1e-12) {
        this.feedback('Référence confondue avec le pivot — recliquez.', 'warn');
        return;
      }
      this.p1 = [...pt] as Vec3;
      this.step = 3;
      this.feedback('R1 — point d’angle final…', 'ok');
      return;
    }
    // step 3 : angle final
    if (!this.p0 || !this.p1 || !this.oneTargetId) return;
    const a0 = Math.atan2(this.p1[1] - this.p0[1], this.p1[0] - this.p0[0]);
    const a1 = Math.atan2(pt[1] - this.p0[1], pt[0] - this.p0[0]);
    let ang = a1 - a0;
    // normaliser −π…π
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) < 1e-12) {
      this.feedback('Rotation nulle — recliquez.', 'warn');
      return;
    }
    const ok = this.applyOneRotate(this.p0, ang);
    const deg = (ang * 180) / Math.PI;
    this.feedback(
      ok
        ? `R1 — rotation ${deg.toFixed(2)}°`
        : 'R1 — objet introuvable.',
      ok ? 'ok' : 'err',
    );
    this.resetState();
  }

  private describeOneTarget(e: Entity): string {
    if (e.kind === 'dimension') {
      return 'cotation (ligne + texte lié)';
    }
    if (e.kind === 'text' && e.dimId) {
      return 'texte de cotation (libellé seul)';
    }
    if (e.kind === 'text') return 'texte';
    if (e.kind === 'polyline') return 'polyligne (hachures incluses)';
    if (e.kind === 'object') return 'objet library';
    if (e.kind === 'wall') return 'mur / polymur';
    return e.kind;
  }

  private getOneTargetEntity(): Entity | null {
    if (!this.oneTargetId) return null;
    return this.doc.entities.find((e) => e.id === this.oneTargetId) ?? null;
  }

  private applyOneMove(dx: number, dy: number): boolean {
    const e = this.getOneTargetEntity();
    if (!e) return false;
    // Texte de cotation : uniquement le texte (translateEntities ne tire pas la dim)
    // Cotation : dim + labelId suivent (document.translateEntities)
    return this.doc.translateEntities([e.id], dx, dy, 0) > 0;
  }

  private applyOneRotate(pivot: Vec3, angle: number): boolean {
    const e = this.getOneTargetEntity();
    if (!e) return false;
    return this.doc.rotateEntities([e.id], pivot, angle) > 0;
  }

  private previewOneMove(cur: Vec3): void {
    if (!this.p0 || !this.oneTargetId) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    // [Shift] = H / 45° / V
    const end = this.applyLineConstraint(this.p0, cur);
    const dx = end[0] - this.p0[0];
    const dy = end[1] - this.p0[1];
    const e = this.getOneTargetEntity();
    if (!e) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    this.previewOneEntityOffset(e, dx, dy);
  }

  private previewOneEntityOffset(e: Entity, dx: number, dy: number): void {
    const previewColor = '#ffb74d';
    const strokes: {
      points: Vec3[];
      color: string;
      lineWidth: number;
      lineStyle: import('./types').LineStyleId;
    }[] = [];

    if (e.kind === 'dimension') {
      const geom = buildDimensionGeom(
        e.style,
        [e.lineAnchor[0] + dx, e.lineAnchor[1] + dy, e.lineAnchor[2]],
        e.direction,
        e.defPoints.map((p) => [p[0] + dx, p[1] + dy, p[2]] as Vec3),
      );
      for (const s of geom.strokes) {
        strokes.push({
          points: s.points,
          color: previewColor,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
      // Aperçu du libellé lié
      if (e.labelId) {
        const txt = this.doc.entities.find((x) => x.id === e.labelId);
        if (txt && txt.kind === 'text') {
          this.pushEntityPreviewStrokes(
            translateEntity(txt, dx, dy, 0),
            previewColor,
            strokes,
          );
        }
      }
    } else {
      const moved = translateEntity(e, dx, dy, 0);
      this.pushEntityPreviewStrokes(moved, previewColor, strokes);
    }

    if (this.p0) {
      strokes.push({
        points: [this.p0, [this.p0[0] + dx, this.p0[1] + dy, this.p0[2]]],
        color: previewColor,
        lineWidth: 1,
        lineStyle: 'pointille',
      });
    }
    this.viewport.setPreviewStrokes(strokes);
  }

  private pushEntityPreviewStrokes(
    e: Entity,
    color: string,
    strokes: {
      points: Vec3[];
      color: string;
      lineWidth: number;
      lineStyle: import('./types').LineStyleId;
    }[],
  ): void {
    if (e.kind === 'line') {
      strokes.push({
        points: [e.start, e.end],
        color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'arc' || e.kind === 'circle') {
      const samples =
        e.kind === 'circle' ? sampleCircle(e, 32) : sampleArc(e, 32);
      strokes.push({
        points: samples,
        color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'wall') {
      for (const s of wallEntityStrokes(e, 16)) {
        strokes.push({
          points: s.points,
          color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
    } else if (e.kind === 'object') {
      for (const s of objectInstanceStrokes(e)) {
        strokes.push({
          points: s.points,
          color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
    } else if (e.kind === 'text') {
      const h = e.height * 0.5;
      const p = e.position;
      strokes.push({
        points: [
          [p[0] - h, p[1], p[2]],
          [p[0] + h, p[1], p[2]],
        ],
        color,
        lineWidth: 1,
        lineStyle: 'plein',
      });
      strokes.push({
        points: [
          [p[0], p[1] - h, p[2]],
          [p[0], p[1] + h, p[2]],
        ],
        color,
        lineWidth: 1,
        lineStyle: 'plein',
      });
    } else if (e.kind === 'polyline') {
      for (const s of polylineStrokes(e, 24)) {
        strokes.push({
          points: s.points,
          color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
    } else if (e.kind === 'point') {
      const p = e.position;
      const h = 0.05;
      strokes.push({
        points: [
          [p[0] - h, p[1], p[2]],
          [p[0] + h, p[1], p[2]],
        ],
        color,
        lineWidth: e.lineWidth,
        lineStyle: 'plein',
      });
    } else if (e.kind === 'dimension') {
      const geom = buildDimensionGeom(
        e.style,
        e.lineAnchor,
        e.direction,
        e.defPoints,
        {
          labelPositions: e.labelPositions,
          labelRotations: e.labelRotations,
        },
      );
      for (const s of geom.strokes) {
        strokes.push({
          points: s.points,
          color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
    }
  }

  private previewOneRotate(cur: Vec3): void {
    if (!this.p0 || !this.oneTargetId) {
      this.viewport.setPreviewStrokes(null);
      return;
    }
    const previewColor = '#ffb74d';
    // step 2 : pivot posé, référence suit la souris
    if (this.step === 2) {
      this.viewport.setPreview([this.p0, cur], {
        color: previewColor,
        lineWidth: 1,
        lineStyle: 'pointille',
      });
      return;
    }
    // step 3 : pivot + ref + angle courant
    if (this.step === 3 && this.p1) {
      const a0 = Math.atan2(this.p1[1] - this.p0[1], this.p1[0] - this.p0[0]);
      const a1 = Math.atan2(cur[1] - this.p0[1], cur[0] - this.p0[0]);
      let ang = a1 - a0;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;

      const e = this.getOneTargetEntity();
      const strokes: {
        points: Vec3[];
        color: string;
        lineWidth: number;
        lineStyle: import('./types').LineStyleId;
      }[] = [];

      // Bras de référence + bras courant
      strokes.push({
        points: [this.p0, this.p1],
        color: previewColor,
        lineWidth: 1,
        lineStyle: 'pointille',
      });
      strokes.push({
        points: [this.p0, cur],
        color: previewColor,
        lineWidth: 1,
        lineStyle: 'plein',
      });

      if (e) {
        const rotated = rotateEntityAround(e, this.p0, ang);
        this.pushEntityPreviewStrokes(rotated, previewColor, strokes);
        if (e.kind === 'dimension' && e.labelId) {
          const txt = this.doc.entities.find((x) => x.id === e.labelId);
          if (txt && txt.kind === 'text') {
            this.pushEntityPreviewStrokes(
              rotateEntityAround(txt, this.p0, ang),
              previewColor,
              strokes,
            );
          }
        }
      }
      this.viewport.setPreviewStrokes(strokes);
      return;
    }
    this.viewport.setPreviewStrokes(null);
  }

  /**
   * STRETCH : step0 coin1 · step1 coin2 · step2 base · step3 dest
   */
  private onStretchPoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback('STRETCH — 2ᵉ coin du cadre…', 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0) return;
      this.stretchBox = normalizeAabb(this.p0, pt);
      this.viewport.setSelectRect(null, null);
      this.p0 = null;
      this.p1 = null;
      this.step = 2;
      this.feedback(
        'STRETCH — point de base du déplacement… (puis destination)',
        'ok',
      );
      return;
    }
    if (this.step === 2) {
      this.p0 = pt;
      this.step = 3;
      this.feedback('STRETCH — point de destination…', 'ok');
      return;
    }
    if (this.step === 3) {
      if (!this.p0 || !this.stretchBox) {
        this.resetState();
        return;
      }
      const dx = pt[0] - this.p0[0];
      const dy = pt[1] - this.p0[1];
      if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
        this.feedback('Déplacement nul — recliquez la destination.', 'warn');
        return;
      }
      const n = this.doc.stretchByBox(this.stretchBox, dx, dy, 0);
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      this.feedback(
        n > 0
          ? `STRETCH — ${n} élément(s) modifié(s) Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)})`
          : 'STRETCH — aucune extrémité / objet entier dans le cadre.',
        n > 0 ? 'ok' : 'warn',
      );
      this.resetState();
    }
  }

  private onRejoinPoint(pt: Vec3, source: 'click' | 'snap' | 'right' = 'click'): void {
    // Phase Y/N : Gauche = Oui, Droit = Non (cycle)
    if (this.step === 2) {
      if (source === 'right') {
        this.cycleJonctionSolution();
        return;
      }
      // clic gauche (ou snap si jamais) = valider
      this.acceptJonctionSolution();
      return;
    }

    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback('JONCTION — 2ᵉ coin du cadre…', 'ok');
      return;
    }
    if (!this.p0) return;
    const box = normalizeAabb(this.p0, pt);
    this.viewport.setSelectRect(null, null);

    // Snapshot avant toute modification (Échap = restore)
    this.rejoinPreEntities = this.doc.entities.map((e) =>
      structuredClone(e),
    ) as Entity[];

    // 1ʳᵉ stratégie (préférence mémorisée si signature connue — on applique
    // d’abord first-hit pour obtenir la signature, puis on réordonne)
    const first = this.doc.rejoinWallsInBox(box, undefined, 'first-hit');
    this.rejoinSnappedEntities = first.snappedEntities.map((e) =>
      structuredClone(e),
    ) as Entity[];
    this.rejoinSignature = first.signature;
    this.rejoinClusters = first.clusters;
    this.rejoinStrategies = orderedJonctionStrategies(first.signature);
    this.rejoinStrategyIndex = 0;

    // Si la préférence n’est pas first-hit, réappliquer
    const preferred = this.rejoinStrategies[0]!;
    if (preferred !== 'first-hit') {
      this.doc.replaceAllEntities(this.rejoinSnappedEntities, {
        rejoin: true,
        strategy: preferred,
      });
    }

    const wallsInBox = this.doc.walls.filter((w) => {
      const inB = (p: [number, number, number]) =>
        p[0] >= Math.min(box.minX, box.maxX) &&
        p[0] <= Math.max(box.minX, box.maxX) &&
        p[1] >= Math.min(box.minY, box.maxY) &&
        p[1] <= Math.max(box.minY, box.maxY);
      return (
        inB(w.start as [number, number, number]) ||
        inB(w.end as [number, number, number])
      );
    });
    this.rejoinWallsInBoxCount = wallsInBox.length;

    // L pur (degré ≤ 2) : valider tout de suite, pas de cycle
    if (first.maxNodeDegree < 3) {
      const sid = preferred;
      if (first.clusters > 0) {
        this.feedback(
          `JONCTION ${APP_VERSION} — ${first.clusters} nœud(s) L, ${first.wallsTouched} mur(s) snappé(s), ${wallsInBox.length} mur(s) — ${JONCTION_STRATEGY_LABELS[sid]}.`,
          'ok',
        );
      } else {
        const near =
          first.nearestEndDist != null && Number.isFinite(first.nearestEndDist)
            ? ` Plus proches extrémités : ${(first.nearestEndDist * 100).toFixed(0)} cm (tol. 65 cm — rapprochez les bouts ou /join).`
            : ' Englober les **coins** (tol. 65 cm).';
        this.feedback(
          `JONCTION ${APP_VERSION} — aucun snap (${wallsInBox.length} mur(s) dans le cadre).${near}`,
          'info',
        );
      }
      this.resetState();
      return;
    }

    // T/Y : mode interactif Y/N
    this.step = 2;
    this.viewport.setPickHandler(
      (p, src) => this.onRejoinPoint(p, src),
      { rightClickAsPick: true },
    );
    this.announceJonctionSolution();
  }

  private announceJonctionSolution(): void {
    const n = this.rejoinStrategies.length;
    const i = this.rejoinStrategyIndex;
    const sid = this.rejoinStrategies[i]!;
    const label = JONCTION_STRATEGY_LABELS[sid];
    this.feedback(
      `JONCTION — Solution ${i + 1}/${n} « ${label} » — garder ?  Clic GAUCHE = Oui · Clic DROIT = Non  ·  Échap = annuler`,
      'info',
    );
  }

  private cycleJonctionSolution(): void {
    if (!this.rejoinSnappedEntities || this.rejoinStrategies.length === 0) {
      this.resetState();
      return;
    }
    this.rejoinStrategyIndex =
      (this.rejoinStrategyIndex + 1) % this.rejoinStrategies.length;
    const sid = this.rejoinStrategies[this.rejoinStrategyIndex]!;
    this.doc.replaceAllEntities(this.rejoinSnappedEntities, {
      rejoin: true,
      strategy: sid,
    });
    this.announceJonctionSolution();
  }

  private acceptJonctionSolution(): void {
    const sid =
      this.rejoinStrategies[this.rejoinStrategyIndex] ?? 'first-hit';
    if (this.rejoinSignature) {
      saveJonctionPref(this.rejoinSignature, sid);
    }
    this.feedback(
      `JONCTION ${APP_VERSION} — solution « ${JONCTION_STRATEGY_LABELS[sid]} » validée` +
        (this.rejoinClusters > 0
          ? ` (${this.rejoinClusters} nœud(s), ${this.rejoinWallsInBoxCount} mur(s)).`
          : '.'),
      'ok',
    );
    this.rejoinPreEntities = null;
    this.resetState();
  }

  private previewStretchTool(cur: Vec3): void {
    // Cadre en cours
    if (this.step === 1 && this.p0) {
      this.viewport.setSelectRect(this.p0, cur, 'add');
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
      return;
    }
    this.viewport.setSelectRect(null, null);

    // Fantôme du stretch : base → souris
    if (this.step === 3 && this.p0 && this.stretchBox) {
      const dx = cur[0] - this.p0[0];
      const dy = cur[1] - this.p0[1];
      const previewed = previewStretch(this.doc.entities, this.stretchBox, dx, dy, 0);
      const strokes: {
        points: Vec3[];
        color: string;
        lineWidth: number;
        lineStyle: import('./types').LineStyleId;
      }[] = [];
      const color = '#4fc3f7';
      for (const e of previewed) {
        if (e.kind === 'line') {
          strokes.push({
            points: [e.start, e.end],
            color,
            lineWidth: e.lineWidth,
            lineStyle: e.lineStyle,
          });
        } else if (e.kind === 'arc') {
          strokes.push({
            points: sampleArc(e, 32),
            color,
            lineWidth: e.lineWidth,
            lineStyle: e.lineStyle,
          });
        } else if (e.kind === 'circle') {
          strokes.push({
            points: sampleCircle(e, 32),
            color,
            lineWidth: e.lineWidth,
            lineStyle: e.lineStyle,
          });
        } else if (e.kind === 'polyline') {
          for (const s of polylineStrokes(e, 16)) {
            strokes.push({
              points: s.points,
              color,
              lineWidth: s.lineWidth,
              lineStyle: s.lineStyle,
            });
          }
        } else if (e.kind === 'wall') {
          for (const s of wallEntityStrokes(e, 16)) {
            strokes.push({
              points: s.points,
              color,
              lineWidth: s.lineWidth,
              lineStyle: s.lineStyle,
            });
          }
        } else if (e.kind === 'point') {
          const h = 0.05;
          const p = e.position;
          strokes.push({
            points: [
              [p[0] - h, p[1], p[2]],
              [p[0] + h, p[1], p[2]],
            ],
            color,
            lineWidth: e.lineWidth,
            lineStyle: 'plein',
          });
        }
      }
      // Vecteur base → souris
      strokes.push({
        points: [this.p0, cur],
        color: '#ffb74d',
        lineWidth: 1,
        lineStyle: 'pointille',
      });
      this.viewport.setPreviewStrokes(strokes);
      return;
    }

    if (this.step === 2) {
      this.viewport.setPreview(null);
      this.viewport.setPreviewStrokes(null);
    }
  }

  private async onObjOrigin(pt: Vec3, extract: boolean): Promise<void> {
    if (!this.selection) return;
    const selected = this.selection.selectedEntities(this.doc.entities);
    if (selected.length === 0) {
      this.feedback('Sélection vide.', 'err');
      this.resetState();
      return;
    }

    const entities = extractAtOrigin(selected, pt);
    const suggested = extract ? 'extrait' : 'objet';

    if (extract) {
      const name =
        window.prompt('Nom du fichier extrait :', suggested) ?? '';
      if (!name.trim()) {
        this.feedback('Extraction annulée.', 'warn');
        this.resetState();
        return;
      }
      const doc = buildObjectDocument(entities, name.trim());
      const res = await saveExtractDialog(doc, name.trim());
      if (!res.ok) {
        this.feedback('Extraction annulée.', 'warn');
      } else if (res.method === 'picker') {
        this.feedback(`Extrait enregistré : ${res.name}`, 'ok');
      } else {
        this.feedback(
          `Extrait téléchargé : ${res.name} (choisissez l’emplacement dans le navigateur)`,
          'ok',
        );
      }
      this.resetState();
      return;
    }

    // /obj → library
    let tab = 'sanitaire';
    let name = suggested;
    if (this.objSavePrompt) {
      const choice = await this.objSavePrompt(suggested);
      if (!choice) {
        this.feedback('Objet annulé.', 'warn');
        this.resetState();
        return;
      }
      tab = choice.tab;
      name = choice.name;
    } else {
      const t = window.prompt(
        'Onglet library (sanitaire, electrique, salon, chambre, …) :',
        tab,
      );
      if (!t?.trim()) {
        this.feedback('Objet annulé.', 'warn');
        this.resetState();
        return;
      }
      tab = t.trim();
      const n = window.prompt('Nom de l’objet :', name);
      if (!n?.trim()) {
        this.feedback('Objet annulé.', 'warn');
        this.resetState();
        return;
      }
      name = n.trim();
    }

    const doc = buildObjectDocument(entities, name);
    const res = await saveLibraryObject(tab, name, doc);
    if (!res.ok) {
      this.feedback(`Échec enregistrement library : ${res.error ?? '?'}`, 'err');
    } else {
      objectDefCache.set(tab, name, doc);
      this.feedback(
        `Objet « ${name} » → library/${tab}/${name}.gkd`,
        'ok',
      );
    }
    this.resetState();
  }

  private onWallLinePoint(pt: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback('Mur courant invalide — /murs', 'err');
      this.cancel(false);
      return;
    }
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `MUR LIGNE — départ (${fmt(pt)}). Arrivée… [Shift]=H/45°/V  [ALT]=${this.wallFlip ? 'flip' : 'normal'}`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const end = this.applyLineConstraint(this.p0, pt);
    if (isDegenerateLine(this.p0, end)) {
      this.feedback('Segment trop court.', 'warn');
      return;
    }
    const wall = createLinearWallEntity(this.p0, end, style, this.wallFlip);
    this.doc.addEntity(wall);
    this.feedback(
      `Mur « ${style.name} » posé (${style.lines.length} traits) — suite (Échap pour finir)`,
      'ok',
    );
    this.p0 = end;
    this.step = 1;
    this.viewport.setPreviewStrokes(null);
  }

  /**
   * Si Shift enfoncé : projette le point sur le plus proche axe
   * horizontal / vertical / 45° (distance conservée).
   */
  private applyLineConstraint(origin: Vec3, target: Vec3): Vec3 {
    if (!this.shiftDown) return target;
    return constrainAxis45(origin, target);
  }

  private onWallArcPoint(pt: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback('Mur courant invalide — /murs', 'err');
      this.cancel(false);
      return;
    }
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`MUR ARC — départ (${fmt(pt)}). Passage…`, 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`MUR ARC — passage (${fmt(pt)}). Fin… [ALT] bascule`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (colinéaire ?).', 'err');
        return;
      }
      const wall = createArcWallEntity(
        arc.center,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        style,
        this.wallFlip,
      );
      this.doc.addEntity(wall);
      this.feedback(
        `Mur arc « ${style.name} » posé — nouveau départ, ou Échap.`,
        'ok',
      );
      this.p0 = null;
      this.p1 = null;
      this.step = 0;
      this.viewport.setPreviewStrokes(null);
    }
  }

  private onCutPoint(pt: Vec3): void {
    // Rayon = snap courant (px écran) — indépendant du snap on/off
    const maxDist = this.viewport.snapToleranceMeters();
    const hit = findNearestCuttable(pt, this.doc.entities, maxDist);
    if (!hit) {
      // Rien dans le rayon : silence total
      return;
    }
    const result = applyCut(hit);
    if (!result) {
      // Coupure dégénérée (extrémité, etc.) : silence
      return;
    }
    this.doc.replaceEntity(result.removedId, result.replacements);
    if (result.kind === 'line') {
      this.feedback('Ligne coupée → 2 segments.', 'ok');
    } else if (result.kind === 'arc') {
      this.feedback('Arc coupé → 2 arcs.', 'ok');
    } else {
      this.feedback(
        'Cercle ouvert au point de coupe (arc plein) — recliquer pour scinder.',
        'ok',
      );
    }
  }

  private findNearestPolyline(
    pt: Vec3,
    maxDist: number,
  ): PolylineEntity | null {
    let best: PolylineEntity | null = null;
    let bestD = Infinity;
    for (const e of this.doc.entities) {
      if (e.kind !== 'polyline') continue;
      const near = closestOnPolyline(e, pt);
      if (!near || near.dist > maxDist) continue;
      if (near.dist < bestD) {
        bestD = near.dist;
        best = e;
      }
    }
    return best;
  }

  private async onFillPoint(pt: Vec3): Promise<void> {
    const maxDist = this.viewport.snapToleranceMeters();
    const px = this.viewport.snapRadiusPx();
    const best = this.findNearestPolyline(pt, maxDist);
    if (!best) {
      this.feedback(`Aucune polyligne dans ${px} px.`, 'warn');
      return;
    }
    await this.fillPolyline(best);
  }

  private onDelHatchPoint(pt: Vec3): void {
    const maxDist = this.viewport.snapToleranceMeters();
    const px = this.viewport.snapRadiusPx();
    const best = this.findNearestPolyline(pt, maxDist);
    if (!best) {
      this.feedback(`Aucune polyligne dans ${px} px.`, 'warn');
      return;
    }
    if (!best.hatch) {
      // Rien à faire (polyligne sans hachure)
      return;
    }
    const next = clearHatchFromPolyline(best);
    this.doc.replaceEntity(best.id, [next]);
    this.feedback('Hachurage retiré.', 'ok');
    // Reste actif pour enchaîner d’autres polylignes
  }

  private onExtendPoint(pt: Vec3): void {
    const maxDist = this.viewport.snapToleranceMeters();
    const px = this.viewport.snapRadiusPx();

    // Étape 1 — objet à allonger
    if (!this.extendSource) {
      const hit = findNearestExtendable(pt, this.doc.entities, maxDist);
      if (!hit) {
        this.feedback(
          `Aucun objet prolongeable dans ${px} px (ligne, arc, bout de polyligne ouverte).`,
          'warn',
        );
        return;
      }
      // Polyligne fermée déjà filtrée ; double check
      if (hit.entity.kind === 'polyline') {
        const s = hit.entity.segments;
        if (s.length === 0) {
          this.feedback('Polyligne vide.', 'warn');
          return;
        }
      }
      this.extendSource = hit;
      this.designation?.set([hit.entity.id]);
      const kind =
        hit.entity.kind === 'line'
          ? 'ligne'
          : hit.entity.kind === 'arc'
            ? 'arc'
            : 'polyligne';
      this.feedback(
        `EXTEND — ${kind} (${hit.end === 'start' ? 'début' : 'fin'}) : cliquez la limite (ligne / arc / cercle)…`,
        'ok',
      );
      return;
    }

    // Étape 2 — limite
    const src = this.extendSource;
    // Recharger l’entité depuis le doc (peut avoir bougé)
    const live = this.doc.entities.find((e) => e.id === src.entity.id);
    if (
      !live ||
      (live.kind !== 'line' && live.kind !== 'arc' && live.kind !== 'polyline')
    ) {
      this.extendSource = null;
      this.designation?.clear();
      this.feedback('Objet source disparu — redésignez l’objet à allonger.', 'warn');
      return;
    }
    const sourceHit: ExtendSourceHit = {
      entity: live,
      end: src.end,
      point: src.point,
      dist: src.dist,
    };

    const bound = findNearestBoundary(
      pt,
      this.doc.entities,
      maxDist,
      live.id,
    );
    if (!bound) {
      this.feedback(
        `Aucune limite dans ${px} px (ligne / arc / cercle).`,
        'warn',
      );
      return;
    }

    const result = applyExtend(sourceHit, bound.entity);
    if (!result) {
      this.feedback(
        'Pas d’intersection dans le sens d’allongement (parallèle ou déjà au contact).',
        'warn',
      );
      // garder la source pour retenter une autre limite
      return;
    }

    this.doc.replaceEntity(live.id, [result.entity]);
    this.designation?.clear();
    this.extendSource = null;
    this.feedback(
      `Allongé de ${result.lengthened.toFixed(3)} m → recliquer un objet à allonger, ou Échap.`,
      'ok',
    );
  }

  private onHelperAxisPoint(pt: Vec3): void {
    if (!this.helperAxis) return;
    this.placeHelperAxis(this.helperAxis, pt);
  }

  /** /d · Ctrl+D — efface l’entité la plus proche, reste actif jusqu’à Échap. */
  private onDeletePickPoint(pt: Vec3): void {
    const maxDist = this.viewport.snapToleranceMeters();
    const hit = findNearestEntity(pt, this.doc.entities, maxDist);
    if (!hit) {
      const px = this.viewport.snapRadiusPx();
      this.feedback(
        `Aucun élément dans ${px} px — cliquez plus près (ligne, arc, cercle, mur, aide, objet).`,
        'warn',
      );
      return;
    }
    const id = hit.entity.id;
    const kind = hit.entity.kind;
    const ok = this.doc.removeEntity(id);
    if (!ok) {
      this.feedback('Échec de la suppression.', 'err');
      return;
    }
    // Retirer de la sélection s’il y était (sans toucher au reste)
    if (this.selection?.has(id)) {
      this.selection.remove([id]);
    }
    const label =
      kind === 'line'
        ? 'ligne'
        : kind === 'arc'
          ? 'arc'
          : kind === 'circle'
            ? 'cercle'
            : kind === 'polyline'
              ? 'polyligne'
              : kind === 'point'
                ? 'point'
                : kind === 'wall'
                  ? 'mur'
                  : kind === 'helper'
                    ? 'aide'
                    : kind === 'object'
                      ? 'objet'
                      : kind;
    this.feedback(
      `Effacé : ${label} — désignez un autre élément, ou Échap pour terminer.`,
      'ok',
    );
  }

  private onPlinePoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `PLINE — départ (${fmt(pt)}). Arrivée…  [Shift]=H/45°/V  ·  /parc /parct · Échap = fin`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const end = this.applyLineConstraint(this.p0, pt);
    if (isDegenerateLine(this.p0, end)) {
      this.feedback('Segment trop court — choisissez un autre point.', 'warn');
      return;
    }
    this.commitPolyLineSeg(this.p0, end);
    this.p0 = end;
    this.step = 1;
    this.viewport.setPreview(null);
    void this.maybePromptPolylineClosed();
  }

  private onParcPoint(pt: Vec3): void {
    // Arc 3 pts : step 0 = départ, 1 = passage, 2 = fin
    // Si bascule avec tip : p0 déjà posé, step = 1
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `PARC — départ (${fmt(pt)}). Passage…  /pline /parct · Échap = fin`,
        'ok',
      );
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(
        `PARC — passage (${fmt(pt)}). Fin…  /pline /parct · Échap = fin`,
        'ok',
      );
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (points colinéaires ?).', 'err');
        return;
      }
      this.commitPolyArcSeg(arc);
      // Suite : tip = fin d’arc, prochain = passage (même mode parc)
      this.p0 = arcEndPoint(arc);
      this.p1 = null;
      this.step = 1;
      this.viewport.setPreview(null);
      this.feedback(
        `PARC — arc r=${arc.radius.toFixed(3)} m. Passage suivant…  /pline /parct · Échap = fin`,
        'ok',
      );
      void this.maybePromptPolylineClosed();
    }
  }

  private onParctPoint(pt: Vec3): void {
    // Mode G1 : un seul clic = fin
    if (this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(
        this.contPoint,
        this.contTangent,
        pt,
        this.pen.strokeFields(),
      );
      if (!arc) {
        this.feedback(
          'Position impossible pour un arc lisse — déplacez la souris.',
          'warn',
        );
        return;
      }
      this.commitPolyArcSeg(arc);
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      this.p0 = this.contPoint;
      this.p1 = null;
      this.step = 0;
      this.viewport.setPreview(null);
      const spanDeg = ((arc.endAngle - arc.startAngle) * 180) / Math.PI;
      this.feedback(
        `PARCT — arc tangent r=${arc.radius.toFixed(3)} m, ${spanDeg.toFixed(1)}° — suite… Échap = fin`,
        'ok',
      );
      void this.maybePromptPolylineClosed();
      return;
    }

    // 1er arc = 3 points (comme /parc)
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `PARCT — départ (${fmt(pt)}). Passage…  ·  Échap = fin`,
        'ok',
      );
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`PARCT — passage (${fmt(pt)}). Fin…`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (points colinéaires ?).', 'err');
        return;
      }
      this.commitPolyArcSeg(arc);
      // Passe en mode G1 pour la suite
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      this.p0 = this.contPoint;
      this.p1 = null;
      this.step = 0;
      this.viewport.setPreview(null);
      this.feedback(
        `PARCT — 1er arc r=${arc.radius.toFixed(3)} m — suite en tangente (1 clic). Échap = fin`,
        'ok',
      );
      void this.maybePromptPolylineClosed();
    }
  }

  private commitPolyLineSeg(start: Vec3, end: Vec3): void {
    const stroke = this.pen.strokeFields();
    const seg = lineSegFromPoints(start, end, stroke);
    this.appendToPolyline(seg);
    this.feedback(
      `PLINE + ligne  [${this.pen.resolved.colorLabel}, ${this.pen.resolved.widthLabel}, ${this.pen.resolved.styleLabel}] — suite · /parc /parct · Échap = fin`,
      'ok',
    );
  }

  private commitPolyArcSeg(arc: ArcEntity): void {
    const seg = arcSegFromArc(arc);
    this.appendToPolyline(seg);
  }

  private appendToPolyline(
    seg: import('./types').PolylineSegment,
  ): void {
    let poly = this.getActivePolyline();
    if (!poly) {
      poly = createEmptyPolyline();
      poly = appendSegment(poly, seg);
      this.doc.addEntity(poly);
      this.polyId = poly.id;
      return;
    }
    const updated = appendSegment(poly, seg);
    this.doc.replaceEntity(poly.id, [updated]);
    this.polyId = updated.id;
  }

  // ── Points polymur ────────────────────────────────────────────────────────

  private onPmurPoint(pt: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback('Mur courant invalide — /murs', 'err');
      this.cancel(false);
      return;
    }
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `PMUR — départ (${fmt(pt)}). Arrivée…  [Shift] [ALT]  ·  /pmarc /pmarct  ·  Échap`,
        'ok',
      );
      return;
    }
    if (!this.p0) return;
    const end = this.applyLineConstraint(this.p0, pt);
    if (isDegenerateLine(this.p0, end)) {
      this.feedback('Segment trop court.', 'warn');
      return;
    }
    this.appendToPolyWall(wallSegLineFrom(this.p0, end), style);
    this.feedback(
      `PMUR + mur ligne « ${style.name} » — suite · /pmarc /pmarct · Échap = fin`,
      'ok',
    );
    this.p0 = end;
    this.step = 1;
    this.viewport.setPreviewStrokes(null);
    void this.maybePromptPolyWallClosed();
  }

  private onPmarcPoint(pt: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback('Mur courant invalide — /murs', 'err');
      this.cancel(false);
      return;
    }
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`PMARC — départ (${fmt(pt)}). Passage…`, 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`PMARC — passage (${fmt(pt)}). Fin…  [ALT]`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (colinéaire ?).', 'err');
        return;
      }
      this.appendToPolyWall(wallSegFromArcEntity(arc), style);
      this.p0 = arcEndPoint(arc);
      this.p1 = null;
      this.step = 1;
      this.viewport.setPreviewStrokes(null);
      this.feedback(
        `PMARC — mur arc r=${arc.radius.toFixed(3)} m. Passage suivant… · Échap`,
        'ok',
      );
      void this.maybePromptPolyWallClosed();
    }
  }

  private onPmarctPoint(pt: Vec3): void {
    const style = this.walls?.currentDrawable;
    if (!style) {
      this.feedback('Mur courant invalide — /murs', 'err');
      this.cancel(false);
      return;
    }

    if (this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(
        this.contPoint,
        this.contTangent,
        pt,
        this.pen.strokeFields(),
      );
      if (!arc) {
        this.feedback(
          'Position impossible pour un arc lisse — déplacez la souris.',
          'warn',
        );
        return;
      }
      this.appendToPolyWall(wallSegFromArcEntity(arc), style);
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      this.p0 = this.contPoint;
      this.p1 = null;
      this.step = 0;
      this.viewport.setPreviewStrokes(null);
      this.feedback(
        `PMARCT — mur arc tangent r=${arc.radius.toFixed(3)} m — suite… Échap`,
        'ok',
      );
      void this.maybePromptPolyWallClosed();
      return;
    }

    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`PMARCT — départ (${fmt(pt)}). Passage…`, 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`PMARCT — passage (${fmt(pt)}). Fin…`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (colinéaire ?).', 'err');
        return;
      }
      this.appendToPolyWall(wallSegFromArcEntity(arc), style);
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      this.p0 = this.contPoint;
      this.p1 = null;
      this.step = 0;
      this.viewport.setPreviewStrokes(null);
      this.feedback(
        `PMARCT — 1er mur arc r=${arc.radius.toFixed(3)} m — suite en tangente. Échap`,
        'ok',
      );
      void this.maybePromptPolyWallClosed();
    }
  }

  private appendToPolyWall(
    seg: import('./types').WallSegment,
    style: import('./types').WallStyle,
  ): void {
    let wall = this.getActivePolyWall();
    if (!wall) {
      wall = createEmptyPolyWall(style, this.wallFlip);
      wall = appendWallSegment(wall, seg);
      this.doc.addEntity(wall);
      this.pwallId = wall.id;
      return;
    }
    // flip / style snapshot : garder flip courant
    const base = { ...wall, flip: this.wallFlip };
    const updated = appendWallSegment(base, seg);
    this.doc.replaceEntity(wall.id, [updated]);
    this.pwallId = updated.id;
  }

  private async maybePromptPolyWallClosed(): Promise<void> {
    if (!this.isPolyWallTool()) return;
    const wall = this.getActivePolyWall();
    if (!wall || !wall.segments || wall.segments.length < 2) return;
    if (wall.closed) return;

    const start = polyWallStart(wall);
    const end = polyWallEnd(wall);
    if (!start || !end) return;
    if (dist(start, end) > POLY_CLOSE_TOL) return;

    this.doc.replaceEntity(wall.id, [{ ...wall, closed: true }]);

    const choice = await showConfirm({
      title: 'Polymur fermé',
      message:
        'Polymur fermé. Arrêter la commande ou continuer à dessiner le polymur ?',
      buttons: [
        { id: 'stop', label: 'Arrêter', primary: true },
        { id: 'continue', label: 'Continuer' },
      ],
    });

    if (!this.isPolyWallTool() || this.pwallId !== wall.id) return;

    if (choice === 'stop') {
      this.finishPolyWall();
      return;
    }
    this.feedback(
      'Polymur fermé — vous pouvez continuer, ou Échap pour terminer.',
      'info',
    );
  }

  /**
   * Si le dernier point coïncide avec le premier : polyligne fermée.
   * Dialogue Arrêter / Continuer (une seule fois, au moment de la fermeture).
   */
  private async maybePromptPolylineClosed(): Promise<void> {
    if (!this.isPolyTool()) return;
    const poly = this.getActivePolyline();
    if (!poly || poly.segments.length < 2) return;
    // Déjà fermée (utilisateur a choisi Continuer) → ne pas re-demander
    if (poly.closed) return;

    const start = polylineStart(poly);
    const end = polylineEnd(poly);
    if (!start || !end) return;
    if (dist(start, end) > POLY_CLOSE_TOL) return;

    // Marquer fermée avant le dialogue
    this.doc.replaceEntity(poly.id, [{ ...poly, closed: true }]);

    const choice = await showConfirm({
      title: 'Polyligne fermée',
      message:
        'Polyligne fermée. Arrêter la commande ou continuer à dessiner la polyligne ?',
      buttons: [
        { id: 'stop', label: 'Arrêter', primary: true },
        { id: 'continue', label: 'Continuer' },
      ],
    });

    // Outil peut avoir été annulé pendant le dialogue
    if (!this.isPolyTool() || this.polyId !== poly.id) return;

    if (choice === 'stop') {
      this.finishPolyline();
      return;
    }
    // Continuer (ou fermeture du dialogue / Échap) : reste en mode dessin
    this.feedback(
      'Polyligne fermée — vous pouvez continuer à dessiner, ou Échap pour terminer.',
      'info',
    );
  }

  private onPointPlace(pt: Vec3): void {
    const r = this.pen.resolved;
    const ent = createPointEntity(pt, {
      color: r.color,
      lineWidth: r.lineWidth,
    });
    this.doc.addEntity(ent);
    this.feedback(
      `Point @ (${fmt(pt)})  [${r.colorLabel}, ${r.lineWidth}×${r.lineWidth} px] — recliquer, Échap = fin`,
      'ok',
    );
  }

  private onLinePoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(
        `LIGNE — départ (${fmt(pt)}). Arrivée…  [Shift]=H/45°/V  ·  Échap termine`,
        'ok',
      );
      return;
    }

    if (!this.p0) return;
    const end = this.applyLineConstraint(this.p0, pt);
    if (isDegenerateLine(this.p0, end)) {
      this.feedback('Segment trop court — choisissez un autre point.', 'warn');
      return;
    }

    const line = createLineEntity(this.p0, end, this.pen.strokeFields());
    this.doc.addEntity(line);
    this.feedback(
      `Ligne ${fmt(this.p0)} → ${fmt(end)}  [${this.pen.resolved.colorLabel}, ${this.pen.resolved.widthLabel}, ${this.pen.resolved.styleLabel}] — suite (Échap pour finir)`,
      'ok',
    );
    this.p0 = end;
    this.step = 1;
    this.viewport.setPreview(null);
  }

  private onArccPoint(pt: Vec3): void {
    // 0 centre · 1 rayon · 2 départ arc · 3 fin arc
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`ARCC — centre (${fmt(pt)}). Point pour le rayon…`, 'ok');
      return;
    }

    if (this.step === 1) {
      if (!this.p0 || isDegenerateRadius(this.p0, pt)) {
        this.feedback('Rayon nul — éloignez-vous du centre.', 'warn');
        return;
      }
      this.radius = Math.hypot(pt[0] - this.p0[0], pt[1] - this.p0[1]);
      this.step = 2;
      this.feedback(
        `ARCC — r=${this.radius.toFixed(3)} m. Échap = cercle · ou clic = début d’arc…`,
        'ok',
      );
      return;
    }

    if (this.step === 2) {
      if (!this.p0) return;
      // Point de départ : projeté sur le cercle
      this.p1 = projectOnCircle(this.p0, this.radius, pt);
      this.step = 3;
      this.feedback(
        `ARCC — départ d’arc (${fmt(this.p1)}). Point d’arrivée (arc suit la souris)…`,
        'ok',
      );
      return;
    }

    if (this.step === 3) {
      if (!this.p0 || !this.p1) return;
      const endOn = projectOnCircle(this.p0, this.radius, pt);
      const arc = arcFromCenterStartEnd(this.p0, this.p1, endOn, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide.', 'err');
        return;
      }
      this.doc.addEntity(arc);
      const spanDeg = ((arc.endAngle - arc.startAngle) * 180) / Math.PI;
      this.feedback(
        `Arc r=${arc.radius.toFixed(3)} m, balayage ${spanDeg.toFixed(1)}° — centre suivant, ou Échap.`,
        'ok',
      );
      // Enchaîne un nouvel arcc
      this.p0 = null;
      this.p1 = null;
      this.radius = 0;
      this.step = 0;
      this.viewport.setPreview(null);
    }
  }

  private onArc3Point(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`ARC — départ (${fmt(pt)}). Point de passage…`, 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Point de passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`ARC — passage (${fmt(pt)}). Point de fin (arc suit la souris)…`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (points colinéaires ?).', 'err');
        return;
      }
      this.commitArcAndMaybeContinue(arc, false);
    }
  }

  private onArcContPoint(pt: Vec3): void {
    // Après 1er arc : un seul point = fin du prochain arc G1
    if (this.contPoint && this.contTangent) {
      const arc = arcFromTangentContinue(
        this.contPoint,
        this.contTangent,
        pt,
        this.pen.strokeFields(),
      );
      if (!arc) {
        this.feedback(
          'Position impossible pour un arc lisse — déplacez la souris (preview disparaît si invalide).',
          'warn',
        );
        return;
      }
      this.doc.addEntity(arc);
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      const spanDeg = ((arc.endAngle - arc.startAngle) * 180) / Math.PI;
      this.feedback(
        `Arc cont. r=${arc.radius.toFixed(3)} m, ${spanDeg.toFixed(1)}° — point suivant (Échap termine).`,
        'ok',
      );
      this.viewport.setPreview(null);
      return;
    }

    // 1er arc : 3 points
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`ARCCONT — départ (${fmt(pt)}). Point de passage…`, 'ok');
      return;
    }
    if (this.step === 1) {
      if (!this.p0 || isDegenerateLine(this.p0, pt)) {
        this.feedback('Point de passage trop proche du départ.', 'warn');
        return;
      }
      this.p1 = pt;
      this.step = 2;
      this.feedback(`ARCCONT — passage (${fmt(pt)}). Point de fin…`, 'ok');
      return;
    }
    if (this.step === 2) {
      if (!this.p0 || !this.p1) return;
      const arc = arcFrom3Points(this.p0, this.p1, pt, this.pen.strokeFields());
      if (!arc) {
        this.feedback('Arc invalide (points colinéaires ?).', 'err');
        return;
      }
      this.commitArcAndMaybeContinue(arc, true);
    }
  }

  private commitArcAndMaybeContinue(arc: ArcEntity, cont: boolean): void {
    this.doc.addEntity(arc);
    const spanDeg = ((arc.endAngle - arc.startAngle) * 180) / Math.PI;
    if (cont) {
      this.contPoint = arcEndPoint(arc);
      this.contTangent = arcEndTangent(arc);
      this.p0 = null;
      this.p1 = null;
      this.step = 0;
      this.feedback(
        `1er arc r=${arc.radius.toFixed(3)} m, ${spanDeg.toFixed(1)}° — suite continue (tangente). Échap termine.`,
        'ok',
      );
    } else {
      this.feedback(
        `Arc r=${arc.radius.toFixed(3)} m, balayage ${spanDeg.toFixed(1)}° — départ suivant, ou Échap.`,
        'ok',
      );
      this.p0 = null;
      this.p1 = null;
      this.step = 0;
    }
    this.viewport.setPreview(null);
  }

  private onCirclePoint(pt: Vec3): void {
    if (this.step === 0) {
      this.p0 = pt;
      this.step = 1;
      this.feedback(`CERCLE — centre (${fmt(pt)}). Point sur le rayon…`, 'ok');
      return;
    }
    if (!this.p0 || isDegenerateRadius(this.p0, pt)) {
      this.feedback('Rayon nul — éloignez-vous du centre.', 'warn');
      return;
    }
    const r = Math.hypot(pt[0] - this.p0[0], pt[1] - this.p0[1]);
    const circle = createCircleEntity(this.p0, r, this.pen.strokeFields());
    this.doc.addEntity(circle);
    this.feedback(
      `Cercle r=${r.toFixed(3)} m — centre suivant, ou Échap pour terminer.`,
      'ok',
    );
    this.p0 = null;
    this.step = 0;
    this.viewport.setPreview(null);
  }

  private bindAltFlip(): void {
    this.unbindAltFlip();
    this.altHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.repeat) return;
      if (
        this.kind !== 'wallline' &&
        this.kind !== 'wallarc' &&
        !this.isPolyWallTool()
      ) {
        return;
      }
      e.preventDefault();
      this.wallFlip = !this.wallFlip;
      // Polymur déjà posé : mettre à jour le flip de l’entité
      const pw = this.getActivePolyWall();
      if (pw) {
        this.doc.replaceEntity(pw.id, [{ ...pw, flip: this.wallFlip }]);
      }
      this.feedback(
        `Mur côté ${this.wallFlip ? 'inversé (flip)' : 'normal'} — [ALT] pour basculer.`,
        'info',
      );
      this.updatePreview();
    };
    window.addEventListener('keydown', this.altHandler);
  }

  private unbindAltFlip(): void {
    if (this.altHandler) {
      window.removeEventListener('keydown', this.altHandler);
      this.altHandler = null;
    }
  }

  /** Suit l’état de la touche ALT (select = désélection). */
  private bindAltTrack(): void {
    this.unbindAltTrack();
    this.altDown = false;
    this.altTrack = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        this.altDown = e.type === 'keydown';
        if (this.kind === 'select') this.updatePreview();
      }
    };
    window.addEventListener('keydown', this.altTrack);
    window.addEventListener('keyup', this.altTrack);
  }

  private unbindAltTrack(): void {
    if (this.altTrack) {
      window.removeEventListener('keydown', this.altTrack);
      window.removeEventListener('keyup', this.altTrack);
      this.altTrack = null;
    }
    this.altDown = false;
  }

  private resetState(): void {
    if (
      this.kind === 'rejoin' &&
      this.step === 2 &&
      this.rejoinPreEntities
    ) {
      this.doc.replaceAllEntities(this.rejoinPreEntities, { rejoin: false });
    }
    this.unbindAltFlip();
    this.unbindAltTrack();
    this.kind = null;
    this.step = 0;
    this.p0 = null;
    this.p1 = null;
    this.radius = 0;
    this.contPoint = null;
    this.contTangent = null;
    this.wallFlip = false;
    this.placeTab = null;
    this.placeName = null;
    this.paralDeltas = null;
    this.paralTarget = null;
    this.paralDesignatePt = null;
    this.copyMode = null;
    this.helperAxis = null;
    this.polyId = null;
    this.pwallId = null;
    this.stretchBox = null;
    this.extendSource = null;
    this.rejoinPreEntities = null;
    this.rejoinSnappedEntities = null;
    this.rejoinStrategies = [];
    this.rejoinStrategyIndex = 0;
    this.rejoinSignature = null;
    this.rejoinWallsInBoxCount = 0;
    this.rejoinClusters = 0;
    this.joinStem = null;
    this.pendingText = '';
    this.textBoxed = false;
    this.coteDefPoints = [];
    this.coteDir = null;
    this.oneTargetId = null;
    this.cotePlacedCount = 0;
    // Fin d’outil → lever la désignation (la sélection reste intacte)
    this.designation?.clear();
    this.viewport.setPickHandler(null);
    this.viewport.setPreview(null);
    this.viewport.setPreviewStrokes(null);
    this.viewport.setPreviewLabels(null);
    this.viewport.setSelectRect(null, null);
  }
}

function shortText(s: string, max = 24): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

const EPS = 1e-9;

/**
 * Verrouille le segment origin→target sur le multiple de 45° le plus proche
 * (horizontal, 45°, vertical, …). Conserve la distance souris.
 */
function constrainAxis45(origin: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) return [target[0], target[1], target[2]];
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4; // 45°
  const snapped = Math.round(ang / step) * step;
  return [
    origin[0] + L * Math.cos(snapped),
    origin[1] + L * Math.sin(snapped),
    origin[2],
  ];
}

function projectOnCircle(center: Vec3, radius: number, pt: Vec3): Vec3 {
  const dx = pt[0] - center[0];
  const dy = pt[1] - center[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) {
    return [center[0] + radius, center[1], center[2]];
  }
  const s = radius / L;
  return [center[0] + dx * s, center[1] + dy * s, center[2]];
}

function fmt(p: Vec3): string {
  return `${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)}`;
}
