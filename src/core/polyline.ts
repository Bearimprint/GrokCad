/**
 * Polyligne : création, extrémités, tangentes, échantillonnage, explosion.
 */

import {
  arcEndPoint,
  arcEndTangent,
  arcStartPoint,
  createLineEntity,
  sampleArc,
  type StrokeOpts,
} from './drawing';
import { dist, normalize, sub } from './geometry';
import type {
  ArcEntity,
  Entity,
  PolylineArcSeg,
  PolylineEntity,
  PolylineLineSeg,
  PolylineSegment,
  Vec3,
} from './types';

const DRAW_LAYER = 'DESSIN';
const EPS = 1e-9;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export function createEmptyPolyline(opts?: { id?: string; layer?: string }): PolylineEntity {
  return {
    id: opts?.id ?? nextId('pline'),
    kind: 'polyline',
    layer: opts?.layer ?? DRAW_LAYER,
    segments: [],
  };
}

export function lineSegFromPoints(
  start: Vec3,
  end: Vec3,
  stroke: StrokeOpts,
): PolylineLineSeg {
  return {
    type: 'line',
    start: [start[0], start[1], start[2]],
    end: [end[0], end[1], end[2]],
    color: stroke.color,
    lineWidth: stroke.lineWidth,
    lineStyle: stroke.lineStyle,
  };
}

/**
 * Polyligne d’un seul tenant à partir d’une suite de sommets
 * (ex. résultat de parseLinePath pour /pline avec arguments).
 */
export function createPolylineFromPoints(
  points: readonly Vec3[],
  stroke: StrokeOpts,
  opts?: { closed?: boolean },
): PolylineEntity | null {
  if (points.length < 2) return null;
  let poly = createEmptyPolyline();
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (dist(a, b) < EPS) continue;
    poly = appendSegment(poly, lineSegFromPoints(a, b, stroke));
    n += 1;
  }
  if (n === 0) return null;
  if (opts?.closed) poly = { ...poly, closed: true };
  return poly;
}

/**
 * Rectangle (polyligne fermée) depuis 2 coins opposés.
 * Si `square` : côté = min(|dx|,|dy|), signes conservés (ex. 10×3 → 3×3).
 */
export function createRectPolyline(
  p0: Vec3,
  p1: Vec3,
  stroke: StrokeOpts,
  square = false,
): PolylineEntity | null {
  let x0 = p0[0];
  let y0 = p0[1];
  let x1 = p1[0];
  let y1 = p1[1];
  const z = p0[2];
  if (square) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    if (side < EPS) return null;
    const sx = dx === 0 ? 1 : Math.sign(dx);
    const sy = dy === 0 ? 1 : Math.sign(dy);
    x1 = x0 + sx * side;
    y1 = y0 + sy * side;
  }
  if (Math.abs(x1 - x0) < EPS && Math.abs(y1 - y0) < EPS) return null;
  const corners: Vec3[] = [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
    [x0, y0, z],
  ];
  return createPolylineFromPoints(corners, stroke, { closed: true });
}

/** Construit un segment d’arc à partir d’une ArcEntity (géométrie + style). */
export function arcSegFromArc(arc: ArcEntity): PolylineArcSeg {
  return {
    type: 'arc',
    center: [arc.center[0], arc.center[1], arc.center[2]],
    radius: arc.radius,
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
    normal: [...(arc.normal ?? [0, 0, 1])] as Vec3,
    color: arc.color,
    lineWidth: arc.lineWidth,
    lineStyle: arc.lineStyle,
  };
}

export function appendSegment(
  poly: PolylineEntity,
  seg: PolylineSegment,
): PolylineEntity {
  return {
    ...poly,
    segments: [...poly.segments, seg],
  };
}

/** Point de départ de la polyligne (début du 1er segment). */
export function polylineStart(poly: PolylineEntity): Vec3 | null {
  const s = poly.segments[0];
  if (!s) return null;
  if (s.type === 'line') return [...s.start] as Vec3;
  return arcStartPoint({
    id: '',
    kind: 'arc',
    layer: '',
    center: s.center,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    normal: s.normal,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
  });
}

/** Point final de la polyligne (fin du dernier segment). */
export function polylineEnd(poly: PolylineEntity): Vec3 | null {
  const s = poly.segments[poly.segments.length - 1];
  if (!s) return null;
  if (s.type === 'line') return [...s.end] as Vec3;
  return arcEndPoint({
    id: '',
    kind: 'arc',
    layer: '',
    center: s.center,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    normal: s.normal,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
  });
}

/** Tangente unitaire au bout du dernier segment (pour /parct G1). */
export function polylineEndTangent(poly: PolylineEntity): Vec3 | null {
  const s = poly.segments[poly.segments.length - 1];
  if (!s) return null;
  if (s.type === 'line') {
    const t = normalize(sub(s.end, s.start));
    if (Math.hypot(t[0], t[1], t[2]) < EPS) return null;
    return t;
  }
  return arcEndTangent({
    id: '',
    kind: 'arc',
    layer: '',
    center: s.center,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    normal: s.normal,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
  });
}

export interface PolylineStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: PolylineSegment['lineStyle'];
}

/** Un trait par segment (style propre) — pour rendu / sélection / snap. */
export function polylineStrokes(
  poly: PolylineEntity,
  arcSamples = 48,
): PolylineStroke[] {
  const out: PolylineStroke[] = [];
  for (const s of poly.segments) {
    if (s.type === 'line') {
      out.push({
        points: [
          [s.start[0], s.start[1], s.start[2]],
          [s.end[0], s.end[1], s.end[2]],
        ],
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    } else {
      const arc: ArcEntity = {
        id: '',
        kind: 'arc',
        layer: '',
        center: s.center,
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: s.normal,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      };
      out.push({
        points: sampleArc(arc, arcSamples),
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    }
  }
  return out;
}

/** Explose en lignes / arcs indépendants (même géométrie et style). */
export function explodePolyline(poly: PolylineEntity): Entity[] {
  const parts: Entity[] = [];
  for (const s of poly.segments) {
    if (s.type === 'line') {
      parts.push(
        createLineEntity(s.start, s.end, {
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
          layer: poly.layer,
        }),
      );
    } else {
      // Copie directe des angles (préserve CW / CCW stockés)
      const arc: ArcEntity = {
        id: nextId('arc'),
        kind: 'arc',
        layer: poly.layer,
        center: [s.center[0], s.center[1], s.center[2]],
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: [...s.normal] as Vec3,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      };
      parts.push(arc);
    }
  }
  return parts;
}

/** Translate tous les points d’une polyligne. */
export function translatePolyline(
  poly: PolylineEntity,
  dx: number,
  dy: number,
  dz = 0,
): PolylineEntity {
  const move = (p: Vec3): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  return {
    ...poly,
    segments: poly.segments.map((s): PolylineSegment => {
      if (s.type === 'line') {
        return {
          ...s,
          start: move(s.start),
          end: move(s.end),
        };
      }
      return {
        ...s,
        center: move(s.center),
      };
    }),
  };
}

export function clonePolyline(poly: PolylineEntity, newId?: string): PolylineEntity {
  return {
    ...poly,
    id: newId ?? nextId('pline'),
    segments: poly.segments.map((s): PolylineSegment => {
      if (s.type === 'line') {
        return {
          ...s,
          start: [...s.start] as Vec3,
          end: [...s.end] as Vec3,
        };
      }
      return {
        ...s,
        center: [...s.center] as Vec3,
        normal: [...s.normal] as Vec3,
      };
    }),
  };
}

/** Point le plus proche sur la polyligne (tous segments). */
export function closestOnPolyline(
  poly: PolylineEntity,
  click: Vec3,
): { point: Vec3; dist: number } | null {
  let bestD = Infinity;
  let bestP: Vec3 | null = null;

  for (const stroke of polylineStrokes(poly, 64)) {
    const pts = stroke.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const near = closestOnSegment(a, b, click);
      if (near.dist < bestD) {
        bestD = near.dist;
        bestP = near.point;
      }
    }
  }
  if (!bestP || !Number.isFinite(bestD)) return null;
  return { point: bestP, dist: bestD };
}

function closestOnSegment(
  a: Vec3,
  b: Vec3,
  p: Vec3,
): { point: Vec3; dist: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 < EPS ? 0 : (apx * abx + apy * aby + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  const point: Vec3 = [a[0] + t * abx, a[1] + t * aby, a[2] + t * abz];
  return { point, dist: dist(point, p) };
}

/** Extrémités de chaque segment (snap endpoint). */
export function polylineEndpoints(poly: PolylineEntity): Vec3[] {
  const pts: Vec3[] = [];
  for (const s of poly.segments) {
    if (s.type === 'line') {
      pts.push([...s.start] as Vec3, [...s.end] as Vec3);
    } else {
      const arc: ArcEntity = {
        id: '',
        kind: 'arc',
        layer: '',
        center: s.center,
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: s.normal,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      };
      pts.push(arcStartPoint(arc), arcEndPoint(arc));
    }
  }
  return pts;
}
