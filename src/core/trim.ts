/**
 * /trim — raccourcit un objet au point indiqué, en gardant un seul côté.
 *
 * 1) objet  2) endroit de la coupe  3) côté à garder
 *
 * Ligne, arc, mur (line / arc / poly ouvert), polyligne **ouverte**.
 * Refus : polyligne fermée, polymur fermé, instances library, cercle.
 */

import {
  arcEndPoint,
  arcStartPoint,
  createArcEntity,
  isDegenerateLine,
  sampleArc,
} from './drawing';
import { dist } from './geometry';
import { isPolylineClosedGeom } from './fill';
import {
  polylineEnd,
  polylineStart,
  polylineStrokes,
} from './polyline';
import type {
  ArcEntity,
  Entity,
  LineEntity,
  LineStyleId,
  PolylineEntity,
  PolylineSegment,
  Vec3,
  WallEntity,
  WallSegment,
} from './types';
import {
  isPolyWallClosed,
  polyWallEnd,
  polyWallStart,
  wallEntityStrokes,
} from './walls';

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

export type TrimSide = 'start' | 'end';

export type Trimmable = LineEntity | ArcEntity | PolylineEntity | WallEntity;

export type TrimReject = 'closed-poly' | 'closed-wall' | 'object';

export interface TrimHit {
  entity: Trimmable;
  point: Vec3;
  dist: number;
}

export interface TrimCandidate {
  entity: Entity;
  point: Vec3;
  dist: number;
  reject?: TrimReject;
}

export interface TrimPreviewStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

export interface TrimResult {
  entity: Entity;
  kept: TrimSide;
}

// ─── Picking ────────────────────────────────────────────────────────────────

/** Plus proche candidat trim (y compris refus explicites). */
export function findNearestTrimCandidate(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): TrimCandidate | null {
  if (maxDist <= 0) return null;
  let best: TrimCandidate | null = null;

  const consider = (c: TrimCandidate) => {
    if (c.dist > maxDist) return;
    if (!best || c.dist < best.dist) best = c;
  };

  for (const e of entities) {
    if (e.kind === 'line') {
      const near = closestOnSegment(e.start, e.end, click);
      consider({ entity: e, point: near.point, dist: near.dist });
    } else if (e.kind === 'arc') {
      const near = closestOnArc(e, click);
      if (near) consider({ entity: e, point: near.point, dist: near.dist });
    } else if (e.kind === 'polyline') {
      const near = closestOnPolylinePath(e, click);
      if (!near) continue;
      consider({
        entity: e,
        point: near.point,
        dist: near.dist,
        reject: isPolylineClosedGeom(e) ? 'closed-poly' : undefined,
      });
    } else if (e.kind === 'wall') {
      const near = closestOnWall(e, click);
      if (!near) continue;
      const closed = e.path === 'poly' && isPolyWallClosed(e);
      consider({
        entity: e,
        point: near.point,
        dist: near.dist,
        reject: closed ? 'closed-wall' : undefined,
      });
    }
  }
  return best;
}

export function findNearestTrimmable(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): TrimHit | null {
  const c = findNearestTrimCandidate(click, entities, maxDist);
  if (!c || c.reject) return null;
  if (
    c.entity.kind !== 'line' &&
    c.entity.kind !== 'arc' &&
    c.entity.kind !== 'polyline' &&
    c.entity.kind !== 'wall'
  ) {
    return null;
  }
  return { entity: c.entity, point: c.point, dist: c.dist };
}

export interface PerpProject {
  /** Pied de la perpendiculaire sur le support (droite / cercle / segment). */
  foot: Vec3;
  /** Point clampe sur l’objet (extrémité si le pied est hors trait). */
  point: Vec3;
  /** false si la perpendiculaire tombe hors de l’objet fini. */
  onObject: boolean;
}

/**
 * Perpendiculaire du clic vers l’objet (même très loin).
 * `onObject` = le pied est sur le trait fini (pas au-delà d’une extrémité).
 */
export function projectPerpOnObject(
  entity: Trimmable,
  click: Vec3,
): PerpProject | null {
  if (entity.kind === 'line') {
    return projectPerpOnSegment(entity.start, entity.end, click);
  }
  if (entity.kind === 'arc') {
    return projectPerpOnArc(entity, click);
  }
  if (entity.kind === 'polyline') {
    return projectPerpOnPolyline(entity, click);
  }
  return projectPerpOnWall(entity, click);
}

/** @deprecated préfère projectPerpOnObject */
export function projectTrimPoint(entity: Trimmable, click: Vec3): Vec3 | null {
  return projectPerpOnObject(entity, click)?.point ?? null;
}

/** Côté à garder selon le clic (vers quelle extrémité). */
export function sideToKeep(
  entity: Trimmable,
  cut: Vec3,
  click: Vec3,
): TrimSide {
  if (entity.kind === 'line') {
    return dist(click, entity.start) <= dist(click, entity.end) ? 'start' : 'end';
  }
  if (entity.kind === 'arc') {
    const p0 = arcStartPoint(entity);
    const p1 = arcEndPoint(entity);
    return dist(click, p0) <= dist(click, p1) ? 'start' : 'end';
  }
  if (entity.kind === 'polyline') {
    const dStart = distToPolylineHalf(entity, cut, 'start', click);
    const dEnd = distToPolylineHalf(entity, cut, 'end', click);
    return dStart <= dEnd ? 'start' : 'end';
  }
  if (entity.path === 'arc' && entity.center && entity.radius != null) {
    const p0 = entity.start;
    const p1 = entity.end;
    return dist(click, p0) <= dist(click, p1) ? 'start' : 'end';
  }
  if (entity.path === 'poly' && entity.segments?.length) {
    const asPoly = wallPathAsPolyline(entity);
    if (asPoly) {
      const dStart = distToPolylineHalf(asPoly, cut, 'start', click);
      const dEnd = distToPolylineHalf(asPoly, cut, 'end', click);
      return dStart <= dEnd ? 'start' : 'end';
    }
  }
  return dist(click, entity.start) <= dist(click, entity.end) ? 'start' : 'end';
}

export function applyTrim(
  entity: Trimmable,
  cut: Vec3,
  keep: TrimSide,
): TrimResult | null {
  if (entity.kind === 'line') {
    const next = trimLine(entity, cut, keep);
    return next ? { entity: next, kept: keep } : null;
  }
  if (entity.kind === 'arc') {
    const next = trimArc(entity, cut, keep);
    return next ? { entity: next, kept: keep } : null;
  }
  if (entity.kind === 'polyline') {
    const next = trimPolyline(entity, cut, keep);
    return next ? { entity: next, kept: keep } : null;
  }
  const next = trimWall(entity, cut, keep);
  return next ? { entity: next, kept: keep } : null;
}

/** Traits de preview : côté gardé (clair) + côté jeté (sombre, tireté). */
export function trimPreviewStrokes(
  entity: Trimmable,
  cut: Vec3,
  keep: TrimSide,
): TrimPreviewStroke[] {
  const kept = applyTrim(entity, cut, keep);
  const dropped = applyTrim(entity, cut, keep === 'start' ? 'end' : 'start');
  const out: TrimPreviewStroke[] = [];
  if (dropped) {
    for (const s of entityPreviewStrokes(dropped.entity)) {
      out.push({
        ...s,
        color: '#5a3030',
        lineStyle: 'tiret',
        lineWidth: Math.max(1, s.lineWidth),
      });
    }
  }
  if (kept) {
    for (const s of entityPreviewStrokes(kept.entity)) {
      out.push({
        ...s,
        color: '#4fc3f7',
        lineStyle: 'plein',
        lineWidth: Math.max(2, s.lineWidth),
      });
    }
  }
  return out;
}

// ─── Apply per kind ─────────────────────────────────────────────────────────

function trimLine(
  line: LineEntity,
  cut: Vec3,
  keep: TrimSide,
): LineEntity | null {
  const p = closestOnSegment(line.start, line.end, cut).point;
  if (keep === 'start') {
    if (isDegenerateLine(line.start, p)) return null;
    return { ...line, end: [...p] as Vec3 };
  }
  if (isDegenerateLine(p, line.end)) return null;
  return { ...line, start: [...p] as Vec3 };
}

function trimArc(arc: ArcEntity, cut: Vec3, keep: TrimSide): ArcEntity | null {
  const aCut = angleOnArc(arc, cut);
  if (aCut == null) return null;
  const cw = arc.endAngle < arc.startAngle;
  if (keep === 'start') {
    if (Math.abs(aCut - arc.startAngle) < 1e-6) return null;
    return createArcEntity(
      arc.center,
      arc.radius,
      arc.startAngle,
      aCut,
      {
        color: arc.color,
        lineWidth: arc.lineWidth,
        lineStyle: arc.lineStyle,
        layer: arc.layer,
        id: arc.id,
      },
      { clockwise: cw },
    );
  }
  if (Math.abs(aCut - arc.endAngle) < 1e-6) return null;
  return createArcEntity(
    arc.center,
    arc.radius,
    aCut,
    arc.endAngle,
    {
      color: arc.color,
      lineWidth: arc.lineWidth,
      lineStyle: arc.lineStyle,
      layer: arc.layer,
      id: arc.id,
    },
    { clockwise: cw },
  );
}

function trimPolyline(
  poly: PolylineEntity,
  cut: Vec3,
  keep: TrimSide,
): PolylineEntity | null {
  const loc = locateOnPolyline(poly, cut);
  if (!loc) return null;
  const segs = splitPolylineAt(poly, loc);
  if (!segs) return null;
  const kept = keep === 'start' ? segs.start : segs.end;
  if (kept.length === 0) return null;
  return { ...poly, segments: kept, closed: false };
}

function trimWall(wall: WallEntity, cut: Vec3, keep: TrimSide): WallEntity | null {
  if (wall.path === 'arc' && wall.center && wall.radius != null) {
    const fake: ArcEntity = {
      id: wall.id,
      kind: 'arc',
      layer: wall.layer,
      center: wall.center,
      radius: wall.radius,
      startAngle: wall.startAngle ?? 0,
      endAngle: wall.endAngle ?? 0,
      normal: wall.normal ?? [0, 0, 1],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    };
    const next = trimArc(fake, cut, keep);
    if (!next) return null;
    return {
      ...wall,
      start: arcStartPoint(next),
      end: arcEndPoint(next),
      startAngle: next.startAngle,
      endAngle: next.endAngle,
      strokeGeom: undefined,
    };
  }

  if (wall.path === 'poly' && wall.segments?.length) {
    if (isPolyWallClosed(wall)) return null;
    const asPoly = wallPathAsPolyline(wall);
    if (!asPoly) return null;
    const trimmed = trimPolyline(asPoly, cut, keep);
    if (!trimmed) return null;
    const segs: WallSegment[] = trimmed.segments.map((s): WallSegment => {
      if (s.type === 'line') {
        return {
          type: 'line',
          start: [...s.start] as Vec3,
          end: [...s.end] as Vec3,
        };
      }
      return {
        type: 'arc',
        center: [...s.center] as Vec3,
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: [...s.normal] as Vec3,
      };
    });
    const w: WallEntity = {
      ...wall,
      path: 'poly',
      segments: segs,
      strokeGeom: undefined,
      closed: false,
    };
    const a = polyWallStart(w);
    const b = polyWallEnd(w);
    if (a) w.start = a;
    if (b) w.end = b;
    return w;
  }

  // path line
  const p = closestOnSegment(wall.start, wall.end, cut).point;
  if (keep === 'start') {
    if (isDegenerateLine(wall.start, p)) return null;
    return { ...wall, end: [...p] as Vec3, strokeGeom: undefined };
  }
  if (isDegenerateLine(p, wall.end)) return null;
  return { ...wall, start: [...p] as Vec3, strokeGeom: undefined };
}

// ─── Preview helpers ────────────────────────────────────────────────────────

function entityPreviewStrokes(e: Entity): TrimPreviewStroke[] {
  if (e.kind === 'line') {
    return [
      {
        points: [e.start, e.end],
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      },
    ];
  }
  if (e.kind === 'arc') {
    return [
      {
        points: sampleArc(e, 48),
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      },
    ];
  }
  if (e.kind === 'polyline') {
    return polylineStrokes(e, 32).map((s) => ({
      points: s.points,
      color: s.color,
      lineWidth: s.lineWidth,
      lineStyle: s.lineStyle,
    }));
  }
  if (e.kind === 'wall') {
    return wallEntityStrokes(e, 24).map((s) => ({
      points: s.points,
      color: s.color,
      lineWidth: s.lineWidth,
      lineStyle: s.lineStyle,
    }));
  }
  return [];
}

// ─── Geometry ───────────────────────────────────────────────────────────────

function projectPerpOnSegment(a: Vec3, b: Vec3, click: Vec3): PerpProject {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  if (L2 < EPS) {
    return { foot: [...a] as Vec3, point: [...a] as Vec3, onObject: false };
  }
  const t =
    ((click[0] - a[0]) * abx +
      (click[1] - a[1]) * aby +
      (click[2] - a[2]) * abz) /
    L2;
  const foot: Vec3 = [a[0] + t * abx, a[1] + t * aby, a[2] + t * abz];
  const tc = Math.max(0, Math.min(1, t));
  const point: Vec3 = [a[0] + tc * abx, a[1] + tc * aby, a[2] + tc * abz];
  return { foot, point, onObject: t >= -1e-6 && t <= 1 + 1e-6 };
}

function projectPerpOnArc(arc: ArcEntity, click: Vec3): PerpProject | null {
  if (arc.radius < EPS) return null;
  const ang = Math.atan2(click[1] - arc.center[1], click[0] - arc.center[0]);
  const foot: Vec3 = [
    arc.center[0] + arc.radius * Math.cos(ang),
    arc.center[1] + arc.radius * Math.sin(ang),
    arc.center[2],
  ];
  const aCut = angleOnArc(arc, foot);
  if (aCut != null) {
    const point: Vec3 = [
      arc.center[0] + arc.radius * Math.cos(aCut),
      arc.center[1] + arc.radius * Math.sin(aCut),
      arc.center[2],
    ];
    return { foot: point, point, onObject: true };
  }
  const p0 = arcStartPoint(arc);
  const p1 = arcEndPoint(arc);
  const point = dist(foot, p0) <= dist(foot, p1) ? p0 : p1;
  return { foot, point, onObject: false };
}

function projectPerpOnPolyline(
  poly: PolylineEntity,
  click: Vec3,
): PerpProject | null {
  let bestOn: PerpProject | null = null;
  let bestOnD = Infinity;
  let bestOff: PerpProject | null = null;
  let bestOffD = Infinity;
  for (const s of poly.segments) {
    let proj: PerpProject | null = null;
    if (s.type === 'line') {
      proj = projectPerpOnSegment(s.start, s.end, click);
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
      proj = projectPerpOnArc(arc, click);
    }
    if (!proj) continue;
    const d = dist(click, proj.foot);
    if (proj.onObject && d < bestOnD) {
      bestOnD = d;
      bestOn = proj;
    } else if (!proj.onObject && d < bestOffD) {
      bestOffD = d;
      bestOff = proj;
    }
  }
  return bestOn ?? bestOff;
}

function projectPerpOnWall(wall: WallEntity, click: Vec3): PerpProject | null {
  if (wall.path === 'arc' && wall.center && wall.radius != null) {
    const fake: ArcEntity = {
      id: wall.id,
      kind: 'arc',
      layer: wall.layer,
      center: wall.center,
      radius: wall.radius,
      startAngle: wall.startAngle ?? 0,
      endAngle: wall.endAngle ?? 0,
      normal: wall.normal ?? [0, 0, 1],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    };
    return projectPerpOnArc(fake, click);
  }
  if (wall.path === 'poly' && wall.segments?.length) {
    const asPoly = wallPathAsPolyline(wall);
    return asPoly ? projectPerpOnPolyline(asPoly, click) : null;
  }
  return projectPerpOnSegment(wall.start, wall.end, click);
}

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
    return { point: [...a] as Vec3, dist: dist(a, click) };
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
  const a = angleOnArc(arc, click);
  if (a == null) {
    const p0 = arcStartPoint(arc);
    const p1 = arcEndPoint(arc);
    const d0 = dist(p0, click);
    const d1 = dist(p1, click);
    return d0 <= d1 ? { point: p0, dist: d0 } : { point: p1, dist: d1 };
  }
  const p: Vec3 = [
    arc.center[0] + arc.radius * Math.cos(a),
    arc.center[1] + arc.radius * Math.sin(a),
    arc.center[2],
  ];
  return { point: p, dist: dist(p, click) };
}

function angleOnArc(arc: ArcEntity, pt: Vec3): number | null {
  let a = Math.atan2(pt[1] - arc.center[1], pt[0] - arc.center[0]);
  const a0 = arc.startAngle;
  const a1 = arc.endAngle;
  const span = a1 - a0;
  if (Math.abs(span) < EPS) return null;
  if (span >= 0) {
    while (a < a0) a += TWO_PI;
    while (a >= a0 + TWO_PI) a -= TWO_PI;
    if (a < a0 - 1e-9 || a > a1 + 1e-9) return null;
    return Math.max(a0, Math.min(a1, a));
  }
  while (a > a0) a -= TWO_PI;
  while (a <= a0 - TWO_PI) a += TWO_PI;
  if (a > a0 + 1e-9 || a < a1 - 1e-9) return null;
  return Math.min(a0, Math.max(a1, a));
}

function closestOnPolylinePath(
  poly: PolylineEntity,
  click: Vec3,
): { point: Vec3; dist: number } | null {
  let bestD = Infinity;
  let bestP: Vec3 | null = null;
  for (const s of poly.segments) {
    if (s.type === 'line') {
      const near = closestOnSegment(s.start, s.end, click);
      if (near.dist < bestD) {
        bestD = near.dist;
        bestP = near.point;
      }
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
      const near = closestOnArc(arc, click);
      if (near && near.dist < bestD) {
        bestD = near.dist;
        bestP = near.point;
      }
    }
  }
  return bestP ? { point: bestP, dist: bestD } : null;
}

function closestOnWall(
  wall: WallEntity,
  click: Vec3,
): { point: Vec3; dist: number; axis: Vec3 } | null {
  // Hit-test sur les traits visibles, coupe sur l’axe de référence
  let bestD = Infinity;
  for (const s of wallEntityStrokes(wall, 24)) {
    const pts = s.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const near = closestOnSegment(pts[i]!, pts[i + 1]!, click);
      if (near.dist < bestD) bestD = near.dist;
    }
  }
  if (!Number.isFinite(bestD)) return null;

  let axis: Vec3;
  if (wall.path === 'arc' && wall.center && wall.radius != null) {
    const fake: ArcEntity = {
      id: wall.id,
      kind: 'arc',
      layer: wall.layer,
      center: wall.center,
      radius: wall.radius,
      startAngle: wall.startAngle ?? 0,
      endAngle: wall.endAngle ?? 0,
      normal: wall.normal ?? [0, 0, 1],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    };
    axis = closestOnArc(fake, click)?.point ?? wall.start;
  } else if (wall.path === 'poly' && wall.segments?.length) {
    const asPoly = wallPathAsPolyline(wall);
    axis = asPoly
      ? (closestOnPolylinePath(asPoly, click)?.point ?? wall.start)
      : wall.start;
  } else {
    axis = closestOnSegment(wall.start, wall.end, click).point;
  }
  return { point: axis, dist: bestD, axis };
}

function wallPathAsPolyline(wall: WallEntity): PolylineEntity | null {
  if (!wall.segments?.length) return null;
  const ln0 = wall.lines[0];
  return {
    id: wall.id,
    kind: 'polyline',
    layer: wall.layer,
    closed: false,
    segments: wall.segments.map((s): PolylineSegment => {
      if (s.type === 'line') {
        return {
          type: 'line',
          start: [...s.start] as Vec3,
          end: [...s.end] as Vec3,
          color: ln0?.color ?? '#000',
          lineWidth: ln0?.lineWidth ?? 1,
          lineStyle: ln0?.lineStyle ?? 'plein',
        };
      }
      return {
        type: 'arc',
        center: [...s.center] as Vec3,
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: [...s.normal] as Vec3,
        color: ln0?.color ?? '#000',
        lineWidth: ln0?.lineWidth ?? 1,
        lineStyle: ln0?.lineStyle ?? 'plein',
      };
    }),
  };
}

type PolyLoc = { segIdx: number; point: Vec3 };

function locateOnPolyline(poly: PolylineEntity, cut: Vec3): PolyLoc | null {
  let best: PolyLoc | null = null;
  let bestD = Infinity;
  poly.segments.forEach((s, i) => {
    if (s.type === 'line') {
      const near = closestOnSegment(s.start, s.end, cut);
      if (near.dist < bestD) {
        bestD = near.dist;
        best = { segIdx: i, point: near.point };
      }
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
      const near = closestOnArc(arc, cut);
      if (near && near.dist < bestD) {
        bestD = near.dist;
        best = { segIdx: i, point: near.point };
      }
    }
  });
  return best;
}

function splitPolylineAt(
  poly: PolylineEntity,
  loc: PolyLoc,
): { start: PolylineSegment[]; end: PolylineSegment[] } | null {
  const s = poly.segments[loc.segIdx];
  if (!s) return null;
  const halves = splitSegment(s, loc.point);
  if (!halves) return null;
  const start = [
    ...poly.segments.slice(0, loc.segIdx),
    ...(halves[0] ? [halves[0]] : []),
  ];
  const end = [
    ...(halves[1] ? [halves[1]] : []),
    ...poly.segments.slice(loc.segIdx + 1),
  ];
  return { start, end };
}

function splitSegment(
  s: PolylineSegment,
  cut: Vec3,
): [PolylineSegment | null, PolylineSegment | null] | null {
  if (s.type === 'line') {
    const left = isDegenerateLine(s.start, cut)
      ? null
      : { ...s, end: [...cut] as Vec3 };
    const right = isDegenerateLine(cut, s.end)
      ? null
      : { ...s, start: [...cut] as Vec3 };
    if (!left && !right) return null;
    return [left, right];
  }
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
  const aCut = angleOnArc(arc, cut);
  if (aCut == null) return null;
  const cw = s.endAngle < s.startAngle;
  const leftArc =
    Math.abs(aCut - s.startAngle) < 1e-6
      ? null
      : createArcEntity(
          s.center,
          s.radius,
          s.startAngle,
          aCut,
          {
            color: s.color,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          },
          { clockwise: cw },
        );
  const rightArc =
    Math.abs(aCut - s.endAngle) < 1e-6
      ? null
      : createArcEntity(
          s.center,
          s.radius,
          aCut,
          s.endAngle,
          {
            color: s.color,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          },
          { clockwise: cw },
        );
  const left: PolylineSegment | null = leftArc
    ? {
        type: 'arc',
        center: leftArc.center,
        radius: leftArc.radius,
        startAngle: leftArc.startAngle,
        endAngle: leftArc.endAngle,
        normal: [...s.normal] as Vec3,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      }
    : null;
  const right: PolylineSegment | null = rightArc
    ? {
        type: 'arc',
        center: rightArc.center,
        radius: rightArc.radius,
        startAngle: rightArc.startAngle,
        endAngle: rightArc.endAngle,
        normal: [...s.normal] as Vec3,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      }
    : null;
  if (!left && !right) return null;
  return [left, right];
}

function distToPolylineHalf(
  poly: PolylineEntity,
  cut: Vec3,
  keep: TrimSide,
  click: Vec3,
): number {
  const half = applyTrim(poly, cut, keep);
  if (!half || half.entity.kind !== 'polyline') return Infinity;
  const near = closestOnPolylinePath(half.entity, click);
  return near?.dist ?? Infinity;
}

/** Exposé pour tests. */
export function polylineEndpoint(
  poly: PolylineEntity,
  which: TrimSide,
): Vec3 | null {
  return which === 'start' ? polylineStart(poly) : polylineEnd(poly);
}
