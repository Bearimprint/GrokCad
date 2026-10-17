/**
 * Calques de dessin (1–127) et calques d’insertion (−1…−127).
 *
 * Pas de couche 0. L’ordre d’affichage des calques positifs :
 * 1 dessiné en premier (fond), 127 en dernier (devant).
 * Libellé : 255 caractères max.
 *
 * Les calques négatifs ne servent qu’aux objets « insertions »
 * (library/insertions/) destinés à un mur, une ligne ou un arc.
 */

import type { DrawLayerLabel, Entity, GkdDocument } from './types';

/** Surface minimale du document pour le gestionnaire de calques (évite un import circulaire). */
export interface DrawLayerDoc {
  currentDrawLayer: number;
  drawLayerLabels: readonly DrawLayerLabel[];
  setCurrentDrawLayer(id: number): void;
  setDrawLayerLabel(id: number, label: string): void;
}

export const DRAW_LAYER_MIN = 1;
export const DRAW_LAYER_MAX = 127;
export const INSERT_LAYER_MIN = -127;
export const INSERT_LAYER_MAX = -1;
export const DEFAULT_DRAW_LAYER = 1;
export const LAYER_LABEL_MAX = 255;

/** Dossier library/ des objets à insérer dans un mur / une ligne / un arc. */
export const INSERTIONS_TAB = 'insertions';

export const INSERTION_CATEGORIES = ['doors', 'windows', 'others'] as const;
export type InsertCategory = (typeof INSERTION_CATEGORIES)[number];

export const INSERTION_CATEGORY_LABELS: Record<InsertCategory, string> = {
  doors: 'Portes',
  windows: 'Fenêtres',
  others: 'Autres',
};

export function insertionTab(cat: InsertCategory): string {
  return `${INSERTIONS_TAB}/${cat}`;
}

export function isInsertionsTab(tab: string): boolean {
  return tab === INSERTIONS_TAB || tab.startsWith(`${INSERTIONS_TAB}/`);
}

export function parseInsertCategory(tab: string): InsertCategory | null {
  if (!tab.startsWith(`${INSERTIONS_TAB}/`)) return null;
  const sub = tab.slice(INSERTIONS_TAB.length + 1);
  return (INSERTION_CATEGORIES as readonly string[]).includes(sub)
    ? (sub as InsertCategory)
    : null;
}

/** Point d’ancrage (gros rond orange). Obligatoire pour toute insertion. */
export const ANCHOR_LAYER = -9;

export interface StretchAxes {
  x: boolean;
  y: boolean;
  z: boolean;
}

export type { DrawLayerLabel };

export type DrawLayerListener = () => void;

const STRETCH_BY_LAYER: Record<number, StretchAxes> = {
  [-1]: { x: false, y: false, z: false },
  [-2]: { x: true, y: false, z: false },
  [-3]: { x: false, y: true, z: false },
  [-4]: { x: false, y: false, z: true },
  [-5]: { x: true, y: true, z: false },
  [-6]: { x: true, y: false, z: true },
  [-7]: { x: false, y: true, z: true },
  [-8]: { x: true, y: true, z: true },
};

const INSERT_DEFAULT_LABELS: Record<number, string> = {
  [-1]: 'Fixe (taille inchangée)',
  [-2]: 'Étirable X',
  [-3]: 'Étirable Y',
  [-4]: 'Étirable Z',
  [-5]: 'Étirable XY',
  [-6]: 'Étirable XZ',
  [-7]: 'Étirable YZ',
  [-8]: 'Étirable XYZ',
  [-9]: 'Point d’ancrage',
};

export function isDrawLayerId(n: number): boolean {
  return (
    Number.isInteger(n) &&
    n !== 0 &&
    ((n >= DRAW_LAYER_MIN && n <= DRAW_LAYER_MAX) ||
      (n >= INSERT_LAYER_MIN && n <= INSERT_LAYER_MAX))
  );
}

export function isPositiveDrawLayer(n: number): boolean {
  return Number.isInteger(n) && n >= DRAW_LAYER_MIN && n <= DRAW_LAYER_MAX;
}

export function isInsertLayer(n: number): boolean {
  return Number.isInteger(n) && n >= INSERT_LAYER_MIN && n <= INSERT_LAYER_MAX;
}

/** Anciens .gkd / valeur absente / 0 / NaN → couche 1. Ne crée jamais de couche négative. */
export function parseEntityDrawLayer(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    if (isDrawLayerId(n)) return n;
  }
  return DEFAULT_DRAW_LAYER;
}

export function clampLayerLabel(raw: string): string {
  const t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return t.length <= LAYER_LABEL_MAX ? t : t.slice(0, LAYER_LABEL_MAX);
}

export function defaultLayerLabel(id: number): string {
  if (id === 1) return 'Bedrock layer';
  if (INSERT_DEFAULT_LABELS[id]) return INSERT_DEFAULT_LABELS[id]!;
  return `Couche numero ${id}`;
}

export function stretchAxesOf(drawLayer: number | undefined): StretchAxes {
  if (typeof drawLayer !== 'number') return { x: false, y: false, z: false };
  return STRETCH_BY_LAYER[drawLayer] ?? { x: false, y: false, z: false };
}

export function isAnchorLayer(drawLayer: number | undefined): boolean {
  return drawLayer === ANCHOR_LAYER;
}

export function entityDrawLayer(e: { drawLayer?: number }): number {
  return parseEntityDrawLayer(e.drawLayer);
}

/** renderOrder Three.js : 1 derrière, 127 devant. Négatifs au-dessus du 127 en édition. */
export function renderOrderForDrawLayer(drawLayer: number | undefined): number {
  const n = parseEntityDrawLayer(drawLayer);
  if (n > 0) return n * 10;
  // −1 → 1280, −9 (ancre) un peu au-dessus de ses voisins
  if (n === ANCHOR_LAYER) return 1280 + 200;
  return 1280 + Math.abs(n);
}

export function normalizeDrawLayerTable(raw: unknown): DrawLayerLabel[] {
  if (!Array.isArray(raw)) return [];
  const out: DrawLayerLabel[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { id?: unknown; label?: unknown };
    if (typeof o.id !== 'number' || !isDrawLayerId(Math.round(o.id))) continue;
    const id = Math.round(o.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof o.label === 'string' ? clampLayerLabel(o.label) : '';
    if (!label.trim()) continue;
    out.push({ id, label });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function labelOfLayer(
  id: number,
  table: readonly DrawLayerLabel[] | undefined,
): string {
  const hit = table?.find((l) => l.id === id);
  if (hit && hit.label.trim()) return hit.label;
  return defaultLayerLabel(id);
}

export function formatLayerRow(
  id: number,
  table?: readonly DrawLayerLabel[],
): string {
  return `${id}  ${labelOfLayer(id, table)}`;
}

/** L’objet a-t-il au moins un point d’ancrage (couche −9) ? */
export function hasAnchorPoint(entities: readonly Entity[]): boolean {
  return entities.some(
    (e) => e.kind === 'point' && entityDrawLayer(e) === ANCHOR_LAYER,
  );
}

/** Premier point de la couche −9 (ou barycentre s’il y en a plusieurs). */
export function findAnchorPoint(
  entities: readonly Entity[],
): [number, number, number] | null {
  const pts = entities.filter(
    (e): e is Extract<Entity, { kind: 'point' }> =>
      e.kind === 'point' && entityDrawLayer(e) === ANCHOR_LAYER,
  );
  if (pts.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.position[0];
    y += p.position[1];
    z += p.position[2];
  }
  const n = pts.length;
  return [x / n, y / n, z / n];
}

/** Présence d’au moins une entité sur un calque d’insertion (−1…−127). */
export function hasInsertLayers(entities: readonly Entity[]): boolean {
  return entities.some((e) => isInsertLayer(entityDrawLayer(e)));
}

export function positiveLayerIds(): number[] {
  const out: number[] = [];
  for (let i = DRAW_LAYER_MIN; i <= DRAW_LAYER_MAX; i++) out.push(i);
  return out;
}

export function insertLayerIds(): number[] {
  const out: number[] = [];
  for (let i = INSERT_LAYER_MAX; i >= INSERT_LAYER_MIN; i--) out.push(i);
  return out;
}

/**
 * Gestionnaire UI / session : couche courante + libellés du document.
 *
 * Deux IDs distincts :
 * - standard (1–127) toujours affiché ;
 * - spécial (−1…−127) affiché si biblio insertions ouverte ou édition canvas.
 * La liste canvas et l’ID spécial de la barre lisent la même `insertLayer`.
 */
export class DrawLayerManager {
  private insertModeOn = false;
  private libraryInsertOpenOn = false;
  private insertLayerId = INSERT_LAYER_MAX; // −1
  private standardLayerId = DEFAULT_DRAW_LAYER;
  private listeners = new Set<DrawLayerListener>();

  constructor(private doc: DrawLayerDoc) {
    const cur = this.doc.currentDrawLayer;
    if (cur > 0) this.standardLayerId = cur;
    if (cur < 0) this.insertLayerId = cur;
  }

  onChange(fn: DrawLayerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Couche réellement utilisée pour le prochain objet. */
  get current(): number {
    return this.doc.currentDrawLayer;
  }

  get insertMode(): boolean {
    return this.insertModeOn;
  }

  /** Biblio insertions (portes/fenêtres/autres) ouverte. */
  get libraryInsertOpen(): boolean {
    return this.libraryInsertOpenOn;
  }

  /** Afficher l’ID des calques spéciaux (barre). */
  get showSpecialId(): boolean {
    return this.insertModeOn || this.libraryInsertOpenOn;
  }

  /** Calque spécial affiché / surligné (−1…−127). Jamais désync de la liste canvas. */
  get insertLayer(): number {
    return this.insertLayerId;
  }

  get standardLayer(): number {
    return this.standardLayerId;
  }

  get table(): readonly DrawLayerLabel[] {
    return this.doc.drawLayerLabels;
  }

  label(id: number): string {
    return labelOfLayer(id, this.table);
  }

  setLibraryInsertOpen(on: boolean): void {
    if (this.libraryInsertOpenOn === on) return;
    this.libraryInsertOpenOn = on;
    this.emit();
  }

  setInsertMode(on: boolean): void {
    if (this.insertModeOn === on) {
      if (on) this.doc.setCurrentDrawLayer(this.insertLayerId);
      return;
    }
    this.insertModeOn = on;
    if (on) {
      this.doc.setCurrentDrawLayer(this.insertLayerId);
    } else {
      this.libraryInsertOpenOn = false;
      const std = isPositiveDrawLayer(this.standardLayerId)
        ? this.standardLayerId
        : DEFAULT_DRAW_LAYER;
      this.doc.setCurrentDrawLayer(std);
    }
    this.emit();
  }

  setCurrent(id: number): boolean {
    if (!isDrawLayerId(id)) return false;
    if (id > 0) {
      this.standardLayerId = id;
      this.doc.setCurrentDrawLayer(id);
      this.emit();
      return true;
    }
    if (!this.insertModeOn && !this.libraryInsertOpen) return false;
    return this.setInsertLayer(id);
  }

  /**
   * Change le calque spécial (barre + liste canvas).
   * En édition canvas, c’est aussi le calque de dessin.
   */
  setInsertLayer(id: number): boolean {
    if (!isInsertLayer(id)) return false;
    this.insertLayerId = id;
    if (this.insertModeOn) this.doc.setCurrentDrawLayer(id);
    this.emit();
    return true;
  }

  /** Ancre −9 obligatoire : force barre + liste + stylo. */
  forceAnchorLayer(): void {
    this.insertLayerId = ANCHOR_LAYER;
    if (this.insertModeOn) this.doc.setCurrentDrawLayer(ANCHOR_LAYER);
    this.emit();
  }

  setLabel(id: number, label: string): boolean {
    if (!isDrawLayerId(id)) return false;
    this.doc.setDrawLayerLabel(id, clampLayerLabel(label));
    this.emit();
    return true;
  }

  listStandard(): { id: number; label: string }[] {
    return positiveLayerIds().map((id) => ({ id, label: this.label(id) }));
  }

  listSpecial(): { id: number; label: string }[] {
    return insertLayerIds().map((id) => ({ id, label: this.label(id) }));
  }

  /** Liste pour le menu déroulant / le dialogue. */
  listForUi(): { id: number; label: string }[] {
    const rows = this.listStandard();
    if (this.showSpecialId) {
      rows.push(...this.listSpecial());
    }
    return rows;
  }

  /** Re-lire après load/reset de document. */
  notifyDocChanged(): void {
    const cur = this.doc.currentDrawLayer;
    if (this.insertModeOn) {
      if (isInsertLayer(cur)) this.insertLayerId = cur;
      else if (isPositiveDrawLayer(cur)) this.standardLayerId = cur;
    } else {
      if (isPositiveDrawLayer(cur)) this.standardLayerId = cur;
      else if (isInsertLayer(cur)) {
        this.doc.setCurrentDrawLayer(this.standardLayerId);
      }
    }
    this.emit();
  }
}

export function documentLayerState(doc: GkdDocument): {
  drawLayers: DrawLayerLabel[];
  currentDrawLayer: number;
} {
  return {
    drawLayers: normalizeDrawLayerTable(doc.drawLayers),
    currentDrawLayer: parseEntityDrawLayer(doc.currentDrawLayer),
  };
}
