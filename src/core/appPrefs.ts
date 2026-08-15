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
  /** Grille de fond visible (`/grid on|off`). Défaut true. */
  gridVisible: boolean;
  /**
   * Accroche sur la grille au clic droit (`/gridsnap on|off`).
   * Inactif tant que `gridVisible` est false.
   */
  gridSnap: boolean;
  /**
   * Si true : `/grid off` écrit aussi `gridSnap = false`.
   * Si false : le souhait snap est conservé et redevient actif au prochain `/grid on`.
   * Dans les deux cas, le snap grille n’est jamais effectif tant que la grille est cachée.
   */
  gridOffDisablesSnap: boolean;
  /**
   * Dernier répertoire d’où un fichier a été ouvert (/open).
   * Chemin absolu disque ; utilisé comme départ de l’explorateur.
   */
  lastOpenDir?: string;
  /**
   * 7 derniers fichiers ouverts / enregistrés (chemin absolu).
   * Un même fichier n’apparaît qu’une fois (remonté en tête).
   */
  recentFiles?: RecentFileEntry[];
}

/** Entrée de l’historique fichiers (/openlast). */
export interface RecentFileEntry {
  path: string;
  name: string;
}

export const RECENT_FILES_MAX = 7;

export const APP_STORAGE_KEY = 'grokcad.app';
export const DEFAULT_SNAP_RADIUS_PX = 20;

/** Message `/gridsnap on` alors que la grille est cachée (texte demandé). */
export const GRID_SNAP_HIDDEN_ERROR =
  "impossible d'activer la grille quand celle-ci est cachée";

export function defaultAppPrefs(): AppPrefsFile {
  return {
    version: 1,
    snap: {
      enabled: true,
      radiusPx: DEFAULT_SNAP_RADIUS_PX,
    },
    units: DEFAULT_UNIT,
    gridSpacingMeters: DEFAULT_GRID_SPACING_METERS,
    gridVisible: true,
    gridSnap: false,
    gridOffDisablesSnap: true,
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
  if (typeof o.gridVisible === 'boolean') base.gridVisible = o.gridVisible;
  if (typeof o.gridSnap === 'boolean') base.gridSnap = o.gridSnap;
  if (typeof o.gridOffDisablesSnap === 'boolean') {
    base.gridOffDisablesSnap = o.gridOffDisablesSnap;
  }
  // Snap grille jamais ON si la grille est cachée (état persisté).
  if (!base.gridVisible && base.gridOffDisablesSnap) {
    base.gridSnap = false;
  }
  if (
    typeof o.lastOpenDir === 'string' &&
    o.lastOpenDir.trim().length > 0
  ) {
    base.lastOpenDir = o.lastOpenDir.trim();
  }
  if (Array.isArray(o.recentFiles)) {
    const seen = new Set<string>();
    const recent: RecentFileEntry[] = [];
    for (const raw of o.recentFiles) {
      const e = normalizeRecentEntry(raw);
      if (!e || seen.has(e.path)) continue;
      seen.add(e.path);
      recent.push(e);
      if (recent.length >= RECENT_FILES_MAX) break;
    }
    if (recent.length > 0) base.recentFiles = recent;
  }
  return base;
}

function normalizeRecentEntry(raw: unknown): RecentFileEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<RecentFileEntry>;
  const path = typeof o.path === 'string' ? o.path.trim() : '';
  if (!path) return null;
  const name =
    (typeof o.name === 'string' && o.name.trim()) ||
    path.split('/').filter(Boolean).pop() ||
    path;
  return { path, name };
}

/** Ajoute un chemin en tête (dédupliqué, max `max`). */
export function pushRecentFile(
  list: readonly RecentFileEntry[],
  path: string,
  max = RECENT_FILES_MAX,
): RecentFileEntry[] {
  const p = path.trim();
  if (!p) return list.map((e) => ({ ...e }));
  const name = p.split('/').filter(Boolean).pop() ?? p;
  return [{ path: p, name }, ...list.filter((f) => f.path !== p)].slice(0, max);
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

  get gridVisible(): boolean {
    return this.prefs.gridVisible;
  }

  get gridSnap(): boolean {
    return this.prefs.gridSnap;
  }

  get gridOffDisablesSnap(): boolean {
    return this.prefs.gridOffDisablesSnap;
  }

  /** Accroche grille réellement active (visible + demandé). */
  get gridSnapEffective(): boolean {
    return this.prefs.gridVisible && this.prefs.gridSnap;
  }

  /** Dernier dossier d’ouverture (/open), ou null si jamais mémorisé. */
  get lastOpenDir(): string | null {
    const d = this.prefs.lastOpenDir?.trim();
    return d && d.length > 0 ? d : null;
  }

  /** Historique des fichiers (le plus récent en premier). */
  get recentFiles(): readonly RecentFileEntry[] {
    return this.prefs.recentFiles ?? [];
  }

  /** Dernier fichier ouvert / enregistré, ou null. */
  get lastRecentFile(): RecentFileEntry | null {
    return this.prefs.recentFiles?.[0] ?? null;
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

  setGridVisible(visible: boolean): void {
    if (this.prefs.gridVisible === visible) return;
    this.prefs.gridVisible = visible;
    if (!visible && this.prefs.gridOffDisablesSnap) {
      this.prefs.gridSnap = false;
    }
    this.emit();
  }

  toggleGridVisible(): boolean {
    this.setGridVisible(!this.prefs.gridVisible);
    return this.prefs.gridVisible;
  }

  /**
   * Active / désactive l’accroche grille.
   * Refuse ON si la grille est cachée (message `GRID_SNAP_HIDDEN_ERROR`).
   */
  setGridSnap(enabled: boolean): { ok: true } | { ok: false; error: string } {
    if (enabled && !this.prefs.gridVisible) {
      return { ok: false, error: GRID_SNAP_HIDDEN_ERROR };
    }
    if (this.prefs.gridSnap === enabled) return { ok: true };
    this.prefs.gridSnap = enabled;
    this.emit();
    return { ok: true };
  }

  toggleGridSnap():
    | { ok: true; enabled: boolean }
    | { ok: false; error: string } {
    const r = this.setGridSnap(!this.prefs.gridSnap);
    if (!r.ok) return r;
    return { ok: true, enabled: this.prefs.gridSnap };
  }

  setGridOffDisablesSnap(value: boolean): void {
    if (this.prefs.gridOffDisablesSnap === value) return;
    this.prefs.gridOffDisablesSnap = value;
    if (value && !this.prefs.gridVisible && this.prefs.gridSnap) {
      this.prefs.gridSnap = false;
    }
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

  /**
   * Mémorise un fichier ouvert / enregistré.
   * Le même chemin n’apparaît qu’une fois (remonté en tête), max 7.
   */
  rememberFile(path: string | null | undefined): void {
    const p = path?.trim() ?? '';
    if (!p) return;
    const next = pushRecentFile(this.prefs.recentFiles ?? [], p);
    const prev = this.prefs.recentFiles ?? [];
    const same =
      prev.length === next.length &&
      prev.every((e, i) => e.path === next[i]!.path && e.name === next[i]!.name);
    if (same) return;
    this.prefs.recentFiles = next;
    const dir = p.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/';
    if (dir && dir !== p) this.prefs.lastOpenDir = dir;
    this.emit();
  }

  /** Retire un chemin de l’historique (fichier manquant). */
  forgetFile(path: string): void {
    const p = path.trim();
    if (!p || !this.prefs.recentFiles?.length) return;
    const next = this.prefs.recentFiles.filter((f) => f.path !== p);
    if (next.length === this.prefs.recentFiles.length) return;
    if (next.length === 0) delete this.prefs.recentFiles;
    else this.prefs.recentFiles = next;
    this.emit();
  }
}
