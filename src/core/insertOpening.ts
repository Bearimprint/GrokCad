/**
 * Ouverture d’une insertion dans un mur.
 *
 * - Longueur : de l’ancre jusqu’au point le plus loin en X (suit la souris ou `dx 1.2`).
 * - Largeur : les parties étirables en Y (ou tout le symbole s’il n’a aucun
 *   calque étirable) sont calées sur l’épaisseur du mur (min → max des offsets).
 * - Trou : les traits du mur dont l’offset tombe dans l’empreinte sont coupés
 *   sur l’intervalle d’abscisse occupé par le symbole.
 */

import {
  ANCHOR_LAYER,
  entityDrawLayer,
  findAnchorPoint,
  isInsertionsTab,
  stretchAxesOf,
} from './drawLayers';
import { dist, sub } from './geometry';
import { hitAtAlong, frameFromHit, type InsertHostEntity, type InsertHostHit } from './insertHost';
import {
  sampleInsertLocals,
  type InsertFrame,
} from './insertTransform';
import { objectDefCache } from './objectCache';
import type {
  Entity,
  InsertPlacement,
  Vec3,
  WallEntity,
  WallSegment,
} from './types';
import type { WallStroke } from './walls';

const EPS = 1e-9;
/** 0,1 mm : une face pile sur le bord de l’ouverture est effacée. */
const OFF_EPS = 1e-4;

export interface OpeningMeasure {
  /** Aucun calque étirable : le symbole entier est l’ouverture. */
  fallbackXY: boolean;
  stretchAnyX: boolean;
  stretchAnyY: boolean;
  /** Bbox X (repère ancre, avant échelle) des parties qui prennent la longueur. */
  x0: number;
  x1: number;
  /** Bbox Y des parties qui prennent l’épaisseur. */
  y0: number;
  y1: number;
  spanX: number;
  spanY: number;
  /**
   * Distance ancre → extrémité X la plus loin.
   * `échelle X = longueur / reachX` : le bord suit la souris.
   */
  reachX: number;
}

export interface OpeningInterval {
  hostId: string;
  along0: number;
  along1: number;
  /** Offsets de style (même espace que `WallLineDef.offset`). */
  off0: number;
  off1: number;
}

export function formatInsertLength(length: number): string {
  const v = Math.round(Math.abs(length) * 1000) / 1000;
  return `dx ${v}`;
}

function consider(e: Entity): boolean {
  if (e.kind === 'helper' || e.kind === 'object') return false;
  if (entityDrawLayer(e) === ANCHOR_LAYER) return false;
  return true;
}

function definitionPoints(e: Entity): Vec3[] {
  if (e.kind === 'line') return [e.start, e.end];
  if (e.kind === 'point') return [e.position];
  if (e.kind === 'text') return [e.position];
  if (e.kind === 'arc' || e.kind === 'circle') return [e.center];
  if (e.kind === 'polyline') {
    const pts: Vec3[] = [];
    for (const s of e.segments) {
      if (s.type === 'line') pts.push(s.start, s.end);
      else pts.push(s.center);
    }
    return pts;
  }
  if (e.kind === 'wall') return [e.start, e.end];
  if (e.kind === 'dimension') return [e.lineAnchor, ...e.defPoints];
  return [];
}

function bboxOf(pts: readonly Vec3[]): { x0: number; x1: number; y0: number; y1: number } | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  return { x0, x1, y0, y1 };
}

/** Mesure la définition (repère de l’ancre −9, avant pose). */
export function measureOpening(entities: readonly Entity[]): OpeningMeasure {
  const anchor = findAnchorPoint(entities) ?? ([0, 0, 0] as Vec3);
  let anyStretch = false;
  let stretchAnyX = false;
  let stretchAnyY = false;
  const xPts: Vec3[] = [];
  const yPts: Vec3[] = [];
  const allPts: Vec3[] = [];
  for (const e of entities) {
    if (!consider(e)) continue;
    const axes = stretchAxesOf(entityDrawLayer(e));
    const rel = definitionPoints(e).map((p) => sub(p, anchor));
    if (axes.swing) {
      // Le battant suit la largeur : il ne définit ni l’épaisseur ni le trou.
      anyStretch = true;
      continue;
    }
    if (axes.x || axes.y || axes.z) anyStretch = true;
    if (axes.x) {
      stretchAnyX = true;
      xPts.push(...rel);
    }
    if (axes.y) {
      stretchAnyY = true;
      yPts.push(...rel);
    }
    allPts.push(...rel);
  }
  const fallbackXY = !anyStretch && allPts.length > 0;
  const xb = bboxOf(fallbackXY ? allPts : xPts);
  const yb = bboxOf(fallbackXY ? allPts : yPts);
  const x0 = xb?.x0 ?? 0;
  const x1 = xb?.x1 ?? 1;
  const y0 = yb?.y0 ?? 0;
  const y1 = yb?.y1 ?? 1;
  const spanX = Math.max(0, x1 - x0);
  const spanY = Math.max(0, y1 - y0);
  const reachRaw = Math.max(Math.abs(x0), Math.abs(x1));
  return {
    fallbackXY,
    stretchAnyX: stretchAnyX || fallbackXY,
    stretchAnyY: stretchAnyY || fallbackXY,
    x0,
    x1,
    y0,
    y1,
    spanX: spanX > EPS ? spanX : 1,
    spanY: spanY > EPS ? spanY : 1,
    reachX: reachRaw > EPS ? reachRaw : 1,
  };
}

function offsetRange(wall: WallEntity): { min: number; max: number } | null {
  if (wall.lines.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const ln of wall.lines) {
    min = Math.min(min, ln.offset);
    max = Math.max(max, ln.offset);
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

/**
 * Recale Y sur l’épaisseur du mur. `scaleX` est déjà le multiplicateur de longueur.
 * Ne change pas les axes (ALT / CTRL / sens souris déjà appliqués).
 */
export function fitInsertFrame(
  frame: InsertFrame,
  defEntities: readonly Entity[],
  host: InsertHostEntity | null,
): InsertFrame {
  const spec = measureOpening(defEntities);
  const forceXY = spec.fallbackXY;
  const wall = host && host.kind === 'wall' ? host : null;
  if (!wall || !spec.stretchAnyY) {
    return { ...frame, forceXY, biasY: 0 };
  }
  const range = offsetRange(wall);
  if (!range) return { ...frame, forceXY, biasY: 0 };
  const width = range.max - range.min;
  if (width < 1e-6 || spec.spanY < 1e-6) {
    return { ...frame, forceXY, biasY: 0 };
  }
  const scaleY = width / spec.spanY;
  // [y0, y1] → [min offset, max offset]
  const biasY = range.min - spec.y0 * scaleY;
  return { ...frame, scaleY, biasY, forceXY };
}

/** Cadre monde à partir d’une pose déjà enregistrée (échelle X = multiplicateur). */
export function frameFromPlacement(
  host: InsertHostEntity,
  placement: InsertPlacement,
  defEntities: readonly Entity[],
  hit?: InsertHostHit | null,
): InsertFrame | null {
  const h = hit ?? hitAtAlong(host, placement.along);
  if (!h) return null;
  const fr = frameFromHit(h, placement.flipAlt, placement.flipCtrl);
  let axisX = fr.axisX;
  if (placement.xSign === -1) axisX = [-axisX[0], -axisX[1], -axisX[2]];
  return fitInsertFrame(
    {
      origin: fr.origin,
      axisX,
      axisY: fr.axisY,
      scaleX: placement.scaleX,
      scaleY: placement.scaleY,
      scaleZ: placement.scaleZ,
    },
    defEntities,
    host,
  );
}

/**
 * Cadre pour l’outil : `length` est la distance ancre → bord (m),
 * pas le multiplicateur brut.
 */
export function composeInsertFrame(
  hit: InsertHostHit,
  defEntities: readonly Entity[],
  opts: {
    flipAlt: boolean;
    flipCtrl: boolean;
    length: number;
    xSign: 1 | -1;
  },
): InsertFrame {
  const spec = measureOpening(defEntities);
  const length = Math.max(0.001, Math.abs(opts.length));
  const scaleX = length / spec.reachX;
  const built = frameFromPlacement(
    hit.entity,
    {
      hostId: hit.entity.id,
      along: hit.along,
      flipAlt: opts.flipAlt,
      flipCtrl: opts.flipCtrl,
      scaleX,
      scaleY: 1,
      scaleZ: 1,
      xSign: opts.xSign,
    },
    defEntities,
    hit,
  );
  if (built) return built;
  return {
    origin: hit.point,
    axisX: opts.xSign === -1 ? [-hit.tangent[0], -hit.tangent[1], 0] : hit.tangent,
    axisY: hit.inward,
    scaleX,
    scaleY: 1,
    scaleZ: 1,
    forceXY: spec.fallbackXY,
  };
}

/** Empreinte du symbole posé, en abscisse hôte et en offset de mur. */
export function openingFromFrame(
  host: InsertHostEntity,
  anchorAlong: number,
  frame: InsertFrame,
  defEntities: readonly Entity[],
): OpeningInterval | null {
  if (host.kind !== 'wall') return null;
  const samples = sampleInsertLocals(defEntities, frame).filter((s) => s.cutter);
  if (samples.length === 0) return null;
  const hit = hitAtAlong(host, Math.max(0, anchorAlong));
  if (!hit) return null;
  const tx = hit.tangent[0] * frame.axisX[0] + hit.tangent[1] * frame.axisX[1];
  const ty = hit.inward[0] * frame.axisY[0] + hit.inward[1] * frame.axisY[1];
  let a0 = Infinity;
  let a1 = -Infinity;
  let o0 = Infinity;
  let o1 = -Infinity;
  for (const s of samples) {
    const along = anchorAlong + s.lx * tx;
    const off = s.ly * ty;
    a0 = Math.min(a0, along);
    a1 = Math.max(a1, along);
    o0 = Math.min(o0, off);
    o1 = Math.max(o1, off);
  }
  if (!(a1 - a0 > 1e-4)) return null;
  return { hostId: host.id, along0: a0, along1: a1, off0: o0, off1: o1 };
}

/** Ouvertures déjà posées (+ aperçu en cours). */
export function collectWallOpenings(
  entities: readonly Entity[],
  extra?: readonly OpeningInterval[],
): OpeningInterval[] {
  const out: OpeningInterval[] = [];
  for (const e of entities) {
    if (e.kind !== 'object' || !e.insert) continue;
    if (!isInsertionsTab(e.libTab)) continue;
    const host = entities.find((x) => x.id === e.insert!.hostId);
    if (!host || host.kind !== 'wall') continue;
    const def = objectDefCache.get(e.libTab, e.libName);
    if (!def) continue;
    const frame = frameFromPlacement(host, e.insert, def.entities);
    if (!frame) continue;
    const op = openingFromFrame(host, e.insert.along, frame, def.entities);
    if (op) out.push(op);
  }
  if (extra) {
    for (const op of extra) out.push(op);
  }
  return out;
}

function segmentAlongUnclamped(a: Vec3, b: Vec3, p: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  if (L2 < EPS) return 0;
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L2;
  return t * Math.sqrt(L2);
}

function wrapDelta(ang: number, start: number, sweep: number): number {
  const TAU = Math.PI * 2;
  let d = ang - start;
  d = ((d % TAU) + TAU) % TAU;
  if (sweep >= 0) {
    if (d > sweep + 0.35 && sweep < TAU - 0.05) d -= TAU;
  } else if (d > 0) {
    d -= TAU;
    if (d < sweep - 0.35) d += TAU;
  }
  return d;
}

function arcAlong(
  center: Vec3,
  radius: number,
  startAngle: number,
  endAngle: number,
  p: Vec3,
): number {
  const ang = Math.atan2(p[1] - center[1], p[0] - center[0]);
  return wrapDelta(ang, startAngle, endAngle - startAngle) * radius;
}

function polyAlong(segments: readonly WallSegment[], p: Vec3): number {
  let acc = 0;
  let bestD = Infinity;
  let bestAlong = 0;
  for (const s of segments) {
    if (s.type === 'line') {
      const L = dist(s.start, s.end);
      const t = L < EPS ? 0 : segmentAlongUnclamped(s.start, s.end, p) / L;
      const tc = Math.max(0, Math.min(1, t));
      const proj: Vec3 = [
        s.start[0] + (s.end[0] - s.start[0]) * tc,
        s.start[1] + (s.end[1] - s.start[1]) * tc,
        s.start[2] + (s.end[2] - s.start[2]) * tc,
      ];
      const d = dist(proj, p);
      if (d < bestD) {
        bestD = d;
        bestAlong = acc + t * L;
      }
      acc += L;
    } else {
      const len = Math.abs(s.endAngle - s.startAngle) * s.radius;
      const along = arcAlong(s.center, s.radius, s.startAngle, s.endAngle, p);
      const ang = s.startAngle + (s.radius > EPS ? along / s.radius : 0);
      const on: Vec3 = [
        s.center[0] + s.radius * Math.cos(ang),
        s.center[1] + s.radius * Math.sin(ang),
        s.center[2],
      ];
      const d = dist(on, p);
      if (d < bestD) {
        bestD = d;
        bestAlong = acc + along;
      }
      acc += len;
    }
  }
  return bestAlong;
}

/** Abscisse curviligne (non bornée) d’un point monde sur le chemin de référence. */
export function hostPointAlong(host: InsertHostEntity, p: Vec3): number {
  if (host.kind === 'line') return segmentAlongUnclamped(host.start, host.end, p);
  if (host.kind === 'arc') {
    return arcAlong(host.center, host.radius, host.startAngle, host.endAngle, p);
  }
  if (
    host.path === 'arc' &&
    host.center &&
    host.radius != null &&
    host.startAngle != null &&
    host.endAngle != null
  ) {
    return arcAlong(host.center, host.radius, host.startAngle, host.endAngle, p);
  }
  if (host.path === 'poly' && host.segments && host.segments.length > 0) {
    return polyAlong(host.segments, p);
  }
  return segmentAlongUnclamped(host.start, host.end, p);
}

function lerp(a: Vec3, b: Vec3, u: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

function subtractRanges(
  keep: [number, number][],
  cut0: number,
  cut1: number,
): [number, number][] {
  const a = Math.min(cut0, cut1);
  const b = Math.max(cut0, cut1);
  const out: [number, number][] = [];
  for (const [s, e] of keep) {
    if (b <= s + 1e-12 || a >= e - 1e-12) {
      out.push([s, e]);
      continue;
    }
    if (a > s + 1e-12) out.push([s, Math.min(a, e)]);
    if (b < e - 1e-12) out.push([Math.max(b, s), e]);
  }
  return out.filter(([s, e]) => e - s > 1e-8);
}

function keptOnEdge(
  a: Vec3,
  b: Vec3,
  alongA: number,
  alongB: number,
  openings: readonly OpeningInterval[],
): [Vec3, Vec3][] {
  const span = alongB - alongA;
  if (Math.abs(span) < 1e-12) return [];
  let keep: [number, number][] = [[0, 1]];
  const lo = Math.min(alongA, alongB);
  const hi = Math.max(alongA, alongB);
  for (const op of openings) {
    const c0 = Math.max(lo, Math.min(op.along0, op.along1));
    const c1 = Math.min(hi, Math.max(op.along0, op.along1));
    if (c1 - c0 <= 1e-9) continue;
    const u0 = (c0 - alongA) / span;
    const u1 = (c1 - alongA) / span;
    keep = subtractRanges(keep, u0, u1);
    if (keep.length === 0) break;
  }
  const segs: [Vec3, Vec3][] = [];
  for (const [u0, u1] of keep) {
    const p0 = lerp(a, b, u0);
    const p1 = lerp(a, b, u1);
    if (dist(p0, p1) > 1e-8) segs.push([p0, p1]);
  }
  return segs;
}

function clipPolyline(
  host: InsertHostEntity,
  points: readonly Vec3[],
  openings: readonly OpeningInterval[],
): Vec3[][] {
  const chains: Vec3[][] = [];
  let cur: Vec3[] = [];
  const flush = () => {
    if (cur.length >= 2) chains.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const kept = keptOnEdge(
      a,
      b,
      hostPointAlong(host, a),
      hostPointAlong(host, b),
      openings,
    );
    if (kept.length === 0) {
      flush();
      continue;
    }
    for (const [p0, p1] of kept) {
      const joins =
        cur.length > 0 && dist(cur[cur.length - 1]!, p0) < 1e-6 && dist(a, p0) < 1e-6;
      if (joins) cur.push(p1);
      else {
        flush();
        cur = [p0, p1];
      }
    }
    const last = kept[kept.length - 1]!;
    if (dist(last[1], b) > 1e-6) flush();
  }
  flush();
  return chains;
}

function overlapsOffset(offset: number, op: OpeningInterval): boolean {
  const lo = Math.min(op.off0, op.off1) - OFF_EPS;
  const hi = Math.max(op.off0, op.off1) + OFF_EPS;
  return offset >= lo && offset <= hi;
}

/** Coupe les traits de mur qui traversent les ouvertures de cet hôte. */
export function clipWallStrokes(
  wall: WallEntity,
  strokes: readonly WallStroke[],
  openings: readonly OpeningInterval[],
): WallStroke[] {
  const mine = openings.filter((o) => o.hostId === wall.id);
  if (mine.length === 0) return strokes.slice();
  const out: WallStroke[] = [];
  for (const s of strokes) {
    const hits = mine.filter((o) => overlapsOffset(s.offset, o));
    if (hits.length === 0) {
      out.push(s);
      continue;
    }
    for (const pts of clipPolyline(wall, s.points, hits)) {
      out.push({ ...s, points: pts });
    }
  }
  return out;
}
