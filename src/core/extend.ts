/**
 * /extend — prolonge une ligne ou un arc jusqu’à un autre objet (ligne / arc / cercle).
 *
 * 1) Clic objet à allonger (extrémité la plus proche du clic)
 * 2) Clic limite (boundary)
 *
 * Polyligne ouverte : uniquement le 1er ou le dernier segment (extrémités).
 * Polyligne fermée (1er ≈ dernier) : refusée.
 */

import {
  arcEndPoint,
  arcStartPoint,
  createArcEntity,
  createLineEntity,
} from './drawing';
import { dist, normalize, sub } from './geometry';
import { polylineEnd, polylineStart } from './polyline';
import type {
  ArcEntity,
  CircleEntity,
  Entity,
  LineEntity,
  PolylineEntity,
  PolylineSegment,
  Vec3,
} from './types';

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;
/** Polyligne fermée si extrémités à moins de 1 mm. */
const POLY_CLOSE_TOL = 0.001;

export type ExtendBoundary = LineEntity | ArcEntity | CircleEntity;

export interface ExtendSourceHit {
  entity: LineEntity | ArcEntity | PolylineEntity;
  /** Extrémité à déplacer / allonger. */
  end: 'start' | 'end';
  point: Vec3;
  dist: number;
}

export interface ExtendResult {
  entity: Entity;
  /** Distance d’allongement approximative (m). */
  lengthened: number;
}

// ─── Picking ────────────────────────────────────────────────────────────────

/** Entité prolongeable la plus proche (ligne, arc, polyligne ouverte). */
export function findNearestExtendable(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): ExtendSourceHit | null {
  if (maxDist <= 0) return null;
  let best: ExtendSourceHit | null = null;

  for (const e of entities) {
    if (e.kind === 'line') {
      const near = closestOnSegment(e.start, e.end, click);
      if (near.dist > maxDist) continue;
      const d0 = dist(click, e.start);
      const d1 = dist(click, e.end);
      const end: 'start' | 'end' = d0 <= d1 ? 'start' : 'end';
      if (!best || near.dist < best.dist) {
        best = { entity: e, end, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'arc') {
      const near = closestOnArc(e, click);
      if (!near || near.dist > maxDist) continue;
      const p0 = arcStartPoint(e);
      const p1 = arcEndPoint(e);
      const end: 'start' | 'end' =
        dist(click, p0) <= dist(click, p1) ? 'start' : 'end';
      if (!best || near.dist < best.dist) {
        best = { entity: e, end, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'polyline') {
      if (isPolylineClosed(e)) continue;
      if (e.segments.length === 0) continue;
      const near = closestOnPolylineEnds(e, click);
      if (!near || near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = {
          entity: e,
          end: near.end,
          point: near.point,
          dist: near.dist,
        };
      }
    }
  }
  return best;
}

/** Limite la plus proche : ligne, arc ou cercle. */
export function findNearestBoundary(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
  excludeId?: string,
): { entity: ExtendBoundary; point: Vec3; dist: number } | null {
  if (maxDist <= 0) return null;
  let best: { entity: ExtendBoundary; point: Vec3; dist: number } | null = null;

  for (const e of entities) {
    if (excludeId && e.id === excludeId) continue;
    if (e.kind === 'line') {
      const near = closestOnSegment(e.start, e.end, click);
      if (near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'arc') {
      const near = closestOnArc(e, click);
      if (!near || near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'circle') {
      const near = closestOnCircle(e, click);
      if (near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    }
  }
  return best;
}

export function isPolylineClosed(poly: PolylineEntity): boolean {
  if (poly.closed === true) return true;
  const s = polylineStart(poly);
  const e = polylineEnd(poly);
  if (!s || !e) return true;
  return dist(s, e) <= POLY_CLOSE_TOL;
}

// ─── Apply ──────────────────────────────────────────────────────────────────

/**
 * Allonge `source` jusqu’à `boundary`.
 * null si parallèle, déjà au contact, ou pas d’intersection dans le sens d’extension.
 */
export function applyExtend(
  source: ExtendSourceHit,
  boundary: ExtendBoundary,
): ExtendResult | null {
  const e = source.entity;
  if (e.kind === 'line') {
    return extendLine(e, source.end, boundary);
  }
  if (e.kind === 'arc') {
    return extendArc(e, source.end, boundary);
  }
  // polyline
  return extendPolyline(e, source.end, boundary);
}

function strokeOf(e: LineEntity | ArcEntity) {
  return {
    id: e.id,
    color: e.color,
    lineWidth: e.lineWidth,
    lineStyle: e.lineStyle,
    layer: e.layer,
  };
}

function extendLine(
  line: LineEntity,
  end: 'start' | 'end',
  boundary: ExtendBoundary,
): ExtendResult | null {
  const fixed = end === 'end' ? line.start : line.end;
  const free = end === 'end' ? line.end : line.start;
  const dir = normalize(sub(free, fixed));
  if (Math.hypot(dir[0], dir[1]) < EPS) return null;
  const L = dist(fixed, free);
  if (L < EPS) return null;

  const hits = rayBoundaryHits(fixed, dir, boundary);
  // t > L : au-delà de l’extrémité libre (allongement uniquement)
  let bestT = Infinity;
  let bestP: Vec3 | null = null;
  for (const h of hits) {
    if (h.t > L + 1e-6 && h.t < bestT) {
      bestT = h.t;
      bestP = h.point;
    }
  }
  if (!bestP) return null;

  const newStart = end === 'end' ? line.start : bestP;
  const newEnd = end === 'end' ? bestP : line.end;
  const next = createLineEntity(newStart, newEnd, strokeOf(line));
  return { entity: next, lengthened: bestT - L };
}

function extendArc(
  arc: ArcEntity,
  end: 'start' | 'end',
  boundary: ExtendBoundary,
): ExtendResult | null {
  if (arc.radius < EPS) return null;
  const span = arc.endAngle - arc.startAngle;
  if (Math.abs(span) < EPS) return null;
  const dir: 1 | -1 = span >= 0 ? 1 : -1; // sens de parcours

  const hits = circleBoundaryHits(arc.center, arc.radius, boundary);
  if (hits.length === 0) return null;

  // Angles candidats sur le cercle de l’arc
  const candidates: number[] = [];
  for (const p of hits) {
    const a = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
    candidates.push(a);
  }

  let bestDelta = Infinity;
  let bestAngle: number | null = null;

  if (end === 'end') {
    // Allonger endAngle dans le sens de parcours
    for (const a of candidates) {
      const ext = angleBeyond(arc.endAngle, a, dir);
      if (ext > 1e-6 && ext < bestDelta) {
        bestDelta = ext;
        bestAngle = arc.endAngle + dir * ext;
      }
    }
    if (bestAngle == null) return null;
    const next = createArcEntity(
      arc.center,
      arc.radius,
      arc.startAngle,
      bestAngle,
      strokeOf(arc),
      { clockwise: dir < 0 },
    );
    // createArcEntity normalise — forcer les angles bruts
    next.startAngle = arc.startAngle;
    next.endAngle = bestAngle;
    return {
      entity: next,
      lengthened: bestDelta * arc.radius,
    };
  }

  // end === 'start' : reculer startAngle à contre-sens du parcours
  // = étendre dans le sens -dir depuis start
  const back: 1 | -1 = dir > 0 ? -1 : 1;
  for (const a of candidates) {
    const ext = angleBeyond(arc.startAngle, a, back);
    if (ext > 1e-6 && ext < bestDelta) {
      bestDelta = ext;
      bestAngle = arc.startAngle + back * ext;
    }
  }
  if (bestAngle == null) return null;
  const next = createArcEntity(
    arc.center,
    arc.radius,
    bestAngle,
    arc.endAngle,
    strokeOf(arc),
    { clockwise: dir < 0 },
  );
  next.startAngle = bestAngle;
  next.endAngle = arc.endAngle;
  return {
    entity: next,
    lengthened: bestDelta * arc.radius,
  };
}

function extendPolyline(
  poly: PolylineEntity,
  end: 'start' | 'end',
  boundary: ExtendBoundary,
): ExtendResult | null {
  if (isPolylineClosed(poly) || poly.segments.length === 0) return null;
  const segs = poly.segments.map(cloneSeg);
  const idx = end === 'start' ? 0 : segs.length - 1;
  const seg = segs[idx]!;

  if (seg.type === 'line') {
    const fake: LineEntity = {
      id: poly.id,
      kind: 'line',
      layer: poly.layer,
      start: seg.start,
      end: seg.end,
      color: seg.color,
      lineWidth: seg.lineWidth,
      lineStyle: seg.lineStyle,
    };
    // Pour le 1er segment, « start » est l’extrémité libre ;
    // pour le dernier, « end » est l’extrémité libre.
    const which: 'start' | 'end' = end === 'start' ? 'start' : 'end';
    const r = extendLine(fake, which, boundary);
    if (!r || r.entity.kind !== 'line') return null;
    const L = r.entity;
    segs[idx] = {
      type: 'line',
      start: L.start,
      end: L.end,
      color: seg.color,
      lineWidth: seg.lineWidth,
      lineStyle: seg.lineStyle,
    };
    return {
      entity: { ...poly, segments: segs, closed: false },
      lengthened: r.lengthened,
    };
  }

  // arc segment
  const fake: ArcEntity = {
    id: poly.id,
    kind: 'arc',
    layer: poly.layer,
    center: seg.center,
    radius: seg.radius,
    startAngle: seg.startAngle,
    endAngle: seg.endAngle,
    normal: seg.normal,
    color: seg.color,
    lineWidth: seg.lineWidth,
    lineStyle: seg.lineStyle,
  };
  const which: 'start' | 'end' = end === 'start' ? 'start' : 'end';
  const r = extendArc(fake, which, boundary);
  if (!r || r.entity.kind !== 'arc') return null;
  const A = r.entity;
  segs[idx] = {
    type: 'arc',
    center: A.center,
    radius: A.radius,
    startAngle: A.startAngle,
    endAngle: A.endAngle,
    normal: [...(A.normal ?? [0, 0, 1])] as Vec3,
    color: seg.color,
    lineWidth: seg.lineWidth,
    lineStyle: seg.lineStyle,
  };
  return {
    entity: { ...poly, segments: segs, closed: false },
    lengthened: r.lengthened,
  };
}

function cloneSeg(s: PolylineSegment): PolylineSegment {
  if (s.type === 'line') {
    return {
      type: 'line',
      start: [...s.start] as Vec3,
      end: [...s.end] as Vec3,
      color: s.color,
      lineWidth: s.lineWidth,
      lineStyle: s.lineStyle,
    };
  }
  return {
    type: 'arc',
    center: [...s.center] as Vec3,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    normal: [...(s.normal ?? [0, 0, 1])] as Vec3,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
  };
}

// ─── Intersections boundary ─────────────────────────────────────────────────

/** Hits ray origin + t·dir (t réel) ∩ boundary. */
function rayBoundaryHits(
  origin: Vec3,
  dir: Vec3,
  boundary: ExtendBoundary,
): { point: Vec3; t: number }[] {
  const d = normalize(dir);
  if (boundary.kind === 'line') {
    const hit = infiniteLineLine(
      origin,
      d,
      boundary.start,
      normalize(sub(boundary.end, boundary.start)),
    );
    if (!hit) return [];
    return [hit];
  }
  // arc ou cercle → cercle plein
  const c = boundary.center;
  const r = boundary.radius;
  return lineCircleHits(origin, d, c, r);
}

function circleBoundaryHits(
  center: Vec3,
  radius: number,
  boundary: ExtendBoundary,
): Vec3[] {
  if (boundary.kind === 'line') {
    return circleLineHits(center, radius, boundary.start, boundary.end);
  }
  // cercle ∩ cercle
  return circleCircleHits(center, radius, boundary.center, boundary.radius);
}

function infiniteLineLine(
  o1: Vec3,
  d1: Vec3,
  o2: Vec3,
  d2: Vec3,
): { point: Vec3; t: number } | null {
  const dx = d1[0];
  const dy = d1[1];
  const ex = d2[0];
  const ey = d2[1];
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < EPS) return null;
  const ox = o2[0] - o1[0];
  const oy = o2[1] - o1[1];
  const t = (ox * ey - oy * ex) / det;
  const p: Vec3 = [o1[0] + t * dx, o1[1] + t * dy, o1[2]];
  return { point: p, t };
}

function lineCircleHits(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
): { point: Vec3; t: number }[] {
  const d = normalize(dir);
  const ox = origin[0] - center[0];
  const oy = origin[1] - center[1];
  const dx = d[0];
  const dy = d[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (ox * dx + oy * dy);
  const C = ox * ox + oy * oy - radius * radius;
  if (A < EPS) return [];
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const out: { point: Vec3; t: number }[] = [];
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
    out.push({
      point: [origin[0] + t * dx, origin[1] + t * dy, origin[2]],
      t,
    });
  }
  return out;
}

function circleLineHits(
  center: Vec3,
  radius: number,
  a: Vec3,
  b: Vec3,
): Vec3[] {
  const dir = normalize(sub(b, a));
  if (Math.hypot(dir[0], dir[1]) < EPS) return [];
  return lineCircleHits(a, dir, center, radius).map((h) => h.point);
}

function circleCircleHits(
  c0: Vec3,
  r0: number,
  c1: Vec3,
  r1: number,
): Vec3[] {
  const dx = c1[0] - c0[0];
  const dy = c1[1] - c0[1];
  const d = Math.hypot(dx, dy);
  if (d < EPS) return []; // concentriques
  if (d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = c0[0] + (a * dx) / d;
  const my = c0[1] + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  const z = c0[2];
  if (h < EPS) return [[mx, my, z]];
  return [
    [mx + rx, my + ry, z],
    [mx - rx, my - ry, z],
  ];
}

/**
 * Distance angulaire minimale pour aller de `from` à `to` dans le sens `dir`
 * (+1 = CCW, −1 = CW). Résultat dans (0, 2π].
 */
function angleBeyond(from: number, to: number, dir: 1 | -1): number {
  let d = to - from;
  if (dir > 0) {
    while (d <= 0) d += TWO_PI;
    while (d > TWO_PI) d -= TWO_PI;
  } else {
    while (d >= 0) d -= TWO_PI;
    while (d < -TWO_PI) d += TWO_PI;
    d = -d; // positif
  }
  // Si quasi 0 ou 2π → même point
  if (d < 1e-9 || Math.abs(d - TWO_PI) < 1e-9) return 0;
  return d;
}

// ─── Closest helpers ────────────────────────────────────────────────────────

function closestOnSegment(
  a: Vec3,
  b: Vec3,
  click: Vec3,
): { point: Vec3; dist: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  if (L2 < EPS) {
    return { point: [a[0], a[1], a[2]], dist: dist(a, click) };
  }
  let t =
    ((click[0] - a[0]) * abx +
      (click[1] - a[1]) * aby +
      (click[2] - a[2]) * abz) /
    L2;
  t = Math.max(0, Math.min(1, t));
  const p: Vec3 = [a[0] + t * abx, a[1] + t * aby, a[2] + t * abz];
  return { point: p, dist: dist(p, click) };
}

function closestOnArc(
  arc: ArcEntity,
  click: Vec3,
): { point: Vec3; dist: number } | null {
  if (arc.radius < EPS) return null;
  const cx = arc.center[0];
  const cy = arc.center[1];
  const cz = arc.center[2];
  let ang = Math.atan2(click[1] - cy, click[0] - cx);
  const a0 = arc.startAngle;
  const a1 = arc.endAngle;
  const span = a1 - a0;

  if (span >= 0) {
    while (ang < a0) ang += TWO_PI;
    while (ang >= a0 + TWO_PI) ang -= TWO_PI;
    if (ang <= a1 + 1e-9) {
      const p: Vec3 = [
        cx + arc.radius * Math.cos(ang),
        cy + arc.radius * Math.sin(ang),
        cz,
      ];
      return { point: p, dist: dist(p, click) };
    }
  } else {
    while (ang > a0) ang -= TWO_PI;
    while (ang <= a0 - TWO_PI) ang += TWO_PI;
    if (ang >= a1 - 1e-9) {
      const p: Vec3 = [
        cx + arc.radius * Math.cos(ang),
        cy + arc.radius * Math.sin(ang),
        cz,
      ];
      return { point: p, dist: dist(p, click) };
    }
  }

  const p0 = arcStartPoint(arc);
  const p1 = arcEndPoint(arc);
  const d0 = dist(p0, click);
  const d1 = dist(p1, click);
  return d0 <= d1 ? { point: p0, dist: d0 } : { point: p1, dist: d1 };
}

function closestOnCircle(
  circle: CircleEntity,
  click: Vec3,
): { point: Vec3; dist: number } {
  const cx = circle.center[0];
  const cy = circle.center[1];
  const cz = circle.center[2];
  const dx = click[0] - cx;
  const dy = click[1] - cy;
  const L = Math.hypot(dx, dy);
  if (L < EPS) {
    const p: Vec3 = [cx + circle.radius, cy, cz];
    return { point: p, dist: circle.radius };
  }
  const s = circle.radius / L;
  const p: Vec3 = [cx + dx * s, cy + dy * s, cz];
  return { point: p, dist: dist(p, click) };
}

/** Distance au début ou à la fin d’une polyligne ouverte uniquement. */
function closestOnPolylineEnds(
  poly: PolylineEntity,
  click: Vec3,
): { end: 'start' | 'end'; point: Vec3; dist: number } | null {
  const s = polylineStart(poly);
  const e = polylineEnd(poly);
  if (!s || !e) return null;
  // Aussi sur le 1er / dernier segment (pas seulement le point extrémité)
  const first = poly.segments[0]!;
  const last = poly.segments[poly.segments.length - 1]!;
  let dStart = dist(click, s);
  let dEnd = dist(click, e);
  if (first.type === 'line') {
    dStart = Math.min(dStart, closestOnSegment(first.start, first.end, click).dist);
  } else {
    const a: ArcEntity = {
      id: '',
      kind: 'arc',
      layer: '',
      center: first.center,
      radius: first.radius,
      startAngle: first.startAngle,
      endAngle: first.endAngle,
      normal: first.normal,
      color: first.color,
      lineWidth: first.lineWidth,
      lineStyle: first.lineStyle,
    };
    const n = closestOnArc(a, click);
    if (n) dStart = Math.min(dStart, n.dist);
  }
  if (last.type === 'line') {
    dEnd = Math.min(dEnd, closestOnSegment(last.start, last.end, click).dist);
  } else {
    const a: ArcEntity = {
      id: '',
      kind: 'arc',
      layer: '',
      center: last.center,
      radius: last.radius,
      startAngle: last.startAngle,
      endAngle: last.endAngle,
      normal: last.normal,
      color: last.color,
      lineWidth: last.lineWidth,
      lineStyle: last.lineStyle,
    };
    const n = closestOnArc(a, click);
    if (n) dEnd = Math.min(dEnd, n.dist);
  }
  if (dStart <= dEnd) {
    return { end: 'start', point: s, dist: dStart };
  }
  return { end: 'end', point: e, dist: dEnd };
}
