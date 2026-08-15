import * as THREE from 'three';
import type { AppPrefsManager } from '../core/appPrefs';
import { DEFAULT_SNAP_RADIUS_PX } from '../core/appPrefs';
import { aabbFromPoints, drawingExtentPoints } from '../core/bounds';
import { defaultCamera } from '../core/gkd';
import { entitiesToSnapCurves, snapAt, type SnapResult } from '../core/snap';
import type {
  CameraState,
  Entity,
  HelperLineEntity,
  LineStyleId,
  Vec3,
  Workplane,
} from '../core/types';
import {
  DEFAULT_GRID_SPACING_METERS,
  DEFAULT_UNIT,
  gridSpacingInWorld,
  nearestGridPoint,
  type UnitId,
} from '../core/units';
import { EntityLayer } from './EntityLayer';
import { HelperLayer } from './HelperLayer';

export type MouseWorld = { x: number; y: number; z: number } | null;

export interface ViewportUi {
  setScale(text: string): void;
  setMouse(text: string): void;
  setView(text: string): void;
  setWorkplane(wp: Workplane): void;
}

export type SnapHandler = (
  snap: SnapResult | null,
  raw: MouseWorld,
  meta: { placedAsLeftClick: boolean },
) => void;
/**
 * Placement de point (outil de tracé).
 * - click : clic gauche brut
 * - snap  : clic droit → accroche (comportement par défaut)
 * - right : clic droit en mode « pick droit » (ex. Non du cycle Y/N /jonction)
 */
export type PickHandler = (
  point: Vec3,
  source: 'click' | 'snap' | 'right',
) => void;

export type PickHandlerOptions = {
  /**
   * Si true : clic droit appelle le handler avec source `'right'`
   * (pas d’accroche). Utile pour Oui/Non.
   */
  rightClickAsPick?: boolean;
};

/**
 * Viewport 3D (Three.js).
 * Convention monde : Z vers le haut, plan de travail XY par défaut (vue en plan ARC+).
 *
 * Souris (style ARC+) :
 * - Bouton gauche drag = pan ; clic court = point brut (sans snap) si outil actif
 * - Bouton milieu drag = pan
 * - Bouton droit = /snap (accroche) ; hors rayon → comme clic gauche
 * - Molette = zoom
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private ortho: THREE.OrthographicCamera;
  private persp: THREE.PerspectiveCamera;
  private mode: 'ortho' | 'persp' = 'ortho';
  private workplane: Workplane = 'XY';
  private target = new THREE.Vector3(0, 0, 0);
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private ui: ViewportUi;
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private helperLayer = new HelperLayer();
  private entityLayer = new EntityLayer();
  private anim = 0;
  private isDragging = false;
  private dragMoved = false;
  private lastClient = { x: 0, y: 0 };
  private mouseWorld: MouseWorld = null;
  private helpers: readonly HelperLineEntity[] = [];
  private entities: readonly Entity[] = [];
  private lastSnap: SnapResult | null = null;
  private onSnap: SnapHandler | null = null;
  private onPick: PickHandler | null = null;
  private pickMode = false;
  /** Clic droit → onPick(..., 'right') au lieu du snap. */
  private pickRightClick = false;
  private appPrefs: AppPrefsManager | null = null;
  /** Unité d'affichage (pour labels + grille). */
  private units: UnitId = DEFAULT_UNIT;
  /** Écart grille en mètres réels. */
  private gridSpacingMeters = DEFAULT_GRID_SPACING_METERS;
  private lastGridKey = '';

  constructor(canvas: HTMLCanvasElement, ui: ViewportUi) {
    this.canvas = canvas;
    this.ui = ui;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f12);

    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200000);
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 200000);
    this.camera = this.ortho;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Grille XY (Z-up) — taille / divisions mises à jour dynamiquement (effet « infini »).
    this.grid = new THREE.GridHelper(20, 20, 0x3a4250, 0x252a33);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1);
    this.scene.add(this.axes);

    this.scene.add(this.helperLayer.group);
    this.scene.add(this.entityLayer.group);

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(amb);

    this.canvas.classList.add('panning');

    this.applyCameraState(defaultCamera());
    this.bindEvents();
    this.resize();
    this.loop();
  }

  setSnapHandler(fn: SnapHandler | null): void {
    this.onSnap = fn;
  }

  setAppPrefs(prefs: AppPrefsManager): void {
    this.appPrefs = prefs;
    this.units = prefs.units;
    this.gridSpacingMeters = prefs.gridSpacingMeters;
    this.rebuildGrid(true);
    prefs.onChange((p) => {
      this.units = p.units;
      this.gridSpacingMeters = p.gridSpacingMeters;
      this.rebuildGrid(true);
      this.refreshUiLabels();
    });
  }

  /** Unité courante (affichage / monde). */
  getUnits(): UnitId {
    return this.units;
  }

  setUnits(unit: UnitId): void {
    this.units = unit;
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /**
   * Active le mode « placement de point » (outil ligne/arc).
   * Clic gauche court → pick brut (sans snap) ; glisser reste pan.
   * @param opts.rightClickAsPick — clic droit = source `'right'` (pas de snap)
   */
  setPickHandler(
    fn: PickHandler | null,
    opts?: PickHandlerOptions,
  ): void {
    this.onPick = fn;
    this.pickMode = fn !== null;
    this.pickRightClick = opts?.rightClickAsPick === true && fn !== null;
    this.canvas.style.cursor = this.pickMode ? 'crosshair' : '';
    if (!this.pickMode) {
      this.pickRightClick = false;
      this.entityLayer.setPreview(null);
    }
  }

  getLastSnap(): SnapResult | null {
    return this.lastSnap;
  }

  /**
   * Masque le marqueur d’accroche orange et oublie le dernier snap.
   * Appelé au lancement d’une commande (ou Échap).
   */
  clearSnap(): void {
    this.lastSnap = null;
    this.helperLayer.showSnap(null);
    this.updateMouseLabel();
  }

  getMouseWorld(): MouseWorld {
    return this.mouseWorld;
  }

  setHelpers(helpers: readonly HelperLineEntity[]): void {
    this.helpers = helpers;
    this.helperLayer.setHelpers(helpers);
    this.refreshHelperClip();
  }

  setEntities(entities: readonly Entity[]): void {
    this.entities = entities;
    this.entityLayer.setEntities(entities);
  }

  setPreview(
    points: Vec3[] | null,
    stroke?: { color: string; lineWidth: number; lineStyle: LineStyleId },
  ): void {
    this.entityLayer.setPreview(points, stroke);
  }

  setPreviewStrokes(
    strokes: {
      points: Vec3[];
      color?: string;
      lineWidth?: number;
      lineStyle?: LineStyleId;
    }[] | null,
  ): void {
    this.entityLayer.setPreviewStrokes(strokes);
  }

  setPreviewLabels(
    labels: import('./EntityLayer').PreviewLabel[] | null,
  ): void {
    this.entityLayer.setPreviewLabels(labels);
  }

  setSelectedIds(ids: ReadonlySet<string> | Iterable<string>): void {
    this.entityLayer.setSelectedIds(ids);
  }

  setDesignatedIds(ids: ReadonlySet<string> | Iterable<string>): void {
    this.entityLayer.setDesignatedIds(ids);
  }

  setSelectRect(
    a: import('../core/types').Vec3 | null,
    b: import('../core/types').Vec3 | null,
    mode: 'add' | 'remove' = 'add',
  ): void {
    this.entityLayer.setSelectRect(a, b, mode);
  }

  getCameraState(): CameraState {
    const cam = this.activeCamera();
    return {
      target: [this.target.x, this.target.y, this.target.z],
      position: [cam.position.x, cam.position.y, cam.position.z],
      up: [cam.up.x, cam.up.y, cam.up.z],
      mode: this.mode,
      orthoHalfHeight: this.ortho.top,
      fov: this.persp.fov,
      workplane: this.workplane,
    };
  }

  applyCameraState(state: CameraState): void {
    this.mode = state.mode;
    this.workplane = state.workplane;
    this.target.set(state.target[0], state.target[1], state.target[2]);

    this.ortho.up.set(state.up[0], state.up[1], state.up[2]);
    this.persp.up.set(state.up[0], state.up[1], state.up[2]);

    this.ortho.position.set(state.position[0], state.position[1], state.position[2]);
    this.persp.position.set(state.position[0], state.position[1], state.position[2]);

    this.ortho.lookAt(this.target);
    this.persp.lookAt(this.target);

    const half = Math.max(0.1, state.orthoHalfHeight);
    this.setOrthoHalfHeight(half);
    this.persp.fov = state.fov;
    this.persp.updateProjectionMatrix();

    this.updateWorkplanePlane();
    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /**
   * /axo — vue axonométrique (isométrique) orthographique.
   * Regard depuis (+X, −Y, +Z) vers la cible, Z-up. Plan de travail XY.
   */
  setAxonometricView(opts?: { distance?: number }): void {
    this.mode = 'ortho';
    this.workplane = 'XY';
    const dist = Math.max(
      opts?.distance ?? this.viewDistance(),
      this.ortho.top * 2.5,
      10,
    );
    // Direction caméra ← cible : coin isométrique classique (Z-up)
    const dir = new THREE.Vector3(1, -1, 1).normalize();
    const pos = this.target.clone().add(dir.multiplyScalar(dist));
    const up = this.upPreferringWorldZ(dir);

    this.ortho.position.copy(pos);
    this.persp.position.copy(pos);
    this.ortho.up.copy(up);
    this.persp.up.copy(up);
    this.ortho.lookAt(this.target);
    this.persp.lookAt(this.target);

    this.updateWorkplanePlane();
    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /**
   * /pers — bascule en perspective en conservant la direction de vue
   * (position / cible / up). Utile après /axo pour juger le relief.
   */
  setPerspectiveView(opts?: { distance?: number }): void {
    const dist = Math.max(opts?.distance ?? this.viewDistance(), 5);
    // Si on est quasi collé (vue plan pure), s’éloigner un peu
    const offset = new THREE.Vector3().subVectors(
      this.activeCamera().position,
      this.target,
    );
    if (offset.length() < 1e-6) {
      offset.set(1, -1, 1).normalize().multiplyScalar(dist);
    } else {
      offset.setLength(dist);
    }
    const pos = this.target.clone().add(offset);
    const up = this.upPreferringWorldZ(offset.clone().normalize());

    this.mode = 'persp';
    this.ortho.position.copy(pos);
    this.persp.position.copy(pos);
    this.ortho.up.copy(up);
    this.persp.up.copy(up);
    this.ortho.lookAt(this.target);
    this.persp.lookAt(this.target);
    this.persp.updateProjectionMatrix();

    this.updateWorkplanePlane();
    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /**
   * /plan — vue en plan XY depuis +Z (orthographique).
   */
  setPlanView(opts?: { distance?: number }): void {
    this.mode = 'ortho';
    this.workplane = 'XY';
    const dist = Math.max(opts?.distance ?? this.viewDistance(), 10);
    const pos = this.target.clone().add(new THREE.Vector3(0, 0, dist));
    const up = new THREE.Vector3(0, 1, 0);

    this.ortho.position.copy(pos);
    this.persp.position.copy(pos);
    this.ortho.up.copy(up);
    this.persp.up.copy(up);
    this.ortho.lookAt(this.target);
    this.persp.lookAt(this.target);

    this.updateWorkplanePlane();
    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /**
   * Fait pivoter la caméra de `degrees` autour de l’axe **vertical monde Z**
   * passant par la cible. Indépendant du mode (ortho / persp) et de la vue
   * (plan, façade, axo…). Préserve distance et hauteur relative.
   */
  rotateCameraAroundWorldZ(degrees: number): void {
    const rad = THREE.MathUtils.degToRad(degrees);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotateZ = (v: THREE.Vector3): THREE.Vector3 => {
      const x = v.x * cos - v.y * sin;
      const y = v.x * sin + v.y * cos;
      return new THREE.Vector3(x, y, v.z);
    };

    const cam = this.activeCamera();
    const offset = new THREE.Vector3().subVectors(cam.position, this.target);
    const newOffset = rotateZ(offset);
    const newUp = rotateZ(cam.up.clone()).normalize();

    // Éviter up // viewDir (cas dégénéré)
    const viewDir = newOffset.clone().negate().normalize();
    if (Math.abs(newUp.dot(viewDir)) > 0.999) {
      newUp.copy(this.upPreferringWorldZ(newOffset.clone().normalize()));
    }

    const pos = this.target.clone().add(newOffset);
    this.ortho.position.copy(pos);
    this.persp.position.copy(pos);
    this.ortho.up.copy(newUp);
    this.persp.up.copy(newUp);
    this.ortho.lookAt(this.target);
    this.persp.lookAt(this.target);

    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();
  }

  /** Distance caméra → cible (m). */
  private viewDistance(): number {
    const cam = this.activeCamera();
    const d = cam.position.distanceTo(this.target);
    return d > 1e-6 ? d : 50;
  }

  /**
   * Vecteur « up » pour une direction caméra (target → cam = dir),
   * en privilégiant le Z monde (vertical).
   */
  private upPreferringWorldZ(dirFromTargetToCam: THREE.Vector3): THREE.Vector3 {
    const worldZ = new THREE.Vector3(0, 0, 1);
    // up = composante de Z perpendiculaire à la direction de vue
    const viewDir = dirFromTargetToCam.clone().negate().normalize(); // cam → target
    let up = worldZ.clone().sub(viewDir.clone().multiplyScalar(worldZ.dot(viewDir)));
    if (up.lengthSq() < 1e-8) {
      // Vue quasi verticale pure : up = +Y
      up = new THREE.Vector3(0, 1, 0);
    }
    return up.normalize();
  }

  /** Déplace la caméra et la cible dans le plan de vue (pan relatif en unités monde). */
  panByWorld(dx: number, dy: number): void {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const cam = this.activeCamera();
    cam.updateMatrixWorld();

    right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    const delta = right.multiplyScalar(-dx).add(up.multiplyScalar(-dy));
    this.target.add(delta);
    cam.position.add(delta);
    cam.lookAt(this.target);
    this.refreshHelperClip();
    this.rebuildGrid(false);
    this.refreshUiLabels();
  }

  /** Zoom orthographique autour du centre de vue. factor > 1 = zoom out. */
  zoomBy(factor: number, anchorNdc?: THREE.Vector2): void {
    if (this.mode === 'ortho') {
      const before = this.mouseWorldFromNdc(anchorNdc ?? new THREE.Vector2(0, 0));
      // Unités m : zoom ~5 cm → 5 km demi-hauteur
      const half = THREE.MathUtils.clamp(this.ortho.top * factor, 0.05, 5000);
      this.setOrthoHalfHeight(half);
      if (before && anchorNdc) {
        const after = this.mouseWorldFromNdc(anchorNdc);
        if (after) {
          const dx = before.x - after.x;
          const dy = before.y - after.y;
          const dz = before.z - after.z;
          this.target.add(new THREE.Vector3(dx, dy, dz));
          this.activeCamera().position.add(new THREE.Vector3(dx, dy, dz));
          this.activeCamera().lookAt(this.target);
        }
      }
    } else {
      this.persp.position.lerp(this.target, 1 - factor);
    }
    this.refreshHelperClip();
    this.rebuildGrid(false);
    this.refreshUiLabels();
  }

  /**
   * /center — cadre tout le dessin dans le canvas.
   * Conserve l’orientation de vue (plan / axo / persp / face…), centre la cible
   * sur l’emprise 3D (X,Y,Z) et ajuste le zoom pour coller au plus près des bords.
   * Les aides infinies sont exclues de l’emprise.
   * @returns false si aucun élément de dessin
   */
  fitToDrawing(
    entities: readonly Entity[],
    opts?: { margin?: number },
  ): { ok: true; halfHeight: number; count: number } | { ok: false } {
    const margin = opts?.margin ?? 1.06; // ~6 % pour ne pas coller au bord
    const points = drawingExtentPoints(entities);
    if (points.length === 0) return { ok: false };

    const box = aabbFromPoints(points);
    const center = new THREE.Vector3(box.center[0], box.center[1], box.center[2]);

    // 8 coins de l’AABB + points denses (arcs) pour une emprise fiable en vue oblique
    const fitPts: THREE.Vector3[] = [];
    const [minX, minY, minZ] = box.min;
    const [maxX, maxY, maxZ] = box.max;
    for (const x of [minX, maxX]) {
      for (const y of [minY, maxY]) {
        for (const z of [minZ, maxZ]) {
          fitPts.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    // Échantillon des points réels (meilleur pour arcs / murs)
    const step = Math.max(1, Math.floor(points.length / 200));
    for (let i = 0; i < points.length; i += step) {
      const p = points[i]!;
      fitPts.push(new THREE.Vector3(p[0], p[1], p[2]));
    }

    const cam = this.activeCamera();
    // Garder la direction de vue (position → target)
    const offset = new THREE.Vector3().subVectors(cam.position, this.target);
    if (offset.lengthSq() < 1e-12) {
      // Fallback : regarder depuis +Z
      offset.set(0, 0, 50);
    }

    this.target.copy(center);
    cam.position.copy(center).add(offset);
    cam.lookAt(this.target);
    cam.updateMatrixWorld(true);

    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    const rel = new THREE.Vector3();
    for (const p of fitPts) {
      rel.subVectors(p, center);
      const u = rel.dot(right);
      const v = rel.dot(up);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    // Recentrer légèrement si l’emprise projetée n’est pas symétrique
    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;
    if (Math.abs(midU) > 1e-9 || Math.abs(midV) > 1e-9) {
      const shift = right.clone().multiplyScalar(midU).add(up.clone().multiplyScalar(midV));
      this.target.add(shift);
      cam.position.add(shift);
      cam.lookAt(this.target);
      minU -= midU;
      maxU -= midU;
      minV -= midV;
      maxV -= midV;
    }

    let halfW = Math.max(Math.abs(minU), Math.abs(maxU));
    let halfH = Math.max(Math.abs(minV), Math.abs(maxV));
    // Point unique / dégénérescence
    const minSpan = 0.5; // 50 cm mini
    halfW = Math.max(halfW, minSpan * 0.5);
    halfH = Math.max(halfH, minSpan * 0.5);

    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);

    if (this.mode === 'ortho') {
      // half = demi-hauteur ; demi-largeur = half * aspect
      const half = Math.max(halfH, halfW / Math.max(aspect, 1e-6)) * margin;
      const clamped = THREE.MathUtils.clamp(half, 0.05, 5000);
      this.setOrthoHalfHeight(clamped);
    } else {
      // Perspective : distance pour que le frustum couvre halfW × halfH
      const fovV = THREE.MathUtils.degToRad(this.persp.fov);
      const tanV = Math.tan(fovV / 2);
      const tanH = tanV * aspect;
      const distH = halfH / Math.max(tanV, 1e-9);
      const distW = halfW / Math.max(tanH, 1e-9);
      const dist = Math.max(distH, distW) * margin;
      const dir = offset.clone().normalize();
      cam.position.copy(this.target).add(dir.multiplyScalar(Math.max(dist, 0.5)));
      cam.lookAt(this.target);
      this.persp.updateProjectionMatrix();
    }

    this.refreshHelperClip();
    this.rebuildGrid(true);
    this.refreshUiLabels();

    return {
      ok: true,
      halfHeight: this.mode === 'ortho' ? this.ortho.top : 0,
      count: points.length,
    };
  }

  /** Mètres monde par pixel écran (hauteur). */
  worldPerPixel(): number {
    const rect = this.canvas.getBoundingClientRect();
    return (this.ortho.top * 2) / Math.max(1, rect.height);
  }

  /** Rayon snap en pixels (paramètres). */
  snapRadiusPx(): number {
    return this.appPrefs?.snap.radiusPx ?? DEFAULT_SNAP_RADIUS_PX;
  }

  /** Tolérance d'accrochage en mètres (pixels × échelle vue). */
  snapToleranceMeters(): number {
    return this.worldPerPixel() * this.snapRadiusPx();
  }

  isSnapEnabled(): boolean {
    return this.appPrefs?.snap.enabled ?? true;
  }

  /** Accroche grille : visible ET demandée. */
  isGridSnapEffective(): boolean {
    return this.appPrefs?.gridSnapEffective ?? false;
  }

  dispose(): void {
    cancelAnimationFrame(this.anim);
    this.helperLayer.dispose();
    this.entityLayer.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
  }

  private activeCamera(): THREE.Camera {
    return this.mode === 'ortho' ? this.ortho : this.persp;
  }

  private setOrthoHalfHeight(half: number): void {
    const el = this.canvas;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  private refreshHelperClip(): void {
    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.helperLayer.updateForCamera(this.target, this.ortho.top, aspect);
  }

  private updateWorkplanePlane(): void {
    switch (this.workplane) {
      case 'XY':
        this.groundPlane.set(new THREE.Vector3(0, 0, 1), 0);
        break;
      case 'XZ':
        this.groundPlane.set(new THREE.Vector3(0, 1, 0), 0);
        break;
      case 'YZ':
        this.groundPlane.set(new THREE.Vector3(1, 0, 0), 0);
        break;
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onResize = (): void => this.resize();

  private resize(): void {
    const wrap = this.canvas.parentElement;
    const w = wrap?.clientWidth ?? this.canvas.clientWidth;
    const h = wrap?.clientHeight ?? this.canvas.clientHeight;
    if (w < 1 || h < 1) return;

    this.renderer.setSize(w, h, false);
    this.entityLayer.setResolution(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.setOrthoHalfHeight(this.ortho.top);
    this.refreshHelperClip();
  }

  private clientToNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return new THREE.Vector2(x, y);
  }

  private mouseWorldFromNdc(ndc: THREE.Vector2): MouseWorld {
    this.raycaster.setFromCamera(ndc, this.activeCamera());
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!ok) return null;
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.pointer.copy(this.clientToNdc(e.clientX, e.clientY));
    this.mouseWorld = this.mouseWorldFromNdc(this.pointer);
    this.updateMouseLabel();

    if (this.isDragging) {
      const rect = this.canvas.getBoundingClientRect();
      const halfH = this.ortho.top;
      const worldPerPxY = (halfH * 2) / Math.max(1, rect.height);
      const worldPerPxX = worldPerPxY;

      const dxPx = e.clientX - this.lastClient.x;
      const dyPx = e.clientY - this.lastClient.y;
      this.lastClient = { x: e.clientX, y: e.clientY };

      if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) {
        this.dragMoved = true;
      }

      this.panByWorld(dxPx * worldPerPxX, -dyPx * worldPerPxY);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Clic droit = accrochage (ne démarre pas un pan)
    // Sauf mode pick « rightClickAsPick » (Oui/Non /jonction) → pas de snap
    if (e.button === 2) {
      e.preventDefault();
      if (this.pickMode && this.onPick && this.pickRightClick) {
        const pt = this.rawPickPoint() ?? ([0, 0, 0] as Vec3);
        this.onPick(pt, 'right');
        return;
      }
      this.doRightClickSnap();
      return;
    }

    // Gauche ou milieu = pan (défaut ARC+)
    if (e.button !== 0 && e.button !== 1) return;

    e.preventDefault();
    this.isDragging = true;
    this.dragMoved = false;
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.canvas.classList.add('active');
    this.canvas.setPointerCapture(e.pointerId);
  };

  /**
   * Clic droit = fonction /snap :
   * 1. croisement dans le rayon (px)
   * 2. sinon courbe la plus proche dans le rayon
   * 3. sinon rien → même effet qu'un clic gauche (point brut si outil actif)
   */
  private doRightClickSnap(): void {
    if (!this.mouseWorld) {
      this.lastSnap = null;
      this.helperLayer.showSnap(null);
      this.onSnap?.(null, null, { placedAsLeftClick: false });
      return;
    }

    const click: Vec3 = [this.mouseWorld.x, this.mouseWorld.y, this.mouseWorld.z];
    let snap: SnapResult | null = null;

    if (this.isSnapEnabled()) {
      const curves = entitiesToSnapCurves(this.helpers, this.entities);
      snap = snapAt(click, curves, this.snapToleranceMeters());
    }

    // Accroche nœud de grille si aucun snap objet, grille visible + /gridsnap on
    if (!snap && this.isGridSnapEffective()) {
      const gp = nearestGridPoint(
        click,
        this.gridSpacingMeters,
        this.units,
      );
      const dx = gp[0] - click[0];
      const dy = gp[1] - click[1];
      const dz = gp[2] - click[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= this.snapToleranceMeters()) {
        snap = {
          point: gp,
          kind: 'grid',
          dist: d,
          entityIds: [],
          helperIds: [],
        };
      }
    }

    if (snap) {
      this.lastSnap = snap;
      this.helperLayer.showSnap(snap.point, this.ortho.top);
      this.onSnap?.(snap, this.mouseWorld, { placedAsLeftClick: false });
      // Pendant un outil : le snap place aussi le point (feedback outil après)
      if (this.pickMode && this.onPick) {
        this.onPick([...snap.point] as Vec3, 'snap');
      }
    } else {
      this.lastSnap = null;
      this.helperLayer.showSnap(null);
      this.onSnap?.(null, this.mouseWorld, { placedAsLeftClick: this.pickMode });
      // Comme un clic gauche : point brut si outil actif
      if (this.pickMode && this.onPick) {
        this.onPick(click, 'click');
      }
    }
    this.updateMouseLabel();
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    const wasDrag = this.dragMoved;
    this.isDragging = false;
    this.canvas.classList.remove('active');
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    // Clic gauche court en mode outil → point BRUT (jamais de snap)
    if (this.pickMode && this.onPick && e.button === 0 && !wasDrag) {
      const pt = this.rawPickPoint();
      if (pt) this.onPick(pt, 'click');
    }
  };

  /** Position souris brute (clic gauche — sans accroche). */
  private rawPickPoint(): Vec3 | null {
    if (!this.mouseWorld) return null;
    return [this.mouseWorld.x, this.mouseWorld.y, this.mouseWorld.z];
  }

  private onPointerLeave = (): void => {
    this.mouseWorld = null;
    this.ui.setMouse('—');
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    const ndc = this.clientToNdc(e.clientX, e.clientY);
    this.zoomBy(factor, ndc);
  };

  private updateMouseLabel(): void {
    if (!this.mouseWorld) {
      this.ui.setMouse('—');
      return;
    }
    const { x, y, z } = this.mouseWorld;
    let text = `X ${fmt(x)}  Y ${fmt(y)}  Z ${fmt(z)}`;
    if (this.lastSnap) {
      const p = this.lastSnap.point;
      const tag =
        this.lastSnap.kind === 'intersection'
          ? '∩'
          : this.lastSnap.kind === 'endpoint'
            ? '◦'
            : this.lastSnap.kind === 'grid'
              ? '#'
              : '∥';
      text += `  │  snap ${tag} ${fmt(p[0])},${fmt(p[1])},${fmt(p[2])}`;
    }
    this.ui.setMouse(text);
  }

  private refreshUiLabels(): void {
    const visibleH = this.ortho.top * 2;
    const u = this.units;
    const spacing = gridSpacingInWorld(this.gridSpacingMeters, u);
    this.ui.setScale(
      `1 : ${Math.max(1, Math.round(visibleH))}  (${visibleH.toFixed(2)} ${u} · grille ${spacing.toFixed(spacing < 1 ? 3 : 1)} ${u})`,
    );
    const viewLabel =
      this.mode === 'ortho'
        ? `Plan ${this.workplane}`
        : this.mode === 'persp'
          ? `Persp ${this.workplane}`
          : `${this.mode} ${this.workplane}`;
    this.ui.setView(viewLabel);
    this.ui.setWorkplane(this.workplane);
    this.updateMouseLabel();
  }

  /**
   * Grille « infinie » : recouvre largement le frustum, centrée sur la cible
   * caméra (accrochée au pas de grille). Un carré = gridSpacingMeters en m réels.
   */
  private rebuildGrid(force: boolean): void {
    const spacing = Math.max(
      1e-9,
      gridSpacingInWorld(this.gridSpacingMeters, this.units),
    );
    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = this.ortho.top;
    const halfW = halfH * aspect;
    // Couvre ~3× la vue visible (effet infini au pan / zoom)
    const cover = Math.max(halfW, halfH) * 3 * 2;
    const divisions = Math.max(2, Math.min(400, Math.round(cover / spacing)));
    const size = divisions * spacing;

    // Ancrage de la grille sur le réseau (évite le glissement des traits)
    const gx = Math.round(this.target.x / spacing) * spacing;
    const gy = Math.round(this.target.y / spacing) * spacing;

    const key = `${size.toFixed(4)}:${divisions}:${gx.toFixed(4)}:${gy.toFixed(4)}:${spacing.toFixed(6)}`;
    if (!force && key === this.lastGridKey) {
      this.grid.position.set(gx, gy, 0);
      this.applyGridVisibility();
      return;
    }
    this.lastGridKey = key;

    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    disposeMaterial(this.grid.material);

    this.grid = new THREE.GridHelper(size, divisions, 0x3a4250, 0x252a33);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.set(gx, gy, 0);
    this.scene.add(this.grid);
    this.applyGridVisibility();

    // Axes ~ 2 m réels
    const axisLen = gridSpacingInWorld(2, this.units);
    this.axes.scale.setScalar(axisLen);
  }

  private applyGridVisibility(): void {
    this.grid.visible = this.appPrefs?.gridVisible ?? true;
  }

  private loop = (): void => {
    this.anim = requestAnimationFrame(this.loop);
    this.renderer.render(this.scene, this.activeCamera());
  };
}

function fmt(n: number): string {
  const v = Math.abs(n) < 1e-9 ? 0 : n;
  return v.toFixed(3);
}

function disposeMaterial(
  mat: THREE.Material | THREE.Material[],
): void {
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}
