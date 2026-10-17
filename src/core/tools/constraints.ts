/**
 * Contraintes de saisie (Shift = H / 45° / V, projection sur un cercle).
 */

import type { Vec3 } from '../types';

const EPS = 1e-9;

/**
 * Verrouille le segment origin→target sur le multiple de 45° le plus proche
 * (horizontal, 45°, vertical, …). Conserve la distance souris.
 */
export function constrainAxis45(origin: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) return [target[0], target[1], target[2]];
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  return [
    origin[0] + L * Math.cos(snapped),
    origin[1] + L * Math.sin(snapped),
    origin[2],
  ];
}

/** Projette `pt` sur le cercle (centre, rayon), plan XY. */
export function projectOnCircle(center: Vec3, radius: number, pt: Vec3): Vec3 {
  const dx = pt[0] - center[0];
  const dy = pt[1] - center[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) {
    return [center[0] + radius, center[1], center[2]];
  }
  const s = radius / L;
  return [center[0] + dx * s, center[1] + dy * s, center[2]];
}
