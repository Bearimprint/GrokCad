/**
 * Préférences application (snap, unités, grille) — localStorage clé grokcad.app
 */

import {
  DEFAULT_GRID_SPACING_METERS,
  DEFAULT_UNIT,
  isUnitId,
  type UnitId,
} from './units';

export interface SnapPrefs {
  /** Accroche clic droit active. */
  enabled: boolean;
  /** Rayon d'accrochage en pixels écran (défaut 20). */
  radiusPx: number;
}

export interface AppPrefsFile {
  version: 1;
  snap: SnapPrefs;
  /** Unité monde / saisie. */
  units: UnitId;
  /**
   * Écart de la grille en **mètres** réels (indépendant de l'unité).
   * Défaut 1 m — un carré de grille = 1 mètre.
   */
  gridSpacingMeters: number;
  /**
   * Dernier répertoire d’où un fichier a été ouvert (/open).
   * Chemin absolu disque ; utilisé comme départ de l’explorateur.
   */
  lastOpenDir?: string;
}

export const APP_STORAGE_KEY = 'grokcad.app';
export const DEFAULT_SNAP_RADIUS_PX = 20;

export function defaultAppPrefs(): AppPrefsFile {
  return {
    version: 1,
    snap: {
      enabled: true,
      radiusPx: DEFAULT_SNAP_RADIUS_PX,
    },
    units: DEFAULT_UNIT,
    gridSpacingMeters: DEFAULT_GRID_SPACING_METERS,
  };
}

function normalize(raw: unknown): AppPrefsFile {
  const base = defaultAppPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<AppPrefsFile> & { unit?: unknown };
  if (o.snap && typeof o.snap === 'object') {
    if (typeof o.snap.enabled === 'boolean') base.snap.enabled = o.snap.enabled;
    if (typeof o.snap.radiusPx === 'number' && Number.isFinite(o.snap.radiusPx)) {
      base.snap.radiusPx = clampSnapPx(o.snap.radiusPx);
    }
  }
  // units | unit (tolérance)
  if (isUnitId(o.units)) base.units = o.units;
  else if (isUnitId(o.unit)) base.units = o.unit;
  if (
    typeof o.gridSpacingMeters === 'number' &&
    Number.isFinite(o.gridSpacingMeters) &&
    o.gridSpacingMeters > 0
  ) {
    base.gridSpacingMeters = o.gridSpacingMeters;
  }
  if (
    typeof o.lastOpenDir === 'string' &&
    o.lastOpenDir.trim().length > 0
  ) {
    base.lastOpenDir = o.lastOpenDir.trim();
  }
  return base;
}

export function clampSnapPx(n: number): number {
  return Math.min(64, Math.max(1, Math.round(n)));
}

export function loadAppPrefs(): AppPrefsFile {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return defaultAppPrefs();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultAppPrefs();
  }
}

export function saveAppPrefs(prefs: AppPrefsFile): void {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export type AppPrefsListener = (prefs: AppPrefsFile) => void;

export class AppPrefsManager {
  private prefs: AppPrefsFile;
  private listeners = new Set<AppPrefsListener>();

  constructor() {
    this.prefs = loadAppPrefs();
  }

  get file(): AppPrefsFile {
    return this.prefs;
  }

  get snap(): SnapPrefs {
    return this.prefs.snap;
  }

  get units(): UnitId {
    return this.prefs.units;
  }

  get gridSpacingMeters(): number {
    return this.prefs.gridSpacingMeters;
  }

  /** Dernier dossier d’ouverture (/open), ou null si jamais mémorisé. */
  get lastOpenDir(): string | null {
    const d = this.prefs.lastOpenDir?.trim();
    return d && d.length > 0 ? d : null;
  }

  onChange(fn: AppPrefsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveAppPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  setSnapEnabled(enabled: boolean): void {
    this.prefs.snap.enabled = enabled;
    this.emit();
  }

  setSnapRadiusPx(px: number): void {
    this.prefs.snap.radiusPx = clampSnapPx(px);
    this.emit();
  }

  toggleSnap(): boolean {
    this.prefs.snap.enabled = !this.prefs.snap.enabled;
    this.emit();
    return this.prefs.snap.enabled;
  }

  setUnits(unit: UnitId): void {
    if (!isUnitId(unit) || unit === this.prefs.units) return;
    this.prefs.units = unit;
    this.emit();
  }

  setGridSpacingMeters(meters: number): void {
    if (!Number.isFinite(meters) || meters <= 0) return;
    this.prefs.gridSpacingMeters = meters;
    this.emit();
  }

  /** Mémorise le dossier d’où un fichier a été ouvert (localStorage grokcad.app). */
  setLastOpenDir(dir: string | null | undefined): void {
    const d = dir?.trim() ?? '';
    if (!d) {
      if (this.prefs.lastOpenDir == null) return;
      delete this.prefs.lastOpenDir;
      this.emit();
      return;
    }
    if (this.prefs.lastOpenDir === d) return;
    this.prefs.lastOpenDir = d;
    this.emit();
  }
}
