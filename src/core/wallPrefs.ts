/**
 * Bibliothèque de murs + mur courant — localStorage (session à session).
 * Clé : grokcad.walls
 */

import type { LineStyleId, WallLineDef, WallStyle } from './types';
import {
  DEFAULT_LAYER_PRIORITY,
  DEFAULT_LAYER_TYPE_ID,
} from './wallLayerCatalog';
import { defaultTabName, nextWallStyleId } from './walls';

export const WALLS_STORAGE_KEY = 'grokcad.walls';

export interface WallPrefsFile {
  version: 1;
  /** Id du style de mur courant (dernier choisi). */
  currentId: string | null;
  /** Noms d'onglets (ordre d'affichage). */
  tabs: string[];
  styles: WallStyle[];
}

export function defaultWallPrefs(): WallPrefsFile {
  return {
    version: 1,
    currentId: null,
    tabs: [defaultTabName()],
    styles: [],
  };
}

function normalizeLine(raw: unknown): WallLineDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<WallLineDef>;
  if (typeof o.offset !== 'number' || !Number.isFinite(o.offset)) return null;
  const priority =
    typeof o.priority === 'number' && Number.isFinite(o.priority)
      ? Math.max(1, Math.min(99, Math.round(o.priority)))
      : DEFAULT_LAYER_PRIORITY;
  const line: WallLineDef = {
    offset: o.offset,
    color: typeof o.color === 'string' ? o.color : '#000000',
    lineWidth: typeof o.lineWidth === 'number' && o.lineWidth > 0 ? o.lineWidth : 1,
    lineStyle: (typeof o.lineStyle === 'string' ? o.lineStyle : 'plein') as LineStyleId,
    priority,
  };
  if (typeof o.layerTypeId === 'string' && o.layerTypeId.trim()) {
    line.layerTypeId = o.layerTypeId.trim();
  } else {
    line.layerTypeId = DEFAULT_LAYER_TYPE_ID;
  }
  return line;
}

function normalizeStyle(raw: unknown): WallStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<WallStyle>;
  const lines = Array.isArray(o.lines)
    ? o.lines.map(normalizeLine).filter((l): l is WallLineDef => l !== null)
    : [];
  return {
    id: typeof o.id === 'string' && o.id ? o.id : nextWallStyleId(),
    name: typeof o.name === 'string' && o.name ? o.name : 'Mur',
    tab: typeof o.tab === 'string' && o.tab ? o.tab : defaultTabName(),
    lines,
  };
}

function normalize(raw: unknown): WallPrefsFile {
  const base = defaultWallPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<WallPrefsFile>;
  if (Array.isArray(o.styles)) {
    base.styles = o.styles.map(normalizeStyle).filter((s): s is WallStyle => s !== null);
  }
  if (Array.isArray(o.tabs) && o.tabs.length > 0) {
    base.tabs = o.tabs.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  // Onglets dérivés des styles manquants
  for (const s of base.styles) {
    if (!base.tabs.includes(s.tab)) base.tabs.push(s.tab);
  }
  if (base.tabs.length === 0) base.tabs = [defaultTabName()];
  if (typeof o.currentId === 'string' || o.currentId === null) {
    base.currentId = o.currentId;
  }
  if (base.currentId && !base.styles.some((s) => s.id === base.currentId)) {
    base.currentId = base.styles[0]?.id ?? null;
  }
  return base;
}

export function loadWallPrefs(): WallPrefsFile {
  try {
    const raw = localStorage.getItem(WALLS_STORAGE_KEY);
    if (!raw) return defaultWallPrefs();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultWallPrefs();
  }
}

export function saveWallPrefs(prefs: WallPrefsFile): void {
  try {
    localStorage.setItem(WALLS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export type WallPrefsListener = (prefs: WallPrefsFile) => void;

/**
 * Gestionnaire bibliothèque murs (source de vérité UI + localStorage).
 * Le document .GKD reçoit une copie de `styles` à la sauvegarde.
 */
export class WallLibraryManager {
  private prefs: WallPrefsFile;
  private listeners = new Set<WallPrefsListener>();

  constructor(initial?: WallPrefsFile) {
    this.prefs = initial ?? loadWallPrefs();
  }

  get file(): WallPrefsFile {
    return this.prefs;
  }

  get styles(): readonly WallStyle[] {
    return this.prefs.styles;
  }

  get tabs(): readonly string[] {
    return this.prefs.tabs;
  }

  get currentId(): string | null {
    return this.prefs.currentId;
  }

  get current(): WallStyle | null {
    if (!this.prefs.currentId) return null;
    return this.prefs.styles.find((s) => s.id === this.prefs.currentId) ?? null;
  }

  /** Style utilisable pour tracer (au moins 1 trait). */
  get currentDrawable(): WallStyle | null {
    const s = this.current;
    if (!s || s.lines.length === 0) return null;
    return s;
  }

  onChange(fn: WallPrefsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveWallPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  /** Remplace la biblio (ex. ouverture .GKD). */
  loadFromDocument(styles: WallStyle[], currentId?: string | null): void {
    this.prefs.styles = styles.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l })),
    }));
    const tabs = new Set(this.prefs.tabs);
    for (const s of this.prefs.styles) tabs.add(s.tab);
    if (tabs.size === 0) tabs.add(defaultTabName());
    this.prefs.tabs = [...tabs];
    if (currentId !== undefined) {
      this.prefs.currentId = currentId;
    }
    if (this.prefs.currentId && !this.prefs.styles.some((s) => s.id === this.prefs.currentId)) {
      this.prefs.currentId = this.prefs.styles[0]?.id ?? null;
    }
    this.emit();
  }

  setCurrent(id: string | null): void {
    if (id && !this.prefs.styles.some((s) => s.id === id)) return;
    this.prefs.currentId = id;
    this.emit();
  }

  addStyle(style: WallStyle): void {
    this.prefs.styles.push(style);
    if (!this.prefs.tabs.includes(style.tab)) {
      this.prefs.tabs.push(style.tab);
    }
    this.prefs.currentId = style.id;
    this.emit();
  }

  updateStyle(id: string, patch: Partial<WallStyle>): void {
    const i = this.prefs.styles.findIndex((s) => s.id === id);
    if (i < 0) return;
    const prev = this.prefs.styles[i]!;
    const next: WallStyle = {
      ...prev,
      ...patch,
      lines: patch.lines ? patch.lines.map((l) => ({ ...l })) : prev.lines.map((l) => ({ ...l })),
    };
    this.prefs.styles[i] = next;
    if (!this.prefs.tabs.includes(next.tab)) {
      this.prefs.tabs.push(next.tab);
    }
    this.emit();
  }

  removeStyle(id: string): void {
    this.prefs.styles = this.prefs.styles.filter((s) => s.id !== id);
    if (this.prefs.currentId === id) {
      this.prefs.currentId = this.prefs.styles[0]?.id ?? null;
    }
    this.emit();
  }

  moveStyle(id: string, tab: string): void {
    if (!tab.trim()) return;
    const t = tab.trim();
    if (!this.prefs.tabs.includes(t)) this.prefs.tabs.push(t);
    this.updateStyle(id, { tab: t });
  }

  addTab(name: string): void {
    const t = name.trim();
    if (!t || this.prefs.tabs.includes(t)) return;
    this.prefs.tabs.push(t);
    this.emit();
  }

  /** Multiplie tous les offsets de traits (changement d’unité monde). */
  scaleOffsets(factor: number): void {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-15) return;
    this.prefs.styles = this.prefs.styles.map((st) => ({
      ...st,
      lines: st.lines.map((l) => ({ ...l, offset: l.offset * factor })),
    }));
    this.emit();
  }

  removeTab(name: string): void {
    if (this.prefs.tabs.length <= 1) return;
    // Styles de l'onglet → premier onglet restant
    const rest = this.prefs.tabs.filter((t) => t !== name);
    if (rest.length === 0) return;
    const dest = rest[0]!;
    for (const s of this.prefs.styles) {
      if (s.tab === name) s.tab = dest;
    }
    this.prefs.tabs = rest;
    this.emit();
  }

  stylesInTab(tab: string): WallStyle[] {
    return this.prefs.styles.filter((s) => s.tab === tab);
  }

  /** Snapshot pour .GKD */
  toDocumentLibrary(): WallStyle[] {
    return this.prefs.styles.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l })),
    }));
  }
}
