/**
 * Préférences texte courant (typo, couleurs, taille, Bold/Italic)
 * + décalage textbox. Stockage localStorage clé grokcad.text
 */

export interface TextStyleState {
  fontFamily: string;
  /** Id couleur catalogue pen (ou hex direct si custom). */
  colorId: string;
  /** Id fond : 'transparent' ou id couleur pen. */
  backgroundId: string;
  /** Hauteur caractères en unités monde. */
  height: number;
  bold: boolean;
  italic: boolean;
  /** true = police, gras et italique du calque courant. */
  fontByLayer: boolean;
  /** true = couleur du calque courant. */
  colorByLayer: boolean;
}

export interface TextPrefsFile {
  version: 1;
  current: TextStyleState;
  /**
   * Décalage entre le texte et le rectangle /textbox (unités monde).
   * Défaut 0.03 (= 3 cm si unité = m, 3 mm si on raisonne en m).
   */
  textboxPadding: number;
}

export const TEXT_STORAGE_KEY = 'grokcad.text';

export const DEFAULT_FONTS: { id: string; label: string; value: string }[] = [
  { id: 'sans', label: 'Sans-serif', value: 'Arial, Helvetica, sans-serif' },
  { id: 'serif', label: 'Serif', value: 'Times New Roman, Times, serif' },
  { id: 'mono', label: 'Mono', value: 'Consolas, "Courier New", monospace' },
  { id: 'verdana', label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { id: 'georgia', label: 'Georgia', value: 'Georgia, serif' },
];

/** Valeur du menu police : suivre le calque. */
export const TEXT_FONT_BY_LAYER = '__ducalque__';

export const DEFAULT_TEXT_HEIGHT = 0.25;
export const DEFAULT_TEXTBOX_PADDING = 0.03;

export function defaultTextPrefs(): TextPrefsFile {
  return {
    version: 1,
    current: {
      fontFamily: DEFAULT_FONTS[0]!.value,
      colorId: 'noir',
      backgroundId: 'transparent',
      height: DEFAULT_TEXT_HEIGHT,
      bold: false,
      italic: false,
      fontByLayer: true,
      colorByLayer: true,
    },
    textboxPadding: DEFAULT_TEXTBOX_PADDING,
  };
}

function normalize(raw: unknown): TextPrefsFile {
  const base = defaultTextPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<TextPrefsFile>;
  if (o.current && typeof o.current === 'object') {
    const c = o.current as Partial<TextStyleState>;
    if (typeof c.fontFamily === 'string' && c.fontFamily.trim()) {
      base.current.fontFamily = c.fontFamily;
    }
    if (typeof c.colorId === 'string') base.current.colorId = c.colorId;
    if (typeof c.backgroundId === 'string') {
      base.current.backgroundId = c.backgroundId;
    }
    if (typeof c.height === 'number' && Number.isFinite(c.height) && c.height > 0) {
      base.current.height = c.height;
    }
    if (typeof c.bold === 'boolean') base.current.bold = c.bold;
    if (typeof c.italic === 'boolean') base.current.italic = c.italic;
    const factoryFont = c.fontFamily === undefined || c.fontFamily === DEFAULT_FONTS[0]!.value;
    base.current.fontByLayer =
      typeof c.fontByLayer === 'boolean'
        ? c.fontByLayer
        : factoryFont && c.bold !== true && c.italic !== true;
    base.current.colorByLayer =
      typeof c.colorByLayer === 'boolean'
        ? c.colorByLayer
        : !c.colorId || c.colorId === 'noir';
  }
  if (
    typeof o.textboxPadding === 'number' &&
    Number.isFinite(o.textboxPadding) &&
    o.textboxPadding >= 0
  ) {
    base.textboxPadding = o.textboxPadding;
  }
  return base;
}

export function loadTextPrefs(): TextPrefsFile {
  try {
    const raw = localStorage.getItem(TEXT_STORAGE_KEY);
    if (!raw) return defaultTextPrefs();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultTextPrefs();
  }
}

export function saveTextPrefs(prefs: TextPrefsFile): void {
  try {
    localStorage.setItem(TEXT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export type TextPrefsListener = (prefs: TextPrefsFile) => void;

export class TextPrefsManager {
  private prefs: TextPrefsFile;
  private listeners = new Set<TextPrefsListener>();

  constructor() {
    this.prefs = loadTextPrefs();
  }

  get file(): TextPrefsFile {
    return this.prefs;
  }

  get current(): TextStyleState {
    return this.prefs.current;
  }

  get textboxPadding(): number {
    return this.prefs.textboxPadding;
  }

  onChange(fn: TextPrefsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    saveTextPrefs(this.prefs);
    for (const fn of this.listeners) fn(this.prefs);
  }

  setFontFamily(font: string): void {
    if (font === TEXT_FONT_BY_LAYER) {
      if (this.prefs.current.fontByLayer) return;
      this.prefs.current.fontByLayer = true;
      this.emit();
      return;
    }
    if (!font.trim()) return;
    if (
      font === this.prefs.current.fontFamily &&
      !this.prefs.current.fontByLayer
    ) {
      return;
    }
    this.prefs.current.fontFamily = font;
    this.prefs.current.fontByLayer = false;
    this.emit();
  }

  setFontByLayer(on: boolean): void {
    if (this.prefs.current.fontByLayer === on) return;
    this.prefs.current.fontByLayer = on;
    this.emit();
  }

  setColorByLayer(on: boolean): void {
    if (this.prefs.current.colorByLayer === on) return;
    this.prefs.current.colorByLayer = on;
    this.emit();
  }

  setColorId(id: string): void {
    if (id === 'ducalque') {
      this.setColorByLayer(true);
      return;
    }
    if (id === this.prefs.current.colorId && !this.prefs.current.colorByLayer) return;
    this.prefs.current.colorId = id;
    this.prefs.current.colorByLayer = false;
    this.emit();
  }

  setBackgroundId(id: string): void {
    if (id === this.prefs.current.backgroundId) return;
    this.prefs.current.backgroundId = id;
    this.emit();
  }

  setHeight(h: number): void {
    if (!Number.isFinite(h) || h <= 0) return;
    this.prefs.current.height = h;
    this.emit();
  }

  setBold(v: boolean): void {
    if (v === this.prefs.current.bold && !this.prefs.current.fontByLayer) return;
    this.prefs.current.bold = v;
    this.prefs.current.fontByLayer = false;
    this.emit();
  }

  setItalic(v: boolean): void {
    if (v === this.prefs.current.italic && !this.prefs.current.fontByLayer) return;
    this.prefs.current.italic = v;
    this.prefs.current.fontByLayer = false;
    this.emit();
  }

  toggleBold(): boolean {
    const shown = this.prefs.current.fontByLayer ? false : this.prefs.current.bold;
    this.prefs.current.bold = !shown;
    this.prefs.current.fontByLayer = false;
    this.emit();
    return this.prefs.current.bold;
  }

  toggleItalic(): boolean {
    const shown = this.prefs.current.fontByLayer ? false : this.prefs.current.italic;
    this.prefs.current.italic = !shown;
    this.prefs.current.fontByLayer = false;
    this.emit();
    return this.prefs.current.italic;
  }

  setTextboxPadding(p: number): void {
    if (!Number.isFinite(p) || p < 0) return;
    this.prefs.textboxPadding = p;
    this.emit();
  }

  /**
   * Résout la couleur CSS depuis le catalogue pen + id courant.
   * `backgroundId === 'transparent'` → null.
   */
  resolveColors(colors: { id: string; value: string }[]): {
    color: string;
    background: string | null;
  } {
    const c =
      colors.find((x) => x.id === this.prefs.current.colorId) ?? colors[0];
    const bgId = this.prefs.current.backgroundId;
    if (bgId === 'transparent' || !bgId) {
      return { color: c?.value ?? '#000000', background: null };
    }
    const bg = colors.find((x) => x.id === bgId);
    return {
      color: c?.value ?? '#000000',
      background: bg?.value ?? null,
    };
  }
}
