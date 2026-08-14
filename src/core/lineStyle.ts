/**
 * Motifs de style de trait (linetype).
 *
 * Three.js LineMaterial ne gère qu’un motif simple tiret/gap uniforme.
 * Pour tiret-point / tiret-point-point (et une apparence fiable de tous
 * les styles), on tesselle la géométrie en petits segments **pleins**
 * selon un cycle [dessin, trou, dessin, trou, …] en mètres monde.
 */

import { dist, sub } from './geometry';
import {
  DEFAULT_STYLES,
  type StyleOption,
} from './penPrefs';
import type { LineStyleId, Vec3 } from './types';

const EPS = 1e-9;

/**
 * Cycle de longueurs en mètres : indices pairs = trait, impairs = trou.
 * Ex. tiret-point : [tiret, gap, point, gap]
 */
export function stylePattern(style: StyleOption): number[] | null {
  if (!style.dashed) return null;
  if (style.pattern && style.pattern.length >= 2) {
    return style.pattern.map((v) => Math.max(1e-5, v));
  }
  // Fallback simple tiret / gap
  const d = Math.max(1e-5, style.dashSize);
  const g = Math.max(1e-5, style.gapSize);
  return [d, g];
}

export function styleById(id: LineStyleId | string): StyleOption {
  return DEFAULT_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLES[0]!;
}

/**
 * Découpe une polyligne en morceaux pleins selon le style.
 * Si plein (ou pattern null) : un seul morceau = les points d’origine.
 */
export function tessellateByLineStyle(
  points: readonly Vec3[],
  lineStyle: LineStyleId | string,
): Vec3[][] {
  if (points.length < 2) return [];
  const style = styleById(lineStyle);
  const pattern = stylePattern(style);
  if (!pattern) {
    return [points.map((p) => [p[0], p[1], p[2]] as Vec3)];
  }
  return tessellatePattern(points, pattern);
}

/**
 * pattern = [on0, off0, on1, off1, …] en mètres le long de la courbe.
 */
export function tessellatePattern(
  points: readonly Vec3[],
  pattern: readonly number[],
): Vec3[][] {
  if (points.length < 2 || pattern.length === 0) {
    return points.length >= 2
      ? [points.map((p) => [p[0], p[1], p[2]] as Vec3)]
      : [];
  }

  const cycle = pattern.map((v) => Math.max(1e-6, v));
  const pieces: Vec3[][] = [];
  let phase = 0; // index dans cycle
  let phaseLeft = cycle[0]!;
  let drawing = true; // phase pair = dessin
  let cur: Vec3[] = [];

  const pushPoint = (p: Vec3) => {
    if (!drawing) return;
    const last = cur[cur.length - 1];
    if (
      last &&
      Math.abs(last[0] - p[0]) < EPS &&
      Math.abs(last[1] - p[1]) < EPS &&
      Math.abs(last[2] - p[2]) < EPS
    ) {
      return;
    }
    cur.push([p[0], p[1], p[2]]);
  };

  const flush = () => {
    if (cur.length >= 2) {
      pieces.push(cur);
    } else if (cur.length === 1) {
      // Point isolé (dot très court) : petit segment le long de la tangente
      // déjà géré en forçant min length sur les phases on
    }
    cur = [];
  };

  const advancePhase = () => {
    if (drawing) flush();
    phase = (phase + 1) % cycle.length;
    phaseLeft = cycle[phase]!;
    drawing = phase % 2 === 0;
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segLen = dist(a, b);
    if (segLen < EPS) continue;

    const dir = sub(b, a);
    const ux = dir[0] / segLen;
    const uy = dir[1] / segLen;
    const uz = dir[2] / segLen;

    let t = 0; // distance le long de ce segment [0, segLen]
    while (t < segLen - EPS) {
      const remainOnSeg = segLen - t;
      const step = Math.min(phaseLeft, remainOnSeg);

      const p0: Vec3 = [
        a[0] + ux * t,
        a[1] + uy * t,
        a[2] + uz * t,
      ];
      const p1: Vec3 = [
        a[0] + ux * (t + step),
        a[1] + uy * (t + step),
        a[2] + uz * (t + step),
      ];

      if (drawing) {
        if (cur.length === 0) pushPoint(p0);
        pushPoint(p1);
      }

      t += step;
      phaseLeft -= step;
      if (phaseLeft <= EPS) {
        advancePhase();
      }
    }
  }

  if (drawing) flush();
  return pieces.length > 0
    ? pieces
    : [points.map((p) => [p[0], p[1], p[2]] as Vec3)];
}

/** Longueur totale d’une polyligne (utile debug / tests). */
export function polylineLength(points: readonly Vec3[]): number {
  let L = 0;
  for (let i = 0; i < points.length - 1; i++) {
    L += dist(points[i]!, points[i + 1]!);
  }
  return L;
}

/** Vérifie qu’un motif a une longueur de cycle non nulle. */
export function patternCycleLength(pattern: readonly number[]): number {
  return pattern.reduce((a, b) => a + Math.max(0, b), 0);
}
