import { dist, len, normalize, sub, v3 } from './geometry';
import type { LineStyleId } from './penPrefs';
import type {
  ArcEntity,
  CircleEntity,
  LineEntity,
  PointEntity,
  TextEntity,
  Vec3,
} from './types';

const DRAW_LAYER = 'DESSIN';
const EPS = 1e-9;

let seq = 0;

function nextDrawId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export interface StrokeOpts {
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
  layer?: string;
  id?: string;
}

export function createLineEntity(start: Vec3, end: Vec3, stroke: StrokeOpts): LineEntity {
  return {
    id: stroke.id ?? nextDrawId('line'),
    kind: 'line',
    layer: stroke.layer ?? DRAW_LAYER,
    start: [start[0], start[1], start[2]],
    end: [end[0], end[1], end[2]],
    color: stroke.color,
    lineWidth: stroke.lineWidth,
    lineStyle: stroke.lineStyle,
  };
}

/**
 * Arc dans le plan XY (Z = center.z) : angles en radians depuis +X, sens trigo.
 * endAngle peut être < startAngle (arc CW via balayage positif en ajoutant 2π).
 */
export function createArcEntity(
  center: Vec3,
  radius: number,
  startAngle: number,
  endAngle: number,
  stroke: StrokeOpts,
  opts?: { clockwise?: boolean },
): ArcEntity {
  let a0 = startAngle;
  let a1 = endAngle;
  if (opts?.clockwise) {
    while (a1 > a0) a1 -= Math.PI * 2;
    if (a1 === a0) a1 = a0 - Math.PI * 2;
  } else {
    while (a1 < a0) a1 += Math.PI * 2;
    if (a1 === a0) a1 = a0 + Math.PI * 2;
  }

  return {
    id: stroke.id ?? nextDrawId('arc'),
    kind: 'arc',
    layer: stroke.layer ?? DRAW_LAYER,
    center: [center[0], center[1], center[2]],
    radius: Math.abs(radius),
    startAngle: a0,
    endAngle: a1,
    normal: v3(0, 0, 1),
    color: stroke.color,
    lineWidth: stroke.lineWidth,
    lineStyle: stroke.lineStyle,
  };
}

export function createCircleEntity(
  center: Vec3,
  radius: number,
  stroke: StrokeOpts,
): CircleEntity {
  return {
    id: stroke.id ?? nextDrawId('circle'),
    kind: 'circle',
    layer: stroke.layer ?? DRAW_LAYER,
    center: [center[0], center[1], center[2]],
    radius: Math.abs(radius),
    normal: v3(0, 0, 1),
    color: stroke.color,
    lineWidth: stroke.lineWidth,
    lineStyle: stroke.lineStyle,
  };
}

/** Point : couleur + épaisseur (px écran) ; le style de trait est ignoré. */
export function createPointEntity(
  position: Vec3,
  opts: { color: string; lineWidth: number; layer?: string; id?: string },
): PointEntity {
  return {
    id: opts.id ?? nextDrawId('pt'),
    kind: 'point',
    layer: opts.layer ?? DRAW_LAYER,
    position: [position[0], position[1], position[2]],
    color: opts.color,
    lineWidth: Math.max(1, Math.min(7, Math.round(opts.lineWidth) || 1)),
  };
}

export interface TextOpts {
  color: string;
  height: number;
  content: string;
  rotation?: number;
  hAlign?: number;
  vAlign?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  background?: string | null;
  boxed?: boolean;
  boxPadding?: number;
  layer?: string;
  id?: string;
  /** Lien vers une cotation (libellé de côte). */
  dimId?: string;
}

/** Texte 2D (/text, /textbox, import DXF, libellés de cotation). */
export function createTextEntity(position: Vec3, opts: TextOpts): TextEntity {
  return {
    id: opts.id ?? nextDrawId('text'),
    kind: 'text',
    layer: opts.layer ?? DRAW_LAYER,
    position: [position[0], position[1], position[2]],
    height: Math.max(1e-6, opts.height),
    content: opts.content,
    rotation: opts.rotation ?? 0,
    color: opts.color,
    hAlign: opts.hAlign ?? 0,
    vAlign: opts.vAlign ?? 0,
    fontFamily: opts.fontFamily,
    bold: opts.bold,
    italic: opts.italic,
    background: opts.background ?? null,
    boxed: opts.boxed,
    boxPadding: opts.boxPadding,
    dimId: opts.dimId,
  };
}

/** Arc centre + point de départ + point d'arrivée (plan XY). */
export function arcFromCenterStartEnd(
  center: Vec3,
  startPt: Vec3,
  endPt: Vec3,
  stroke: StrokeOpts,
  clockwise = false,
): ArcEntity | null {
  const r0 = dist(center, startPt);
  if (r0 < EPS) return null;
  const startAngle = Math.atan2(startPt[1] - center[1], startPt[0] - center[0]);
  const endAngle = Math.atan2(endPt[1] - center[1], endPt[0] - center[0]);
  return createArcEntity(center, r0, startAngle, endAngle, stroke, { clockwise });
}

/**
 * Arc passant par 3 points (départ, passage, fin) dans le plan XY.
 * Retourne null si colinéaires ou dégénérés.
 */
export function arcFrom3Points(
  start: Vec3,
  mid: Vec3,
  end: Vec3,
  stroke: StrokeOpts,
): ArcEntity | null {
  const center = circumcenter2d(start, mid, end);
  if (!center) return null;
  const r = dist(center, start);
  if (r < EPS) return null;

  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const aMid = Math.atan2(mid[1] - center[1], mid[0] - center[0]);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);

  // Delta CCW normalisé dans [0, 2π)
  const ccw = (from: number, to: number): number => {
    let d = to - from;
    const TWO = Math.PI * 2;
    while (d < 0) d += TWO;
    while (d >= TWO) d -= TWO;
    return d;
  };

  const spanCcw = ccw(a0, a1);
  const midFromStart = ccw(a0, aMid);
  // Le milieu est sur l'arc CCW s'il est entre 0 et spanCcw
  const midOnCcw = midFromStart <= spanCcw + 1e-9;

  return createArcEntity(center, r, a0, a1, stroke, { clockwise: !midOnCcw });
}

/**
 * Arc G1 : part de `start` avec tangente unitaire `tangent`, arrive en `end`.
 * Centre sur la normale à la tangente. null si géométrie impossible.
 */
export function arcFromTangentContinue(
  start: Vec3,
  tangent: Vec3,
  end: Vec3,
  stroke: StrokeOpts,
): ArcEntity | null {
  const T = normalize([tangent[0], tangent[1], 0]);
  if (len(T) < EPS) return null;

  const dx = start[0] - end[0];
  const dy = start[1] - end[1];
  const d2 = dx * dx + dy * dy;
  if (d2 < EPS * EPS) return null;

  // Deux normales ±perp(T)
  const normals: Vec3[] = [
    [-T[1], T[0], 0],
    [T[1], -T[0], 0],
  ];

  let best: ArcEntity | null = null;
  let bestSpan = Infinity;

  for (const N of normals) {
    const pqN = dx * N[0] + dy * N[1];
    if (Math.abs(pqN) < EPS) continue;
    // |start + t N - end| = |t|  →  t = -|P-Q|² / (2 (P-Q)·N)
    const t = -d2 / (2 * pqN);
    if (Math.abs(t) < EPS) continue;
    const r = Math.abs(t);
    const center: Vec3 = [start[0] + t * N[0], start[1] + t * N[1], start[2]];

    const ux = (start[0] - center[0]) / r;
    const uy = (start[1] - center[1]) / r;
    // Tangentes CCW / CW sur le cercle
    const dotCcw = -uy * T[0] + ux * T[1];
    const dotCw = uy * T[0] - ux * T[1];

    let clockwise: boolean;
    if (dotCcw >= dotCw) {
      if (dotCcw < 0.995) continue;
      clockwise = false;
    } else {
      if (dotCw < 0.995) continue;
      clockwise = true;
    }

    const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
    const arc = createArcEntity(center, r, a0, a1, stroke, { clockwise });
    const span = Math.abs(arc.endAngle - arc.startAngle);
    // Éviter le tour complet ou quasi-nul
    if (span > 1e-4 && span < Math.PI * 2 - 1e-4 && span < bestSpan) {
      bestSpan = span;
      best = arc;
    }
  }

  return best;
}

/** Centre du cercle circonscrit (plan XY). null si colinéaires. */
export function circumcenter2d(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const cx = c[0];
  const cy = c[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-12) return null;

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
  const z = (a[2] + b[2] + c[2]) / 3;
  return [ux, uy, z];
}

/** Point final d'un arc. */
export function arcEndPoint(arc: ArcEntity): Vec3 {
  return [
    arc.center[0] + arc.radius * Math.cos(arc.endAngle),
    arc.center[1] + arc.radius * Math.sin(arc.endAngle),
    arc.center[2],
  ];
}

/** Point de départ d'un arc. */
export function arcStartPoint(arc: ArcEntity): Vec3 {
  return [
    arc.center[0] + arc.radius * Math.cos(arc.startAngle),
    arc.center[1] + arc.radius * Math.sin(arc.startAngle),
    arc.center[2],
  ];
}

/**
 * Tangente unitaire au point final, dans le sens de parcours de l'arc.
 * (Pour enchaîner des arcs G1.)
 */
export function arcEndTangent(arc: ArcEntity): Vec3 {
  const a = arc.endAngle;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // endAngle >= startAngle → sens CCW
  if (arc.endAngle >= arc.startAngle) {
    return normalize([-uy, ux, 0]);
  }
  return normalize([uy, -ux, 0]);
}

/** Échantillonne un arc en points 3D (pour rendu / preview). */
export function sampleArc(arc: ArcEntity, segments = 64): Vec3[] {
  const span = arc.endAngle - arc.startAngle;
  // Assez de points même pour un petit balayage (preview fluide)
  const n = Math.max(24, Math.ceil((segments * Math.abs(span)) / (Math.PI * 2)));
  const pts: Vec3[] = [];
  const [cx, cy, cz] = arc.center;
  const r = arc.radius;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = arc.startAngle + span * t;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]);
  }
  return pts;
}

/** Échantillonne un cercle complet (boucle fermée). */
export function sampleCircle(circle: CircleEntity, segments = 64): Vec3[] {
  const pts: Vec3[] = [];
  const [cx, cy, cz] = circle.center;
  const r = circle.radius;
  const n = Math.max(16, segments);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]);
  }
  return pts;
}

/** Cercle provisoire centre + point sur le rayon (preview). */
export function sampleCircleFromCenterPoint(
  center: Vec3,
  onCircle: Vec3,
  segments = 64,
): Vec3[] | null {
  const r = dist(center, onCircle);
  if (r < EPS) return null;
  return sampleCircle(
    {
      id: 'tmp',
      kind: 'circle',
      layer: DRAW_LAYER,
      center,
      radius: r,
      normal: v3(0, 0, 1),
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    segments,
  );
}

export function lineLength(line: LineEntity): number {
  return dist(line.start, line.end);
}

export function isDegenerateLine(start: Vec3, end: Vec3): boolean {
  return len(sub(end, start)) < EPS;
}

export function isDegenerateArc(center: Vec3, start: Vec3): boolean {
  return dist(center, start) < EPS;
}

export function isDegenerateRadius(center: Vec3, edge: Vec3): boolean {
  return dist(center, edge) < EPS;
}
