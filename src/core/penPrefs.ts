/**
 * Préférences stylo + catalogues (couleurs, épaisseurs, styles).
 * Schéma unique, stocké en localStorage (clé grokcad.pen) pour survivre
 * d'une session navigateur à l'autre. Export/import JSON possible plus tard.
 */

import type { LineStyleId } from './types';

export type { LineStyleId };

export interface ColorOption {
  id: string;
  label: string;
  /** CSS / hex. */
  value: string;
}

export interface WidthOption {
  id: string;
  label: string;
  /** Épaisseur en pixels écran. */
  px: number;
}

export interface StyleOption {
  id: LineStyleId;
  label: string;
  /** false = trait plein. */
  dashed: boolean;
  /**
   * Fallback simple (si `pattern` absent) : tiret / gap en mètres monde.
   * Utilisé aussi pour l’aperçu UI.
   */
  dashSize: number;
  gapSize: number;
  /**
   * Motif cycle en mètres : [trait, trou, trait, trou, …].
   * Ex. tiret-point : [0.20, 0.05, 0.015, 0.05] = tiret · gap · point · gap.
   * Requis pour tiret-point / tiret-point-point (LineMaterial ne gère qu’un seul couple).
   */
  pattern?: number[];
}

/** Sélection courante du stylo (prochaine entité). */
export interface PenState {
  colorId: string;
  widthId: string;
  styleId: LineStyleId;
}

export interface PenPrefsFile {
  version: 1;
  colors: ColorOption[];
  widths: WidthOption[];
  styles: StyleOption[];
  current: PenState;
}

export const PEN_STORAGE_KEY = 'grokcad.pen';

export const DEFAULT_COLORS: ColorOption[] = [
  { id: 'noir', label: 'Noir', value: '#000000' },
  { id: 'blanc', label: 'Blanc', value: '#ffffff' },
  { id: 'bleu', label: 'Bleu', value: '#1e88e5' },
  { id: 'vert', label: 'Vert', value: '#43a047' },
  { id: 'jaune', label: 'Jaune', value: '#fdd835' },
  { id: 'rouge', label: 'Rouge', value: '#e53935' },
  { id: 'orange', label: 'Orange', value: '#fb8c00' },
];

export const DEFAULT_WIDTHS: WidthOption[] = [
  { id: 'w1', label: '1 px', px: 1 },
  { id: 'w2', label: '2 px', px: 2 },
  { id: 'w3', label: '3 px', px: 3 },
  { id: 'w4', label: '4 px', px: 4 },
  { id: 'w5', label: '5 px', px: 5 },
  { id: 'w6', label: '6 px', px: 6 },
  { id: 'w7', label: '7 px', px: 7 },
];

/**
 * 7 styles : plein + motifs pointillé / tiret / tiret-point.
 * Longueurs en **mètres monde**. Les motifs complexes (tiret-point…) sont
 * tessellés en géométrie (voir `lineStyle.ts`) — LineMaterial ne fait qu’un couple tiret/gap.
 */
export const DEFAULT_STYLES: StyleOption[] = [
  { id: 'plein', label: 'Plein', dashed: false, dashSize: 0, gapSize: 0 },
  {
    id: 'pointille',
    label: 'Pointillé',
    dashed: true,
    dashSize: 0.02,
    gapSize: 0.06,
    // petits tirets ≈ points
    pattern: [0.02, 0.06],
  },
  {
    id: 'pointille_espace',
    label: 'Pointillé espacé',
    dashed: true,
    dashSize: 0.02,
    gapSize: 0.14,
    pattern: [0.02, 0.14],
  },
  {
    id: 'tiret',
    label: 'Tiret',
    dashed: true,
    dashSize: 0.18,
    gapSize: 0.09,
    pattern: [0.18, 0.09],
  },
  {
    id: 'tiret_point',
    label: 'Tiret-point',
    dashed: true,
    dashSize: 0.2,
    gapSize: 0.06,
    // tiret — trou — point — trou
    pattern: [0.2, 0.05, 0.015, 0.05],
  },
  {
    id: 'tiret_point_point',
    label: 'Tiret-point-point',
    dashed: true,
    dashSize: 0.22,
    gapSize: 0.05,
    // tiret — trou — point — trou — point — trou
    pattern: [0.22, 0.045, 0.015, 0.04, 0.015, 0.045],
  },
  {
    id: 'long_tiret',
    label: 'Long tiret',
    dashed: true,
    dashSize: 0.4,
    gapSize: 0.12,
    pattern: [0.4, 0.12],
  },
];

export const DEFAULT_PEN: PenState = {
  colorId: 'noir',
  widthId: 'w1',
  styleId: 'plein',
};

export function defaultPenPrefs(): PenPrefsFile {
  return {
    version: 1,
    colors: DEFAULT_COLORS.map((c) => ({ ...c })),
    widths: DEFAULT_WIDTHS.map((w) => ({ ...w })),
    styles: DEFAULT_STYLES.map((s) => ({ ...s })),
    current: { ...DEFAULT_PEN },
  };
}

export function resolvePen(prefs: PenPrefsFile): {
  color: string;
  lineWidth: number;
  styleId: LineStyleId;
  style: StyleOption;
  colorLabel: string;
  widthLabel: string;
  styleLabel: string;
} {
  const color =
    prefs.colors.find((c) => c.id === prefs.current.colorId) ?? prefs.colors[0]!;
  const width =
    prefs.widths.find((w) => w.id === prefs.current.widthId) ?? prefs.widths[0]!;
  const style =
    prefs.styles.find((s) => s.id === prefs.current.styleId) ?? prefs.styles[0]!;
  return {
    color: color.value,
    lineWidth: width.px,
    styleId: style.id,
    style,
    colorLabel: color.label,
    widthLabel: width.label,
    styleLabel: style.label,
  };
}

function normalizePrefs(raw: unknown): PenPrefsFile {
  const base = defaultPenPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<PenPrefsFile>;

  if (Array.isArray(o.colors) && o.colors.length > 0) {
    base.colors = o.colors.filter(
      (c): c is ColorOption =>
        !!c && typeof c.id === 'string' && typeof c.value === 'string',
    );
  }
  if (Array.isArray(o.widths) && o.widths.length > 0) {
    base.widths = o.widths.filter(
      (w): w is WidthOption =>
        !!w && typeof w.id === 'string' && typeof w.px === 'number',
    );
  }
  if (Array.isArray(o.styles) && o.styles.length > 0) {
    // Garder l’ordre / les ids stockés, mais resynchroniser dash/gap depuis
    // DEFAULT_STYLES (évite les anciennes tailles en « cm » figées en localStorage).
    const loaded = o.styles.filter(
      (s): s is StyleOption =>
        !!s && typeof s.id === 'string' && typeof s.dashed === 'boolean',
    ) as StyleOption[];
    base.styles = loaded.map((s) => {
      const def = DEFAULT_STYLES.find((d) => d.id === s.id);
      if (def) {
        return {
          id: def.id,
          label: typeof s.label === 'string' ? s.label : def.label,
          dashed: def.dashed,
          dashSize: def.dashSize,
          gapSize: def.gapSize,
          pattern: def.pattern ? [...def.pattern] : undefined,
        };
      }
      // Style custom : si dashSize absurde (> 2 m), ramener à l’échelle mètre
      let dashSize = typeof s.dashSize === 'number' ? s.dashSize : 0.1;
      let gapSize = typeof s.gapSize === 'number' ? s.gapSize : 0.1;
      if (s.dashed && dashSize > 2) dashSize *= 0.01;
      if (s.dashed && gapSize > 2) gapSize *= 0.01;
      const pattern = Array.isArray(s.pattern)
        ? s.pattern.filter((n): n is number => typeof n === 'number' && n > 0)
        : undefined;
      return {
        id: s.id,
        label: s.label,
        dashed: s.dashed,
        dashSize,
        gapSize,
        pattern: pattern && pattern.length >= 2 ? pattern : undefined,
      };
    });
  }
  if (o.current && typeof o.current === 'object') {
    const c = o.current as Partial<PenState>;
    if (typeof c.colorId === 'string') base.current.colorId = c.colorId;
    if (typeof c.widthId === 'string') base.current.widthId = c.widthId;
    if (typeof c.styleId === 'string') base.current.styleId = c.styleId as LineStyleId;
  }

  // Garantir que la sélection pointe sur une entrée existante
  if (!base.colors.some((c) => c.id === base.current.colorId)) {
    base.current.colorId = base.colors[0]?.id ?? 'noir';
  }
  if (!base.widths.some((w) => w.id === base.current.widthId)) {
    base.current.widthId = base.widths[0]?.id ?? 'w1';
  }
  if (!base.styles.some((s) => s.id === base.current.styleId)) {
    base.current.styleId = (base.styles[0]?.id as LineStyleId) ?? 'plein';
  }

  return base;
}

export function loadPenPrefs(): PenPrefsFile {
  try {
    const raw = localStorage.getItem(PEN_STORAGE_KEY);
    if (!raw) return defaultPenPrefs();
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return defaultPenPrefs();
  }
}

export function savePenPrefs(prefs: PenPrefsFile): void {
  try {
    localStorage.setItem(PEN_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / mode privé : ignorer */
  }
}

export type PenChangeListener = (prefs: PenPrefsFile) => void;

/** Gestionnaire unique du stylo courant. */
export class PenManager {
  private prefs: PenPrefsFile;
  private listeners = new Set<PenChangeListener>();

  constructor() {
    this.prefs = loadPenPrefs();
  }

  get file(): PenPrefsFile {
    return this.prefs;
  }

  get resolved() {
    return resolvePen(this.prefs);
  }

  onChange(fn: PenChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    savePenPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  setColorId(id: string): boolean {
    if (!this.prefs.colors.some((c) => c.id === id)) return false;
    this.prefs.current.colorId = id;
    this.emit();
    return true;
  }

  setWidthId(id: string): boolean {
    if (!this.prefs.widths.some((w) => w.id === id)) return false;
    this.prefs.current.widthId = id;
    this.emit();
    return true;
  }

  setStyleId(id: LineStyleId | string): boolean {
    if (!this.prefs.styles.some((s) => s.id === id)) return false;
    this.prefs.current.styleId = id as LineStyleId;
    this.emit();
    return true;
  }

  cycleColor(dir = 1): void {
    const list = this.prefs.colors;
    const i = list.findIndex((c) => c.id === this.prefs.current.colorId);
    const n = list.length;
    if (n === 0) return;
    this.prefs.current.colorId = list[((i < 0 ? 0 : i) + dir + n * 10) % n]!.id;
    this.emit();
  }

  cycleWidth(dir = 1): void {
    const list = this.prefs.widths;
    const i = list.findIndex((w) => w.id === this.prefs.current.widthId);
    const n = list.length;
    if (n === 0) return;
    this.prefs.current.widthId = list[((i < 0 ? 0 : i) + dir + n * 10) % n]!.id;
    this.emit();
  }

  cycleStyle(dir = 1): void {
    const list = this.prefs.styles;
    const i = list.findIndex((s) => s.id === this.prefs.current.styleId);
    const n = list.length;
    if (n === 0) return;
    this.prefs.current.styleId = list[((i < 0 ? 0 : i) + dir + n * 10) % n]!
      .id as LineStyleId;
    this.emit();
  }

  /** Applique le stylo courant aux champs d'une entité. */
  strokeFields(): { color: string; lineWidth: number; lineStyle: LineStyleId } {
    const r = this.resolved;
    return { color: r.color, lineWidth: r.lineWidth, lineStyle: r.styleId };
  }
}
