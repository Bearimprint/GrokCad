/**
 * Accroche (snap) style ARC+ :
 * 1) croisement / intersection (priorité absolue)
 * 2) extrémité (fin de ligne / d’arc) dans le rayon
 * 3) point le plus proche sur une courbe
 * 4) rien si hors rayon (rayon monde dérivé des pixels écran)
 *
 * Les extrémités sont des candidates à part entière : si la fin d’une ligne
 * est dans le rayon, elle gagne même si le pied de perpendiculaire sur le
 * segment est plus proche du clic. Pour s’accrocher « juste avant » une fin,
 * zoomer pour que le rayon n’englobe plus l’extrémité.
 */

import {
  add,
  closestPointOnInfiniteLine,
  dist,
  dot,
  infiniteLineIntersection,
  normalize,
  scale,
  sub,
  v3,
} from './geometry';
import type {
  ArcEntity,
  CircleEntity,
  Entity,
  HelperLineEntity,
  LineEntity,
  Vec3,
} from './types';
import { objectInstanceStrokes } from './objectInstance';
import { wallEntityStrokes } from './walls';

const EPS = 1e-9;
/** Extrémités quasi confondues → traitées comme intersection. */
const ENDPOINT_MERGE = 0.0005; // m (~0.5 mm)

export type SnapKind = 'intersection' | 'endpoint' | 'nearest';

export interface SnapResult {
  point: Vec3;
  kind: SnapKind;
  /** Distance monde au clic. */
  dist: number;
  /** Ids des entités impliquées. */
  entityIds: string[];
  /** @deprecated alias de entityIds pour compat. */
  helperIds: string[];
}

/** Courbe accrochable normalisée (plan XY principalement). */
export type SnapCurve =
  | { id: string; type: 'infinite'; origin: Vec3; direction: Vec3 }
  | { id: string; type: 'segment'; a: Vec3; b: Vec3 }
  | {
      id: string;
      type: 'arc';
      center: Vec3;
      radius: number;
      startAngle: number;
      endAngle: number;
    };

export function entitiesToSnapCurves(
  helpers: readonly HelperLineEntity[],
  entities: readonly Entity[],
): SnapCurve[] {
  const out: SnapCurve[] = [];
  for (const h of helpers) {
    out.push({
      id: h.id,
      type: 'infinite',
      origin: h.origin,
      direction: h.direction,
    });
  }
  for (const e of entities) {
    if (e.kind === 'line') {
      out.push({ id: e.id, type: 'segment', a: e.start, b: e.end });
    } else if (e.kind === 'wall') {
      const strokes = wallEntityStrokes(e, 32);
      for (let i = 0; i < strokes.length; i++) {
        const pts = strokes[i]!.points;
        if (pts.length < 2) continue;
        if (e.path === 'line' && pts.length === 2) {
          out.push({ id: `${e.id}#${i}`, type: 'segment', a: pts[0]!, b: pts[1]! });
        } else if (
          e.path === 'arc' &&
          e.center &&
          e.radius != null &&
          e.startAngle != null &&
          e.endAngle != null
        ) {
          const side = e.flip ? -1 : 1;
          const ln = e.lines[i];
          if (!ln) continue;
          const r = e.radius - ln.offset * side;
          if (r > 1e-9) {
            out.push({
              id: `${e.id}#${i}`,
              type: 'arc',
              center: e.center,
              radius: r,
              startAngle: e.startAngle,
              endAngle: e.endAngle,
            });
          }
        } else {
          for (let k = 0; k < pts.length - 1; k++) {
            out.push({
              id: `${e.id}#${i}_${k}`,
              type: 'segment',
              a: pts[k]!,
              b: pts[k + 1]!,
            });
          }
        }
      }
    } else if (e.kind === 'arc') {
      out.push({
        id: e.id,
        type: 'arc',
        center: e.center,
        radius: e.radius,
        startAngle: e.startAngle,
        endAngle: e.endAngle,
      });
    } else if (e.kind === 'circle') {
      out.push({
        id: e.id,
        type: 'arc',
        center: e.center,
        radius: e.radius,
        startAngle: 0,
        endAngle: Math.PI * 2,
      });
    } else if (e.kind === 'helper') {
      out.push({
        id: e.id,
        type: 'infinite',
        origin: e.origin,
        direction: e.direction,
      });
    } else if (e.kind === 'text') {
      // Point d’insertion du texte
      out.push({
        id: e.id,
        type: 'segment',
        a: e.position,
        b: e.position,
      });
    } else if (e.kind === 'dimension') {
      out.push({
        id: e.id,
        type: 'segment',
        a: e.lineAnchor,
        b: e.lineAnchor,
      });
      for (let i = 0; i < e.defPoints.length; i++) {
        const p = e.defPoints[i]!;
        out.push({
          id: `${e.id}#d${i}`,
          type: 'segment',
          a: p,
          b: p,
        });
      }
    } else if (e.kind === 'object') {
      // Snap sur la géométrie résolue de l'instance (un seul id d'entité)
      const strokes = objectInstanceStrokes(e);
      for (let i = 0; i < strokes.length; i++) {
        const pts = strokes[i]!.points;
        if (pts.length < 2) continue;
        if (pts.length === 2) {
          out.push({
            id: `${e.id}#${i}`,
            type: 'segment',
            a: pts[0]!,
            b: pts[1]!,
          });
        } else {
          for (let k = 0; k < pts.length - 1; k++) {
            out.push({
              id: `${e.id}#${i}_${k}`,
              type: 'segment',
              a: pts[k]!,
              b: pts[k + 1]!,
            });
          }
        }
      }
    } else if (e.kind === 'polyline') {
      for (let i = 0; i < e.segments.length; i++) {
        const seg = e.segments[i]!;
        if (seg.type === 'line') {
          out.push({
            id: `${e.id}#${i}`,
            type: 'segment',
            a: seg.start,
            b: seg.end,
          });
        } else {
          out.push({
            id: `${e.id}#${i}`,
            type: 'arc',
            center: seg.center,
            radius: seg.radius,
            startAngle: seg.startAngle,
            endAngle: seg.endAngle,
          });
        }
      }
    } else if (e.kind === 'point') {
      // Segment dégénéré → extrémité prioritaire (même point 2×)
      out.push({
        id: e.id,
        type: 'segment',
        a: e.position,
        b: e.position,
      });
    }
  }
  return out;
}

export function lineEntityCurve(e: LineEntity): SnapCurve {
  return { id: e.id, type: 'segment', a: e.start, b: e.end };
}

export function arcEntityCurve(e: ArcEntity): SnapCurve {
  return {
    id: e.id,
    type: 'arc',
    center: e.center,
    radius: e.radius,
    startAngle: e.startAngle,
    endAngle: e.endAngle,
  };
}

export function circleEntityCurve(e: CircleEntity): SnapCurve {
  return {
    id: e.id,
    type: 'arc',
    center: e.center,
    radius: e.radius,
    startAngle: 0,
    endAngle: Math.PI * 2,
  };
}

const KIND_PRIORITY: Record<SnapKind, number> = {
  intersection: 0,
  endpoint: 1,
  nearest: 2,
};

/**
 * Snap complet dans le rayon maxDist (monde).
 * Priorité stricte : intersection → extrémité → nearest (puis distance).
 */
export function snapAt(
  click: Vec3,
  curves: readonly SnapCurve[],
  maxDist: number,
): SnapResult | null {
  if (curves.length === 0 || maxDist <= 0) return null;

  const candidates: SnapResult[] = [];

  // ── 1) Intersections (priorité max) ──────────────────────────────────────
  // Rayon un peu plus large pour les croisement : si on vise un X,
  // le pied de perpendiculaire sur un bras peut être plus proche que le X.
  const ixRadius = maxDist * 2;

  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const ca = curves[i]!;
      const cb = curves[j]!;
      const pts = curveIntersections(ca, cb);
      for (const p of pts) {
        const d = dist(p, click);
        if (d <= ixRadius) {
          candidates.push(makeResult(p, 'intersection', d, [ca.id, cb.id]));
        }
      }
    }
  }

  // ── 2) Extrémités (priorité haute) — candidates indépendantes ────────────
  // Si une fin de ligne/arc est dans le rayon, elle gagne sur le « nearest »
  // même quand le pied de perpendiculaire est plus proche du clic.
  for (const c of curves) {
    for (const ep of curveEndpoints(c)) {
      const d = dist(ep, click);
      if (d <= maxDist) {
        candidates.push(makeResult(ep, 'endpoint', d, [c.id]));
      }
    }
  }

  // ── 3) Point le plus proche sur chaque courbe ───────────────────────────
  for (const c of curves) {
    const near = closestOnCurve(c, click);
    if (!near) continue;
    if (near.dist > maxDist) continue;
    // Déjà couvert comme extrémité → ne pas doubler en nearest
    if (near.kind === 'endpoint') continue;
    // Pied quasi confondu avec une extrémité déjà candidate
    const onEndpoint = curveEndpoints(c).some(
      (ep) => dist(near.point, ep) <= ENDPOINT_MERGE,
    );
    if (onEndpoint) continue;
    candidates.push(makeResult(near.point, 'nearest', near.dist, [c.id]));
  }

  if (candidates.length === 0) return null;

  // Parmi les intersections dans le rayon élargi, ne garder que celles
  // pertinentes par rapport au rayon normal / aux autres candidates.
  const endpointOrNearBest = candidates
    .filter((c) => c.kind === 'nearest' || c.kind === 'endpoint')
    .sort((a, b) => a.dist - b.dist)[0];

  const filtered = candidates.filter((c) => {
    if (c.kind !== 'intersection') return c.dist <= maxDist;
    // Intersection dans le rayon normal → toujours OK
    if (c.dist <= maxDist) return true;
    // Intersection un peu hors rayon : OK si plus proche (ou quasi) qu’une extrémité/nearest
    if (endpointOrNearBest && c.dist <= endpointOrNearBest.dist * 1.01 + 1e-9) {
      return true;
    }
    // Ou si le clic est clairement « dans la zone » du croisement
    if (c.dist <= maxDist * 1.5) return true;
    return false;
  });

  if (filtered.length === 0) return null;

  // Priorité de *kind* d’abord (intersection > endpoint > nearest),
  // puis distance croissante — une extrémité un peu plus loin qu’un nearest gagne.
  filtered.sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind];
    const pb = KIND_PRIORITY[b.kind];
    if (pa !== pb) return pa - pb;
    return a.dist - b.dist;
  });

  return filtered[0]!;
}

function makeResult(
  point: Vec3,
  kind: SnapKind,
  d: number,
  entityIds: string[],
): SnapResult {
  return {
    point: [point[0], point[1], point[2]],
    kind,
    dist: d,
    entityIds,
    helperIds: entityIds,
  };
}

// —— Closest ——

function closestOnCurve(
  c: SnapCurve,
  click: Vec3,
): { point: Vec3; dist: number; kind: SnapKind } | null {
  if (c.type === 'infinite') {
    const r = closestPointOnInfiniteLine(c.origin, c.direction, click);
    return { point: r.point, dist: r.dist, kind: 'nearest' };
  }
  if (c.type === 'segment') {
    return closestOnSegment(c.a, c.b, click);
  }
  return closestOnArc(c, click);
}

function closestOnSegment(
  a: Vec3,
  b: Vec3,
  click: Vec3,
): { point: Vec3; dist: number; kind: SnapKind } {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  if (L2 < EPS) {
    return { point: [...a] as Vec3, dist: dist(a, click), kind: 'endpoint' };
  }
  let t = dot(sub(click, a), ab) / L2;
  let kind: SnapKind = 'nearest';
  if (t <= 0) {
    t = 0;
    kind = 'endpoint';
  } else if (t >= 1) {
    t = 1;
    kind = 'endpoint';
  }
  const p = add(a, scale(ab, t));
  // Tolérance extrémité : si très proche d'un bout, marquer endpoint
  const dA = dist(p, a);
  const dB = dist(p, b);
  if (dA <= ENDPOINT_MERGE) kind = 'endpoint';
  if (dB <= ENDPOINT_MERGE) kind = 'endpoint';
  return { point: p, dist: dist(p, click), kind };
}

function closestOnArc(
  c: Extract<SnapCurve, { type: 'arc' }>,
  click: Vec3,
): { point: Vec3; dist: number; kind: SnapKind } | null {
  if (c.radius < EPS) return null;
  const cx = c.center[0];
  const cy = c.center[1];
  const cz = c.center[2];
  const dx = click[0] - cx;
  const dy = click[1] - cy;
  const ang = Math.atan2(dy, dx);

  if (angleOnArc(ang, c.startAngle, c.endAngle)) {
    const p: Vec3 = [
      cx + c.radius * Math.cos(ang),
      cy + c.radius * Math.sin(ang),
      cz,
    ];
    // Extrémités d'arc
    const p0 = arcPoint(c, c.startAngle);
    const p1 = arcPoint(c, c.endAngle);
    if (dist(p, p0) <= ENDPOINT_MERGE || dist(p, p1) <= ENDPOINT_MERGE) {
      const closer = dist(click, p0) <= dist(click, p1) ? p0 : p1;
      return { point: closer, dist: dist(closer, click), kind: 'endpoint' };
    }
    return { point: p, dist: dist(p, click), kind: 'nearest' };
  }

  const p0 = arcPoint(c, c.startAngle);
  const p1 = arcPoint(c, c.endAngle);
  const d0 = dist(p0, click);
  const d1 = dist(p1, click);
  if (d0 <= d1) return { point: p0, dist: d0, kind: 'endpoint' };
  return { point: p1, dist: d1, kind: 'endpoint' };
}

function arcPoint(c: Extract<SnapCurve, { type: 'arc' }>, angle: number): Vec3 {
  return [
    c.center[0] + c.radius * Math.cos(angle),
    c.center[1] + c.radius * Math.sin(angle),
    c.center[2],
  ];
}

/** true si angle est dans le balayage [start, end] (CCW, end ≥ start, éventuellement +2π). */
function angleOnArc(angle: number, start: number, end: number): boolean {
  const TWO = Math.PI * 2;
  // Cercle plein
  if (Math.abs(end - start) >= TWO - 1e-9) return true;

  let a = normalizeAngle(angle);
  let s = normalizeAngle(start);
  let e = end;

  // Amener e dans (s, s+2π]
  while (e < s - 1e-12) e += TWO;
  while (e - s > TWO) e -= TWO;

  // Amener a dans [s, s+2π)
  while (a < s - 1e-12) a += TWO;
  while (a >= s + TWO) a -= TWO;

  return a <= e + 1e-9;
}

function normalizeAngle(a: number): number {
  const TWO = Math.PI * 2;
  let x = a % TWO;
  if (x < 0) x += TWO;
  return x;
}

// —— Intersections ——

function curveIntersections(a: SnapCurve, b: SnapCurve): Vec3[] {
  const pts: Vec3[] = [];

  // Extrémités quasi confondues
  for (const pa of curveEndpoints(a)) {
    for (const pb of curveEndpoints(b)) {
      if (dist(pa, pb) <= ENDPOINT_MERGE) {
        pts.push([
          (pa[0] + pb[0]) / 2,
          (pa[1] + pb[1]) / 2,
          (pa[2] + pb[2]) / 2,
        ]);
      }
    }
  }

  if (a.type === 'infinite' && b.type === 'infinite') {
    const p = infiniteLineIntersection(a.origin, a.direction, b.origin, b.direction);
    if (p) pts.push(p);
  } else if (a.type === 'infinite' && b.type === 'segment') {
    pts.push(...infiniteSegIx(a.origin, a.direction, b.a, b.b));
  } else if (a.type === 'segment' && b.type === 'infinite') {
    pts.push(...infiniteSegIx(b.origin, b.direction, a.a, a.b));
  } else if (a.type === 'segment' && b.type === 'segment') {
    const p = segmentSegmentIx(a.a, a.b, b.a, b.b);
    if (p) pts.push(p);
  } else if (a.type === 'infinite' && b.type === 'arc') {
    pts.push(...infiniteArcIx(a.origin, a.direction, b));
  } else if (a.type === 'arc' && b.type === 'infinite') {
    pts.push(...infiniteArcIx(b.origin, b.direction, a));
  } else if (a.type === 'segment' && b.type === 'arc') {
    pts.push(...segmentArcIx(a.a, a.b, b));
  } else if (a.type === 'arc' && b.type === 'segment') {
    pts.push(...segmentArcIx(b.a, b.b, a));
  } else if (a.type === 'arc' && b.type === 'arc') {
    pts.push(...arcArcIx(a, b));
  }

  return dedupePoints(pts);
}

function curveEndpoints(c: SnapCurve): Vec3[] {
  if (c.type === 'segment') return [c.a, c.b];
  if (c.type === 'arc') {
    // Cercle plein : pas d'extrémités utiles
    if (Math.abs(c.endAngle - c.startAngle) >= Math.PI * 2 - 1e-9) return [];
    return [arcPoint(c, c.startAngle), arcPoint(c, c.endAngle)];
  }
  return [];
}

function dedupePoints(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) {
    if (!out.some((q) => dist(p, q) < 1e-6)) out.push(p);
  }
  return out;
}

/** Droite infinie ∩ segment (plan XY). */
function infiniteSegIx(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3): Vec3[] {
  const d = normalize(direction);
  const dx = d[0];
  const dy = d[1];
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const rhs0 = a[0] - origin[0];
  const rhs1 = a[1] - origin[1];
  const DET = -dx * by + bx * dy;
  if (Math.abs(DET) < EPS) return [];
  const u = (dx * rhs1 - dy * rhs0) / DET;
  if (u < -1e-6 || u > 1 + 1e-6) return [];
  const t = (rhs0 * -by - -bx * rhs1) / DET;
  const p = add(origin, scale(d, t));
  const z = a[2] + (b[2] - a[2]) * clamp01(u);
  return [[p[0], p[1], z]];
}

/**
 * Intersection de deux segments finis (plan XY).
 * Formule standard paramétrique robuste + secours si le croisement
 * est numériquement juste hors [0,1] mais quasi sur les deux segments.
 */
function segmentSegmentIx(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): Vec3 | null {
  const ax = a0[0];
  const ay = a0[1];
  const adx = a1[0] - a0[0];
  const ady = a1[1] - a0[1];
  const bx = b0[0];
  const by = b0[1];
  const bdx = b1[0] - b0[0];
  const bdy = b1[1] - b0[1];

  const det = adx * bdy - ady * bdx;
  if (Math.abs(det) < EPS) {
    return null; // parallèles / colinéaires
  }

  const t = ((bx - ax) * bdy - (by - ay) * bdx) / det;
  const u = ((bx - ax) * ady - (by - ay) * adx) / det;

  // Tolérance pour croisement « pile au bout »
  const tol = 1e-5;
  if (t >= -tol && t <= 1 + tol && u >= -tol && u <= 1 + tol) {
    const tt = clamp01(t);
    const z = a0[2] + (a1[2] - a0[2]) * tt;
    return [ax + adx * tt, ay + ady * tt, z];
  }

  // Secours : intersection des droites supports si le point est quasi sur les 2 segments
  const pInf = infiniteLineIntersection(a0, sub(a1, a0), b0, sub(b1, b0));
  if (!pInf) return null;
  const da = distPointToSegment(pInf, a0, a1);
  const db = distPointToSegment(pInf, b0, b1);
  if (da <= ENDPOINT_MERGE && db <= ENDPOINT_MERGE) {
    return [pInf[0], pInf[1], a0[2]];
  }
  return null;
}

/** Distance 2D d'un point à un segment. */
function distPointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  if (L2 < EPS) return dist(p, a);
  let t = dot(sub(p, a), ab) / L2;
  t = clamp01(t);
  const q = add(a, scale(ab, t));
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

function infiniteArcIx(
  origin: Vec3,
  direction: Vec3,
  arc: Extract<SnapCurve, { type: 'arc' }>,
): Vec3[] {
  const d = normalize(direction);
  const ox = origin[0] - arc.center[0];
  const oy = origin[1] - arc.center[1];
  const dx = d[0];
  const dy = d[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (ox * dx + oy * dy);
  const C = ox * ox + oy * oy - arc.radius * arc.radius;
  if (A < EPS) return [];
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  const out: Vec3[] = [];
  for (const t of ts) {
    const p = add(origin, scale(d, t));
    const ang = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
    if (angleOnArc(ang, arc.startAngle, arc.endAngle)) {
      out.push([p[0], p[1], arc.center[2]]);
    }
  }
  return out;
}

function segmentArcIx(
  a: Vec3,
  b: Vec3,
  arc: Extract<SnapCurve, { type: 'arc' }>,
): Vec3[] {
  const ab = sub(b, a);
  const ox = a[0] - arc.center[0];
  const oy = a[1] - arc.center[1];
  const dx = ab[0];
  const dy = ab[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (ox * dx + oy * dy);
  const C = ox * ox + oy * oy - arc.radius * arc.radius;
  if (A < EPS) return [];
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  const out: Vec3[] = [];
  for (const t of ts) {
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const p = add(a, scale(ab, t));
    const ang = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
    if (angleOnArc(ang, arc.startAngle, arc.endAngle)) {
      out.push([p[0], p[1], arc.center[2]]);
    }
  }
  return out;
}

function arcArcIx(
  a: Extract<SnapCurve, { type: 'arc' }>,
  b: Extract<SnapCurve, { type: 'arc' }>,
): Vec3[] {
  const c0 = a.center;
  const c1 = b.center;
  const r0 = a.radius;
  const r1 = b.radius;
  const d = dist(v3(c0[0], c0[1], 0), v3(c1[0], c1[1], 0));
  if (d < EPS) return [];
  if (d > r0 + r1 + 1e-6 || d < Math.abs(r0 - r1) - 1e-6) return [];

  const nx = (c1[0] - c0[0]) / d;
  const ny = (c1[1] - c0[1]) / d;
  const aa = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - aa * aa;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const mx = c0[0] + aa * nx;
  const my = c0[1] + aa * ny;
  const px = -ny * h;
  const py = nx * h;

  const candidates: Vec3[] = [
    [mx + px, my + py, c0[2]],
    [mx - px, my - py, c0[2]],
  ];
  if (h < EPS) candidates.length = 1;

  return candidates.filter((p) => {
    const angA = Math.atan2(p[1] - a.center[1], p[0] - a.center[0]);
    const angB = Math.atan2(p[1] - b.center[1], p[0] - b.center[0]);
    return (
      angleOnArc(angA, a.startAngle, a.endAngle) &&
      angleOnArc(angB, b.startAngle, b.endAngle)
    );
  });
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Compat : anciennes aides seules. */
export function snapToHelpers(
  click: Vec3,
  helpers: readonly HelperLineEntity[],
  maxDist: number,
): SnapResult | null {
  return snapAt(click, entitiesToSnapCurves(helpers, []), maxDist);
}
