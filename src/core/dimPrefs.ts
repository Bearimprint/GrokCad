/**
 * Styles de cotation (liste « Cotations ») — localStorage clé grokcad.dim
 */

import type { DimensionStyle, LineStyleId } from './types';

export interface DimPrefsFile {
  version: 1;
  styles: DimensionStyle[];
  /** Id du style courant. */
  currentId: string;
}

export const DIM_STORAGE_KEY = 'grokcad.dim';

export function defaultDimensionStyle(
  partial?: Partial<DimensionStyle> & { name?: string },
): DimensionStyle {
  return {
    id: partial?.id ?? `dim_${Date.now().toString(36)}`,
    name: partial?.name ?? 'Standard',
    fontFamily: partial?.fontFamily ?? 'Arial, Helvetica, sans-serif',
    textColor: partial?.textColor ?? '#000000',
    textBackground: partial?.textBackground ?? null,
    textHeight: partial?.textHeight ?? 0.18,
    bold: partial?.bold ?? false,
    italic: partial?.italic ?? false,
    lineColor: partial?.lineColor ?? '#000000',
    lineWidth: partial?.lineWidth ?? 1,
    lineStyle: (partial?.lineStyle as LineStyleId) ?? 'plein',
    extensionOffset: partial?.extensionOffset ?? 0.05,
    extensionOverhang: partial?.extensionOverhang ?? 0.05,
    tickSize: partial?.tickSize ?? 0.08,
    textOffset: partial?.textOffset ?? 0.05,
  };
}

export function defaultDimPrefs(): DimPrefsFile {
  const std = defaultDimensionStyle({ id: 'std', name: 'Standard' });
  return {
    version: 1,
    styles: [std],
    currentId: std.id,
  };
}

function normalizeStyle(raw: unknown): DimensionStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<DimensionStyle>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  return defaultDimensionStyle({
    id: o.id,
    name: o.name,
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : undefined,
    textColor: typeof o.textColor === 'string' ? o.textColor : undefined,
    textBackground:
      o.textBackground === null
        ? null
        : typeof o.textBackground === 'string'
          ? o.textBackground
          : undefined,
    textHeight:
      typeof o.textHeight === 'number' && o.textHeight > 0
        ? o.textHeight
        : undefined,
    bold: typeof o.bold === 'boolean' ? o.bold : undefined,
    italic: typeof o.italic === 'boolean' ? o.italic : undefined,
    lineColor: typeof o.lineColor === 'string' ? o.lineColor : undefined,
    lineWidth:
      typeof o.lineWidth === 'number' && o.lineWidth > 0
        ? o.lineWidth
        : undefined,
    lineStyle: typeof o.lineStyle === 'string' ? o.lineStyle : undefined,
    extensionOffset:
      typeof o.extensionOffset === 'number' && o.extensionOffset >= 0
        ? o.extensionOffset
        : undefined,
    extensionOverhang:
      typeof o.extensionOverhang === 'number' && o.extensionOverhang >= 0
        ? o.extensionOverhang
        : undefined,
    tickSize:
      typeof o.tickSize === 'number' && o.tickSize >= 0 ? o.tickSize : undefined,
    textOffset:
      typeof o.textOffset === 'number' && o.textOffset >= 0
        ? o.textOffset
        : undefined,
  });
}

function normalize(raw: unknown): DimPrefsFile {
  const base = defaultDimPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<DimPrefsFile>;
  if (Array.isArray(o.styles) && o.styles.length > 0) {
    const styles = o.styles
      .map(normalizeStyle)
      .filter((s): s is DimensionStyle => !!s);
    if (styles.length > 0) base.styles = styles;
  }
  if (typeof o.currentId === 'string') base.currentId = o.currentId;
  if (!base.styles.some((s) => s.id === base.currentId)) {
    base.currentId = base.styles[0]!.id;
  }
  return base;
}

export function loadDimPrefs(): DimPrefsFile {
  try {
    const raw = localStorage.getItem(DIM_STORAGE_KEY);
    if (!raw) return defaultDimPrefs();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultDimPrefs();
  }
}

export function saveDimPrefs(prefs: DimPrefsFile): void {
  try {
    localStorage.setItem(DIM_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export type DimPrefsListener = (prefs: DimPrefsFile) => void;

export class DimPrefsManager {
  private prefs: DimPrefsFile;
  private listeners = new Set<DimPrefsListener>();

  constructor() {
    this.prefs = loadDimPrefs();
  }

  get file(): DimPrefsFile {
    return this.prefs;
  }

  get styles(): readonly DimensionStyle[] {
    return this.prefs.styles;
  }

  get current(): DimensionStyle {
    return (
      this.prefs.styles.find((s) => s.id === this.prefs.currentId) ??
      this.prefs.styles[0]!
    );
  }

  get currentId(): string {
    return this.prefs.currentId;
  }

  /** Snapshot pour figé dans l’entité. */
  snapshotCurrent(): DimensionStyle {
    return { ...this.current };
  }

  onChange(fn: DimPrefsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveDimPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  setCurrentId(id: string): void {
    if (!this.prefs.styles.some((s) => s.id === id)) return;
    if (id === this.prefs.currentId) return;
    this.prefs.currentId = id;
    this.emit();
  }

  addStyle(style: DimensionStyle): void {
    this.prefs.styles = [...this.prefs.styles, style];
    this.prefs.currentId = style.id;
    this.emit();
  }

  updateStyle(style: DimensionStyle): void {
    const i = this.prefs.styles.findIndex((s) => s.id === style.id);
    if (i < 0) return;
    const next = [...this.prefs.styles];
    next[i] = style;
    this.prefs.styles = next;
    this.emit();
  }

  removeStyle(id: string): boolean {
    if (this.prefs.styles.length <= 1) return false;
    const next = this.prefs.styles.filter((s) => s.id !== id);
    if (next.length === this.prefs.styles.length) return false;
    this.prefs.styles = next;
    if (this.prefs.currentId === id) {
      this.prefs.currentId = next[0]!.id;
    }
    this.emit();
    return true;
  }

  /** Déplace un style (delta = -1 haut, +1 bas). */
  moveStyle(id: string, delta: number): void {
    const i = this.prefs.styles.findIndex((s) => s.id === id);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= this.prefs.styles.length) return;
    const next = [...this.prefs.styles];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item!);
    this.prefs.styles = next;
    this.emit();
  }
}
