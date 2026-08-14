import { normalize, perpInPlane, v3 } from './geometry';
import type { HelperLineEntity, Vec3 } from './types';

/** Gris clair type « ligne d'aide ARC+ ». */
export const HELPER_COLOR = '#9aa3ad';
export const HELPER_LAYER = 'AIDES';

let seq = 0;

export function nextHelperId(): string {
  seq += 1;
  return `aide_${seq}_${Date.now().toString(36)}`;
}

export function createHelperLine(
  origin: Vec3,
  direction: Vec3,
  opts?: { id?: string; color?: string },
): HelperLineEntity {
  const dir = normalize(direction);
  if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) {
    throw new Error("Direction de ligne d'aide nulle.");
  }
  return {
    id: opts?.id ?? nextHelperId(),
    kind: 'helper',
    layer: HELPER_LAYER,
    isHelper: true,
    origin: [origin[0], origin[1], origin[2]],
    direction: dir,
    color: opts?.color ?? HELPER_COLOR,
  };
}

/** Axes XYZ passant par un point (comme ARC+ « Axes XYZ par 0 0 0 »). */
export function createAxesHelpers(origin: Vec3 = v3(0, 0, 0)): HelperLineEntity[] {
  return [
    createHelperLine(origin, v3(1, 0, 0), { color: '#c07070' }),
    createHelperLine(origin, v3(0, 1, 0), { color: '#70c078' }),
    createHelperLine(origin, v3(0, 0, 1), { color: '#7090c8' }),
  ];
}

/** Ligne d'aide // axe X (horizontale en plan). */
export function helperParallelX(y: number, z = 0): HelperLineEntity {
  return createHelperLine(v3(0, y, z), v3(1, 0, 0));
}

/** Ligne d'aide // axe Y (verticale en plan). */
export function helperParallelY(x: number, z = 0): HelperLineEntity {
  return createHelperLine(v3(x, 0, z), v3(0, 1, 0));
}

/** Ligne d'aide // axe Z. */
export function helperParallelZ(x: number, y: number): HelperLineEntity {
  return createHelperLine(v3(x, y, 0), v3(0, 0, 1));
}

/**
 * Parallèle à une ligne d'aide existante, décalée de `distance` m
 * le long de la perpendiculaire dans le plan (signe = sens).
 */
export function helperParallelTo(
  ref: HelperLineEntity,
  distance: number,
  planeNormal: Vec3 = v3(0, 0, 1),
): HelperLineEntity {
  const n = perpInPlane(ref.direction, planeNormal);
  const origin: Vec3 = [
    ref.origin[0] + n[0] * distance,
    ref.origin[1] + n[1] * distance,
    ref.origin[2] + n[2] * distance,
  ];
  return createHelperLine(origin, ref.direction);
}

/** Perpendiculaire à une ligne, passant par un point. */
export function helperPerpendicularTo(
  ref: HelperLineEntity,
  through: Vec3,
  planeNormal: Vec3 = v3(0, 0, 1),
): HelperLineEntity {
  const dir = perpInPlane(ref.direction, planeNormal);
  return createHelperLine(through, dir);
}
