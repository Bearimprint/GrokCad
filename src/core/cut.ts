/**
 * /cut — coupe un élément de dessin au point le plus proche du clic
 * (dans un rayon en mètres, dérivé des pixels écran / snap).
 *
 * - line   → 2 segments
 * - arc    → 2 arcs (même centre / rayon / style)
 * - circle → 1 arc plein ouvert au point de coupe (aspect identique ;
 *            une 2ᵉ coupe le scinde en 2 arcs)
 */

import { dist } from './geometry';
import { createArcEntity, createLineEntity, isDegenerateLine } from './drawing';
import type {
  ArcEntity,
  CircleEntity,
  Entity,
  LineEntity,
  Vec3,
} from './types';

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

export type Cuttable = LineEntity | ArcEntity | CircleEntity;

export interface CutHit {
  entity: Cuttable;
  /** Point projeté sur l'élément (lieu de la coupe). */
  point: Vec3;
  /** Distance monde clic → point. */
  dist: number;
}

export interface CutResult {
  removedId: string;
  /** Entités de remplacement (1 pour cercle→arc, 2 pour split). */
  replacements: Entity[];
  kind: 'line' | 'arc' | 'circle';
}

/** Entité de dessin la plus proche du clic, si dist ≤ maxDist. */
export function findNearestCuttable(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): CutHit | null {
  if (maxDist <= 0) return null;
  let best: CutHit | null = null;

  for (const e of entities) {
    if (e.kind === 'line') {
      const near = closestOnSegment(e.start, e.end, click);
      if (near.dist <= maxDist && (!best || near.dist < best.dist)) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'arc') {
      const near = closestOnArcEntity(e, click);
      if (near && near.dist <= maxDist && (!best || near.dist < best.dist)) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'circle') {
      const near = closestOnCircle(e, click);
      if (near.dist <= maxDist && (!best || near.dist < best.dist)) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    }
  }

  return best;
}

/**
 * Applique la coupe. null si dégénérée (trop près d'une extrémité,
 * segment nul, etc.) — l'appelant peut alors ne rien faire.
 */
export function applyCut(hit: CutHit): CutResult | null {
  const { entity, point } = hit;
  if (entity.kind === 'line') {
    const parts = splitLine(entity, point);
    if (!parts) return null;
    return { removedId: entity.id, replacements: parts, kind: 'line' };
  }
  if (entity.kind === 'arc') {
    const parts = splitArc(entity, point);
    if (!parts) return null;
    return { removedId: entity.id, replacements: parts, kind: 'arc' };
  }
  // circle → arc plein ancré au point de coupe
  const arc = circleToArcAt(entity, point);
  if (!arc) return null;
  return { removedId: entity.id, replacements: [arc], kind: 'circle' };
}

// —— Geometry ——

function strokeOf(e: Cuttable) {
  return {
    color: e.color,
    lineWidth: e.lineWidth,
    lineStyle: e.lineStyle,
    layer: e.layer,
  };
}

function splitLine(line: LineEntity, cut: Vec3): [LineEntity, LineEntity] | null {
  if (isDegenerateLine(line.start, cut) || isDegenerateLine(cut, line.end)) {
    return null;
  }
  // Éviter coupe quasi-extrémité (bruit numérique)
  const L = dist(line.start, line.end);
  if (L < EPS) return null;
  if (dist(line.start, cut) / L < 1e-6 || dist(line.end, cut) / L < 1e-6) {
    return null;
  }
  const s = strokeOf(line);
  return [
    createLineEntity(line.start, cut, s),
    createLineEntity(cut, line.end, s),
  ];
}

function splitArc(arc: ArcEntity, cut: Vec3): [ArcEntity, ArcEntity] | null {
  const a0 = arc.startAngle;
  const a1 = arc.endAngle;
  const span = a1 - a0;
  if (Math.abs(span) < EPS) return null;

  let a = Math.atan2(cut[1] - arc.center[1], cut[0] - arc.center[0]);
  // Placer a sur le balayage [a0, a1] (span peut être négatif = CW)
  if (span >= 0) {
    while (a < a0) a += TWO_PI;
    while (a >= a0 + TWO_PI) a -= TWO_PI;
    if (a <= a0 + EPS || a >= a1 - EPS) return null;
  } else {
    while (a > a0) a -= TWO_PI;
    while (a <= a0 - TWO_PI) a += TWO_PI;
    if (a >= a0 - EPS || a <= a1 + EPS) return null;
  }

  // Vérifier que le point de coupe est bien sur le rayon (tolérance)
  const onArc: Vec3 = [
    arc.center[0] + arc.radius * Math.cos(a),
    arc.center[1] + arc.radius * Math.sin(a),
    arc.center[2],
  ];
  if (dist(onArc, cut) > Math.max(EPS, arc.radius * 1e-6) * 100 + 1e-6) {
    // cut peut être légèrement off-radius (projection) — on utilise a quand même
  }

  const s = strokeOf(arc);
  const cw = span < 0;
  const first = createArcEntity(arc.center, arc.radius, a0, a, s, {
    clockwise: cw,
  });
  const second = createArcEntity(arc.center, arc.radius, a, a1, s, {
    clockwise: cw,
  });

  // Rejeter si un morceau a un balayage quasi nul
  if (
    Math.abs(first.endAngle - first.startAngle) < 1e-6 ||
    Math.abs(second.endAngle - second.startAngle) < 1e-6
  ) {
    return null;
  }
  return [first, second];
}

function circleToArcAt(circle: CircleEntity, cut: Vec3): ArcEntity | null {
  if (circle.radius < EPS) return null;
  const a = Math.atan2(cut[1] - circle.center[1], cut[0] - circle.center[0]);
  // Arc plein [a, a+2π] — aspect identique au cercle, désormais coupable en 2
  return createArcEntity(circle.center, circle.radius, a, a + TWO_PI, strokeOf(circle));
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
    return { point: [a[0], a[1], a[2]], dist: dist(a, click) };
  }
  let t =
    ((click[0] - a[0]) * abx + (click[1] - a[1]) * aby + (click[2] - a[2]) * abz) /
    L2;
  t = Math.max(0, Math.min(1, t));
  const p: Vec3 = [a[0] + t * abx, a[1] + t * aby, a[2] + t * abz];
  return { point: p, dist: dist(p, click) };
}

function closestOnArcEntity(
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

  // Hors secteur → extrémités
  const p0: Vec3 = [
    cx + arc.radius * Math.cos(a0),
    cy + arc.radius * Math.sin(a0),
    cz,
  ];
  const p1: Vec3 = [
    cx + arc.radius * Math.cos(a1),
    cy + arc.radius * Math.sin(a1),
    cz,
  ];
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
    // Clic au centre : point arbitraire sur le cercle
    const p: Vec3 = [cx + circle.radius, cy, cz];
    return { point: p, dist: circle.radius };
  }
  const s = circle.radius / L;
  const p: Vec3 = [cx + dx * s, cy + dy * s, cz];
  return { point: p, dist: dist(p, click) };
}
