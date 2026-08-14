/**
 * Catalogue des types de couches de mur + priorités de raccord.
 *
 * Source : library/walls/layer-priorities.json
 * Fallback : DEFAULT_LAYER_TYPES (embarqué) si le fichier est absent / illisible.
 *
 * Priorité 1 = plus haute importance (ex. structure béton) :
 * une couche prioritaire rejoint sa correspondante en traversant
 * les couches de priorité plus faible (modèle type Revit / ArchiCAD).
 */

import type { LineStyleId } from './types';

export const WALL_LAYER_CATALOG_PATH = 'library/walls/layer-priorities.json';
/** Clé localStorage miroir (édition hors fichier possible plus tard). */
export const WALL_LAYER_CATALOG_STORAGE_KEY = 'grokcad.wallLayerCatalog';

/** Priorité par défaut si une couche n’en a pas (anciens .GKD). */
export const DEFAULT_LAYER_PRIORITY = 3;

export interface WallLayerTypeDef {
  id: string;
  /** 1 = plus haute importance, nombres plus grands = moindre importance. */
  priority: number;
  name: string;
  defaultColor?: string;
  defaultLineWidth?: number;
  defaultLineStyle?: LineStyleId;
}

export interface WallLayerCatalogFile {
  version: 1;
  description?: string;
  types: WallLayerTypeDef[];
}

/** Catalogue embarqué (copie de library/walls/layer-priorities.json). */
export const DEFAULT_LAYER_TYPES: readonly WallLayerTypeDef[] = [
  {
    id: 'structure-beton',
    priority: 1,
    name: 'mur porteur en béton armé',
    defaultColor: '#4a4a4a',
    defaultLineWidth: 2,
    defaultLineStyle: 'plein',
  },
  {
    id: 'structure-parpaing',
    priority: 2,
    name: 'parpaing / brique porteuse',
    defaultColor: '#6b6b6b',
    defaultLineWidth: 2,
    defaultLineStyle: 'plein',
  },
  {
    id: 'structure-ossature',
    priority: 2,
    name: 'ossature bois / métal',
    defaultColor: '#8b6914',
    defaultLineWidth: 1,
    defaultLineStyle: 'plein',
  },
  {
    id: 'isolant',
    priority: 3,
    name: 'isolant thermique',
    defaultColor: '#e6b800',
    defaultLineWidth: 1,
    defaultLineStyle: 'tiret',
  },
  {
    id: 'air',
    priority: 4,
    name: "lame d'air / cavité",
    defaultColor: '#9aa0a6',
    defaultLineWidth: 1,
    defaultLineStyle: 'pointille',
  },
  {
    id: 'placo-13',
    priority: 5,
    name: 'placo-platre 13mm',
    defaultColor: '#c8c8c8',
    defaultLineWidth: 1,
    defaultLineStyle: 'plein',
  },
  {
    id: 'placo-ba13-double',
    priority: 5,
    name: 'double BA13',
    defaultColor: '#b0b0b0',
    defaultLineWidth: 1,
    defaultLineStyle: 'plein',
  },
  {
    id: 'enduit',
    priority: 5,
    name: 'enduit / finition',
    defaultColor: '#e8e8e8',
    defaultLineWidth: 1,
    defaultLineStyle: 'plein',
  },
  {
    id: 'membrane',
    priority: 6,
    name: 'membrane / pare-vapeur',
    defaultColor: '#5c9ead',
    defaultLineWidth: 1,
    defaultLineStyle: 'pointille',
  },
  {
    id: 'generique',
    priority: 3,
    name: 'couche générique',
    defaultColor: '#000000',
    defaultLineWidth: 1,
    defaultLineStyle: 'plein',
  },
] as const;

export const DEFAULT_LAYER_TYPE_ID = 'generique';

const LINE_STYLES: readonly LineStyleId[] = [
  'plein',
  'pointille',
  'pointille_espace',
  'tiret',
  'tiret_point',
  'tiret_point_point',
  'long_tiret',
];

function isLineStyleId(v: unknown): v is LineStyleId {
  return typeof v === 'string' && (LINE_STYLES as readonly string[]).includes(v);
}

export function normalizeLayerType(raw: unknown): WallLayerTypeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<WallLayerTypeDef>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const p =
    typeof o.priority === 'number' && Number.isFinite(o.priority)
      ? Math.max(1, Math.min(99, Math.round(o.priority)))
      : DEFAULT_LAYER_PRIORITY;
  const def: WallLayerTypeDef = {
    id: o.id.trim(),
    priority: p,
    name: o.name.trim(),
  };
  if (typeof o.defaultColor === 'string' && o.defaultColor) {
    def.defaultColor = o.defaultColor;
  }
  if (
    typeof o.defaultLineWidth === 'number' &&
    o.defaultLineWidth > 0 &&
    Number.isFinite(o.defaultLineWidth)
  ) {
    def.defaultLineWidth = Math.max(1, Math.min(7, Math.round(o.defaultLineWidth)));
  }
  if (isLineStyleId(o.defaultLineStyle)) {
    def.defaultLineStyle = o.defaultLineStyle;
  }
  return def;
}

export function normalizeCatalog(raw: unknown): WallLayerCatalogFile {
  const base: WallLayerCatalogFile = {
    version: 1,
    types: DEFAULT_LAYER_TYPES.map((t) => ({ ...t })),
  };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<WallLayerCatalogFile>;
  if (typeof o.description === 'string') base.description = o.description;
  if (Array.isArray(o.types) && o.types.length > 0) {
    const types = o.types
      .map(normalizeLayerType)
      .filter((t): t is WallLayerTypeDef => t !== null);
    if (types.length > 0) base.types = types;
  }
  // Garantir un type générique
  if (!base.types.some((t) => t.id === DEFAULT_LAYER_TYPE_ID)) {
    const gen = DEFAULT_LAYER_TYPES.find((t) => t.id === DEFAULT_LAYER_TYPE_ID)!;
    base.types.push({ ...gen });
  }
  // Tri affichage : priorité croissante puis nom
  base.types.sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'fr'),
  );
  return base;
}

export function defaultCatalog(): WallLayerCatalogFile {
  return normalizeCatalog({ version: 1, types: DEFAULT_LAYER_TYPES });
}

/** Priorité effective d’une couche (champ stocké ou défaut). */
export function layerPriorityOf(line: {
  priority?: number;
  layerTypeId?: string;
}): number {
  if (typeof line.priority === 'number' && Number.isFinite(line.priority)) {
    return Math.max(1, Math.min(99, Math.round(line.priority)));
  }
  return DEFAULT_LAYER_PRIORITY;
}

/**
 * Modèle matériau = **bande entre deux traits**, pas le trait seul.
 *
 * Création :
 * - trait 0 (1ʳᵉ face) : pas de type / priorité (simple géométrie)
 * - chaque épaisseur ajoute un trait dont type/prio = le **matériau de la bande**
 *   qu’on vient de fermer (entre le trait précédent et le nouveau).
 *
 * Un trait intermédiaire est donc **partagé** par deux matériaux :
 * ex. fin structure-béton = début isolant. Pour le raccord on prend la
 * priorité la plus importante (nombre le plus petit) des matériaux adjacents.
 *
 * Ex. offsets 0 / 0.02(enduit) / 0.18(béton) / 0.28(isolant) / 0.293(placo) :
 * - trait 0.02 → min(enduit 5, béton 1) = **1** (face béton)
 * - trait 0.18 → min(béton 1, isolant 3) = **1** (face béton)
 * - trait 0.28 → min(isolant 3, placo 5) = **3**
 * - trait 0.293 → placo **5**
 */
export function wallLineJoinPriority(
  lines: readonly { offset: number; priority?: number; layerTypeId?: string }[],
  line: { offset: number; priority?: number; layerTypeId?: string },
): number {
  if (!lines.length) return layerPriorityOf(line);
  const sorted = [...lines].sort((a, b) => a.offset - b.offset);
  const i = sorted.findIndex((l) => Math.abs(l.offset - line.offset) < 1e-9);
  if (i < 0) return layerPriorityOf(line);

  // 1ʳᵉ face : uniquement le matériau de la 1ʳᵉ bande (trait suivant)
  if (i === 0) {
    if (sorted.length >= 2) return layerPriorityOf(sorted[1]!);
    return layerPriorityOf(sorted[0]!);
  }
  // Dernière face : uniquement le matériau de la dernière bande (ce trait)
  if (i === sorted.length - 1) {
    return layerPriorityOf(sorted[i]!);
  }
  // Trait partagé : min des deux matériaux (bande qui se termine + bande qui commence)
  return Math.min(layerPriorityOf(sorted[i]!), layerPriorityOf(sorted[i + 1]!));
}

/** Type(s) de matériau adjacents à un trait (pour UI / debug). */
export function wallLineMaterialTypeIds(
  lines: readonly { offset: number; layerTypeId?: string }[],
  line: { offset: number; layerTypeId?: string },
): string[] {
  if (!lines.length) return line.layerTypeId ? [line.layerTypeId] : [];
  const sorted = [...lines].sort((a, b) => a.offset - b.offset);
  const i = sorted.findIndex((l) => Math.abs(l.offset - line.offset) < 1e-9);
  if (i < 0) return line.layerTypeId ? [line.layerTypeId] : [];
  const ids: string[] = [];
  if (i === 0) {
    if (sorted[1]?.layerTypeId) ids.push(sorted[1].layerTypeId);
  } else if (i === sorted.length - 1) {
    if (sorted[i]?.layerTypeId) ids.push(sorted[i]!.layerTypeId!);
  } else {
    if (sorted[i]?.layerTypeId) ids.push(sorted[i]!.layerTypeId!);
    if (sorted[i + 1]?.layerTypeId) ids.push(sorted[i + 1]!.layerTypeId!);
  }
  return [...new Set(ids)];
}

/** Libellé court pour l’UI : « 1 — mur porteur… ». */
export function formatLayerTypeLabel(t: WallLayerTypeDef): string {
  return `${t.priority} — ${t.name}`;
}

export type WallLayerCatalogListener = (catalog: WallLayerCatalogFile) => void;

/**
 * Gestionnaire du catalogue (source de vérité UI).
 * Charge le JSON disque via l’API library, sinon localStorage, sinon défauts.
 */
export class WallLayerCatalogManager {
  private catalog: WallLayerCatalogFile;
  private listeners = new Set<WallLayerCatalogListener>();
  private loaded = false;

  constructor(initial?: WallLayerCatalogFile) {
    this.catalog = initial ?? loadCatalogFromStorage() ?? defaultCatalog();
  }

  get file(): WallLayerCatalogFile {
    return this.catalog;
  }

  get types(): readonly WallLayerTypeDef[] {
    return this.catalog.types;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  onChange(fn: WallLayerCatalogListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveCatalogToStorage(this.catalog);
    for (const fn of this.listeners) fn(this.catalog);
  }

  findById(id: string | undefined | null): WallLayerTypeDef | undefined {
    if (!id) return undefined;
    return this.catalog.types.find((t) => t.id === id);
  }

  /** Type par défaut pour une nouvelle ligne (générique). */
  defaultType(): WallLayerTypeDef {
    return (
      this.findById(DEFAULT_LAYER_TYPE_ID) ??
      this.catalog.types[0] ?? {
        id: DEFAULT_LAYER_TYPE_ID,
        priority: DEFAULT_LAYER_PRIORITY,
        name: 'couche générique',
      }
    );
  }

  setCatalog(file: WallLayerCatalogFile): void {
    this.catalog = normalizeCatalog(file);
    this.loaded = true;
    this.emit();
  }

  /**
   * Recharge depuis le disque (library API).
   * En cas d’échec, conserve le catalogue courant.
   */
  async reloadFromDisk(): Promise<{ ok: boolean; source: string }> {
    try {
      // Extension .json supportée par l’API library (voir vite-plugin-library-api)
      const r = await fetch(
        `/api/library/walls/${encodeURIComponent('layer-priorities.json')}`,
      );
      if (!r.ok) {
        // Ancien chemin / fallback : body JSON direct via query
        const r2 = await fetch('/api/wall-layer-catalog');
        if (!r2.ok) {
          this.loaded = true;
          return { ok: false, source: 'defaults' };
        }
        const data = await r2.json();
        this.catalog = normalizeCatalog(data);
        this.loaded = true;
        this.emit();
        return { ok: true, source: 'api' };
      }
      const data = await r.json();
      this.catalog = normalizeCatalog(data);
      this.loaded = true;
      this.emit();
      return { ok: true, source: WALL_LAYER_CATALOG_PATH };
    } catch {
      this.loaded = true;
      return { ok: false, source: 'defaults' };
    }
  }
}

function loadCatalogFromStorage(): WallLayerCatalogFile | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(WALL_LAYER_CATALOG_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveCatalogToStorage(file: WallLayerCatalogFile): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(WALL_LAYER_CATALOG_STORAGE_KEY, JSON.stringify(file));
  } catch {
    /* ignore */
  }
}

/** Instance partagée (lazy). */
let shared: WallLayerCatalogManager | null = null;

export function getWallLayerCatalog(): WallLayerCatalogManager {
  if (!shared) shared = new WallLayerCatalogManager();
  return shared;
}
