/**
 * /paral — copie parallèle d’un élément **désigné** (pas sélectionné).
 *
 * - Mode libre : désigner → clic de placement (offset // depuis la géométrie de réf.)
 * - Mode D… : désigner → **2ᵉ clic = sens uniquement** ; les valeurs dx/dy/dz
 *   sont des **distances** (toujours positives). Ex. `/paral dx 1.4` :
 *   1) désigner l’objet  2) clic à gauche ou à droite → copie à ±1.4 m sur X.
 *
 * Murs (mode libre) : distance mesurée depuis le trait le plus proche du clic
 * (évite de coller le nouveau mur dans l’épaisseur de l’ancien).
 */

import { cloneEntity, translateEntity } from './entityOps';
import { dist } from './geometry';
import type {
  ArcEntity,
  CircleEntity,
  Entity,
  HelperLineEntity,
  LineEntity,
  Vec3,
  WallEntity,
} from './types';
import { leftNormalFromDir, wallEntityStrokes } from './walls';

const EPS = 1e-9;

export type Designatable =
  | LineEntity
  | ArcEntity
  | CircleEntity
  | WallEntity
  | HelperLineEntity;

export interface DesignationHit {
  entity: Designatable;
  point: Vec3;
  dist: number;
}

export type ParalDelta = { dx: number; dy: number; dz: number };

/** Parse « DX 1,2 » · « dxy 1.5,3 » · « DXY 3.2,4,6,7 » · etc. */
export function parseParalDeltas(args: string[]):
  | { ok: true; deltas: ParalDelta[] }
  | { ok: false; error: string } {
  if (args.length === 0) {
    return { ok: true, deltas: [] };
  }

  const token = args[0]!.trim();
  const m = /^d([xyz]+)$/i.exec(token);
  if (!m) {
    return {
      ok: false,
      error:
        'Usage : /paral  ·  /paral dx 1,2  ·  /paral dxy 1.5,3  ·  /paral dy 2.7  ·  /paral dxyz 1,2,3',
    };
  }

  const axesRaw = m[1]!.toLowerCase();
  // Axes uniques, ordre d’apparition (x puis y puis z si répétés → une seule fois)
  const axes: Array<'x' | 'y' | 'z'> = [];
  for (const ch of axesRaw) {
    if ((ch === 'x' || ch === 'y' || ch === 'z') && !axes.includes(ch)) {
      axes.push(ch);
    }
  }
  if (axes.length === 0) {
    return { ok: false, error: 'Axes invalides après D (utilisez x, y, z).' };
  }

  // Nombres : reste des args + virgules
  const numStr = args
    .slice(1)
    .join(' ')
    .replace(/,/g, ' ')
    .trim();
  if (!numStr) {
    return {
      ok: false,
      error: `Indiquez des distances après ${token} (ex. /paral ${token} 1,2).`,
    };
  }
  const parts = numStr.split(/\s+/).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p.replace(',', '.'));
    if (!Number.isFinite(n)) {
      return { ok: false, error: `Nombre invalide : « ${p} »` };
    }
    nums.push(n);
  }

  const dim = axes.length;
  if (nums.length % dim !== 0) {
    return {
      ok: false,
      error: `Attendu un multiple de ${dim} valeur(s) pour ${token.toUpperCase()} (reçu ${nums.length}).`,
    };
  }

  const deltas: ParalDelta[] = [];
  for (let i = 0; i < nums.length; i += dim) {
    const d: ParalDelta = { dx: 0, dy: 0, dz: 0 };
    for (let k = 0; k < dim; k++) {
      const ax = axes[k]!;
      // Distances uniquement — le signe vient du 2ᵉ clic (sens)
      const v = Math.abs(nums[i + k]!);
      if (ax === 'x') d.dx = v;
      else if (ax === 'y') d.dy = v;
      else d.dz = v;
    }
    deltas.push(d);
  }
  return { ok: true, deltas };
}

/** Élément désignable le plus proche du clic (dans maxDist). */
export function findNearestDesignatable(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): DesignationHit | null {
  if (maxDist <= 0) return null;
  let best: DesignationHit | null = null;

  const consider = (entity: Designatable, point: Vec3, d: number) => {
    if (d > maxDist) return;
    if (!best || d < best.dist) best = { entity, point, dist: d };
  };

  for (const e of entities) {
    if (e.kind === 'line') {
      const near = closestOnSegment(e.start, e.end, click);
      consider(e, near.point, near.dist);
    } else if (e.kind === 'arc') {
      const near = closestOnArc(e, click);
      if (near) consider(e, near.point, near.dist);
    } else if (e.kind === 'circle') {
      const near = closestOnCircle(e, click);
      consider(e, near.point, near.dist);
    } else if (e.kind === 'helper') {
      const near = closestOnInfinite(e.origin, e.direction, click);
      consider(e, near.point, near.dist);
    } else if (e.kind === 'wall') {
      const near = closestOnWall(e, click);
      if (near) consider(e, near.point, near.dist);
    }
  }

  return best;
}

/**
 * Translation pour une copie parallèle en mode libre (2ᵉ clic = côté + distance).
 */
export function freeParalTranslation(
  entity: Designatable,
  place: Vec3,
  designateClick: Vec3,
): Vec3 | null {
  if (entity.kind === 'wall') {
    return wallClearanceTranslation(entity, designateClick, place, null);
  }
  if (entity.kind === 'line') {
    return lineOffsetTranslation(entity.start, entity.end, place);
  }
  if (entity.kind === 'helper') {
    return helperOffsetTranslation(entity, place);
  }
  if (entity.kind === 'arc' || entity.kind === 'circle') {
    // Même objet déplacé : translation du centre vers le clic (radial)
    // → copie concentrée / décalée radialement
    return radialArcTranslation(entity, place);
  }
  return null;
}

/**
 * Signe des axes actifs d’après le 2ᵉ clic (sens), relatif au clic de désignation.
 * `null` si un axe requis n’a pas de sens clair (clic trop aligné).
 */
export function paralDirectionSigns(
  designateClick: Vec3,
  directionClick: Vec3,
  deltas: ParalDelta[],
): { sx: number; sy: number; sz: number } | null {
  let needX = false;
  let needY = false;
  let needZ = false;
  for (const d of deltas) {
    if (Math.abs(d.dx) > EPS) needX = true;
    if (Math.abs(d.dy) > EPS) needY = true;
    if (Math.abs(d.dz) > EPS) needZ = true;
  }
  const sx = Math.sign(directionClick[0] - designateClick[0]);
  const sy = Math.sign(directionClick[1] - designateClick[1]);
  const sz = Math.sign(directionClick[2] - designateClick[2]);
  if ((needX && sx === 0) || (needY && sy === 0) || (needZ && sz === 0)) {
    return null;
  }
  return {
    sx: needX ? sx : 0,
    sy: needY ? sy : 0,
    sz: needZ ? sz : 0,
  };
}

/**
 * Translations pour mode D… (un vecteur par delta).
 * Les composants de `deltas` sont des **distances** ; le 2ᵉ clic (`directionClick`)
 * fixe uniquement le sens sur chaque axe (gauche/droite, haut/bas, etc.).
 *
 * Murs : même vecteur d’axe, mais la distance est un **jeu** depuis le trait
 * le plus proche du clic de désignation (évite de coller dans l’épaisseur).
 */
export function deltaParalTranslations(
  entity: Designatable,
  designateClick: Vec3,
  directionClick: Vec3,
  deltas: ParalDelta[],
): Vec3[] | null {
  const signs = paralDirectionSigns(designateClick, directionClick, deltas);
  if (!signs) return null;

  return deltas.map((d) => {
    const pure: Vec3 = [
      Math.abs(d.dx) * signs.sx,
      Math.abs(d.dy) * signs.sy,
      Math.abs(d.dz) * signs.sz,
    ];
    if (entity.kind === 'wall') {
      // G = longueur du delta signé ; côté = direction du 2ᵉ clic
      const G = Math.hypot(pure[0], pure[1], pure[2]);
      if (G < EPS) return pure;
      const place: Vec3 = [
        designateClick[0] + pure[0],
        designateClick[1] + pure[1],
        designateClick[2] + pure[2],
      ];
      const t = wallClearanceTranslation(entity, designateClick, place, G);
      return t ?? pure;
    }
    return pure;
  });
}

/** Clone + translate ; renvoie les nouvelles entités. */
export function makeParalCopies(
  entity: Designatable,
  translations: Vec3[],
): Entity[] {
  const out: Entity[] = [];
  for (const t of translations) {
    if (Math.hypot(t[0], t[1], t[2]) < EPS) continue;
    out.push(translateEntity(cloneEntity(entity), t[0], t[1], t[2]));
  }
  return out;
}

// —— Geometry helpers ——

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

function closestOnInfinite(
  origin: Vec3,
  direction: Vec3,
  click: Vec3,
): { point: Vec3; dist: number } {
  const dx = direction[0];
  const dy = direction[1];
  const dz = direction[2];
  const L2 = dx * dx + dy * dy + dz * dz;
  if (L2 < EPS) {
    return { point: [...origin] as Vec3, dist: dist(origin, click) };
  }
  const t =
    ((click[0] - origin[0]) * dx +
      (click[1] - origin[1]) * dy +
      (click[2] - origin[2]) * dz) /
    L2;
  const p: Vec3 = [
    origin[0] + t * dx,
    origin[1] + t * dy,
    origin[2] + t * dz,
  ];
  return { point: p, dist: dist(p, click) };
}

function closestOnArc(
  arc: ArcEntity,
  click: Vec3,
): { point: Vec3; dist: number } | null {
  if (arc.radius < EPS) return null;
  const ang = Math.atan2(click[1] - arc.center[1], click[0] - arc.center[0]);
  // Clamp angle to arc span
  const a = clampAngleToArc(ang, arc.startAngle, arc.endAngle);
  const p: Vec3 = [
    arc.center[0] + arc.radius * Math.cos(a),
    arc.center[1] + arc.radius * Math.sin(a),
    arc.center[2],
  ];
  return { point: p, dist: dist(p, click) };
}

function closestOnCircle(
  c: CircleEntity,
  click: Vec3,
): { point: Vec3; dist: number } {
  const dx = click[0] - c.center[0];
  const dy = click[1] - c.center[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) {
    const p: Vec3 = [c.center[0] + c.radius, c.center[1], c.center[2]];
    return { point: p, dist: Math.abs(c.radius) };
  }
  const s = c.radius / L;
  const p: Vec3 = [c.center[0] + dx * s, c.center[1] + dy * s, c.center[2]];
  return { point: p, dist: dist(p, click) };
}

function closestOnWall(
  wall: WallEntity,
  click: Vec3,
): { point: Vec3; dist: number; strokeIndex: number } | null {
  const strokes = wallEntityStrokes(wall, 32);
  let best: { point: Vec3; dist: number; strokeIndex: number } | null = null;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i]!;
    const pts = s.points;
    if (pts.length < 2) continue;
    // Polyligne (arc) : segments
    for (let j = 0; j + 1 < pts.length; j++) {
      const near = closestOnSegment(pts[j]!, pts[j + 1]!, click);
      if (!best || near.dist < best.dist) {
        best = { point: near.point, dist: near.dist, strokeIndex: i };
      }
    }
  }
  return best;
}

function clampAngleToArc(ang: number, a0: number, a1: number): number {
  const TWO = Math.PI * 2;
  let a = ang;
  const span = a1 - a0;
  if (span >= 0) {
    while (a < a0) a += TWO;
    while (a >= a0 + TWO) a -= TWO;
    if (a < a0) return a0;
    if (a > a1) {
      // plus proche extrémité
      const d0 = Math.abs(a0 - (a - TWO));
      const d1 = Math.abs(a - a1);
      return d0 < d1 ? a0 : a1;
    }
    return a;
  }
  while (a > a0) a -= TWO;
  while (a <= a0 - TWO) a += TWO;
  if (a > a0) return a0;
  if (a < a1) {
    const d0 = Math.abs(a0 - a);
    const d1 = Math.abs(a - a1);
    return d0 < d1 ? a0 : a1;
  }
  return a;
}

function lineOffsetTranslation(start: Vec3, end: Vec3, place: Vec3): Vec3 | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) return null;
  // normale gauche 2D
  const nx = -dy / L;
  const ny = dx / L;
  // distance signée du place à la droite
  const sx = place[0] - start[0];
  const sy = place[1] - start[1];
  const signed = sx * nx + sy * ny;
  if (Math.abs(signed) < EPS) return null;
  return [nx * signed, ny * signed, 0];
}

function helperOffsetTranslation(h: HelperLineEntity, place: Vec3): Vec3 | null {
  const near = closestOnInfinite(h.origin, h.direction, place);
  const vx = place[0] - near.point[0];
  const vy = place[1] - near.point[1];
  const vz = place[2] - near.point[2];
  if (Math.hypot(vx, vy, vz) < EPS) return null;
  return [vx, vy, vz];
}

/**
 * Arc / cercle : translation radiale pour que le point le plus proche
 * du centre vers `place` se retrouve sur le cercle/arc déplacé.
 * = décalage du centre le long de la direction centre→place de (dist - R).
 */
function radialArcTranslation(
  e: ArcEntity | CircleEntity,
  place: Vec3,
): Vec3 | null {
  const dx = place[0] - e.center[0];
  const dy = place[1] - e.center[1];
  const L = Math.hypot(dx, dy);
  if (L < EPS) return null;
  // Point sur le cercle dans la direction du clic
  const ux = dx / L;
  const uy = dy / L;
  // On veut le cercle parallèle (concentrique) passant par place → ΔR = L - R
  // Centre reste, rayon change — mais cloneEntity garde le rayon.
  // Pour garder le même rayon, on translate le centre de (L - R) dans la direction :
  // nouveau centre à distance R de place → T = place_dir * (L - R)
  // Wait: place is on new circle: |place - (c+T)| = R ⇒ |place - c - T| = R
  // T = (L-R) * u ⇒ |L*u - (L-R)*u| = |R*u| = R ✓
  const t = L - e.radius;
  if (Math.abs(t) < EPS) return null;
  return [ux * t, uy * t, 0];
}

/**
 * Mur : translation pour un jeu G depuis la face la plus proche.
 * @param fixedG si fourni (mode D), distance imposée ; sinon = dist(face, place)
 */
function wallClearanceTranslation(
  wall: WallEntity,
  designateClick: Vec3,
  place: Vec3,
  fixedG: number | null,
): Vec3 | null {
  const near = closestOnWall(wall, designateClick);
  if (!near) return null;

  const strokes = wallEntityStrokes(wall, 16);
  if (strokes.length === 0) return null;

  // Direction de la base (line) ou tangent approx
  let dir: Vec3;
  if (wall.path === 'line') {
    dir = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1], 0];
  } else {
    // arc : tangent moyenne via start→end chord
    dir = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1], 0];
  }
  const n = leftNormalFromDir(dir);
  if (Math.hypot(n[0], n[1]) < EPS) return null;

  // Positions des traits le long de n (échantillon milieu du 1er segment)
  const strokePos: number[] = [];
  for (const s of strokes) {
    const p0 = s.points[0]!;
    const p1 = s.points[Math.min(1, s.points.length - 1)]!;
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    strokePos.push(mx * n[0] + my * n[1]);
  }
  const refPos =
    near.point[0] * n[0] + near.point[1] * n[1];

  // Côté demandé : vers place
  const placeAlong =
    place[0] * n[0] + place[1] * n[1];
  let side = Math.sign(placeAlong - refPos);
  if (Math.abs(side) < EPS) {
    // Si place quasi sur la face, utiliser le delta fixe le long de n
    if (fixedG !== null) {
      // choisir le côté du designateClick par rapport au centre du mur
      const mid =
        strokePos.reduce((a, b) => a + b, 0) / Math.max(1, strokePos.length);
      side = Math.sign(refPos - mid) || 1;
    } else {
      return null;
    }
  }

  const outward: Vec3 = [n[0] * side, n[1] * side, 0];
  // Positions le long d'outward (strokePos est le long de n)
  const alongOut = strokePos.map((p) => p * side);
  const refAlong = refPos * side;
  const backAlong = Math.min(...alongOut);
  const G =
    fixedG !== null
      ? Math.abs(fixedG)
      : Math.hypot(place[0] - near.point[0], place[1] - near.point[1]);
  if (G < EPS && fixedG === null) return null;

  // T = outward * (refAlong - backAlong + G)
  const amount = refAlong - backAlong + G;
  // also handle Z from place if free
  const dz =
    fixedG === null ? place[2] - near.point[2] : 0;

  return [outward[0] * amount, outward[1] * amount, dz];
}
