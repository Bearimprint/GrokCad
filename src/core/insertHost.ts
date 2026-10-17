/**
 * Hôte d’une insertion : mur (1ʳᵉ face / offset 0), ligne ou arc.
 * L’ancre (−9) se pose sur cette courbe ; X objet = tangente, Y = intérieur.
 */

import { sampleArc } from './drawing';
import { dist, dot, normalize, scale, sub } from './geometry';
import type { ArcEntity, Entity, LineEntity, Vec3, WallEntity } from './types';

const EPS = 1e-9;

export type InsertHostEntity = LineEntity | ArcEntity | WallEntity;

export interface InsertHostHit {
  entity: InsertHostEntity;
  point: Vec3;
  /** Tangente unitaire (sens de la courbe, +X local de l’objet). */
  tangent: Vec3;
  /**
   * Normale « intérieure » unitaire.
   * Mur : vers les offsets positifs (dans le mur).
   * Ligne / arc : normale gauche (CCW).
   */
  inward: Vec3;
  /** Abscisse curviligne depuis le départ (m). */
  along: number;
  dist: number;
}

export function isInsertHost(e: Entity): e is InsertHostEntity {
  return e.kind === 'wall' || e.kind === 'line' || e.kind === 'arc';
}

function leftNormal(dir: Vec3): Vec3 {
  const d = normalize(dir);
  return normalize([-d[1], d[0], 0]);
}

function closestOnSegment(
  a: Vec3,
  b: Vec3,
  click: Vec3,
): { point: Vec3; t: number; dist: number; along: number; tangent: Vec3 } {
  const ab = sub(b, a);
  const L = dist(a, b);
  const tangent = L < EPS ? ([1, 0, 0] as Vec3) : normalize(ab);
  if (L < EPS) {
    return { point: [...a] as Vec3, t: 0, dist: dist(a, click), along: 0, tangent };
  }
  const t = Math.max(0, Math.min(1, dot(sub(click, a), ab) / (L * L)));
  const point: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { point, t, dist: dist(point, click), along: t * L, tangent };
}

interface PathHit {
  point: Vec3;
  tangent: Vec3;
  along: number;
  dist: number;
}

function closestOnPolylinePath(
  pts: Vec3[],
  click: Vec3,
): PathHit | null {
  if (pts.length < 2) return null;
  let best: PathHit | null = null;
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const seg = closestOnSegment(a, b, click);
    const along = acc + seg.along;
    if (!best || seg.dist < best.dist) {
      best = { point: seg.point, tangent: seg.tangent, along, dist: seg.dist };
    }
    acc += dist(a, b);
  }
  return best;
}

function wallReferencePath(wall: WallEntity): Vec3[] {
  if (wall.path === 'arc' && wall.center && wall.radius != null && wall.startAngle != null && wall.endAngle != null) {
    const fake: ArcEntity = {
      id: 'tmp',
      kind: 'arc',
      layer: 'MURS',
      center: wall.center,
      radius: wall.radius,
      startAngle: wall.startAngle,
      endAngle: wall.endAngle,
      normal: wall.normal ?? [0, 0, 1],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    };
    return sampleArc(fake, 48);
  }
  if (wall.path === 'poly' && wall.segments && wall.segments.length > 0) {
    const pts: Vec3[] = [];
    for (const s of wall.segments) {
      if (s.type === 'line') {
        if (pts.length === 0) pts.push([...s.start] as Vec3);
        pts.push([...s.end] as Vec3);
      } else {
        const fake: ArcEntity = {
          id: 'tmp',
          kind: 'arc',
          layer: 'MURS',
          center: s.center,
          radius: s.radius,
          startAngle: s.startAngle,
          endAngle: s.endAngle,
          normal: s.normal,
          color: '#000',
          lineWidth: 1,
          lineStyle: 'plein',
        };
        const sampled = sampleArc(fake, 24);
        for (const p of sampled) {
          if (pts.length === 0 || dist(pts[pts.length - 1]!, p) > EPS) {
            pts.push(p);
          }
        }
      }
    }
    return pts;
  }
  return [wall.start, wall.end];
}

function wallInward(wall: WallEntity, tangent: Vec3, point: Vec3): Vec3 {
  const side = wall.flip ? -1 : 1;
  if (wall.path === 'arc' && wall.center) {
    const toCenter = sub(wall.center, point);
    const n = normalize(toCenter);
    // r' = R − offset·side → offset > 0 rapproche du centre si side = +1
    return scale(n, side);
  }
  return scale(leftNormal(tangent), side);
}

function hitOnHost(e: InsertHostEntity, click: Vec3): InsertHostHit | null {
  if (e.kind === 'line') {
    const seg = closestOnSegment(e.start, e.end, click);
    return {
      entity: e,
      point: seg.point,
      tangent: seg.tangent,
      inward: leftNormal(seg.tangent),
      along: seg.along,
      dist: seg.dist,
    };
  }
  if (e.kind === 'arc') {
    const pts = sampleArc(e, 48);
    const path = closestOnPolylinePath(pts, click);
    if (!path) return null;
    return {
      entity: e,
      point: path.point,
      tangent: path.tangent,
      inward: leftNormal(path.tangent),
      along: path.along,
      dist: path.dist,
    };
  }
  const path = closestOnPolylinePath(wallReferencePath(e), click);
  if (!path) return null;
  const tan =
    path.tangent[0] === 0 && path.tangent[1] === 0
      ? ([1, 0, 0] as Vec3)
      : path.tangent;
  return {
    entity: e,
    point: path.point,
    tangent: tan,
    inward: wallInward(e, tan, path.point),
    along: path.along,
    dist: path.dist,
  };
}

/** Point le long d’un hôte déjà choisi (abscisse `along`, m). */
export function hitAtAlong(
  e: InsertHostEntity,
  along: number,
): InsertHostHit | null {
  // Sonde un point loin puis reclasse — on parcourt la courbe.
  const dummy: Vec3 = [1e9, 1e9, 0];
  const base = hitOnHost(e, dummy);
  if (!base) return null;
  // Reconstruire en marchant
  let pts: Vec3[] = [];
  if (e.kind === 'line') pts = [e.start, e.end];
  else if (e.kind === 'arc') pts = sampleArc(e, 48);
  else pts = wallReferencePath(e);
  if (pts.length < 2) return null;

  let acc = 0;
  const target = Math.max(0, along);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const L = dist(a, b);
    if (L < EPS) continue;
    if (acc + L >= target || i === pts.length - 2) {
      const t = L < EPS ? 0 : Math.max(0, Math.min(1, (target - acc) / L));
      const point: Vec3 = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      const tangent = normalize(sub(b, a));
      const inward =
        e.kind === 'wall' ? wallInward(e, tangent, point) : leftNormal(tangent);
      return {
        entity: e,
        point,
        tangent,
        inward,
        along: acc + t * L,
        dist: 0,
      };
    }
    acc += L;
  }
  return base;
}

export function findNearestInsertHost(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): InsertHostHit | null {
  if (maxDist <= 0) return null;
  let best: InsertHostHit | null = null;
  for (const e of entities) {
    if (!isInsertHost(e)) continue;
    const hit = hitOnHost(e, click);
    if (!hit || hit.dist > maxDist) continue;
    if (!best || hit.dist < best.dist) best = hit;
  }
  return best;
}

export function hostById(
  entities: readonly Entity[],
  id: string,
): InsertHostEntity | null {
  const e = entities.find((x) => x.id === id);
  return e && isInsertHost(e) ? e : null;
}

export function frameFromHit(
  hit: InsertHostHit,
  flipAlt: boolean,
  flipCtrl: boolean,
): { origin: Vec3; axisX: Vec3; axisY: Vec3 } {
  let axisX = hit.tangent;
  let axisY = hit.inward;
  if (flipCtrl) axisX = scale(axisX, -1);
  if (flipAlt) axisY = scale(axisY, -1);
  // Recalcule un Y orthogonal si besoin
  if (Math.hypot(axisY[0], axisY[1]) < EPS) {
    axisY = leftNormal(axisX);
    if (flipAlt) axisY = scale(axisY, -1);
  }
  return { origin: hit.point, axisX: normalize(axisX), axisY: normalize(axisY) };
}

export function rotationFromAxisX(axisX: Vec3): number {
  return Math.atan2(axisX[1], axisX[0]);
}

export function axisXFromRotation(rot: number): Vec3 {
  return [Math.cos(rot), Math.sin(rot), 0];
}
