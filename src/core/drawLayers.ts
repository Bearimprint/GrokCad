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

import type {
  ByLayerFlags,
  DrawLayerLabel,
  Entity,
  GkdDocument,
  LineStyleId,
} from './types';

/** Surface minimale du document pour le gestionnaire de calques (évite un import circulaire). */
export interface DrawLayerDoc {
  currentDrawLayer: number;
  drawLayerLabels: readonly DrawLayerLabel[];
  setCurrentDrawLayer(id: number): void;
  setDrawLayerLabel(id: number, label: string): void;
  patchDrawLayer(id: number, patch: LayerPatch): void;
  setDrawLayers(table: readonly DrawLayerLabel[]): void;
}

/** Champs modifiables d’un calque (l’id ne change pas). */
export type LayerPatch = Partial<Omit<DrawLayerLabel, 'id'>>;

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

/** Attributs par défaut de chaque calque normal (1–127). */
export const LAYER_DEFAULT_COLOR = '#ffffff';
export const LAYER_DEFAULT_WIDTH = 1;
export const LAYER_DEFAULT_STYLE: LineStyleId = 'plein';
export const LAYER_DEFAULT_FONT = 'Tahoma';

const LINE_STYLE_IDS: readonly LineStyleId[] = [
  'plein',
  'pointille',
  'pointille_espace',
  'tiret',
  'tiret_point',
  'tiret_point_point',
  'long_tiret',
];

export function isLineStyleId(v: unknown): v is LineStyleId {
  return typeof v === 'string' && (LINE_STYLE_IDS as readonly string[]).includes(v);
}

/** #RGB ou #RRGGBB → #rrggbb. */
export function parseLayerColor(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

const NAMED_LAYER_COLORS: Record<string, string> = {
  blanc: '#ffffff',
  white: '#ffffff',
  noir: '#000000',
  black: '#000000',
  bleu: '#1e88e5',
  vert: '#43a047',
  jaune: '#fdd835',
  rouge: '#e53935',
  orange: '#fb8c00',
};

export function parseLayerColorToken(raw: string): string | null {
  const hex = parseLayerColor(raw);
  if (hex) return hex;
  return NAMED_LAYER_COLORS[raw.trim().toLowerCase()] ?? null;
}

export interface ResolvedLayerStyle {
  id: number;
  label: string;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
  fontFamily: string;
  fontBold: boolean;
  fontItalic: boolean;
  visible: boolean;
}

export function resolveLayerStyle(
  id: number,
  table: readonly DrawLayerLabel[] | undefined,
): ResolvedLayerStyle {
  const hit = table?.find((l) => l.id === id);
  const width =
    hit && typeof hit.lineWidth === 'number' && hit.lineWidth >= 1
      ? Math.min(7, Math.round(hit.lineWidth))
      : LAYER_DEFAULT_WIDTH;
  return {
    id,
    label: labelOfLayer(id, table),
    color:
      hit?.color && parseLayerColor(hit.color) ? parseLayerColor(hit.color)! : LAYER_DEFAULT_COLOR,
    lineWidth: width,
    lineStyle: hit?.lineStyle && isLineStyleId(hit.lineStyle) ? hit.lineStyle : LAYER_DEFAULT_STYLE,
    fontFamily: hit?.fontFamily?.trim() || LAYER_DEFAULT_FONT,
    fontBold: hit?.fontBold === true,
    fontItalic: hit?.fontItalic === true,
    visible: isPositiveDrawLayer(id) ? hit?.visible !== false : true,
  };
}

/** Calques négatifs (insertions) restent toujours visibles. */
export function layerIsVisible(
  id: number,
  table: readonly DrawLayerLabel[] | undefined,
): boolean {
  return resolveLayerStyle(id, table).visible;
}

export function entityLayerVisible(
  e: { drawLayer?: number },
  table: readonly DrawLayerLabel[] | undefined,
): boolean {
  return layerIsVisible(entityDrawLayer(e), table);
}

export function entitiesOnVisibleLayers<T extends { drawLayer?: number }>(
  entities: readonly T[],
  table: readonly DrawLayerLabel[] | undefined,
): T[] {
  return entities.filter((e) => entityLayerVisible(e, table));
}

export interface EffectiveStroke {
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

/** Couleur / épaisseur / style réellement dessinés (DuCalque ou valeur stockée). */
export function effectiveStroke(
  e: {
    drawLayer?: number;
    color?: string;
    lineWidth?: number;
    lineStyle?: LineStyleId;
    byLayer?: ByLayerFlags;
  },
  table: readonly DrawLayerLabel[] | undefined,
): EffectiveStroke {
  const layer = resolveLayerStyle(entityDrawLayer(e), table);
  const by = e.byLayer;
  const width = by?.width
    ? layer.lineWidth
    : typeof e.lineWidth === 'number' && e.lineWidth > 0
      ? e.lineWidth
      : layer.lineWidth;
  return {
    color: by?.color ? layer.color : e.color || layer.color,
    lineWidth: width,
    lineStyle: by?.style ? layer.lineStyle : e.lineStyle && isLineStyleId(e.lineStyle) ? e.lineStyle : layer.lineStyle,
  };
}

export interface EffectiveTextStyle {
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

export function effectiveTextStyle(
  e: {
    drawLayer?: number;
    color?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    byLayer?: ByLayerFlags;
  },
  table: readonly DrawLayerLabel[] | undefined,
): EffectiveTextStyle {
  const layer = resolveLayerStyle(entityDrawLayer(e), table);
  const by = e.byLayer;
  return {
    color: by?.color ? layer.color : e.color || layer.color,
    fontFamily: by?.font ? layer.fontFamily : e.fontFamily?.trim() || layer.fontFamily,
    bold: by?.font ? layer.fontBold : e.bold === true,
    italic: by?.font ? layer.fontItalic : e.italic === true,
  };
}

export function sanitizeByLayer(raw: unknown): ByLayerFlags | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as ByLayerFlags;
  const out: ByLayerFlags = {};
  if (o.color === true) out.color = true;
  if (o.width === true) out.width = true;
  if (o.style === true) out.style = true;
  if (o.font === true) out.font = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Ids positifs : `5`, `5-10`, `5,8`. Ignore les jetons vides. */
export function parsePositiveLayerIds(
  tokens: readonly string[],
): { ok: true; ids: number[] } | { ok: false; error: string } {
  const ids: number[] = [];
  const seen = new Set<number>();
  const parts = tokens
    .join(' ')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, error: 'Indiquez un numéro de calque (1–127).' };
  }
  for (const part of parts) {
    const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(part);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        return { ok: false, error: `Plage invalide « ${part} ».` };
      }
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a < DRAW_LAYER_MIN || b > DRAW_LAYER_MAX) {
        return {
          ok: false,
          error: `Plage « ${part} » hors calques 1–${DRAW_LAYER_MAX}. Les calques négatifs ne se masquent pas.`,
        };
      }
      for (let n = a; n <= b; n++) {
        if (!seen.has(n)) {
          seen.add(n);
          ids.push(n);
        }
      }
      continue;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || !isPositiveDrawLayer(n)) {
      return {
        ok: false,
        error: `Calque invalide « ${part} ». Attendu 1–${DRAW_LAYER_MAX} (pas de 0, pas de calque d’insertion).`,
      };
    }
    if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return { ok: true, ids };
}

export const LAYER_VERBS = [
  'afficher',
  'masquer',
  'toutafficher',
  'isoler',
  'couleur',
  'epaisseur',
  'police',
  'nom',
] as const;

export type LayerVerb = (typeof LAYER_VERBS)[number];

export function isLayerVerb(token: string): token is LayerVerb {
  return (LAYER_VERBS as readonly string[]).includes(token.toLowerCase());
}

export type LayerEdit =
  | { kind: 'show'; ids: number[] }
  | { kind: 'hide'; ids: number[] }
  | { kind: 'showAll' }
  | { kind: 'isolate'; id: number }
  | { kind: 'color'; id: number; color: string }
  | { kind: 'width'; id: number; px: number }
  | { kind: 'font'; id: number; fontFamily: string }
  | { kind: 'name'; id: number; label: string };

export function interpretLayerArgs(
  args: readonly string[],
): { ok: true; edit: LayerEdit } | { ok: false; error: string } {
  const verb = (args[0] ?? '').toLowerCase();
  const rest = args.slice(1);
  if (!isLayerVerb(verb)) {
    return {
      ok: false,
      error:
        'Usage : /calques  ·  afficher n  ·  masquer n [m|5-10]  ·  toutafficher  ·  isoler n  ·  couleur n #RRGGBB  ·  epaisseur n px  ·  police n Tahoma  ·  nom n libellé',
    };
  }
  if (verb === 'toutafficher') {
    if (rest.length > 0) return { ok: false, error: '/calques toutafficher ne prend pas d’argument.' };
    return { ok: true, edit: { kind: 'showAll' } };
  }
  if (verb === 'isoler') {
    const parsed = parsePositiveLayerIds(rest);
    if (!parsed.ok) return parsed;
    if (parsed.ids.length !== 1) {
      return { ok: false, error: 'Usage : /calques isoler n' };
    }
    return { ok: true, edit: { kind: 'isolate', id: parsed.ids[0]! } };
  }
  if (verb === 'afficher' || verb === 'masquer') {
    const parsed = parsePositiveLayerIds(rest);
    if (!parsed.ok) return parsed;
    return { ok: true, edit: { kind: verb === 'afficher' ? 'show' : 'hide', ids: parsed.ids } };
  }
  if (verb === 'couleur') {
    const parsed = parsePositiveLayerIds(rest.slice(0, 1));
    if (!parsed.ok) return parsed;
    const color = parseLayerColorToken(rest[1] ?? '');
    if (!color) {
      return { ok: false, error: 'Couleur attendue : #RRGGBB (ou blanc, noir, rouge, bleu, vert, jaune, orange).' };
    }
    return { ok: true, edit: { kind: 'color', id: parsed.ids[0]!, color } };
  }
  if (verb === 'epaisseur') {
    const parsed = parsePositiveLayerIds(rest.slice(0, 1));
    if (!parsed.ok) return parsed;
    const raw = (rest[1] ?? '').toLowerCase().replace(/px$/, '').replace(',', '.');
    const px = Number(raw);
    if (!Number.isInteger(px) || px < 1 || px > 7) {
      return { ok: false, error: 'Épaisseur attendue : 1 à 7 (px). Ex. /calques epaisseur 3 2' };
    }
    return { ok: true, edit: { kind: 'width', id: parsed.ids[0]!, px } };
  }
  if (verb === 'police') {
    const parsed = parsePositiveLayerIds(rest.slice(0, 1));
    if (!parsed.ok) return parsed;
    const font = rest.slice(1).join(' ').trim();
    if (!font) return { ok: false, error: 'Usage : /calques police n Tahoma' };
    if (font.length > 80) return { ok: false, error: 'Nom de police trop long (80 caractères max).' };
    return { ok: true, edit: { kind: 'font', id: parsed.ids[0]!, fontFamily: font } };
  }
  const parsed = parsePositiveLayerIds(rest.slice(0, 1));
  if (!parsed.ok) return parsed;
  const label = rest.slice(1).join(' ');
  if (!label.trim()) return { ok: false, error: 'Usage : /calques nom n libellé' };
  return { ok: true, edit: { kind: 'name', id: parsed.ids[0]!, label: clampLayerLabel(label) } };
}

function cloneTable(table: readonly DrawLayerLabel[]): DrawLayerLabel[] {
  return table.map((l) => ({ ...l }));
}

/** Enregistre un patch. Un calque redevenu entièrement par défaut sort de la table, sauf libellé explicite. */
export function withLayerPatch(
  table: readonly DrawLayerLabel[],
  id: number,
  patch: LayerPatch,
): DrawLayerLabel[] {
  if (!isDrawLayerId(id)) return cloneTable(table);
  const prev = table.find((l) => l.id === id);
  const merged: DrawLayerLabel = {
    id,
    label: prev?.label ?? '',
    color: prev?.color,
    lineWidth: prev?.lineWidth,
    lineStyle: prev?.lineStyle,
    fontFamily: prev?.fontFamily,
    fontBold: prev?.fontBold,
    fontItalic: prev?.fontItalic,
    visible: prev?.visible,
    ...patch,
  };
  const collapsed = collapseLayerRecord(merged);
  const rest = table.filter((l) => l.id !== id);
  if (!collapsed) {
    rest.sort((a, b) => a.id - b.id);
    return rest;
  }
  rest.push(collapsed);
  rest.sort((a, b) => a.id - b.id);
  return rest;
}

function collapseLayerRecord(r: DrawLayerLabel): DrawLayerLabel | null {
  const label = clampLayerLabel(r.label ?? '');
  const keepLabel = label.trim().length > 0;
  const color = r.color && parseLayerColor(r.color) && parseLayerColor(r.color) !== LAYER_DEFAULT_COLOR
    ? parseLayerColor(r.color)!
    : undefined;
  const lineWidth =
    typeof r.lineWidth === 'number' && Math.round(r.lineWidth) !== LAYER_DEFAULT_WIDTH
      ? Math.min(7, Math.max(1, Math.round(r.lineWidth)))
      : undefined;
  const lineStyle =
    r.lineStyle && isLineStyleId(r.lineStyle) && r.lineStyle !== LAYER_DEFAULT_STYLE
      ? r.lineStyle
      : undefined;
  const fontFamily =
    r.fontFamily && r.fontFamily.trim() && r.fontFamily.trim() !== LAYER_DEFAULT_FONT
      ? r.fontFamily.trim()
      : undefined;
  const fontBold = r.fontBold === true ? true : undefined;
  const fontItalic = r.fontItalic === true ? true : undefined;
  const visible = r.visible === false ? false : undefined;
  if (
    !keepLabel &&
    !color &&
    lineWidth === undefined &&
    !lineStyle &&
    !fontFamily &&
    !fontBold &&
    !fontItalic &&
    visible === undefined
  ) {
    return null;
  }
  const out: DrawLayerLabel = { id: r.id, label: keepLabel ? label : '' };
  if (color) out.color = color;
  if (lineWidth !== undefined) out.lineWidth = lineWidth;
  if (lineStyle) out.lineStyle = lineStyle;
  if (fontFamily) out.fontFamily = fontFamily;
  if (fontBold) out.fontBold = true;
  if (fontItalic) out.fontItalic = true;
  if (visible === false) out.visible = false;
  return out;
}

export interface LayerEditResult {
  ok: boolean;
  table: DrawLayerLabel[];
  message: string;
}

/**
 * Applique une édition de calques.
 * Le calque courant n’est jamais masqué : il est ignoré, avec un message clair.
 */
export function applyLayerEdit(
  table: readonly DrawLayerLabel[],
  current: number,
  edit: LayerEdit,
): LayerEditResult {
  let next = cloneTable(table);
  if (edit.kind === 'showAll') {
    for (const row of [...next]) {
      if (row.visible === false) next = withLayerPatch(next, row.id, { visible: true });
    }
    return { ok: true, table: next, message: 'Tous les calques sont affichés.' };
  }
  if (edit.kind === 'show') {
    for (const id of edit.ids) next = withLayerPatch(next, id, { visible: true });
    return {
      ok: true,
      table: next,
      message: `Calque${edit.ids.length > 1 ? 's' : ''} ${edit.ids.join(', ')} affiché${edit.ids.length > 1 ? 's' : ''}.`,
    };
  }
  if (edit.kind === 'hide') {
    const blocked = edit.ids.filter((id) => id === current);
    const ids = edit.ids.filter((id) => id !== current);
    for (const id of ids) next = withLayerPatch(next, id, { visible: false });
    const hidden =
      ids.length === 0
        ? ''
        : `Calque${ids.length > 1 ? 's' : ''} ${ids.join(', ')} masqué${ids.length > 1 ? 's' : ''}.`;
    const guard =
      blocked.length > 0
        ? `Le calque courant ${current} ne peut pas être masqué.`
        : '';
    const message = [hidden, guard].filter(Boolean).join(' ');
    return {
      ok: blocked.length === 0 || ids.length > 0,
      table: next,
      message: message || `Le calque courant ${current} ne peut pas être masqué.`,
    };
  }
  if (edit.kind === 'isolate') {
    const keep = new Set<number>([edit.id]);
    let extra = '';
    if (isPositiveDrawLayer(current) && current !== edit.id) {
      keep.add(current);
      extra = ` Le calque courant ${current} reste affiché.`;
    }
    for (let id = DRAW_LAYER_MIN; id <= DRAW_LAYER_MAX; id++) {
      next = withLayerPatch(next, id, { visible: keep.has(id) });
    }
    return {
      ok: true,
      table: next,
      message: `Calque ${edit.id} isolé.${extra}`,
    };
  }
  if (edit.kind === 'color') {
    next = withLayerPatch(next, edit.id, { color: edit.color });
    return { ok: true, table: next, message: `Calque ${edit.id} → couleur ${edit.color}.` };
  }
  if (edit.kind === 'width') {
    next = withLayerPatch(next, edit.id, { lineWidth: edit.px });
    return { ok: true, table: next, message: `Calque ${edit.id} → épaisseur ${edit.px} px.` };
  }
  if (edit.kind === 'font') {
    next = withLayerPatch(next, edit.id, { fontFamily: edit.fontFamily });
    return { ok: true, table: next, message: `Calque ${edit.id} → police ${edit.fontFamily}.` };
  }
  next = withLayerPatch(next, edit.id, { label: edit.label });
  return { ok: true, table: next, message: `Calque ${edit.id} → « ${edit.label} ».` };
}

/** Entités visibles des calques demandés (une sélection classique ensuite). */
export function entityIdsOnLayers(
  entities: readonly Entity[],
  layerIds: readonly number[],
  table: readonly DrawLayerLabel[] | undefined,
): string[] {
  const want = new Set(layerIds);
  return entities
    .filter((e) => want.has(entityDrawLayer(e)) && entityLayerVisible(e, table))
    .map((e) => e.id);
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
    const o = item as Partial<DrawLayerLabel> & { id?: unknown };
    if (typeof o.id !== 'number' || !isDrawLayerId(Math.round(o.id))) continue;
    const id = Math.round(o.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const label = typeof o.label === 'string' ? clampLayerLabel(o.label) : '';
    const color =
      typeof o.color === 'string' ? parseLayerColor(o.color) ?? undefined : undefined;
    const lineWidth =
      typeof o.lineWidth === 'number' && o.lineWidth >= 1
        ? Math.min(7, Math.round(o.lineWidth))
        : undefined;
    const lineStyle = isLineStyleId(o.lineStyle) ? o.lineStyle : undefined;
    const fontFamily =
      typeof o.fontFamily === 'string' && o.fontFamily.trim()
        ? o.fontFamily.trim().slice(0, 80)
        : undefined;
    const fontBold = o.fontBold === true ? true : undefined;
    const fontItalic = o.fontItalic === true ? true : undefined;
    const visible = o.visible === false ? false : undefined;
    const collapsed = collapseLayerRecord({
      id,
      label,
      color: color && color !== LAYER_DEFAULT_COLOR ? color : undefined,
      lineWidth: lineWidth !== undefined && lineWidth !== LAYER_DEFAULT_WIDTH ? lineWidth : undefined,
      lineStyle: lineStyle && lineStyle !== LAYER_DEFAULT_STYLE ? lineStyle : undefined,
      fontFamily: fontFamily && fontFamily !== LAYER_DEFAULT_FONT ? fontFamily : undefined,
      fontBold,
      fontItalic,
      visible,
    });
    // Un libellé explicite (même le défaut « Bedrock layer ») est conservé.
    if (!collapsed && !label.trim()) continue;
    out.push(
      collapsed ?? {
        id,
        label,
      },
    );
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
      if (!layerIsVisible(id, this.table)) {
        this.doc.patchDrawLayer(id, { visible: true });
      }
      this.doc.setCurrentDrawLayer(id);
      this.emit();
      return true;
    }
    if (!this.insertModeOn && !this.libraryInsertOpen) return false;
    return this.setInsertLayer(id);
  }

  resolved(id: number): ResolvedLayerStyle {
    return resolveLayerStyle(id, this.table);
  }

  /** true si le calque est affiché. Le courant ne peut pas être masqué. */
  setVisible(id: number, visible: boolean): { ok: boolean; message: string } {
    if (!isPositiveDrawLayer(id)) {
      return { ok: false, message: 'Les calques d’insertion ne se masquent pas.' };
    }
    const edit = this.applyEdit({
      kind: visible ? 'show' : 'hide',
      ids: [id],
    });
    return { ok: edit.ok, message: edit.message };
  }

  applyEdit(edit: LayerEdit): LayerEditResult {
    const result = applyLayerEdit(this.table, this.current, edit);
    this.doc.setDrawLayers(result.table);
    this.emit();
    return result;
  }

  patch(id: number, patch: LayerPatch): void {
    this.doc.patchDrawLayer(id, patch);
    this.emit();
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
