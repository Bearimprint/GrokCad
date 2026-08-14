import type { Vec3 } from './types';

const EPS = 1e-9;

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const L = len(a);
  if (L < EPS) return [0, 0, 0];
  return [a[0] / L, a[1] / L, a[2] / L];
}

export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

/** Point le plus proche sur une droite infinie (origin + t·direction). */
export function closestPointOnInfiniteLine(
  origin: Vec3,
  direction: Vec3,
  point: Vec3,
): { point: Vec3; t: number; dist: number } {
  const d = normalize(direction);
  const t = dot(sub(point, origin), d);
  const p = add(origin, scale(d, t));
  return { point: p, t, dist: dist(p, point) };
}

/**
 * Intersection de deux droites infinies (meilleur point si non coplanaires).
 * Retourne null si parallèles.
 */
export function infiniteLineIntersection(
  o1: Vec3,
  d1: Vec3,
  o2: Vec3,
  d2: Vec3,
): Vec3 | null {
  const a = normalize(d1);
  const b = normalize(d2);
  const r = sub(o1, o2);
  const axb = cross(a, b);
  const denom = dot(axb, axb);
  if (denom < EPS) return null; // parallèles

  // Formule skew-lines closest points midpoint
  const bxr = cross(b, r);
  const t = dot(bxr, axb) / denom;
  const p1 = add(o1, scale(a, t));
  const rxa = cross(r, a);
  const s = dot(rxa, axb) / denom;
  const p2 = add(o2, scale(b, s));

  // Si presque coplanaires, les deux points coïncident
  if (dist(p1, p2) < 1e-4) return p1;
  // Sinon milieu du segment le plus court
  return scale(add(p1, p2), 0.5);
}

/** Vecteur perpendiculaire dans le plan (par défaut XY : (-dy, dx, 0)). */
export function perpInPlane(direction: Vec3, planeNormal: Vec3 = [0, 0, 1]): Vec3 {
  return normalize(cross(planeNormal, direction));
}
