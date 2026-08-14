/**
 * Préférences hachures (/hatch · /fill) — localStorage clé grokcad.hatch
 * Dernière hachure choisie + échelle + rotation.
 */

export const HATCH_STORAGE_KEY = 'grokcad.hatch';
/** Onglet library/ réservé aux motifs 1 m × 1 m. */
export const HATCH_LIBRARY_TAB = 'hatch';

export interface HatchPrefsFile {
  version: 1;
  /** Nom du .gkd courant (sans extension), dans library/hatch/. */
  currentName: string | null;
  /** Échelle (1 = taille réelle). */
  scale: number;
  /** Rotation en degrés. */
  rotationDeg: number;
}

export const DEFAULT_HATCH_SCALES = [
  1, 0.5, 0.25, 0.1, 0.04, 0.02, 2, 5, 10,
] as const;

export function defaultHatchPrefs(): HatchPrefsFile {
  return {
    version: 1,
    currentName: null,
    scale: 1,
    rotationDeg: 0,
  };
}

function normalize(raw: unknown): HatchPrefsFile {
  const base = defaultHatchPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<HatchPrefsFile>;
  if (typeof o.currentName === 'string' && o.currentName.trim()) {
    base.currentName = o.currentName.trim();
  } else if (o.currentName === null) {
    base.currentName = null;
  }
  if (typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale > 0) {
    base.scale = o.scale;
  }
  if (
    typeof o.rotationDeg === 'number' &&
    Number.isFinite(o.rotationDeg)
  ) {
    let r = o.rotationDeg % 360;
    if (r < 0) r += 360;
    base.rotationDeg = r;
  }
  return base;
}

export function loadHatchPrefs(): HatchPrefsFile {
  try {
    const raw = localStorage.getItem(HATCH_STORAGE_KEY);
    if (!raw) return defaultHatchPrefs();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultHatchPrefs();
  }
}

export function saveHatchPrefs(prefs: HatchPrefsFile): void {
  try {
    localStorage.setItem(HATCH_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export type HatchPrefsListener = (prefs: HatchPrefsFile) => void;

export class HatchPrefsManager {
  private prefs: HatchPrefsFile;
  private listeners = new Set<HatchPrefsListener>();

  constructor() {
    this.prefs = loadHatchPrefs();
  }

  get file(): HatchPrefsFile {
    return this.prefs;
  }

  get currentName(): string | null {
    return this.prefs.currentName;
  }

  get scale(): number {
    return this.prefs.scale;
  }

  get rotationDeg(): number {
    return this.prefs.rotationDeg;
  }

  onChange(fn: HatchPrefsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveHatchPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  setCurrent(name: string | null): void {
    const n = name?.trim() || null;
    if (this.prefs.currentName === n) return;
    this.prefs.currentName = n;
    this.emit();
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    if (Math.abs(this.prefs.scale - scale) < 1e-12) return;
    this.prefs.scale = scale;
    this.emit();
  }

  setRotationDeg(deg: number): void {
    if (!Number.isFinite(deg)) return;
    let r = deg % 360;
    if (r < 0) r += 360;
    if (Math.abs(this.prefs.rotationDeg - r) < 1e-9) return;
    this.prefs.rotationDeg = r;
    this.emit();
  }
}
