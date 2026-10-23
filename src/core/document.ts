import {
  clampLayerLabel,
  DEFAULT_DRAW_LAYER,
  isDrawLayerId,
  isPositiveDrawLayer,
  parseEntityDrawLayer,
  withLayerPatch,
  type DrawLayerLabel,
  type LayerPatch,
} from './drawLayers';
import { createEmptyDocument } from './gkd';
import type {
  ArcEntity,
  CameraState,
  CircleEntity,
  Entity,
  GkdDocument,
  HelperLineEntity,
  LineEntity,
  WallEntity,
  WallStyle,
} from './types';
import {
  cloneAndTranslate,
  rotateEntityAround,
  translateEntity,
} from './entityOps';
import type { Vec3 } from './types';
import type { Aabb2 } from './selection';
import { stretchDocument } from './stretch';
import { isUnitId, type UnitId } from './units';
import { metersToDoc, TOL_M } from './tolerances';
import {
  applyWallJointsToEntities,
  snapAndRejoinWallsInBox,
  type JonctionStrategyId,
} from './walls';

/** Document de dessin en mémoire (source de vérité). */
export class CadDocument {
  private _doc: GkdDocument;
  private _filename: string;
  /** Chemin absolu disque du dernier enregistrement (si connu). */
  private _filePath: string | null = null;
  private _dirty = false;
  private _lastHelperId: string | null = null;
  private listeners = new Set<() => void>();
  /** Piles d’annulation (entités seulement). 80 pas. */
  private undoStack: Entity[][] = [];
  private redoStack: Entity[][] = [];
  private historyDepth = 0;
  private historyMute = 0;
  private static readonly HISTORY_MAX = 80;

  constructor(doc?: GkdDocument, filename = 'Sans titre.gkd') {
    this._doc = doc ?? createEmptyDocument();
    this._filename = filename;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private cloneEntities(src: readonly Entity[] = this._doc.entities): Entity[] {
    return structuredClone(src) as Entity[];
  }

  /**
   * Enregistre l’état courant une fois par opération (les appels imbriqués,
   * ex. rejoin après un ajout de mur, ne créent pas un second pas).
   */
  private mutate(fn: () => void): void {
    if (this.historyMute === 0 && this.historyDepth === 0) {
      this.undoStack.push(this.cloneEntities());
      if (this.undoStack.length > CadDocument.HISTORY_MAX) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.historyDepth += 1;
    try {
      fn();
    } finally {
      this.historyDepth = Math.max(0, this.historyDepth - 1);
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Annule la dernière modification des entités. */
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.cloneEntities());
    this._doc.entities = prev;
    this.touch();
    this.emit();
    return true;
  }

  /** Rétablit une annulation. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.cloneEntities());
    this._doc.entities = next;
    this.touch();
    this.emit();
    return true;
  }

  /**
   * Oublie le dernier pas (annulation d’un aperçu, ex. /jonction Échap).
   * Ne change pas les entités courantes.
   */
  dropLastUndo(): void {
    this.undoStack.pop();
  }

  private clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get raw(): GkdDocument {
    return this._doc;
  }

  get filename(): string {
    return this._filename;
  }

  set filename(name: string) {
    // Si on passe un chemin absolu, mémoriser path + nom de fichier
    if (name.includes('/') && name.startsWith('/')) {
      this._filePath = name.endsWith('.gkd') ? name : `${name}.gkd`;
      const base = name.split('/').pop() ?? 'Sans titre.gkd';
      this._filename = base.endsWith('.gkd') ? base : `${base}.gkd`;
      return;
    }
    this._filename = name.endsWith('.gkd') ? name : `${name}.gkd`;
  }

  /** Chemin absolu du fichier sur disque, ou null si jamais enregistré via l’explorateur. */
  get filePath(): string | null {
    return this._filePath;
  }

  set filePath(path: string | null) {
    this._filePath = path;
    if (path) {
      const base = path.split('/').pop();
      if (base) {
        this._filename = base.endsWith('.gkd') ? base : `${base}.gkd`;
      }
    }
  }

  get dirty(): boolean {
    return this._dirty;
  }

  get camera(): CameraState {
    return this._doc.camera;
  }

  setCamera(state: CameraState): void {
    this._doc.camera = { ...state };
    this._dirty = true;
  }

  get entities(): readonly Entity[] {
    return this._doc.entities;
  }

  get helpers(): HelperLineEntity[] {
    return this._doc.entities.filter((e): e is HelperLineEntity => e.kind === 'helper');
  }

  get lines(): LineEntity[] {
    return this._doc.entities.filter((e): e is LineEntity => e.kind === 'line');
  }

  get arcs(): ArcEntity[] {
    return this._doc.entities.filter((e): e is ArcEntity => e.kind === 'arc');
  }

  get circles(): CircleEntity[] {
    return this._doc.entities.filter((e): e is CircleEntity => e.kind === 'circle');
  }

  get walls(): WallEntity[] {
    return this._doc.entities.filter((e): e is WallEntity => e.kind === 'wall');
  }

  get wallLibrary(): readonly WallStyle[] {
    return this._doc.wallLibrary;
  }

  setWallLibrary(styles: WallStyle[]): void {
    this._doc.wallLibrary = styles.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l })),
    }));
    this.touch();
    this.emit();
  }

  /** Entités de dessin (hors aides). */
  get drawables(): Entity[] {
    return this._doc.entities.filter(
      (e) =>
        e.kind === 'line' ||
        e.kind === 'arc' ||
        e.kind === 'circle' ||
        e.kind === 'polyline' ||
        e.kind === 'wall' ||
        e.kind === 'object' ||
        e.kind === 'text' ||
        e.kind === 'point' ||
        e.kind === 'dimension',
    );
  }

  get lastHelper(): HelperLineEntity | null {
    if (!this._lastHelperId) {
      const all = this.helpers;
      return all[all.length - 1] ?? null;
    }
    return this.helpers.find((h) => h.id === this._lastHelperId) ?? null;
  }

  addHelper(helper: HelperLineEntity): void {
    this.mutate(() => {
      this._doc.entities.push(helper);
      this._lastHelperId = helper.id;
      this.touch();
      this.emit();
    });
  }

  addHelpers(helpers: HelperLineEntity[]): void {
    if (helpers.length === 0) return;
    this.mutate(() => {
      this._doc.entities.push(...helpers);
      this._lastHelperId = helpers[helpers.length - 1]!.id;
      this.touch();
      this.emit();
    });
  }

  get currentDrawLayer(): number {
    return parseEntityDrawLayer(this._doc.currentDrawLayer);
  }

  setCurrentDrawLayer(id: number): void {
    const n = isDrawLayerId(id) ? id : DEFAULT_DRAW_LAYER;
    if (this._doc.currentDrawLayer === n) return;
    this._doc.currentDrawLayer = n;
    this.touch();
    this.emit();
  }

  get drawLayerLabels(): readonly DrawLayerLabel[] {
    return this._doc.drawLayers ?? [];
  }

  setDrawLayerLabel(id: number, label: string): void {
    this.patchDrawLayer(id, { label: clampLayerLabel(label) });
  }

  patchDrawLayer(id: number, patch: LayerPatch): void {
    if (!isDrawLayerId(id)) return;
    if (!isPositiveDrawLayer(id)) {
      if (patch.label === undefined) return;
      const trimmed = clampLayerLabel(patch.label);
      const list = [...(this._doc.drawLayers ?? [])];
      const i = list.findIndex((l) => l.id === id);
      if (!trimmed.trim()) {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) {
        list[i] = { ...list[i], id, label: trimmed };
      } else {
        list.push({ id, label: trimmed });
        list.sort((a, b) => a.id - b.id);
      }
      this._doc.drawLayers = list;
      this.touch();
      this.emit();
      return;
    }
    this._doc.drawLayers = withLayerPatch(this._doc.drawLayers ?? [], id, patch);
    this.touch();
    this.emit();
  }

  setDrawLayers(table: readonly DrawLayerLabel[]): void {
    this._doc.drawLayers = table.map((l) => ({ ...l }));
    this.touch();
    this.emit();
  }

  /** Envoie des entités sur un autre calque. Ne supprime rien. */
  assignDrawLayer(ids: Iterable<string>, layer: number): number {
    if (!isDrawLayerId(layer)) return 0;
    const set = new Set(ids);
    if (set.size === 0) return 0;
    let n = 0;
    const next = this._doc.entities.map((e) => {
      if (!set.has(e.id)) return e;
      n += 1;
      return { ...e, drawLayer: layer };
    });
    if (n > 0) {
      this.mutate(() => {
        this._doc.entities = next;
        this.touch();
        this.emit();
      });
    }
    return n;
  }

  private stampDrawLayer(entity: Entity): Entity {
    if (isDrawLayerId(entity.drawLayer ?? NaN)) return entity;
    return { ...entity, drawLayer: this.currentDrawLayer };
  }

  addEntity(entity: Entity): void {
    this.mutate(() => {
      const e = this.stampDrawLayer(entity);
      this._doc.entities.push(e);
      if (e.kind === 'wall') this.rejoinWalls();
      this.touch();
      this.emit();
    });
  }

  addEntities(entities: Entity[]): void {
    if (entities.length === 0) return;
    this.mutate(() => {
      const stamped = entities.map((e) => this.stampDrawLayer(e));
      this._doc.entities.push(...stamped);
      if (stamped.some((e) => e.kind === 'wall')) this.rejoinWalls();
      this.touch();
      this.emit();
    });
  }

  /** Recalcule les onglets (miter) entre murs linéaires qui se touchent. */
  rejoinWalls(): void {
    this._doc.entities = applyWallJointsToEntities(
      this._doc.entities,
      undefined,
      'first-hit',
      this.units,
    );
  }

  /** Retire une entité par id. */
  removeEntity(id: string): boolean {
    return this.removeEntities([id]) > 0;
  }

  /**
   * Supprime plusieurs entités.
   * Cotation → supprime aussi son TextEntity libellé (`labelId`).
   * Texte libellé → détache la cotation parente (`labelId`).
   */
  removeEntities(ids: Iterable<string>): number {
    const set = new Set(ids);
    if (set.size === 0) return 0;

    // Étendre : dim → son label
    for (const e of this._doc.entities) {
      if (e.kind === 'dimension' && set.has(e.id) && e.labelId) {
        set.add(e.labelId);
      }
    }

    let n = 0;
    this.mutate(() => {
      const before = this._doc.entities.length;
      this._doc.entities = this._doc.entities
        .filter((e) => !set.has(e.id))
        .map((e) => {
          // Texte libellé supprimé seul → cotation orpheline sans labelId
          if (e.kind === 'dimension' && e.labelId && set.has(e.labelId)) {
            return { ...e, labelId: undefined };
          }
          return e;
        });

      this._doc.entities = this._doc.entities.map((e) => {
        if (e.kind !== 'dimension' || !e.labelId) return e;
        const stillThere = this._doc.entities.some((x) => x.id === e.labelId);
        if (!stillThere) return { ...e, labelId: undefined };
        return e;
      });

      n = before - this._doc.entities.length;
      if (n > 0 || set.size > 0) {
        if (this._lastHelperId && set.has(this._lastHelperId)) {
          this._lastHelperId = null;
        }
        this.rejoinWalls();
        this.touch();
        this.emit();
      }
    });
    return n;
  }

  /**
   * Déplace les entités (ids) de (dx,dy,dz).
   * Si une cotation est déplacée, son libellé (`labelId`) suit automatiquement.
   */
  translateEntities(ids: Iterable<string>, dx: number, dy: number, dz = 0): number {
    const set = new Set(ids);
    // Cotation sélectionnée → libellé suit
    for (const e of this._doc.entities) {
      if (e.kind === 'dimension' && set.has(e.id) && e.labelId) {
        set.add(e.labelId);
      }
    }
    let n = 0;
    const next = this._doc.entities.map((e) => {
      if (!set.has(e.id)) return e;
      n += 1;
      return translateEntity(e, dx, dy, dz);
    });
    if (n > 0) {
      this.mutate(() => {
        this._doc.entities = next;
        this.rejoinWalls();
        this.touch();
        this.emit();
      });
    }
    return n;
  }

  /** Remplace une entité par une version mise à jour (même id). */
  updateEntity(next: Entity): boolean {
    const idx = this._doc.entities.findIndex((e) => e.id === next.id);
    if (idx < 0) return false;
    this.mutate(() => {
      this._doc.entities[idx] = next;
      this.rejoinWalls();
      this.touch();
      this.emit();
    });
    return true;
  }

  /**
   * Rotation autour d’un pivot (axe Z).
   * Cotation sélectionnée → son libellé suit.
   */
  rotateEntities(ids: Iterable<string>, pivot: Vec3, angle: number): number {
    const set = new Set(ids);
    for (const e of this._doc.entities) {
      if (e.kind === 'dimension' && set.has(e.id) && e.labelId) {
        set.add(e.labelId);
      }
    }
    let n = 0;
    const next = this._doc.entities.map((e) => {
      if (!set.has(e.id)) return e;
      n += 1;
      return rotateEntityAround(e, pivot, angle);
    });
    if (n > 0) {
      this.mutate(() => {
        this._doc.entities = next;
        this.rejoinWalls();
        this.touch();
        this.emit();
      });
    }
    return n;
  }

  /**
   * /stretch — extrémités dans le cadre (ou objets entiers) déplacés de (dx,dy,dz).
   * Retourne le nombre d’entités modifiées.
   */
  stretchByBox(box: Aabb2, dx: number, dy: number, dz = 0): number {
    const { entities, changed } = stretchDocument(
      this._doc.entities,
      box,
      dx,
      dy,
      dz,
      this.units,
    );
    if (changed > 0) {
      this.mutate(() => {
        this._doc.entities = entities;
        this.touch();
        this.emit();
      });
    }
    return changed;
  }

  /**
   * /jonction — fusionne les extrémités de murs proches dans le cadre
   * puis recalcule les onglets (stratégie T/Y optionnelle).
   */
  rejoinWallsInBox(
    box: Aabb2,
    snapTol?: number,
    strategy: JonctionStrategyId = 'first-hit',
  ): {
    wallsTouched: number;
    clusters: number;
    extended: number;
    maxNodeDegree: number;
    signature: string | null;
    nearestEndDist: number | null;
    /** Snapshot après snap, avant joints (pour cycler les stratégies). */
    snappedEntities: Entity[];
  } {
    const result = snapAndRejoinWallsInBox(
      this._doc.entities,
      box,
      snapTol ?? metersToDoc(TOL_M.wallRejoinSnap, this.units),
      strategy,
      this.units,
    );
    this.mutate(() => {
      if (result.wallsTouched > 0 || result.clusters > 0 || result.extended > 0) {
        this._doc.entities = result.entities;
        this.touch();
        this.emit();
      } else {
        this._doc.entities = applyWallJointsToEntities(
          this._doc.entities,
          undefined,
          strategy,
          this.units,
        );
        this.touch();
        this.emit();
      }
    });
    return {
      wallsTouched: result.wallsTouched,
      clusters: result.clusters,
      extended: result.extended,
      maxNodeDegree: result.maxNodeDegree,
      signature: result.signature,
      nearestEndDist: result.nearestEndDist,
      snappedEntities: result.snappedEntities,
    };
  }

  /**
   * Remplace toutes les entités (ex. cycle solutions /jonction, annulation).
   * Recalcule les joints avec la stratégie donnée si demandée.
   */
  replaceAllEntities(
    entities: readonly Entity[],
    opts?: { rejoin?: boolean; strategy?: JonctionStrategyId; history?: boolean },
  ): void {
    const apply = () => {
      const strategy = opts?.strategy ?? 'first-hit';
      if (opts?.rejoin) {
        this._doc.entities = applyWallJointsToEntities(
          entities,
          undefined,
          strategy,
          this.units,
        );
      } else {
        this._doc.entities = entities.map((e) => ({ ...e })) as Entity[];
      }
      this.touch();
      this.emit();
    };
    if (opts?.history === false) apply();
    else this.mutate(apply);
  }

  /** Copie les entités (nouveaux ids) décalées de (dx,dy,dz). */
  copyEntities(ids: Iterable<string>, dx: number, dy: number, dz = 0): Entity[] {
    const set = new Set(ids);
    // Cotation → inclure son libellé TextEntity
    for (const e of this._doc.entities) {
      if (e.kind === 'dimension' && set.has(e.id) && e.labelId) {
        set.add(e.labelId);
      }
    }
    const src = this._doc.entities.filter((e) => set.has(e.id));
    if (src.length === 0) return [];
    const copies = cloneAndTranslate(src, dx, dy, dz, this.units);
    this.mutate(() => {
      this._doc.entities.push(...copies);
      this.rejoinWalls();
      this.touch();
      this.emit();
    });
    return copies;
  }

  /**
   * Remplace une entité par une ou plusieurs (ex. /cut : 1 ligne → 2 segments).
   * Conserve l'ordre relatif dans la liste.
   */
  replaceEntity(id: string, replacements: Entity[]): boolean {
    const idx = this._doc.entities.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.mutate(() => {
      this._doc.entities.splice(idx, 1, ...replacements);
      if (this._lastHelperId === id) this._lastHelperId = null;
      this.rejoinWalls();
      this.touch();
      this.emit();
    });
    return true;
  }

  /** Efface toutes les lignes d'aide d'un coup (grosse force d'ARC+). */
  clearHelpers(): number {
    const before = this._doc.entities.length;
    const next = this._doc.entities.filter((e) => e.kind !== 'helper');
    const n = before - next.length;
    if (n > 0) {
      this.mutate(() => {
        this._doc.entities = next;
        this._lastHelperId = null;
        this.touch();
        this.emit();
      });
    }
    return n;
  }

  removeHelper(id: string): boolean {
    const next = this._doc.entities.filter((e) => e.id !== id);
    const ok = next.length < this._doc.entities.length;
    if (ok) {
      this.mutate(() => {
        this._doc.entities = next;
        if (this._lastHelperId === id) this._lastHelperId = null;
        this.touch();
        this.emit();
      });
    }
    return ok;
  }

  load(doc: GkdDocument, filename: string, filePath?: string | null): void {
    this.clearHistory();
    this._doc = doc;
    if (filePath) {
      this._filePath = filePath;
      const base = filePath.split('/').pop() ?? filename;
      this._filename = base.endsWith('.gkd') ? base : `${base}.gkd`;
    } else if (filename.includes('/') && filename.startsWith('/')) {
      this._filePath = filename;
      const base = filename.split('/').pop() ?? 'Sans titre.gkd';
      this._filename = base.endsWith('.gkd') ? base : `${base}.gkd`;
    } else {
      this._filePath = null;
      this._filename = filename.endsWith('.gkd') ? filename : `${filename}.gkd`;
    }
    this._dirty = false;
    this._lastHelperId = null;
    this.rejoinWalls();
    this.emit();
  }

  get units(): UnitId {
    const u = this._doc.meta?.units;
    return isUnitId(u) ? u : 'm';
  }

  setUnits(unit: UnitId, opts?: { dirty?: boolean }): void {
    if (this.units === unit) return;
    this._doc.meta = { ...this._doc.meta, units: unit };
    if (opts?.dirty !== false) this.touch();
  }

  /**
   * Multiplie toutes les coordonnées / longueurs du document (changement d'unité).
   * factor = convertFactor(from, to).
   */
  scaleWorld(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-15) return;
    this.mutate(() => {
    const s = (v: number) => v * factor;
    const sp = (p: [number, number, number]): [number, number, number] => [
      s(p[0]),
      s(p[1]),
      s(p[2]),
    ];

    this._doc.entities = this._doc.entities.map((e) => {
      if (e.kind === 'line') {
        return { ...e, start: sp(e.start), end: sp(e.end) };
      }
      if (e.kind === 'arc') {
        return {
          ...e,
          center: sp(e.center),
          radius: s(e.radius),
        };
      }
      if (e.kind === 'circle') {
        return {
          ...e,
          center: sp(e.center),
          radius: s(e.radius),
        };
      }
      if (e.kind === 'helper') {
        return { ...e, origin: sp(e.origin) };
      }
      if (e.kind === 'wall') {
        return {
          ...e,
          start: sp(e.start),
          end: sp(e.end),
          center: e.center ? sp(e.center) : undefined,
          radius: e.radius !== undefined ? s(e.radius) : undefined,
          lines: e.lines.map((l) => ({ ...l, offset: s(l.offset) })),
          strokeGeom: e.strokeGeom?.map((g) => ({
            ...g,
            offset: s(g.offset),
            start: sp(g.start),
            end: sp(g.end),
          })),
        };
      }
      if (e.kind === 'object') {
        return { ...e, origin: sp(e.origin) };
      }
      if (e.kind === 'text') {
        return {
          ...e,
          position: sp(e.position),
          height: s(e.height),
          boxPadding:
            e.boxPadding !== undefined ? s(e.boxPadding) : e.boxPadding,
        };
      }
      if (e.kind === 'dimension') {
        return {
          ...e,
          lineAnchor: sp(e.lineAnchor),
          defPoints: e.defPoints.map((p) => sp(p)),
          labelPositions: e.labelPositions?.map((p) => sp(p)),
          labelRotations: e.labelRotations
            ? [...e.labelRotations]
            : undefined,
          style: {
            ...e.style,
            textHeight: s(e.style.textHeight),
            extensionOffset: s(e.style.extensionOffset),
            extensionOverhang: s(e.style.extensionOverhang),
            tickSize: s(e.style.tickSize),
            textOffset: s(e.style.textOffset ?? 0.05),
          },
        };
      }
      return e;
    });

    // Bibliothèque de murs du document
    this._doc.wallLibrary = this._doc.wallLibrary.map((st) => ({
      ...st,
      lines: st.lines.map((l) => ({ ...l, offset: s(l.offset) })),
    }));

    const cam = this._doc.camera;
    this._doc.camera = {
      ...cam,
      target: sp(cam.target),
      position: sp(cam.position),
      orthoHalfHeight: s(cam.orthoHalfHeight),
    };

    this.rejoinWalls();
    this.touch();
    this.emit();
    });
  }

  reset(): void {
    this.clearHistory();
    this._doc = createEmptyDocument();
    this._filename = 'Sans titre.gkd';
    this._filePath = null;
    this._dirty = false;
    this._lastHelperId = null;
    this.emit();
  }

  touch(): void {
    this._dirty = true;
    this._doc.modified = new Date().toISOString();
  }

  markSaved(): void {
    this._dirty = false;
  }

  /** Snapshot pour sérialisation .GKD (caméra à jour fournie par le viewport). */
  snapshot(camera: CameraState): GkdDocument {
    return {
      ...this._doc,
      entities: this._doc.entities.map((e) =>
        e.kind === 'wall'
          ? {
              ...e,
              lines: e.lines.map((l) => ({ ...l })),
              strokeGeom: e.strokeGeom?.map((g) => ({
                ...g,
                start: [...g.start] as [number, number, number],
                end: [...g.end] as [number, number, number],
              })),
            }
          : { ...e },
      ),
      wallLibrary: this._doc.wallLibrary.map((s) => ({
        ...s,
        lines: s.lines.map((l) => ({ ...l })),
      })),
      drawLayers: (this._doc.drawLayers ?? []).map((l) => ({ ...l })),
      currentDrawLayer: this.currentDrawLayer,
      camera: { ...camera },
      modified: new Date().toISOString(),
    };
  }
}
