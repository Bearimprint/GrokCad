/**
 * Codec DXF ASCII ↔ GrokCAD (.GKD / entités).
 *
 * Import : LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, TEXT, MTEXT, INSERT (blocs),
 *          types de ligne, couleurs ACI/BYLAYER, $INSUNITS → unités doc.
 * Export : LINE, CIRCLE, ARC, TEXT (+ murs et objets explosés en traits).
 * Coordonnées en unités document (m par défaut). Angles DXF en degrés, sens trigo.
 */

import { createEmptyDocument, defaultCamera } from './gkd';
import { expandObjectEntities } from './objectInstance';
import { objectDefCache } from './objectCache';
import type {
  ArcEntity,
  CircleEntity,
  Entity,
  GkdDocument,
  LineEntity,
  LineStyleId,
  TextEntity,
  UnitId,
  Vec3,
  WallEntity,
} from './types';
import { APP_VERSION } from './types';
import { UNIT_TO_METERS } from './units';
import { wallEntityStrokes } from './walls';

const DRAW_LAYER = 'DESSIN';
const EPS = 1e-12;
const DEFAULT_DRAW_COLOR = '#e0e0e0';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `dxf_${prefix}_${seq}_${Date.now().toString(36)}`;
}

// —— Group codes ——

interface DxfPair {
  code: number;
  value: string;
}

function parsePairs(text: string): DxfPair[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1]!.trimEnd() });
  }
  return pairs;
}

function num(v: string, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// —— Styles / couleurs / unités ——

interface LayerInfo {
  color: string;
  lineStyle: LineStyleId;
}

/** Facteur : 1 unité DXF ($INSUNITS) → mètres SI. */
function insUnitsToMeters(ins: number): number {
  switch (ins) {
    case 1:
      return 0.0254; // inches
    case 2:
      return 0.3048; // feet
    case 3:
      return 1609.344; // miles
    case 4:
      return 0.001; // mm
    case 5:
      return 0.01; // cm
    case 6:
      return 1; // m
    case 7:
      return 1000; // km
    case 8:
      return 2.54e-8; // µin
    case 9:
      return 2.54e-5; // mils
    case 10:
      return 0.9144; // yards
    case 11:
      return 1e-10; // Å
    case 12:
      return 1e-9; // nm
    case 13:
      return 1e-6; // µm
    case 14:
      return 0.1; // dm
    case 15:
      return 10; // dam
    case 16:
      return 100; // hm
    case 0:
    default:
      return 1; // unitless / inconnu : 1:1
  }
}

/** Échelle DXF → unités document GrokCAD. */
function dxfScaleToDoc(insUnits: number, docUnits: UnitId): number {
  const metersPerDxf = insUnitsToMeters(insUnits);
  const metersPerDoc = UNIT_TO_METERS[docUnits] ?? 1;
  return metersPerDxf / metersPerDoc;
}

/** Mappe un nom de type de ligne DXF vers un style GrokCAD. */
export function mapDxfLinetype(name: string | undefined | null): LineStyleId {
  if (!name) return 'plein';
  const n = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (
    !n ||
    n === 'CONTINUOUS' ||
    n === 'BYLAYER' ||
    n === 'BYBLOCK' ||
    n === 'SOLID'
  ) {
    return 'plein';
  }
  if (n.includes('CENTER')) return 'long_tiret';
  if (n.includes('DASHDOT') || n.includes('DIVIDE') || n.includes('PHANTOM')) {
    return 'tiret_point';
  }
  if (n.includes('DOT') || n.includes('POINT')) return 'pointille';
  if (
    n.includes('DASH') ||
    n.includes('HIDDEN') ||
    n.includes('BORDER') ||
    n.includes('DASHED')
  ) {
    return 'tiret';
  }
  return 'plein';
}

/** Palette ACI simplifiée (1–9 + échantillon 10–249 + défaut). */
export function aciToHex(aci: number): string {
  const c = Math.round(aci);
  if (c === 0) return DEFAULT_DRAW_COLOR; // BYBLOCK
  if (c < 0) return DEFAULT_DRAW_COLOR; // calque off
  // ACI 7 = blanc/noir selon fond — fond sombre GrokCAD → clair
  const basic: Record<number, string> = {
    1: '#ff0000',
    2: '#ffff00',
    3: '#00ff00',
    4: '#00ffff',
    5: '#0000ff',
    6: '#ff00ff',
    7: '#e8e8e8',
    8: '#808080',
    9: '#c0c0c0',
  };
  if (basic[c]) return basic[c]!;
  if (c === 250 || c === 251 || c === 252 || c === 253) return '#404040';
  if (c === 254 || c === 255) return '#e0e0e0';
  // Approximation HSL pour 10–249 (grille ACI standard)
  if (c >= 10 && c <= 249) {
    const idx = c - 10;
    const hue = (Math.floor(idx / 10) % 24) * 15;
    const row = idx % 10;
    const light = 0.25 + (row / 9) * 0.55;
    const sat = row < 2 ? 0.15 : 0.85;
    return hslToHex(hue, sat, light);
  }
  return DEFAULT_DRAW_COLOR;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// —— Import ——

export interface DxfImportResult {
  doc: GkdDocument;
  warnings: string[];
  entityCount: number;
}

interface ImportCtx {
  scale: number;
  layers: Map<string, LayerInfo>;
  blocks: Map<string, Entity[]>;
  warnings: string[];
  /** Profondeur INSERT (anti-récursion). */
  insertDepth: number;
}

/**
 * Parse un fichier DXF ASCII en document GrokCAD.
 * Applique $INSUNITS → unités doc, couleurs calque, linetypes, TEXT, INSERT.
 */
export function parseDxf(
  text: string,
  opts?: { title?: string; units?: UnitId },
): DxfImportResult {
  const pairs = parsePairs(text);
  const warnings: string[] = [];
  const units: UnitId = opts?.units ?? 'm';
  const title = opts?.title ?? 'import_dxf';

  const insUnits = readHeaderInsUnits(pairs);
  const scale = dxfScaleToDoc(insUnits, units);
  const layers = readLayerTable(pairs);
  const blocks = readBlocks(pairs, {
    scale,
    layers,
    blocks: new Map(),
    warnings,
    insertDepth: 0,
  });

  const ctx: ImportCtx = {
    scale,
    layers,
    blocks,
    warnings,
    insertDepth: 0,
  };

  const entities = readEntitiesSection(pairs, ctx);

  if (insUnits === 1 && Math.abs(scale - 0.0254) < 1e-12 && units === 'm') {
    warnings.push(
      'DXF en pouces ($INSUNITS=1) converti en mètres (×0,0254).',
    );
  } else if (insUnits > 0 && Math.abs(scale - 1) > 1e-9) {
    warnings.push(
      `Échelle DXF appliquée : $INSUNITS=${insUnits} → ${units} (×${scale.toPrecision(6)}).`,
    );
  }

  const cam = defaultCamera();
  const bounds = boundsOfEntities(entities);
  if (bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const half =
      Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 0.6;
    cam.target = [cx, cy, 0];
    cam.position = [cx, cy, Math.max(half * 10, 50)];
    cam.orthoHalfHeight = half;
  }

  const doc: GkdDocument = {
    ...createEmptyDocument(title),
    version: APP_VERSION,
    camera: cam,
    entities,
    meta: { title, units },
  };

  return { doc, warnings, entityCount: entities.length };
}

type GetI = () => number;
type SetI = (n: number) => void;

function readEntityFields(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  let i = getI();
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0) break;
    const list = map.get(p.code) ?? [];
    list.push(p.value);
    map.set(p.code, list);
    i += 1;
  }
  setI(i);
  return map;
}

function last(map: Map<number, string[]>, code: number, def = '0'): string {
  const a = map.get(code);
  return a && a.length ? a[a.length - 1]! : def;
}

function readHeaderInsUnits(pairs: DxfPair[]): number {
  let inHeader = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      if (pairs[i + 1]?.code === 2) {
        inHeader = pairs[i + 1]!.value.trim().toUpperCase() === 'HEADER';
      }
    }
    if (p.code === 0 && p.value.trim() === 'ENDSEC') inHeader = false;
    if (
      inHeader &&
      p.code === 9 &&
      p.value.trim().toUpperCase() === '$INSUNITS'
    ) {
      // suivant : 70 + valeur
      for (let j = i + 1; j < Math.min(i + 4, pairs.length); j++) {
        if (pairs[j]!.code === 70) return Math.round(num(pairs[j]!.value));
      }
    }
  }
  return 0;
}

function readLayerTable(pairs: DxfPair[]): Map<string, LayerInfo> {
  const layers = new Map<string, LayerInfo>();
  layers.set('0', { color: DEFAULT_DRAW_COLOR, lineStyle: 'plein' });
  let inTables = false;
  let inLayerTable = false;
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      i += 1;
      if (pairs[i]?.code === 2) {
        inTables = pairs[i]!.value.trim().toUpperCase() === 'TABLES';
        i += 1;
      }
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'ENDSEC') {
      inTables = false;
      inLayerTable = false;
      i += 1;
      continue;
    }
    if (!inTables) {
      i += 1;
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'TABLE') {
      i += 1;
      if (pairs[i]?.code === 2) {
        inLayerTable = pairs[i]!.value.trim().toUpperCase() === 'LAYER';
        i += 1;
      }
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'ENDTAB') {
      inLayerTable = false;
      i += 1;
      continue;
    }
    if (inLayerTable && p.code === 0 && p.value.trim() === 'LAYER') {
      i += 1;
      const f = readEntityFields(pairs, () => i, (n) => {
        i = n;
      });
      const name = last(f, 2, '0').trim() || '0';
      const aci = Math.round(num(last(f, 62, '7'), 7));
      const color = aciToHex(Math.abs(aci) || 7);
      const lineStyle = mapDxfLinetype(last(f, 6, 'CONTINUOUS'));
      layers.set(name, { color, lineStyle });
      continue;
    }
    i += 1;
  }
  return layers;
}

function readBlocks(pairs: DxfPair[], baseCtx: ImportCtx): Map<string, Entity[]> {
  const blocks = new Map<string, Entity[]>();
  let inBlocks = false;
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      i += 1;
      if (pairs[i]?.code === 2) {
        inBlocks = pairs[i]!.value.trim().toUpperCase() === 'BLOCKS';
        i += 1;
      }
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'ENDSEC') {
      if (inBlocks) break;
      i += 1;
      continue;
    }
    if (!inBlocks) {
      i += 1;
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'BLOCK') {
      i += 1;
      const header = readEntityFields(pairs, () => i, (n) => {
        i = n;
      });
      const name = last(header, 2, '').trim();
      const base: Vec3 = [
        num(last(header, 10)),
        num(last(header, 20)),
        num(last(header, 30)),
      ];
      const ents: Entity[] = [];
      const ctx: ImportCtx = {
        ...baseCtx,
        blocks, // blocs déjà parsés (ordre DXF)
        insertDepth: 0,
      };
      while (i < pairs.length) {
        const q = pairs[i]!;
        if (q.code === 0) {
          const t = q.value.trim().toUpperCase();
          if (t === 'ENDBLK') {
            i += 1;
            while (i < pairs.length && pairs[i]!.code !== 0) i += 1;
            break;
          }
          i += 1;
          const produced = parseOneEntity(t, pairs, () => i, (n) => {
            i = n;
          }, ctx);
          ents.push(...produced);
          continue;
        }
        i += 1;
      }
      // Origine du bloc : soustraire base point
      const shifted =
        Math.abs(base[0]) + Math.abs(base[1]) + Math.abs(base[2]) > EPS
          ? ents.map((e) => shiftEntity(e, -base[0], -base[1], -base[2]))
          : ents;
      if (name) blocks.set(name.toUpperCase(), shifted);
      continue;
    }
    i += 1;
  }
  return blocks;
}

function readEntitiesSection(pairs: DxfPair[], ctx: ImportCtx): Entity[] {
  const entities: Entity[] = [];
  let inEntities = false;
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.trim() === 'SECTION') {
      i += 1;
      if (pairs[i]?.code === 2) {
        inEntities = pairs[i]!.value.trim().toUpperCase() === 'ENTITIES';
        i += 1;
      }
      continue;
    }
    if (p.code === 0 && p.value.trim() === 'ENDSEC') {
      if (inEntities) break;
      i += 1;
      continue;
    }
    if (!inEntities || p.code !== 0) {
      i += 1;
      continue;
    }
    const type = p.value.trim().toUpperCase();
    i += 1;
    entities.push(
      ...parseOneEntity(type, pairs, () => i, (n) => {
        i = n;
      }, ctx),
    );
  }
  return entities;
}

function parseOneEntity(
  type: string,
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): Entity[] {
  if (type === 'LINE') {
    const e = readLineEntity(pairs, getI, setI, ctx);
    return e ? [e] : [];
  }
  if (type === 'CIRCLE') {
    const e = readCircleEntity(pairs, getI, setI, ctx);
    return e ? [e] : [];
  }
  if (type === 'ARC') {
    const e = readArcEntity(pairs, getI, setI, ctx);
    return e ? [e] : [];
  }
  if (type === 'LWPOLYLINE') {
    return readLwPolyline(pairs, getI, setI, ctx);
  }
  if (type === 'POLYLINE') {
    return readPolyline(pairs, getI, setI, ctx);
  }
  if (type === 'TEXT') {
    const e = readTextEntity(pairs, getI, setI, ctx);
    return e ? [e] : [];
  }
  if (type === 'MTEXT') {
    const e = readMTextEntity(pairs, getI, setI, ctx);
    return e ? [e] : [];
  }
  if (type === 'INSERT') {
    return readInsertEntity(pairs, getI, setI, ctx);
  }
  // Entité non gérée : sauter jusqu’à la prochaine (code 0)
  let i = getI();
  while (i < pairs.length && pairs[i]!.code !== 0) i += 1;
  setI(i);
  return [];
}

function resolveStyle(
  f: Map<number, string[]>,
  ctx: ImportCtx,
): { layer: string; color: string; lineStyle: LineStyleId; lineWidth: number } {
  const layer = (last(f, 8, '0') || '0').trim() || '0';
  const layerInfo = ctx.layers.get(layer) ?? ctx.layers.get('0') ?? {
    color: DEFAULT_DRAW_COLOR,
    lineStyle: 'plein' as LineStyleId,
  };

  const aciRaw = last(f, 62, '');
  let color = layerInfo.color;
  if (aciRaw !== '' && aciRaw !== undefined) {
    const aci = Math.round(num(aciRaw, 256));
    if (aci === 256 || aci === 0) {
      // BYLAYER / BYBLOCK
      color = layerInfo.color;
    } else {
      color = aciToHex(Math.abs(aci));
    }
  }

  const ltRaw = last(f, 6, '');
  let lineStyle = layerInfo.lineStyle;
  if (ltRaw) {
    const u = ltRaw.trim().toUpperCase();
    if (u === 'BYLAYER' || u === '') {
      lineStyle = layerInfo.lineStyle;
    } else if (u === 'BYBLOCK') {
      lineStyle = 'plein';
    } else {
      lineStyle = mapDxfLinetype(ltRaw);
    }
  }

  // Épaisseur DXF 370 : 100ths of mm, -1 BYLAYER, -2 BYBLOCK, -3 default
  let lineWidth = 1;
  const lw = Math.round(num(last(f, 370, '-1'), -1));
  if (lw > 0) {
    // ~0.01 mm units → pixels approx (clamp 1–6)
    lineWidth = Math.min(6, Math.max(1, Math.round(lw / 50)));
  }

  return { layer, color, lineStyle, lineWidth };
}

function sc(v: number, ctx: ImportCtx): number {
  return v * ctx.scale;
}

function scPt(x: number, y: number, z: number, ctx: ImportCtx): Vec3 {
  return [sc(x, ctx), sc(y, ctx), sc(z, ctx)];
}

function readLineEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): LineEntity | null {
  const f = readEntityFields(pairs, getI, setI);
  const start = scPt(num(last(f, 10)), num(last(f, 20)), num(last(f, 30)), ctx);
  const end = scPt(num(last(f, 11)), num(last(f, 21)), num(last(f, 31)), ctx);
  if (dist2(start, end) < EPS) return null;
  const st = resolveStyle(f, ctx);
  return {
    id: nextId('line'),
    kind: 'line',
    layer: st.layer,
    start,
    end,
    color: st.color,
    lineWidth: st.lineWidth,
    lineStyle: st.lineStyle,
  };
}

function readCircleEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): CircleEntity | null {
  const f = readEntityFields(pairs, getI, setI);
  const center = scPt(num(last(f, 10)), num(last(f, 20)), num(last(f, 30)), ctx);
  const radius = Math.abs(sc(num(last(f, 40)), ctx));
  if (radius < EPS) return null;
  const st = resolveStyle(f, ctx);
  return {
    id: nextId('circle'),
    kind: 'circle',
    layer: st.layer,
    center,
    radius,
    normal: [0, 0, 1],
    color: st.color,
    lineWidth: st.lineWidth,
    lineStyle: st.lineStyle,
  };
}

function readArcEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): ArcEntity | null {
  const f = readEntityFields(pairs, getI, setI);
  const center = scPt(num(last(f, 10)), num(last(f, 20)), num(last(f, 30)), ctx);
  const radius = Math.abs(sc(num(last(f, 40)), ctx));
  if (radius < EPS) return null;
  let a0 = (num(last(f, 50)) * Math.PI) / 180;
  let a1 = (num(last(f, 51)) * Math.PI) / 180;
  while (a1 < a0) a1 += Math.PI * 2;
  if (Math.abs(a1 - a0) < EPS) a1 = a0 + Math.PI * 2;
  const st = resolveStyle(f, ctx);
  return {
    id: nextId('arc'),
    kind: 'arc',
    layer: st.layer,
    center,
    radius,
    startAngle: a0,
    endAngle: a1,
    normal: [0, 0, 1],
    color: st.color,
    lineWidth: st.lineWidth,
    lineStyle: st.lineStyle,
  };
}

function readLwPolyline(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): LineEntity[] {
  const f = readEntityFields(pairs, getI, setI);
  const xs = f.get(10) ?? [];
  const ys = f.get(20) ?? [];
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return [];
  const closed = (num(last(f, 70)) & 1) === 1;
  const elev = sc(num(last(f, 38)), ctx);
  const st = resolveStyle(f, ctx);
  const pts: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    pts.push([sc(num(xs[k]!), ctx), sc(num(ys[k]!), ctx), elev]);
  }
  return polyToLines(pts, closed, st);
}

function readPolyline(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): LineEntity[] {
  const header = readEntityFields(pairs, getI, setI);
  const st = resolveStyle(header, ctx);
  const closed = (num(last(header, 70)) & 1) === 1;
  const pts: Vec3[] = [];
  let i = getI();
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0) {
      const t = p.value.trim().toUpperCase();
      if (t === 'SEQEND') {
        i += 1;
        while (i < pairs.length && pairs[i]!.code !== 0) i += 1;
        break;
      }
      if (t === 'VERTEX') {
        i += 1;
        const vf = new Map<number, string[]>();
        while (i < pairs.length && pairs[i]!.code !== 0) {
          const c = pairs[i]!.code;
          const list = vf.get(c) ?? [];
          list.push(pairs[i]!.value);
          vf.set(c, list);
          i += 1;
        }
        pts.push(
          scPt(num(last(vf, 10)), num(last(vf, 20)), num(last(vf, 30)), ctx),
        );
        continue;
      }
      ctx.warnings.push('POLYLINE sans SEQEND — tronquée.');
      break;
    }
    i += 1;
  }
  setI(i);
  return polyToLines(pts, closed, st);
}

function polyToLines(
  pts: Vec3[],
  closed: boolean,
  st: { layer: string; color: string; lineStyle: LineStyleId; lineWidth: number },
): LineEntity[] {
  const out: LineEntity[] = [];
  const n = pts.length;
  if (n < 2) return out;
  const count = closed ? n : n - 1;
  for (let k = 0; k < count; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % n]!;
    if (dist2(a, b) < EPS) continue;
    out.push({
      id: nextId('line'),
      kind: 'line',
      layer: st.layer,
      start: [...a] as Vec3,
      end: [...b] as Vec3,
      color: st.color,
      lineWidth: st.lineWidth,
      lineStyle: st.lineStyle,
    });
  }
  return out;
}

function readTextEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): TextEntity | null {
  const f = readEntityFields(pairs, getI, setI);
  const content = last(f, 1, '').trim();
  if (!content) return null;
  const height = Math.abs(sc(num(last(f, 40), 2.5), ctx));
  if (height < EPS) return null;
  const hAlign = Math.round(num(last(f, 72), 0));
  const vAlign = Math.round(num(last(f, 73), 0));
  // Point d’alignement si justifié, sinon insertion
  const useAlign = hAlign !== 0 || vAlign !== 0;
  const x = num(last(f, useAlign ? 11 : 10, last(f, 10)));
  const y = num(last(f, useAlign ? 21 : 20, last(f, 20)));
  const z = num(last(f, useAlign ? 31 : 30, last(f, 30)));
  const rotation = (num(last(f, 50)) * Math.PI) / 180;
  const st = resolveStyle(f, ctx);
  return {
    id: nextId('text'),
    kind: 'text',
    layer: st.layer,
    position: scPt(x, y, z, ctx),
    height: height || sc(2.5, ctx),
    content: decodeDxfText(content),
    rotation,
    color: st.color,
    hAlign,
    vAlign,
  };
}

function readMTextEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): TextEntity | null {
  const f = readEntityFields(pairs, getI, setI);
  // Contenu : groupes 1 + 3 (fragments)
  const parts = [...(f.get(1) ?? []), ...(f.get(3) ?? [])];
  const raw = parts.join('');
  const content = stripMtextCodes(raw).trim();
  if (!content) return null;
  const height = Math.abs(sc(num(last(f, 40), 2.5), ctx));
  if (height < EPS) return null;
  const rotation = (num(last(f, 50)) * Math.PI) / 180;
  // Attachment point 71 → approx h/v align
  const attach = Math.round(num(last(f, 71), 1));
  const { hAlign, vAlign } = mtextAttachmentToAlign(attach);
  const st = resolveStyle(f, ctx);
  return {
    id: nextId('text'),
    kind: 'text',
    layer: st.layer,
    position: scPt(num(last(f, 10)), num(last(f, 20)), num(last(f, 30)), ctx),
    height: height || sc(2.5, ctx),
    content,
    rotation,
    color: st.color,
    hAlign,
    vAlign,
  };
}

function mtextAttachmentToAlign(attach: number): {
  hAlign: number;
  vAlign: number;
} {
  // 1–9 grille : top-left … bottom-right
  const a = Math.min(9, Math.max(1, attach));
  const row = Math.floor((a - 1) / 3); // 0 top, 1 mid, 2 bot
  const col = (a - 1) % 3; // 0 left, 1 center, 2 right
  const hAlign = col; // 0,1,2
  const vAlign = row === 0 ? 3 : row === 1 ? 2 : 1;
  return { hAlign, vAlign };
}

/** Enlève les codes de formatage MTEXT basiques. */
function stripMtextCodes(s: string): string {
  let t = s;
  // {\fArial|b0|i0|c0|p0;Text} → Text
  t = t.replace(/\{\\f[^;]*;([^}]*)\}/gi, '$1');
  t = t.replace(/\{\\[^;]*;([^}]*)\}/g, '$1');
  // \P = paragraphe
  t = t.replace(/\\P/gi, '\n');
  // \~ espace insécable
  t = t.replace(/\\~/g, ' ');
  // codes \L \l \O \o \K \k \A1; etc.
  t = t.replace(/\\[A-Za-z][^\\;]*;?/g, '');
  t = t.replace(/[{}]/g, '');
  return t;
}

function decodeDxfText(s: string): string {
  // %%d → °, %%c → ∅, %%p → ±
  return s
    .replace(/%%[dD]/g, '°')
    .replace(/%%[cC]/g, '∅')
    .replace(/%%[pP]/g, '±')
    .replace(/%%u/gi, '')
    .replace(/%%o/gi, '');
}

function readInsertEntity(
  pairs: DxfPair[],
  getI: GetI,
  setI: SetI,
  ctx: ImportCtx,
): Entity[] {
  const f = readEntityFields(pairs, getI, setI);
  const name = last(f, 2, '').trim();
  if (!name) return [];
  if (ctx.insertDepth > 8) {
    ctx.warnings.push(`INSERT ${name} : profondeur de blocs max atteinte.`);
    return [];
  }
  const block = ctx.blocks.get(name.toUpperCase());
  if (!block || block.length === 0) {
    // Bloc vide ou *Model_Space — ignorer sans flood de warnings
    if (!name.startsWith('*')) {
      ctx.warnings.push(`INSERT « ${name} » : bloc introuvable ou vide.`);
    }
    return [];
  }

  const ip = scPt(num(last(f, 10)), num(last(f, 20)), num(last(f, 30)), ctx);
  // Échelles : déjà en facteur (pas en unités de longueur) — ne pas sc()
  const sx = num(last(f, 41), 1) || 1;
  const sy = num(last(f, 42), sx) || sx;
  const sz = num(last(f, 43), sx) || sx;
  const rot = (num(last(f, 50)) * Math.PI) / 180;
  const cols = Math.max(1, Math.round(num(last(f, 70), 1)));
  const rows = Math.max(1, Math.round(num(last(f, 71), 1)));
  const colSp = sc(num(last(f, 44)), ctx);
  const rowSp = sc(num(last(f, 45)), ctx);

  const out: Entity[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = ip[0] + c * colSp;
      const oy = ip[1] + r * rowSp;
      const oz = ip[2];
      for (const e of block) {
        out.push(transformEntity(e, ox, oy, oz, sx, sy, sz, rot));
      }
    }
  }
  return out;
}

function shiftEntity(e: Entity, dx: number, dy: number, dz: number): Entity {
  return transformEntity(e, dx, dy, dz, 1, 1, 1, 0);
}

function transformEntity(
  e: Entity,
  ox: number,
  oy: number,
  oz: number,
  sx: number,
  sy: number,
  sz: number,
  rot: number,
): Entity {
  const xf = (p: Vec3): Vec3 => {
    let x = p[0] * sx;
    let y = p[1] * sy;
    let z = p[2] * sz;
    if (Math.abs(rot) > EPS) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const nx = x * c - y * s;
      const ny = x * s + y * c;
      x = nx;
      y = ny;
    }
    return [x + ox, y + oy, z + oz];
  };
  const scaleR = (Math.abs(sx) + Math.abs(sy)) / 2;

  if (e.kind === 'line') {
    return {
      ...e,
      id: nextId('line'),
      start: xf(e.start),
      end: xf(e.end),
    };
  }
  if (e.kind === 'circle') {
    return {
      ...e,
      id: nextId('circle'),
      center: xf(e.center),
      radius: Math.abs(e.radius * scaleR),
    };
  }
  if (e.kind === 'arc') {
    let a0 = e.startAngle + rot;
    let a1 = e.endAngle + rot;
    if (sx * sy < 0) {
      // miroir : inverser le sens
      const t = -a0;
      a0 = -a1;
      a1 = t;
    }
    return {
      ...e,
      id: nextId('arc'),
      center: xf(e.center),
      radius: Math.abs(e.radius * scaleR),
      startAngle: a0,
      endAngle: a1,
    };
  }
  if (e.kind === 'text') {
    return {
      ...e,
      id: nextId('text'),
      position: xf(e.position),
      height: Math.abs(e.height * scaleR),
      rotation: e.rotation + rot,
    };
  }
  if (e.kind === 'wall') {
    return {
      ...e,
      id: nextId('wall'),
      start: xf(e.start),
      end: xf(e.end),
      center: e.center ? xf(e.center) : undefined,
      radius: e.radius !== undefined ? Math.abs(e.radius * scaleR) : undefined,
    };
  }
  // helper / object : clone id
  return { ...e, id: nextId(e.kind) } as Entity;
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function boundsOfEntities(
  entities: Entity[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  const acc = (x: number, y: number) => {
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    if (e.kind === 'line') {
      acc(e.start[0], e.start[1]);
      acc(e.end[0], e.end[1]);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      acc(e.center[0] - e.radius, e.center[1] - e.radius);
      acc(e.center[0] + e.radius, e.center[1] + e.radius);
    } else if (e.kind === 'wall') {
      acc(e.start[0], e.start[1]);
      acc(e.end[0], e.end[1]);
    } else if (e.kind === 'text') {
      const h = e.height;
      const w = Math.max(h * 0.6 * e.content.length, h);
      acc(e.position[0] - w, e.position[1] - h);
      acc(e.position[0] + w, e.position[1] + h);
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

// —— Export ——

/** INSUNITS DXF : 0=Unitless, 4=mm, 5=cm, 6=m, 1=in… */
function insUnits(u: UnitId | undefined): number {
  switch (u) {
    case 'mm':
      return 4;
    case 'cm':
      return 5;
    case 'km':
      return 0;
    case 'm':
    default:
      return 6;
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Évite la notation scientifique pour les CAO classiques
  const s = n.toFixed(12).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

export interface DxfExportOptions {
  /** Entités à exporter (sinon doc.entities). */
  entities?: readonly Entity[];
  /** Inclure les lignes d’aide (défaut false). */
  includeHelpers?: boolean;
  /** Titre / nom de fichier pour HEADER. */
  title?: string;
}

/**
 * Sérialise un document (ou un sous-ensemble d’entités) en DXF ASCII R12-compatible.
 * Les murs sont décomposés en segments ; les objets library sont explosés s’ils sont en cache.
 */
export function serializeDxf(
  doc: GkdDocument,
  opts?: DxfExportOptions,
): { text: string; warnings: string[]; entityCount: number } {
  const warnings: string[] = [];
  const source = opts?.entities ?? doc.entities;
  const includeHelpers = opts?.includeHelpers === true;
  const flat: Entity[] = [];

  for (const e of source) {
    if (e.kind === 'helper') {
      if (includeHelpers) {
        // Ligne d’aide : grand segment autour de l’origine
        const L = 1e5;
        const o = e.origin;
        const d = e.direction;
        flat.push({
          id: e.id,
          kind: 'line',
          layer: e.layer || 'AIDES',
          start: [o[0] - d[0] * L, o[1] - d[1] * L, o[2] - d[2] * L],
          end: [o[0] + d[0] * L, o[1] + d[1] * L, o[2] + d[2] * L],
          color: e.color,
          lineWidth: 1,
          lineStyle: 'pointille',
        });
      }
      continue;
    }
    if (e.kind === 'object') {
      const def = objectDefCache.get(e.libTab, e.libName);
      const parts = expandObjectEntities(e, def);
      if (parts.length === 0) {
        warnings.push(
          `Objet library ${e.libTab}/${e.libName} non chargé — ignoré à l’export.`,
        );
      } else {
        flat.push(...parts);
      }
      continue;
    }
    flat.push(e);
  }

  let body = '';
  let count = 0;

  for (const e of flat) {
    if (e.kind === 'line') {
      body += writeLine(e);
      count += 1;
    } else if (e.kind === 'circle') {
      body += writeCircle(e);
      count += 1;
    } else if (e.kind === 'arc') {
      body += writeArc(e);
      count += 1;
    } else if (e.kind === 'text') {
      body += writeText(e);
      count += 1;
    } else if (e.kind === 'wall') {
      const n = writeWall(e);
      body += n.text;
      count += n.count;
    }
  }

  const units = doc.meta?.units ?? 'm';
  const title = (opts?.title ?? doc.meta?.title ?? 'GrokCAD').slice(0, 31);

  let out = '';
  out += pair(0, 'SECTION');
  out += pair(2, 'HEADER');
  out += pair(9, '$ACADVER');
  out += pair(1, 'AC1009');
  out += pair(9, '$INSUNITS');
  out += pair(70, insUnits(units));
  out += pair(9, '$DWGCODEPAGE');
  out += pair(3, 'ANSI_1252');
  out += pair(0, 'ENDSEC');

  out += pair(0, 'SECTION');
  out += pair(2, 'TABLES');
  out += pair(0, 'TABLE');
  out += pair(2, 'LAYER');
  out += pair(70, 2);
  out += pair(0, 'LAYER');
  out += pair(2, '0');
  out += pair(70, 0);
  out += pair(62, 7);
  out += pair(6, 'CONTINUOUS');
  out += pair(0, 'LAYER');
  out += pair(2, DRAW_LAYER);
  out += pair(70, 0);
  out += pair(62, 7);
  out += pair(6, 'CONTINUOUS');
  out += pair(0, 'ENDTAB');
  out += pair(0, 'ENDSEC');

  out += pair(0, 'SECTION');
  out += pair(2, 'ENTITIES');
  out += body;
  out += pair(0, 'ENDSEC');
  out += pair(0, 'EOF');

  void title; // réservé (commentaire fichier si besoin plus tard)
  return { text: out, warnings, entityCount: count };
}

function layerOf(e: { layer?: string }): string {
  const l = (e.layer ?? DRAW_LAYER).replace(/[\r\n]/g, '');
  return l || '0';
}

function writeLine(e: LineEntity): string {
  let s = '';
  s += pair(0, 'LINE');
  s += pair(8, layerOf(e));
  s += pair(10, fmt(e.start[0]));
  s += pair(20, fmt(e.start[1]));
  s += pair(30, fmt(e.start[2]));
  s += pair(11, fmt(e.end[0]));
  s += pair(21, fmt(e.end[1]));
  s += pair(31, fmt(e.end[2]));
  return s;
}

function writeText(e: TextEntity): string {
  let s = '';
  s += pair(0, 'TEXT');
  s += pair(8, layerOf(e));
  s += pair(10, fmt(e.position[0]));
  s += pair(20, fmt(e.position[1]));
  s += pair(30, fmt(e.position[2]));
  s += pair(40, fmt(e.height));
  s += pair(1, e.content.replace(/[\r\n]+/g, ' '));
  s += pair(50, fmt((e.rotation * 180) / Math.PI));
  s += pair(72, Math.round(e.hAlign) || 0);
  s += pair(11, fmt(e.position[0]));
  s += pair(21, fmt(e.position[1]));
  s += pair(31, fmt(e.position[2]));
  s += pair(73, Math.round(e.vAlign) || 0);
  return s;
}

function writeCircle(e: CircleEntity): string {
  let s = '';
  s += pair(0, 'CIRCLE');
  s += pair(8, layerOf(e));
  s += pair(10, fmt(e.center[0]));
  s += pair(20, fmt(e.center[1]));
  s += pair(30, fmt(e.center[2]));
  s += pair(40, fmt(e.radius));
  return s;
}

function writeArc(e: ArcEntity): string {
  // GrokCAD stocke start→end avec balayage CCW (end peut être > start + 2π)
  let a0 = e.startAngle;
  let a1 = e.endAngle;
  while (a1 < a0) a1 += Math.PI * 2;
  // Si balayage > 2π, normaliser (cercle quasi-complet)
  const span = a1 - a0;
  if (span >= Math.PI * 2 - 1e-9) {
    // Export comme CIRCLE plutôt qu’arc complet
    return writeCircle({
      id: e.id,
      kind: 'circle',
      layer: e.layer,
      center: e.center,
      radius: e.radius,
      normal: e.normal,
      color: e.color,
      lineWidth: e.lineWidth,
      lineStyle: e.lineStyle,
    });
  }
  const deg0 = ((a0 * 180) / Math.PI) % 360;
  const deg1 = ((a1 * 180) / Math.PI) % 360;
  const d0 = deg0 < 0 ? deg0 + 360 : deg0;
  const d1 = deg1 < 0 ? deg1 + 360 : deg1;

  let s = '';
  s += pair(0, 'ARC');
  s += pair(8, layerOf(e));
  s += pair(10, fmt(e.center[0]));
  s += pair(20, fmt(e.center[1]));
  s += pair(30, fmt(e.center[2]));
  s += pair(40, fmt(e.radius));
  s += pair(50, fmt(d0));
  s += pair(51, fmt(d1));
  return s;
}

function writeWall(e: WallEntity): { text: string; count: number } {
  const strokes = wallEntityStrokes(e, 64);
  let text = '';
  let count = 0;
  for (const st of strokes) {
    for (let i = 0; i < st.points.length - 1; i++) {
      const a = st.points[i]!;
      const b = st.points[i + 1]!;
      if (dist2(a, b) < EPS) continue;
      text += writeLine({
        id: e.id,
        kind: 'line',
        layer: e.layer || 'MURS',
        start: a,
        end: b,
        color: st.color,
        lineWidth: st.lineWidth,
        lineStyle: st.lineStyle,
      });
      count += 1;
    }
  }
  return { text, count };
}

/** Nom de base sans extension. */
export function stripExt(name: string): string {
  return name.replace(/\.(dxf|gkd)$/i, '');
}

/** Assure l’extension .dxf. */
export function ensureDxfName(name: string): string {
  return name.toLowerCase().endsWith('.dxf') ? name : `${name}.dxf`;
}

/** Assure l’extension .gkd. */
export function ensureGkdName(name: string): string {
  return name.toLowerCase().endsWith('.gkd') ? name : `${name}.gkd`;
}
