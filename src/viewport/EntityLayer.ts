import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { sampleArc, sampleCircle } from '../core/drawing';
import { generateHatchStrokes } from '../core/fill';
import { getHatchPattern, preloadHatchFromEntities } from '../core/hatchCache';
import { tessellateByLineStyle } from '../core/lineStyle';
import { objectInstanceStrokes } from '../core/objectInstance';
import { polylineStrokes } from '../core/polyline';
import {
  buildDimensionGeom,
  dimLabelsAsTextEntities,
} from '../core/dimension';
import {
  FONT_PX,
  LINE_HEIGHT,
  textCssFont,
} from '../core/textMeasure';
import type {
  ArcEntity,
  CircleEntity,
  DimensionEntity,
  Entity,
  LineEntity,
  LineStyleId,
  ObjectInstanceEntity,
  PointEntity,
  PolylineEntity,
  TextEntity,
  Vec3,
  WallEntity,
} from '../core/types';
import { wallEntityStrokes, type WallStroke } from '../core/walls';

interface SolidPiece {
  points: Vec3[];
  color: string;
  lineWidth: number;
}

/**
 * Tesselle un trait selon lineStyle (tiret-point, etc.) en morceaux pleins.
 * LineMaterial ne gère qu’un couple tiret/gap — les motifs complexes passent par ici.
 */
function expandStroke(
  points: Vec3[],
  color: string,
  lineWidth: number,
  lineStyle: LineStyleId | string | undefined,
): SolidPiece[] {
  const pieces = tessellateByLineStyle(points, lineStyle ?? 'plein');
  return pieces
    .filter((p) => p.length >= 2)
    .map((p) => ({
      points: p,
      color,
      lineWidth,
    }));
}

type DrawEntity =
  | LineEntity
  | ArcEntity
  | CircleEntity
  | PolylineEntity
  | WallEntity
  | ObjectInstanceEntity
  | TextEntity
  | DimensionEntity
  | PointEntity;

export interface PreviewStroke {
  points: Vec3[];
  color?: string;
  lineWidth?: number;
  lineStyle?: LineStyleId;
}

export interface PreviewLabel {
  content: string;
  position: Vec3;
  rotation?: number;
  height: number;
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  background?: string | null;
  hAlign?: number;
  vAlign?: number;
}

/**
 * Rendu des entités de dessin (lignes, arcs, cercles, murs) avec épaisseur en pixels
 * et styles pointillés via Line2 / LineMaterial (Three.js).
 */
export class EntityLayer {
  readonly group = new THREE.Group();
  private objects = new Map<string, Line2>();
  private materials = new Map<string, LineMaterial>();
  /** Textes : mesh plane + texture canvas. */
  private textMeshes = new Map<string, THREE.Mesh>();
  /** Traits de boîte / cotation liés à une entité texte ou dimension. */
  private auxStrokes = new Map<string, Line2>();
  private auxMats = new Map<string, LineMaterial>();
  /** Points : taille écran fixe (px), indépendante du zoom. */
  private pointObjects = new Map<string, THREE.Points>();
  private pointMats = new Map<string, THREE.PointsMaterial>();
  private resolution = new THREE.Vector2(1, 1);
  private previews: Line2[] = [];
  private previewMats: LineMaterial[] = [];
  private previewLabels: THREE.Mesh[] = [];
  private selectedIds = new Set<string>();
  /** Désignation (≠ sélection) — surbrillance orange. */
  private designatedIds = new Set<string>();
  private selectRect: Line2 | null = null;
  private selectRectMat: LineMaterial | null = null;
  private lastEntities: readonly Entity[] = [];

  /** Cyan = sélection (/select). */
  static readonly SELECT_COLOR = '#4fc3f7';
  /** Orange = désignation (/paral, /copy sans sélection…). */
  static readonly DESIGNATE_COLOR = '#ffb74d';

  constructor() {
    this.group.name = 'entity-layer';
  }

  setResolution(width: number, height: number): void {
    this.resolution.set(Math.max(1, width), Math.max(1, height));
    for (const mat of this.materials.values()) {
      mat.resolution.copy(this.resolution);
    }
    for (const mat of this.previewMats) {
      mat.resolution.copy(this.resolution);
    }
    for (const mat of this.auxMats.values()) {
      mat.resolution.copy(this.resolution);
    }
  }

  setEntities(entities: readonly Entity[]): void {
    this.lastEntities = entities;
    // Précharge les motifs /fill (re-render via hatchCache.onChange dans main)
    preloadHatchFromEntities(entities);
    const draw = entities.filter(
      (e): e is DrawEntity =>
        e.kind === 'line' ||
        e.kind === 'arc' ||
        e.kind === 'circle' ||
        e.kind === 'polyline' ||
        e.kind === 'wall' ||
        e.kind === 'object' ||
        e.kind === 'text' ||
        e.kind === 'dimension' ||
        e.kind === 'point',
    );

    const wanted = new Set<string>();
    const wantedText = new Set<string>();
    const wantedPoints = new Set<string>();
    const wantedAux = new Set<string>();
    for (const e of draw) {
      if (e.kind === 'text') {
        wantedText.add(e.id);
        if (e.boxed) {
          for (let i = 0; i < 4; i++) wantedAux.add(`${e.id}__box_${i}`);
        }
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
        let si = 0;
        for (const s of geom.strokes) {
          const pieces = expandStroke(
            s.points,
            s.color,
            s.lineWidth,
            s.lineStyle,
          );
          for (const _p of pieces) {
            wanted.add(strokeId(e.id, si));
            si += 1;
          }
        }
        // Libellé virtuel legacy uniquement (pas de TextEntity labelId)
        if (!e.labelId) {
          for (let i = 0; i < geom.labels.length; i++) {
            wantedText.add(`${e.id}__lbl_${i}`);
          }
        }
      } else if (e.kind === 'point') {
        wantedPoints.add(e.id);
      } else {
        const n = this.countPieces(e);
        for (let i = 0; i < n; i++) wanted.add(strokeId(e.id, i));
        // Ancien id nu (avant tessellation multi-morceaux)
        wanted.delete(e.id);
      }
    }

    for (const id of [...this.objects.keys()]) {
      if (!wanted.has(id)) this.removeObject(id);
    }
    for (const id of [...this.textMeshes.keys()]) {
      if (!wantedText.has(id)) this.removeText(id);
    }
    for (const id of [...this.pointObjects.keys()]) {
      if (!wantedPoints.has(id)) this.removePoint(id);
    }
    for (const id of [...this.auxStrokes.keys()]) {
      if (!wantedAux.has(id)) this.removeAux(id);
    }

    for (const e of draw) {
      if (e.kind === 'wall') {
        this.upsertWall(e);
      } else if (e.kind === 'object') {
        this.upsertObject(e);
      } else if (e.kind === 'polyline') {
        this.upsertPolyline(e);
      } else if (e.kind === 'text') {
        this.upsertText(e);
      } else if (e.kind === 'dimension') {
        this.upsertDimension(e);
      } else if (e.kind === 'point') {
        this.upsertPoint(e);
      } else {
        this.upsertSimple(e);
      }
    }
  }

  /** Met en évidence les entités sélectionnées (cyan). */
  setSelectedIds(ids: ReadonlySet<string> | Iterable<string>): void {
    this.selectedIds = new Set(ids);
    // Re-appliquer les styles
    if (this.lastEntities.length) this.setEntities(this.lastEntities);
  }

  /** Met en évidence les entités désignées (orange) — indépendant de la sélection. */
  setDesignatedIds(ids: ReadonlySet<string> | Iterable<string>): void {
    this.designatedIds = new Set(ids);
    if (this.lastEntities.length) this.setEntities(this.lastEntities);
  }

  /**
   * Cadre de sélection (rectangle monde XY) en aperçu.
   * null pour masquer.
   */
  setSelectRect(a: Vec3 | null, b: Vec3 | null, mode: 'add' | 'remove' = 'add'): void {
    if (!a || !b) {
      if (this.selectRect) this.selectRect.visible = false;
      return;
    }
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const z = a[2];
    const pts: Vec3[] = [
      [minX, minY, z],
      [maxX, minY, z],
      [maxX, maxY, z],
      [minX, maxY, z],
      [minX, minY, z],
    ];

    if (!this.selectRect || !this.selectRectMat) {
      const mat = new LineMaterial({
        color: mode === 'remove' ? 0xe57373 : 0x4fc3f7,
        linewidth: 1.5,
        dashed: true,
        dashSize: 8,
        gapSize: 6,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        worldUnits: false,
      });
      mat.resolution.copy(this.resolution);
      const geo = new LineGeometry();
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 30;
      this.group.add(line);
      this.selectRect = line;
      this.selectRectMat = mat;
    }

    this.selectRectMat.color.set(mode === 'remove' ? 0xe57373 : 0x4fc3f7);
    this.selectRectMat.dashed = true;
    this.selectRectMat.dashSize = 8;
    this.selectRectMat.gapSize = 6;
    this.selectRectMat.needsUpdate = true;
    setLinePoints(this.selectRect, pts, true);
    this.selectRect.visible = true;
  }

  /** Aperçu temporaire mono-trait (rubber-band ligne/arc). */
  setPreview(
    points: Vec3[] | null,
    stroke?: {
      color: string;
      lineWidth: number;
      lineStyle: LineStyleId;
    },
  ): void {
    if (!points || points.length < 2) {
      this.setPreviewStrokes(null);
      return;
    }
    this.setPreviewStrokes([
      {
        points,
        color: stroke?.color ?? '#888888',
        lineWidth: stroke?.lineWidth ?? 1,
        lineStyle: stroke?.lineStyle ?? 'plein',
      },
    ]);
  }

  /** Labels d’aperçu (cotations en cours). null = masquer. */
  setPreviewLabels(labels: PreviewLabel[] | null): void {
    // Nettoyer les anciens
    for (const m of this.previewLabels) {
      this.group.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.previewLabels = [];
    if (!labels || labels.length === 0) return;

    for (const lb of labels) {
      const te: TextEntity = {
        id: `preview_lbl_${this.previewLabels.length}`,
        kind: 'text',
        layer: 'PREVIEW',
        position: lb.position,
        height: lb.height,
        content: lb.content,
        rotation: lb.rotation ?? 0,
        color: lb.color ?? '#000000',
        hAlign: lb.hAlign ?? 1,
        vAlign: lb.vAlign ?? 0,
        fontFamily: lb.fontFamily,
        bold: lb.bold,
        italic: lb.italic,
        background: lb.background ?? null,
      };
      const mesh = this.buildTextMesh(te, false);
      if (mesh) {
        mesh.renderOrder = 40;
        this.previewLabels.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  /** Aperçu multi-traits (murs) — styles tessellés (tiret-point, etc.). */
  setPreviewStrokes(strokes: PreviewStroke[] | null): void {
    if (!strokes || strokes.length === 0) {
      for (const p of this.previews) p.visible = false;
      this.setPreviewLabels(null);
      return;
    }
    // Les labels de cotation sont posés après les traits (previewCote).
    // On ne les efface pas ici pour permettre setPreviewStrokes puis setPreviewLabels.

    // Expand every stroke by line style into solid pieces
    const pieces: SolidPiece[] = [];
    for (const s of strokes) {
      if (!s.points || s.points.length < 2) continue;
      pieces.push(
        ...expandStroke(
          s.points,
          s.color ?? '#888888',
          Math.max(1, s.lineWidth ?? 1),
          s.lineStyle ?? 'plein',
        ),
      );
    }

    while (this.previews.length < pieces.length) {
      const mat = new LineMaterial({
        color: 0x888888,
        linewidth: 1,
        dashed: false,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        worldUnits: false,
      });
      mat.resolution.copy(this.resolution);
      const geo = new LineGeometry();
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 20;
      this.group.add(line);
      this.previews.push(line);
      this.previewMats.push(mat);
    }

    for (let i = 0; i < this.previews.length; i++) {
      const line = this.previews[i]!;
      const mat = this.previewMats[i]!;
      const s = pieces[i];
      if (!s || s.points.length < 2) {
        line.visible = false;
        continue;
      }
      mat.color.set(s.color);
      mat.linewidth = Math.max(1, s.lineWidth);
      mat.dashed = false;
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.needsUpdate = true;
      setLinePoints(line, s.points, true);
      line.visible = true;
    }
  }

  dispose(): void {
    for (const id of [...this.objects.keys()]) this.removeObject(id);
    for (const id of [...this.textMeshes.keys()]) this.removeText(id);
    for (const id of [...this.pointObjects.keys()]) this.removePoint(id);
    for (const p of this.previews) {
      this.group.remove(p);
      p.geometry.dispose();
    }
    for (const m of this.previewMats) m.dispose();
    this.previews = [];
    this.previewMats = [];
    if (this.selectRect) {
      this.group.remove(this.selectRect);
      this.selectRect.geometry.dispose();
      this.selectRectMat?.dispose();
      this.selectRect = null;
      this.selectRectMat = null;
    }
  }

  private isSelectedEntity(entityId: string): boolean {
    return this.selectedIds.has(entityId);
  }

  private isDesignatedEntity(entityId: string): boolean {
    return this.designatedIds.has(entityId);
  }

  /**
   * Priorité visuelle : désignation (orange) > sélection (cyan) > couleur propre.
   */
  private highlightStyle(
    entityId: string,
    color: string,
    lineWidth: number,
  ): { color: string; lineWidth: number } {
    if (this.isDesignatedEntity(entityId)) {
      return {
        color: EntityLayer.DESIGNATE_COLOR,
        lineWidth: Math.max(lineWidth, 2) + 1,
      };
    }
    if (this.isSelectedEntity(entityId)) {
      return {
        color: EntityLayer.SELECT_COLOR,
        lineWidth: Math.max(lineWidth, 2) + 1,
      };
    }
    return { color, lineWidth };
  }

  private upsertWall(e: WallEntity): void {
    this.upsertEntityPieces(e.id, this.entityPieces(e));
  }

  private upsertObject(e: ObjectInstanceEntity): void {
    this.upsertEntityPieces(e.id, this.entityPieces(e));
  }

  private upsertPolyline(e: PolylineEntity): void {
    this.upsertEntityPieces(e.id, this.entityPieces(e));
  }

  private upsertSimple(e: LineEntity | ArcEntity | CircleEntity): void {
    this.upsertEntityPieces(e.id, this.entityPieces(e));
  }

  private upsertEntityPieces(entityId: string, pieces: SolidPiece[]): void {
    // Retirer l’ancien objet mono-id (lignes simples avant tessellation)
    this.removeObject(entityId);
    for (let i = 0; i < pieces.length; i++) {
      const s = pieces[i]!;
      this.upsertStroke(strokeId(entityId, i), {
        points: s.points,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: 'plein',
        offset: 0,
      });
    }
    this.pruneStrokeIds(entityId, pieces.length);
  }

  private countPieces(e: DrawEntity): number {
    if (e.kind === 'text' || e.kind === 'point' || e.kind === 'dimension') {
      return 0;
    }
    return this.entityPieces(e).length;
  }

  /**
   * Point en pixels écran (sizeAttenuation=false) :
   * lineWidth 1→7 → taille 1→7 px, indépendant du zoom / perspective.
   */
  private upsertPoint(e: PointEntity): void {
    const hl = this.highlightStyle(e.id, e.color, e.lineWidth);
    const sizePx = Math.max(1, Math.min(12, Math.round(hl.lineWidth)));

    let pts = this.pointObjects.get(e.id);
    let mat = this.pointMats.get(e.id);

    if (!pts || !mat) {
      mat = new THREE.PointsMaterial({
        color: hl.color,
        size: sizePx,
        sizeAttenuation: false,
        depthTest: true,
        transparent: true,
        opacity: 1,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [e.position[0], e.position[1], e.position[2]],
          3,
        ),
      );
      pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 8;
      pts.userData.entityId = e.id;
      this.pointObjects.set(e.id, pts);
      this.pointMats.set(e.id, mat);
      this.group.add(pts);
    } else {
      const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, e.position[0], e.position[1], e.position[2]);
      pos.needsUpdate = true;
      pts.geometry.computeBoundingSphere();
    }

    mat.color.set(hl.color);
    mat.size = sizePx;
    mat.needsUpdate = true;
  }

  private removePoint(id: string): void {
    const pts = this.pointObjects.get(id);
    const mat = this.pointMats.get(id);
    if (pts) {
      this.group.remove(pts);
      pts.geometry.dispose();
      this.pointObjects.delete(id);
    }
    if (mat) {
      mat.dispose();
      this.pointMats.delete(id);
    }
  }

  /** Tous les morceaux pleins d’une entité (style tessellé + surbrillance). */
  private entityPieces(
    e: Exclude<DrawEntity, TextEntity | PointEntity | DimensionEntity>,
  ): SolidPiece[] {
    const out: SolidPiece[] = [];
    const add = (
      points: Vec3[],
      color: string,
      lineWidth: number,
      lineStyle: LineStyleId | string | undefined,
    ) => {
      const hl = this.highlightStyle(e.id, color, lineWidth);
      out.push(...expandStroke(points, hl.color, hl.lineWidth, lineStyle));
    };

    if (e.kind === 'wall') {
      for (const s of wallEntityStrokes(e)) {
        add(s.points, s.color, s.lineWidth, s.lineStyle);
      }
    } else if (e.kind === 'object') {
      for (const s of objectInstanceStrokes(e)) {
        add(s.points, s.color, s.lineWidth, s.lineStyle);
      }
    } else if (e.kind === 'polyline') {
      for (const s of polylineStrokes(e)) {
        add(s.points, s.color, s.lineWidth, s.lineStyle);
      }
      // Remplissage hachure (/fill)
      if (e.hatch?.hatchName) {
        const pattern = getHatchPattern(e.hatch.hatchName);
        if (pattern && pattern.length > 0) {
          const fills = generateHatchStrokes(e, pattern, e.hatch);
          for (const s of fills) {
            add(s.points, s.color, s.lineWidth, s.lineStyle);
          }
        }
      }
    } else {
      const pts = entityToPoints(e);
      add(pts, e.color, e.lineWidth, e.lineStyle ?? 'plein');
    }
    return out;
  }

  private pruneStrokeIds(entityId: string, count: number): void {
    for (const id of [...this.objects.keys()]) {
      if (id.startsWith(`${entityId}#`)) {
        const idx = Number(id.slice(entityId.length + 1));
        if (!Number.isFinite(idx) || idx >= count) this.removeObject(id);
      }
    }
  }

  private upsertText(e: TextEntity): void {
    const hl = this.highlightStyle(e.id, e.color || '#e0e0e0', 1);
    const te: TextEntity = { ...e, color: hl.color };
    const built = this.buildTextMeshData(te);
    if (!built) return;

    let mesh = this.textMeshes.get(e.id);
    if (!mesh) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: built.tex,
        transparent: true,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      mesh.userData.entityId = e.id;
      this.textMeshes.set(e.id, mesh);
      this.group.add(mesh);
    } else {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.map = built.tex;
      mat.needsUpdate = true;
    }

    mesh.scale.set(built.worldW, built.worldH, 1);
    mesh.position.set(built.posX, built.posY, built.posZ);
    mesh.rotation.set(0, 0, e.rotation);

    // Rectangle /textbox
    if (e.boxed) {
      this.upsertTextBox(e, built);
    } else {
      for (let i = 0; i < 4; i++) this.removeAux(`${e.id}__box_${i}`);
    }
  }

  private buildTextMesh(e: TextEntity, store: boolean): THREE.Mesh | null {
    const built = this.buildTextMeshData(e);
    if (!built) return null;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: built.tex,
      transparent: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.scale.set(built.worldW, built.worldH, 1);
    mesh.position.set(built.posX, built.posY, built.posZ);
    mesh.rotation.set(0, 0, e.rotation);
    if (store) {
      mesh.userData.entityId = e.id;
      this.textMeshes.set(e.id, mesh);
      this.group.add(mesh);
    }
    return mesh;
  }

  private buildTextMeshData(e: TextEntity): {
    tex: THREE.CanvasTexture;
    worldW: number;
    worldH: number;
    posX: number;
    posY: number;
    posZ: number;
    contentW: number;
    contentH: number;
  } | null {
    const content = e.content || ' ';
    const height = Math.max(e.height, 1e-6);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const fontPx = FONT_PX;
    const font = textCssFont(
      {
        height,
        fontFamily: e.fontFamily,
        bold: e.bold,
        italic: e.italic,
      },
      fontPx,
    );
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    ctx.font = font;
    let maxW = fontPx * 0.5;
    for (const line of lines) {
      maxW = Math.max(maxW, ctx.measureText(line || ' ').width);
    }

    // Dessin sur baseline alphabétique : la 1ʳᵉ baseline est une référence claire
    // pour vAlign=0 (DXF baseline) = coordonnée d’insertion.
    const padX = Math.ceil(fontPx * 0.15);
    const padTop = Math.ceil(fontPx * 0.2);
    const padBot = Math.ceil(fontPx * 0.25); // place pour les jambages
    const linePx = fontPx * LINE_HEIGHT;
    // Baseline de la ligne i depuis le haut du canvas (y canvas ↓)
    const baselineFromTop = (i: number) => padTop + fontPx * 0.8 + i * linePx;
    const cw = Math.max(2, Math.ceil(maxW + padX * 2));
    const ch = Math.max(
      2,
      Math.ceil(baselineFromTop(lines.length - 1) + padBot),
    );
    canvas.width = cw;
    canvas.height = ch;
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.clearRect(0, 0, cw, ch);

    if (e.background) {
      ctx.fillStyle = e.background;
      ctx.fillRect(0, 0, cw, ch);
    }

    ctx.fillStyle = e.color || '#e0e0e0';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i] || ' ', padX, baselineFromTop(i));
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    // Hauteur monde du plan : proportionnelle au canvas
    // (1 ligne de glyphes ≈ `height` ; interligne LINE_HEIGHT)
    const worldH = height * (ch / fontPx);
    const worldW = worldH * (cw / ch);

    // Offset du centre du mesh par rapport au point d’insertion (repère local texte).
    // PlaneGeometry : centre = (0,0), +Y = haut, texture flipY → haut canvas = +Y.
    // Point canvas (cx, cy) → local mesh : lx = (cx/cw - 0.5)*worldW
    //                                   ly = (0.5 - cy/ch)*worldH
    const ha = e.hAlign | 0;
    const va = e.vAlign | 0;

    // Point d’ancrage horizontal dans le canvas (bord gauche du glyphe)
    let anchorCx = padX;
    if (ha === 1) anchorCx = cw / 2;
    else if (ha === 2) anchorCx = cw - padX;

    // Ancrage vertical
    let anchorCy: number;
    if (va === 0) {
      // baseline de la 1ʳᵉ ligne
      anchorCy = baselineFromTop(0);
    } else if (va === 1) {
      // bas du plan
      anchorCy = ch;
    } else if (va === 3) {
      // haut du plan
      anchorCy = 0;
    } else {
      // milieu (2) ou défaut
      anchorCy = ch / 2;
    }

    // Mesh center = insertion − R * local(anchor)  ⇔  ox,oy = −local(anchor)
    const lx = (anchorCx / cw - 0.5) * worldW;
    const ly = (0.5 - anchorCy / ch) * worldH;
    const ox = -lx;
    const oy = -ly;

    const c = Math.cos(e.rotation);
    const s = Math.sin(e.rotation);
    const rx = ox * c - oy * s;
    const ry = ox * s + oy * c;

    return {
      tex,
      worldW,
      worldH,
      posX: e.position[0] + rx,
      posY: e.position[1] + ry,
      posZ: e.position[2] + 0.001,
      contentW: worldW,
      contentH: worldH,
    };
  }

  private upsertTextBox(
    e: TextEntity,
    built: { contentW: number; contentH: number; posX: number; posY: number; posZ: number },
  ): void {
    const pad = e.boxPadding ?? 0.03;
    const hl = this.highlightStyle(e.id, e.color || '#000000', 1);
    // Boîte alignée sur le mesh (centré sur pos mesh)
    const hw = built.contentW / 2 + pad;
    const hh = built.contentH / 2 + pad;
    const z = e.position[2];
    const c = Math.cos(e.rotation);
    const s = Math.sin(e.rotation);
    const cornersLocal: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    const world = cornersLocal.map(([lx, ly]) => {
      const x = built.posX + lx * c - ly * s;
      const y = built.posY + lx * s + ly * c;
      return [x, y, z] as Vec3;
    });
    for (let i = 0; i < 4; i++) {
      const a = world[i]!;
      const b = world[(i + 1) % 4]!;
      this.upsertAuxStroke(`${e.id}__box_${i}`, [a, b], hl.color, 1, 'plein');
    }
  }

  private upsertDimension(e: DimensionEntity): void {
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
    const hl = this.highlightStyle(e.id, e.style.lineColor, e.style.lineWidth);
    let si = 0;
    for (const s of geom.strokes) {
      const pieces = expandStroke(
        s.points,
        hl.color,
        hl.lineWidth,
        s.lineStyle,
      );
      for (const p of pieces) {
        this.upsertStroke(strokeId(e.id, si), {
          points: p.points,
          color: p.color,
          lineWidth: p.lineWidth,
        });
        si += 1;
      }
    }
    this.pruneStrokeIds(e.id, si);

    // Texte réel dans le document (labelId) — ne pas doubler en mesh virtuel.
    // Legacy sans labelId : libellés virtuels.
    if (!e.labelId) {
      const texts = dimLabelsAsTextEntities(e.id, geom.labels);
      for (const t of texts) {
        const color =
          this.selectedIds.has(e.id) || this.designatedIds.has(e.id)
            ? hl.color
            : t.color;
        this.upsertText({ ...t, color });
      }
    } else {
      // Nettoyer d’éventuels anciens meshes virtuels
      for (let i = 0; i < 8; i++) this.removeText(`${e.id}__lbl_${i}`);
    }
  }

  private upsertAuxStroke(
    id: string,
    points: Vec3[],
    color: string,
    lineWidth: number,
    _lineStyle: LineStyleId,
  ): void {
    if (points.length < 2) {
      this.removeAux(id);
      return;
    }
    let line = this.auxStrokes.get(id);
    let mat = this.auxMats.get(id);
    if (!line || !mat) {
      mat = new LineMaterial({
        color: 0xffffff,
        linewidth: 1,
        dashed: false,
        worldUnits: false,
      });
      mat.resolution.copy(this.resolution);
      const geo = new LineGeometry();
      line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.userData.entityId = id;
      this.auxStrokes.set(id, line);
      this.auxMats.set(id, mat);
      this.group.add(line);
    }
    mat.color.set(color);
    mat.linewidth = Math.max(1, lineWidth);
    mat.dashed = false;
    mat.needsUpdate = true;
    setLinePoints(line, points);
  }

  private removeAux(id: string): void {
    const line = this.auxStrokes.get(id);
    const mat = this.auxMats.get(id);
    if (line) {
      this.group.remove(line);
      line.geometry.dispose();
      this.auxStrokes.delete(id);
    }
    if (mat) {
      mat.dispose();
      this.auxMats.delete(id);
    }
  }

  private removeText(id: string): void {
    const mesh = this.textMeshes.get(id);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
    this.textMeshes.delete(id);
  }

  private upsertStroke(
    id: string,
    s: WallStroke | (PreviewStroke & { offset?: number }),
  ): void {
    const pts = s.points;
    if (pts.length < 2) {
      this.removeObject(id);
      return;
    }

    let line = this.objects.get(id);
    let mat = this.materials.get(id);

    if (!line || !mat) {
      mat = new LineMaterial({
        color: 0xffffff,
        linewidth: 1,
        dashed: false,
        worldUnits: false,
      });
      mat.resolution.copy(this.resolution);
      const geo = new LineGeometry();
      line = new Line2(geo, mat);
      line.frustumCulled = false;
      line.userData.entityId = id;
      this.objects.set(id, line);
      this.materials.set(id, mat);
      this.group.add(line);
    }

    // Motifs complexes déjà tessellés → toujours trait plein côté GPU
    mat.color.set(s.color ?? '#888888');
    mat.linewidth = Math.max(1, s.lineWidth ?? 1);
    mat.dashed = false;
    mat.needsUpdate = true;
    setLinePoints(line, pts);
  }

  private removeObject(id: string): void {
    const line = this.objects.get(id);
    const mat = this.materials.get(id);
    if (line) {
      this.group.remove(line);
      line.geometry.dispose();
      this.objects.delete(id);
    }
    if (mat) {
      mat.dispose();
      this.materials.delete(id);
    }
  }
}

function strokeId(wallId: string, i: number): string {
  return `${wallId}#${i}`;
}

function entityToPoints(e: LineEntity | ArcEntity | CircleEntity): Vec3[] {
  if (e.kind === 'line') {
    return [e.start, e.end];
  }
  if (e.kind === 'circle') {
    return sampleCircle(e, 64);
  }
  return sampleArc(e, 64);
}

/**
 * Met à jour les sommets d'un Line2.
 * Si le nombre de segments change, on recrée la LineGeometry.
 */
function setLinePoints(
  line: Line2,
  points: Vec3[],
  forceRecreate = false,
): void {
  const positions: number[] = [];
  for (const p of points) {
    positions.push(p[0], p[1], p[2]);
  }

  const newSegCount = Math.max(0, points.length - 1);
  const geo = line.geometry as LineGeometry;
  const prevSegCount = geo.attributes.instanceStart?.count ?? -1;

  if (forceRecreate || prevSegCount !== newSegCount) {
    geo.dispose();
    const fresh = new LineGeometry();
    fresh.setPositions(positions);
    line.geometry = fresh;
  } else {
    geo.setPositions(positions);
  }

  line.computeLineDistances();
}
