/**
 * Géométrie des murs multi-traits (offsets en unités monde, plan XY).
 *
 * Jonctions linéaires : offset de polyligne.
 * Chaque trait reste sur la droite parallèle à son segment de base
 * et s'arrête à l'intersection avec le trait équivalent du segment voisin.
 */

import {
  arcEndPoint,
  arcEndTangent,
  arcStartPoint,
  sampleArc,
} from './drawing';
import { add, dist, normalize, scale, sub, v3 } from './geometry';
import type {
  ArcEntity,
  Entity,
  JonctionStrategyId,
  LineStyleId,
  Vec3,
  WallEntity,
  WallLineDef,
  WallSegArc,
  WallSegLine,
  WallSegment,
  WallStrokeGeom,
  WallStyle,
} from './types';
export type { JonctionStrategyId } from './types';
import { layerPriorityOf, wallLineJoinPriority } from './wallLayerCatalog';

const EPS = 1e-9;
/** Tolérance de coïncidence des extrémités (m — ~5 mm). */
export const WALL_JOIN_TOL = 0.005;
let seq = 0;

export const JONCTION_STRATEGIES: readonly JonctionStrategyId[] = [
  'first-hit',
  'first-hit-cover',
  'l-pair-stem',
  'max-t',
] as const;

export const JONCTION_STRATEGY_LABELS: Record<JonctionStrategyId, string> = {
  'first-hit': '1ʳᵉ rencontre',
  'first-hit-cover': '1ʳᵉ + cover',
  'l-pair-stem': 'L + pied',
  'max-t': 'enveloppe max',
};

const JONCTION_PREFS_KEY = 'grokcad.jonctionPrefs';

export type JonctionPrefEntry = {
  signature: string;
  solutionId: JonctionStrategyId;
};

export function loadJonctionPrefs(): JonctionPrefEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(JONCTION_PREFS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is JonctionPrefEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as JonctionPrefEntry).signature === 'string' &&
        typeof (e as JonctionPrefEntry).solutionId === 'string' &&
        (JONCTION_STRATEGIES as readonly string[]).includes(
          (e as JonctionPrefEntry).solutionId,
        ),
    );
  } catch {
    return [];
  }
}

export function saveJonctionPref(
  signature: string,
  solutionId: JonctionStrategyId,
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const prefs = loadJonctionPrefs().filter((p) => p.signature !== signature);
    prefs.unshift({ signature, solutionId });
    // garder au plus 40 signatures
    localStorage.setItem(
      JONCTION_PREFS_KEY,
      JSON.stringify(prefs.slice(0, 40)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

/** Ordre de cycle : préférence mémorisée en premier, puis le reste. */
export function orderedJonctionStrategies(
  signature: string | null,
): JonctionStrategyId[] {
  const preferred =
    signature != null
      ? loadJonctionPrefs().find((p) => p.signature === signature)?.solutionId
      : undefined;
  if (!preferred) return [...JONCTION_STRATEGIES];
  return [
    preferred,
    ...JONCTION_STRATEGIES.filter((s) => s !== preferred),
  ];
}

export function nextWallId(prefix = 'wall'): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export function nextWallStyleId(): string {
  return nextWallId('wstyle');
}

/** Trait de mur : points + style. */
export interface WallStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
  offset: number;
}

/** Normale « gauche » d'une direction dans le plan XY. */
export function leftNormalFromDir(dir: Vec3): Vec3 {
  const d = normalize(dir);
  return normalize(v3(-d[1], d[0], 0));
}

export function leftNormalXY(a: Vec3, b: Vec3): Vec3 {
  return leftNormalFromDir(sub(b, a));
}

/** Intersection 2D de deux droites (o1 + t·d1) ∩ (o2 + s·d2). Null si parallèles. */
export function lineIntersect2d(
  o1: Vec3,
  d1: Vec3,
  o2: Vec3,
  d2: Vec3,
): Vec3 | null {
  const a = normalize(d1);
  const b = normalize(d2);
  // cross2d(a,b) = a.x*b.y - a.y*b.x
  const denom = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(denom) < 1e-12) return null;

  // t = cross2d(o2-o1, b) / denom
  const ox = o2[0] - o1[0];
  const oy = o2[1] - o1[1];
  const t = (ox * b[1] - oy * b[0]) / denom;
  const z = o1[2];
  return [o1[0] + a[0] * t, o1[1] + a[1] * t, z];
}

/**
 * Point d'onglet au coin C : intersection des deux droites
 * parallèles aux segments (dirIn, dirOut) à la distance signée `off`.
 * Les deux droites sont :
 *   L_in  : (C + nIn·off)  + t · dirIn
 *   L_out : (C + nOut·off) + s · dirOut
 */
export function miterCornerPoint(
  corner: Vec3,
  dirIn: Vec3,
  dirOut: Vec3,
  off: number,
): Vec3 {
  const dIn = normalize(dirIn);
  const dOut = normalize(dirOut);
  if (xyLen(dIn) < EPS) return offsetPoint(corner, dOut, off);
  if (xyLen(dOut) < EPS) return offsetPoint(corner, dIn, off);

  const nIn = leftNormalFromDir(dIn);
  const nOut = leftNormalFromDir(dOut);
  const pIn = add(corner, scale(nIn, off));
  const pOut = add(corner, scale(nOut, off));

  const hit = lineIntersect2d(pIn, dIn, pOut, dOut);
  if (!hit) {
    // Parallèles / colinéaires : offset simple sur le segment sortant
    return offsetPoint(corner, dOut, off);
  }
  return [hit[0], hit[1], corner[2]];
}

function offsetPoint(corner: Vec3, dir: Vec3, off: number): Vec3 {
  const n = leftNormalFromDir(dir);
  return add(corner, scale(n, off));
}

function xyLen(d: Vec3): number {
  return Math.hypot(d[0], d[1]);
}

export interface LinearWallStrokeOpts {
  /** Direction du segment précédent (vers le coin start). */
  joinStartDir?: Vec3 | null;
  /** Direction du segment suivant (depuis le coin end). */
  joinEndDir?: Vec3 | null;
}

/**
 * Offset simple d'un segment (sans joint) — fallback / preview isolé.
 * Avec join*Dir : extrémités = intersections des parallèles (reste sur la parallèle).
 */
export function linearWallStrokes(
  start: Vec3,
  end: Vec3,
  lines: readonly WallLineDef[],
  flip: boolean,
  opts?: LinearWallStrokeOpts,
): WallStroke[] {
  if (dist(start, end) < EPS || lines.length === 0) return [];
  const curDir = normalize(sub(end, start));
  if (xyLen(curDir) < EPS) return [];

  const side = flip ? -1 : 1;
  const n = leftNormalFromDir(curDir);
  const joinStart = opts?.joinStartDir ?? null;
  const joinEnd = opts?.joinEndDir ?? null;

  return lines.map((ln) => {
    const o = ln.offset * side;
    // Les deux extrémités DOIVENT rester sur la droite (start + n*o) + t·curDir
    // = parallèle au segment de base.
    const simpleS: Vec3 = [start[0] + n[0] * o, start[1] + n[1] * o, start[2]];
    const simpleE: Vec3 = [end[0] + n[0] * o, end[1] + n[1] * o, end[2]];

    let s = simpleS;
    let e = simpleE;

    if (joinStart && xyLen(normalize(joinStart)) > EPS) {
      // Intersection parallèle courante ∩ parallèle du précédent
      const m = miterCornerPoint(start, joinStart, curDir, o);
      // Projeter sur la parallèle courante (sécurité numérique)
      s = projectOnLine(simpleS, curDir, m);
    }
    if (joinEnd && xyLen(normalize(joinEnd)) > EPS) {
      const m = miterCornerPoint(end, curDir, joinEnd, o);
      e = projectOnLine(simpleS, curDir, m);
    }

    return {
      points: [s, e],
      color: ln.color,
      lineWidth: ln.lineWidth,
      lineStyle: ln.lineStyle,
      offset: ln.offset,
    };
  });
}

/** Projette un point sur la droite origin + t·dir (plan XY). */
function projectOnLine(origin: Vec3, dir: Vec3, p: Vec3): Vec3 {
  const d = normalize(dir);
  const t = (p[0] - origin[0]) * d[0] + (p[1] - origin[1]) * d[1];
  return [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2]];
}

/**
 * Offset d'une polyligne ouverte : un point miteré par sommet.
 * Le segment i de l'offset (M_i → M_{i+1}) est colinéaire à la parallèle du segment base i.
 */
export function offsetPolylineOpen(poly: Vec3[], signedOffset: number): Vec3[] {
  const n = poly.length;
  if (n < 2) return [];
  const out: Vec3[] = new Array(n);

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      const d = normalize(sub(poly[1]!, poly[0]!));
      out[0] = offsetPoint(poly[0]!, d, signedOffset);
    } else if (i === n - 1) {
      const d = normalize(sub(poly[n - 1]!, poly[n - 2]!));
      out[n - 1] = offsetPoint(poly[n - 1]!, d, signedOffset);
    } else {
      const dIn = normalize(sub(poly[i]!, poly[i - 1]!));
      const dOut = normalize(sub(poly[i + 1]!, poly[i]!));
      // Intersection des deux parallèles — puis projection sur… les deux contiennent le miter.
      out[i] = miterCornerPoint(poly[i]!, dIn, dOut, signedOffset);
    }
  }
  return out;
}

/**
 * Offset d'une polyligne **fermée** : onglet à chaque sommet, y compris
 * entre le dernier et le premier segment (fermeture /pmur).
 *
 * `poly` = sommets [v0…vn] ; si vn ≈ v0 (anneau redondant), vn est retiré.
 * Retourne n+1 points (premier répété en fin) pour itérer n segments.
 */
export function offsetPolylineClosed(poly: Vec3[], signedOffset: number): Vec3[] {
  if (poly.length < 3) return offsetPolylineOpen(poly, signedOffset);

  let pts = poly.map((p) => [p[0], p[1], p[2]] as Vec3);
  // Anneau avec dernier = premier
  if (dist(pts[0]!, pts[pts.length - 1]!) <= WALL_JOIN_TOL) {
    pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 3) return offsetPolylineOpen(poly, signedOffset);

  const out: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const dIn = normalize(sub(cur, prev));
    const dOut = normalize(sub(next, cur));
    if (xyLen(dIn) < EPS || xyLen(dOut) < EPS) {
      const d = xyLen(dOut) >= EPS ? dOut : dIn;
      out[i] = offsetPoint(cur, d, signedOffset);
    } else {
      out[i] = miterCornerPoint(cur, dIn, dOut, signedOffset);
    }
  }
  // Fermer l’anneau pour l’itération segment par segment
  out.push([out[0]![0], out[0]![1], out[0]![2]]);
  return out;
}

/**
 * Mur en arc : chemin de référence = rayon R (offset 0).
 * r' = R - offset * side.
 */
export function arcWallStrokes(
  center: Vec3,
  radius: number,
  startAngle: number,
  endAngle: number,
  lines: readonly WallLineDef[],
  flip: boolean,
  segments = 64,
): WallStroke[] {
  if (radius < EPS || lines.length === 0) return [];
  const side = flip ? -1 : 1;
  const out: WallStroke[] = [];
  for (const ln of lines) {
    const r = radius - ln.offset * side;
    if (r < EPS) continue;
    const arc: ArcEntity = {
      id: 'tmp',
      kind: 'arc',
      layer: 'DESSIN',
      center: [center[0], center[1], center[2]],
      radius: r,
      startAngle,
      endAngle,
      normal: v3(0, 0, 1),
      color: ln.color,
      lineWidth: ln.lineWidth,
      lineStyle: ln.lineStyle,
    };
    out.push({
      points: sampleArc(arc, segments),
      color: ln.color,
      lineWidth: ln.lineWidth,
      lineStyle: ln.lineStyle,
      offset: ln.offset,
    });
  }
  return out;
}

/** Traits d'une entité mur (rendu / preview / snap). */
export function wallEntityStrokes(wall: WallEntity, segments = 64): WallStroke[] {
  // Géométrie précalculée (jonctions L/T/Y, y compris polymurs linéaires)
  if (wall.strokeGeom && wall.strokeGeom.length > 0) {
    const fromGeom = wall.strokeGeom.map((g) => ({
      points: [g.start, g.end] as Vec3[],
      color: g.color,
      lineWidth: g.lineWidth,
      lineStyle: g.lineStyle,
      offset: g.offset,
    }));
    // Polymur : arcs calculés à part (pas dans strokeGeom)
    if (wall.path === 'poly' && wall.segments?.length) {
      const arcs: WallStroke[] = [];
      for (const s of wall.segments) {
        if (s.type === 'arc') {
          arcs.push(
            ...arcWallStrokes(
              s.center,
              s.radius,
              s.startAngle,
              s.endAngle,
              wall.lines,
              wall.flip,
              segments,
            ),
          );
        }
      }
      return arcs.length > 0 ? [...fromGeom, ...arcs] : fromGeom;
    }
    return fromGeom;
  }

  if (wall.path === 'poly' && wall.segments && wall.segments.length > 0) {
    return polyWallStrokes(wall, segments);
  }

  if (wall.path === 'arc' && wall.center && wall.radius != null && wall.startAngle != null && wall.endAngle != null) {
    return arcWallStrokes(
      wall.center,
      wall.radius,
      wall.startAngle,
      wall.endAngle,
      wall.lines,
      wall.flip,
      segments,
    );
  }

  return linearWallStrokes(wall.start, wall.end, wall.lines, wall.flip);
}

// ─── Polymur (path === 'poly') ───────────────────────────────────────────────

export function createEmptyPolyWall(
  style: WallStyle,
  flip: boolean,
): WallEntity {
  return {
    id: nextWallId('pwall'),
    kind: 'wall',
    layer: 'MURS',
    styleId: style.id,
    path: 'poly',
    flip,
    lines: style.lines.map((l) => ({ ...l })),
    start: [0, 0, 0],
    end: [0, 0, 0],
    segments: [],
  };
}

export function wallSegLineFrom(start: Vec3, end: Vec3): WallSegLine {
  return {
    type: 'line',
    start: [start[0], start[1], start[2]],
    end: [end[0], end[1], end[2]],
  };
}

export function wallSegArcFrom(
  center: Vec3,
  radius: number,
  startAngle: number,
  endAngle: number,
): WallSegArc {
  return {
    type: 'arc',
    center: [center[0], center[1], center[2]],
    radius,
    startAngle,
    endAngle,
    normal: [0, 0, 1],
  };
}

export function wallSegFromArcEntity(arc: ArcEntity): WallSegArc {
  return wallSegArcFrom(arc.center, arc.radius, arc.startAngle, arc.endAngle);
}

/** Point de départ d’un segment de mur. */
export function wallSegStart(s: WallSegment): Vec3 {
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
    color: '#000',
    lineWidth: 1,
    lineStyle: 'plein',
  });
}

/** Point final d’un segment de mur. */
export function wallSegEnd(s: WallSegment): Vec3 {
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
    color: '#000',
    lineWidth: 1,
    lineStyle: 'plein',
  });
}

export function polyWallEnd(wall: WallEntity): Vec3 | null {
  if (!wall.segments || wall.segments.length === 0) return null;
  return wallSegEnd(wall.segments[wall.segments.length - 1]!);
}

export function polyWallStart(wall: WallEntity): Vec3 | null {
  if (!wall.segments || wall.segments.length === 0) return null;
  return wallSegStart(wall.segments[0]!);
}

/** Tangente au bout du dernier segment (pour /pmarct G1). */
export function polyWallEndTangent(wall: WallEntity): Vec3 | null {
  const segs = wall.segments;
  if (!segs || segs.length === 0) return null;
  const s = segs[segs.length - 1]!;
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
    color: '#000',
    lineWidth: 1,
    lineStyle: 'plein',
  });
}

export function appendWallSegment(
  wall: WallEntity,
  seg: WallSegment,
): WallEntity {
  const segments = [...(wall.segments ?? []), seg];
  const start = wallSegStart(segments[0]!);
  const end = wallSegEnd(segments[segments.length - 1]!);
  // Si on prolonge après une fermeture, le chemin n’est plus une simple boucle
  const stillClosed =
    Boolean(wall.closed) && dist(start, end) <= WALL_JOIN_TOL;
  return {
    ...wall,
    path: 'poly',
    segments,
    start,
    end,
    closed: stillClosed ? true : false,
    strokeGeom: undefined,
  };
}

/**
 * Rendu d’un polymur.
 * Segments linéaires : joints par **nœuds** (L, T, étoile) via miters multi-voisins.
 * Arcs : offset radial indépendant.
 */
export function polyWallStrokes(wall: WallEntity, arcSamples = 64): WallStroke[] {
  const segs = wall.segments;
  if (!segs || segs.length === 0 || wall.lines.length === 0) return [];

  const out: WallStroke[] = [];
  const linearSegs: CenterSeg[] = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.type === 'arc') {
      out.push(
        ...arcWallStrokes(
          s.center,
          s.radius,
          s.startAngle,
          s.endAngle,
          wall.lines,
          wall.flip,
          arcSamples,
        ),
      );
    } else {
      linearSegs.push({
        id: `${wall.id}#${i}`,
        start: s.start,
        end: s.end,
        lines: wall.lines,
        flip: wall.flip,
      });
    }
  }

  if (linearSegs.length > 0) {
    out.push(...strokesForCenterSegs(linearSegs, WALL_JOIN_TOL));
  }
  return out;
}

/** Segment de centre (mur simple ou morceau de polymur) pour calcul de joints. */
interface CenterSeg {
  id: string;
  start: Vec3;
  end: Vec3;
  lines: readonly WallLineDef[];
  flip: boolean;
  joinStrategy?: JonctionStrategyId;
}

function pickNodeStrategy(
  incidents: readonly { segIdx: number }[],
  segs: readonly CenterSeg[],
  fallback: JonctionStrategyId,
): JonctionStrategyId {
  const votes = new Map<JonctionStrategyId, number>();
  for (const inc of incidents) {
    const s = segs[inc.segIdx]?.joinStrategy;
    if (!s) continue;
    votes.set(s, (votes.get(s) ?? 0) + 1);
  }
  let best: JonctionStrategyId | null = null;
  let bestN = 0;
  for (const [id, n] of votes) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best ?? fallback;
}

/**
 * Fermé géométriquement : dernier point ≈ premier (indépendant du flag
 * `closed`, qui peut rester vrai après « Continuer » puis un nouveau segment).
 */
export function isPolyWallClosed(wall: WallEntity): boolean {
  if (!wall.segments || wall.segments.length < 2) return false;
  const a = polyWallStart(wall);
  const b = polyWallEnd(wall);
  if (!a || !b) return false;
  return dist(a, b) <= WALL_JOIN_TOL;
}

// ─── Joints par nœuds (L, T, étoile) ─────────────────────────────────────────

/** Clustering d’extrémités par union-find (tolérance réelle, pas de grille). */
function clusterPoints(
  points: Vec3[],
  tol: number,
): { rep: number[]; centroids: Vec3[] } {
  const n = points.length;
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let p = i;
    while (parent[p] !== p) p = parent[p]!;
    let x = i;
    while (parent[x] !== x) {
      const nx = parent[x]!;
      parent[x] = p;
      x = nx;
    }
    return p;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(points[i]!, points[j]!) <= tol) unite(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }
  const rep = new Array<number>(n);
  const centroids: Vec3[] = [];
  let ci = 0;
  for (const idxs of groups.values()) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const i of idxs) {
      sx += points[i]![0];
      sy += points[i]![1];
      sz += points[i]![2];
      rep[i] = ci;
    }
    const m = idxs.length;
    centroids.push([sx / m, sy / m, sz / m]);
    ci += 1;
  }
  return { rep, centroids };
}

/**
 * Intersection des parallèles réelles de deux murs (offsets signés + dirs start→end).
 * Source de vérité pour un onglet multi-traits (chaque couche se recoupe).
 */
function intersectWallParallels(
  corner: Vec3,
  dirA: Vec3,
  offA: number,
  dirB: Vec3,
  offB: number,
): Vec3 | null {
  const dA = normalize(dirA);
  const dB = normalize(dirB);
  if (xyLen(dA) < EPS || xyLen(dB) < EPS) return null;
  const nA = leftNormalFromDir(dA);
  const nB = leftNormalFromDir(dB);
  const pA = add(corner, scale(nA, offA));
  const pB = add(corner, scale(nB, offB));
  return lineIntersect2d(pA, dA, pB, dB);
}

/**
 * Intersection couche o entre deux CenterSeg (offsets signés).
 */
function segsIntersectAtOffset(
  a: CenterSeg,
  b: CenterSeg,
  rawOffA: number,
  rawOffB: number,
  corner: Vec3,
): Vec3 | null {
  const oA = rawOffA * (a.flip ? -1 : 1);
  const oB = rawOffB * (b.flip ? -1 : 1);
  const dirA = normalize(sub(a.end, a.start));
  const dirB = normalize(sub(b.end, b.start));
  if (xyLen(dirA) < EPS || xyLen(dirB) < EPS) return null;
  return intersectWallParallels(corner, dirA, oA, dirB, oB);
}

/**
 * Rang d’une couche parmi celles de même priorité (tri par offset croissant).
 * Sert à apparier « 1ʳᵉ prio-5 » ↔ « 1ʳᵉ prio-5 » même si les offsets diffèrent.
 */
function rankAmongPriority(
  lines: readonly WallLineDef[],
  line: WallLineDef,
): number {
  // Priorité de **raccord** = matériaux adjacents (bande), pas le trait seul
  const prio = wallLineJoinPriority(lines, line);
  const same = lines
    .filter((l) => wallLineJoinPriority(lines, l) === prio)
    .slice()
    .sort((a, b) => a.offset - b.offset);
  return same.findIndex((l) => Math.abs(l.offset - line.offset) < 1e-9);
}

/**
 * Trouve le trait partenaire sur un autre mur (même prio de raccord + rang).
 * La prio de raccord tient compte des **bandes** partagées (ex. face béton
 * = fin enduit + début structure → prio 1).
 */
function findPartnerLayer(
  myLines: readonly WallLineDef[],
  myLn: WallLineDef,
  partnerLines: readonly WallLineDef[],
): WallLineDef | undefined {
  const prio = wallLineJoinPriority(myLines, myLn);
  const partners = partnerLines
    .filter((l) => wallLineJoinPriority(partnerLines, l) === prio)
    .slice()
    .sort((a, b) => a.offset - b.offset);
  if (partners.length === 0) {
    return partnerLines.find((l) => Math.abs(l.offset - myLn.offset) < 1e-6);
  }
  const rank = rankAmongPriority(myLines, myLn);
  if (rank >= 0 && rank < partners.length) return partners[rank]!;
  if (partners.length === 1) return partners[0]!;
  let best = partners[0]!;
  let bestD = Math.abs(best.offset - myLn.offset);
  for (const p of partners) {
    const d = Math.abs(p.offset - myLn.offset);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Résolveur de nœud multi-murs (L + T/Y + croix) — une couche = une polyligne.
 *
 * RÈGLES UTILISATEUR (BIM type Revit / ArchiCAD) :
 * 1. Chaque trait reste **strictement parallèle** à sa base.
 * 2. Priorité 1 (structure) > 2 > … > 5 (finition). Une couche de prio P :
 *    - rejoint sa correspondante de même priorité (rang) en traversant les
 *      couches de priorité **plus faible** (nombre > P) ;
 *    - **ne traverse pas** une couche de priorité égale ou supérieure
 *      (nombre ≤ P) : 1ʳᵉ rencontre = stop (efface les stubs).
 * 3. Stratégies (cycle Y/N en T/Y) — voir JONCTION.md :
 *    - first-hit (défaut) : min-t, cover seulement si joint même priorité
 *    - first-hit-cover : min-t, cover toujours
 *    - l-pair-stem : préfère partenaire le + perpendiculaire (miter L)
 *    - max-t : hit le plus loin (enveloppe)
 */
function resolveStarNodeStrokes(
  segs: readonly CenterSeg[],
  nodeIncidents: { segIdx: number; which: 'start' | 'end'; leaveDir: Vec3 }[],
  corner: Vec3,
  byId: Map<string, WallStroke[]>,
  strategy: JonctionStrategyId = 'first-hit',
): void {
  if (nodeIncidents.length < 2) return;

  /** Rayon de recherche autour du coin (m). */
  const nearR = 1.5;
  const preferMaxT = strategy === 'max-t';
  const coverAlways =
    strategy === 'first-hit-cover' || strategy === 'max-t';
  const preferPerp = strategy === 'l-pair-stem';

  /**
   * Place le bout nœud en projetant `pt` sur la parallèle du trait.
   * Préserve l’extrémité opposée (autre coin du même mur).
   */
  const setEndOnParallel = (
    seg: CenterSeg,
    which: 'start' | 'end',
    rawOff: number,
    pt: Vec3,
  ) => {
    const strokes = byId.get(seg.id);
    if (!strokes) return;
    const st = strokes.find((s) => Math.abs(s.offset - rawOff) < 1e-9);
    if (!st) return;

    const baseDir = normalize(sub(seg.end, seg.start));
    if (xyLen(baseDir) < EPS) return;
    const side = seg.flip ? -1 : 1;
    const n = leftNormalFromDir(baseDir);
    const o = rawOff * side;
    const origin: Vec3 = [
      seg.start[0] + n[0]! * o,
      seg.start[1] + n[1]! * o,
      seg.start[2],
    ];
    const existingFar =
      which === 'start'
        ? st.points[st.points.length - 1]!
        : st.points[0]!;
    const farBase = which === 'start' ? seg.end : seg.start;
    const simpleFar: Vec3 = [
      farBase[0] + n[0]! * o,
      farBase[1] + n[1]! * o,
      farBase[2],
    ];
    const farPt = existingFar
      ? projectOnLine(origin, baseDir, existingFar)
      : simpleFar;
    const p = projectOnLine(origin, baseDir, pt);
    const idx = strokes.indexOf(st);
    if (idx < 0) return;
    if (which === 'start') {
      strokes[idx] = { ...st, points: [p, farPt] };
    } else {
      strokes[idx] = { ...st, points: [farPt, p] };
    }
  };

  const simpleNodeEnd = (
    seg: CenterSeg,
    which: 'start' | 'end',
    rawOff: number,
  ): Vec3 => {
    const baseDir = normalize(sub(seg.end, seg.start));
    const side = seg.flip ? -1 : 1;
    const n = leftNormalFromDir(baseDir);
    const o = rawOff * side;
    const nodePt = which === 'start' ? seg.start : seg.end;
    return [nodePt[0] + n[0]! * o, nodePt[1] + n[1]! * o, nodePt[2]];
  };

  /** t le long de far → nœud (et au-delà) sur la parallèle. */
  const paramFromFar = (
    seg: CenterSeg,
    which: 'start' | 'end',
    rawOff: number,
    pt: Vec3,
  ): number => {
    const baseDir = normalize(sub(seg.end, seg.start));
    if (xyLen(baseDir) < EPS) return 0;
    const side = seg.flip ? -1 : 1;
    const n = leftNormalFromDir(baseDir);
    const o = rawOff * side;
    const farBase = which === 'start' ? seg.end : seg.start;
    const farOff: Vec3 = [
      farBase[0] + n[0]! * o,
      farBase[1] + n[1]! * o,
      farBase[2],
    ];
    const towardNode =
      which === 'start' ? normalize(scale(baseDir, -1)) : baseDir;
    const p = projectOnLine(farOff, towardNode, pt);
    return (
      (p[0]! - farOff[0]!) * towardNode[0]! +
      (p[1]! - farOff[1]!) * towardNode[1]!
    );
  };

  /** |dot| leaveDir — 0 = perpendiculaire, 1 = colinéaire. */
  const leaveDotAbs = (
    a: { leaveDir: Vec3 },
    b: { leaveDir: Vec3 },
  ): number => {
    const d =
      a.leaveDir[0]! * b.leaveDir[0]! + a.leaveDir[1]! * b.leaveDir[1]!;
    return Math.abs(d);
  };

  // Murs « barre » colinéaires (T) : leaveDir opposés
  const barSegIdx = new Set<number>();
  for (let i = 0; i < nodeIncidents.length; i++) {
    for (let j = i + 1; j < nodeIncidents.length; j++) {
      const a = nodeIncidents[i]!;
      const b = nodeIncidents[j]!;
      const dot =
        a.leaveDir[0]! * b.leaveDir[0]! + a.leaveDir[1]! * b.leaveDir[1]!;
      if (dot <= -0.95) {
        barSegIdx.add(a.segIdx);
        barSegIdx.add(b.segIdx);
      }
    }
  }

  // Priorités de raccord croissantes (bandes matériaux, pas traits seuls)
  const prioSet = new Set<number>();
  for (const inc of nodeIncidents) {
    const ls = segs[inc.segIdx]!.lines;
    for (const l of ls) {
      prioSet.add(wallLineJoinPriority(ls, l));
    }
  }
  const priorities = [...prioSet].sort((a, b) => a - b);

  /**
   * Pour chaque (mur, couche) groupé par priorité :
   * - joint même prio (partenaire de rang) ;
   * - stop sur toute couche partenaire plus importante (prio < mine) ;
   * - 1ʳᵉ rencontre (min-t) = pas de stub au-delà.
   */
  type EndChoice = {
    segIdx: number;
    which: 'start' | 'end';
    rawOff: number;
    hit: Vec3;
    partnerIdx: number;
    partnerWhich: 'start' | 'end';
    partnerRaw: number;
    t: number;
    /** true = joint couche↔couche même priorité (cover OK). */
    samePrio: boolean;
  };

  for (const prio of priorities) {
    const choices: EndChoice[] = [];

    for (const inc of nodeIncidents) {
      const seg = segs[inc.segIdx]!;
      const linesAtPrio = seg.lines
        .filter((l) => wallLineJoinPriority(seg.lines, l) === prio)
        .slice()
        .sort((a, b) => a.offset - b.offset);

      for (const ln of linesAtPrio) {
        const myPrio = wallLineJoinPriority(seg.lines, ln);
        const simple = simpleNodeEnd(seg, inc.which, ln.offset);
        const tSimple = paramFromFar(seg, inc.which, ln.offset, simple);
        // Hits valides : au moins ~40 % du trajet far→simple (près du nœud)
        const tMin = Math.max(0, tSimple * 0.4 - 0.05);

        let bestT = preferMaxT ? -Infinity : Infinity;
        let bestPerp = Infinity; // |dot| — plus petit = plus perpendiculaire
        let bestSamePrio = false;
        let best: Omit<EndChoice, 'segIdx' | 'which' | 'rawOff'> | null = null;

        const isStem =
          preferPerp &&
          barSegIdx.size >= 2 &&
          !barSegIdx.has(inc.segIdx);

        for (const oth of nodeIncidents) {
          if (oth.segIdx === inc.segIdx) continue;
          // l-pair-stem : le pied ne regarde que la barre
          if (isStem && !barSegIdx.has(oth.segIdx)) continue;
          const oseg = segs[oth.segIdx]!;

          // Partenaire de même priorité de raccord (rang)
          const preferredSame = findPartnerLayer(seg.lines, ln, oseg.lines);

          for (const oln of oseg.lines) {
            const op = wallLineJoinPriority(oseg.lines, oln);
            // Plus faible (nombre > myPrio) : on traverse, pas un arrêt
            if (op > myPrio) continue;
            // Même priorité de raccord : jumelle de rang seulement
            // (les autres traits de même prio sont d’autres faces du même matériau
            //  ou de matériaux à même prio — on ne s’arrête que sur la jumelle)
            if (op === myPrio) {
              const isPref =
                !!preferredSame &&
                Math.abs(preferredSame.offset - oln.offset) < 1e-9;
              if (!isPref) continue;
            }
            // op < myPrio : barrière plus importante (ex. béton coupe le placo)
            // op === myPrio && preferred : joint couche à couche

            const hit = segsIntersectAtOffset(
              seg,
              oseg,
              ln.offset,
              oln.offset,
              corner,
            );
            if (!hit || dist(hit, corner) > nearR * 2) continue;
            const t = paramFromFar(seg, inc.which, ln.offset, hit);
            if (t < tMin - 1e-9) continue;

            const samePrio = op === myPrio;
            const perp = leaveDotAbs(inc, oth);
            let better = false;
            if (preferPerp) {
              if (perp < bestPerp - 1e-6) better = true;
              else if (Math.abs(perp - bestPerp) <= 1e-6 && t < bestT - 1e-9)
                better = true;
              else if (
                Math.abs(perp - bestPerp) <= 1e-6 &&
                Math.abs(t - bestT) <= 1e-9 &&
                samePrio &&
                !bestSamePrio
              )
                better = true;
            } else if (preferMaxT) {
              if (t > bestT + 1e-9) better = true;
              else if (
                Math.abs(t - bestT) <= 1e-9 &&
                samePrio &&
                !bestSamePrio
              )
                better = true;
            } else {
              // first-hit / first-hit-cover : min-t, puis préfère même prio
              if (t < bestT - 1e-9) better = true;
              else if (
                Math.abs(t - bestT) <= 1e-9 &&
                samePrio &&
                !bestSamePrio
              )
                better = true;
            }

            if (better) {
              bestT = t;
              bestPerp = perp;
              bestSamePrio = samePrio;
              best = {
                hit,
                partnerIdx: oth.segIdx,
                partnerWhich: oth.which,
                partnerRaw: oln.offset,
                t,
                samePrio,
              };
            }
          }
        }

        if (best) {
          choices.push({
            segIdx: inc.segIdx,
            which: inc.which,
            rawOff: ln.offset,
            ...best,
          });
        } else {
          setEndOnParallel(seg, inc.which, ln.offset, simple);
        }
      }
    }

    // Appliquer les bouts choisis
    for (const c of choices) {
      setEndOnParallel(segs[c.segIdx]!, c.which, c.rawOff, c.hit);
    }

    // Barre T colinéaire : deux murs opposés (leaveDir · leaveDir ≤ −0.95)
    // n’ont pas d’intersection 2D (//) ; forcer le même bout = hit du pied
    // uniquement pour les joints **même priorité** (pas les stops sur barrière).
    for (let i = 0; i < nodeIncidents.length; i++) {
      for (let j = i + 1; j < nodeIncidents.length; j++) {
        const a = nodeIncidents[i]!;
        const b = nodeIncidents[j]!;
        const la = a.leaveDir;
        const lb = b.leaveDir;
        const dot = la[0]! * lb[0]! + la[1]! * lb[1]!;
        if (dot > -0.95) continue;
        const cas = choices.filter(
          (c) => c.segIdx === a.segIdx && c.samePrio,
        );
        const cbs = choices.filter(
          (c) => c.segIdx === b.segIdx && c.samePrio,
        );
        for (const ca of cas) {
          const segA = segs[a.segIdx]!;
          const lnA = segA.lines.find(
            (l) => Math.abs(l.offset - ca.rawOff) < 1e-9,
          );
          if (!lnA || wallLineJoinPriority(segA.lines, lnA) !== prio) continue;
          const partnerOnB = findPartnerLayer(
            segA.lines,
            lnA,
            segs[b.segIdx]!.lines,
          );
          const cb =
            (partnerOnB &&
              cbs.find(
                (c) => Math.abs(c.rawOff - partnerOnB.offset) < 1e-9,
              )) ||
            cbs.find((c) => Math.abs(c.rawOff - ca.rawOff) < 1e-9);
          if (!cb && !ca) continue;
          const offA = ca.rawOff;
          const offB = cb?.rawOff ?? partnerOnB?.offset ?? ca.rawOff;
          const mid: Vec3 = cb
            ? [
                (ca.hit[0] + cb.hit[0]) / 2,
                (ca.hit[1] + cb.hit[1]) / 2,
                (ca.hit[2] + cb.hit[2]) / 2,
              ]
            : ca.hit;
          setEndOnParallel(segs[a.segIdx]!, a.which, offA, mid);
          setEndOnParallel(segs[b.segIdx]!, b.which, offB, mid);
        }
      }
    }

    // Couverture du partenaire :
    // - first-hit : seulement joint **même priorité**, et H pas au-delà de la 1ʳᵉ de B
    // - first-hit-cover / max-t / l-pair-stem : cover plus agressif
    // Ne pas étirer une couche structure pour coller une finition (samePrio=false).
    for (const c of choices) {
      if (!c.samePrio && !coverAlways && !preferPerp) continue;
      const partner = segs[c.partnerIdx]!;
      const pWhich = c.partnerWhich;
      const pRaw = c.partnerRaw;
      const tHitOnPartner = paramFromFar(partner, pWhich, pRaw, c.hit);
      const partnerChoice = choices.find(
        (o) => o.segIdx === c.partnerIdx && Math.abs(o.rawOff - pRaw) < 1e-9,
      );
      if (
        !coverAlways &&
        !preferPerp &&
        partnerChoice &&
        tHitOnPartner > partnerChoice.t + 1e-6
      ) {
        continue;
      }
      const strokes = byId.get(partner.id);
      const st = strokes?.find((s) => Math.abs(s.offset - pRaw) < 1e-9);
      const curPt = st
        ? pWhich === 'start'
          ? st.points[0]!
          : st.points[st.points.length - 1]!
        : simpleNodeEnd(partner, pWhich, pRaw);
      const tCur = paramFromFar(partner, pWhich, pRaw, curPt);
      const maxBeyond =
        Math.max(Math.abs(c.rawOff), Math.abs(pRaw), 0.05) * 6 + 0.8;
      if (tHitOnPartner > tCur + 1e-6 && tHitOnPartner < tCur + maxBeyond) {
        setEndOnParallel(partner, pWhich, pRaw, c.hit);
      }
    }
  }
}

/**
 * Traits offsetés pour des segments linéaires, **indexés par id de segment**.
 * 1) Snap des extrémités partagées (UF)
 * 2) Si le graphe est une chaîne/boucle (degré ≤ 2) → offset polyligne (fiable L)
 * 3) Sinon → linearWallStrokes + join dir choisi (colinéaire / perpendiculaire)
 */
function strokesForCenterSegsById(
  segsIn: readonly CenterSeg[],
  tol: number,
  strategy: JonctionStrategyId = 'first-hit',
  nodeStrategyOut?: Map<string, JonctionStrategyId>,
): Map<string, WallStroke[]> {
  const byId = new Map<string, WallStroke[]>();
  if (segsIn.length === 0) return byId;

  // Cluster les extrémités pour l’adjacence, mais **garde les axes** :
  // coller au centroïde ferait tourner le segment et casserait le //.
  const rawPts: Vec3[] = [];
  for (const s of segsIn) {
    rawPts.push(s.start, s.end);
  }
  const { rep, centroids } = clusterPoints(rawPts, tol);
  const segs: CenterSeg[] = segsIn.map((s) => ({
    ...s,
    start: [...s.start] as Vec3,
    end: [...s.end] as Vec3,
  }));

  // Adjacence : nœud → segments incidents
  type Inc = {
    segIdx: number;
    which: 'start' | 'end';
    leaveDir: Vec3;
    curDir: Vec3;
    flip: boolean;
    lines: readonly WallLineDef[];
  };
  const atNode: Inc[][] = Array.from({ length: centroids.length }, () => []);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (dist(s.start, s.end) < EPS) continue;
    const curDir = normalize(sub(s.end, s.start));
    if (xyLen(curDir) < EPS) continue;
    const si = rep[i * 2]!;
    const ei = rep[i * 2 + 1]!;
    atNode[si]!.push({
      segIdx: i,
      which: 'start',
      leaveDir: curDir,
      curDir,
      flip: s.flip,
      lines: s.lines,
    });
    atNode[ei]!.push({
      segIdx: i,
      which: 'end',
      leaveDir: normalize(scale(curDir, -1)),
      curDir,
      flip: s.flip,
      lines: s.lines,
    });
  }

  // Composantes connexes de segments (plusieurs chaînes L indépendantes dans le doc)
  const segAdj: number[][] = Array.from({ length: segs.length }, () => []);
  for (const incidents of atNode) {
    for (let a = 0; a < incidents.length; a++) {
      for (let b = a + 1; b < incidents.length; b++) {
        const ia = incidents[a]!.segIdx;
        const ib = incidents[b]!.segIdx;
        segAdj[ia]!.push(ib);
        segAdj[ib]!.push(ia);
      }
    }
  }
  const componentOf = new Array<number>(segs.length).fill(-1);
  const components: number[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (componentOf[i]! >= 0) continue;
    if (dist(segs[i]!.start, segs[i]!.end) < EPS) {
      componentOf[i] = components.length;
      components.push([i]);
      continue;
    }
    const stack = [i];
    const comp: number[] = [];
    componentOf[i] = components.length;
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of segAdj[u]!) {
        if (componentOf[v]! < 0) {
          componentOf[v] = components.length;
          stack.push(v);
        }
      }
    }
    components.push(comp);
  }

  const handled = new Set<number>();

  for (const comp of components) {
    if (comp.length === 0) continue;
    // Sous-graphe : maxDeg local
    let maxDeg = 0;
    for (const si of comp) {
      const s = segs[si]!;
      if (dist(s.start, s.end) < EPS) continue;
      const a = rep[si * 2]!;
      const b = rep[si * 2 + 1]!;
      // Degré restreint aux segs de la composante
      const degA = atNode[a]!.filter((x) => componentOf[x.segIdx] === componentOf[si!]).length;
      const degB = atNode[b]!.filter((x) => componentOf[x.segIdx] === componentOf[si!]).length;
      maxDeg = Math.max(maxDeg, degA, degB);
    }

    // Chaîne / boucle pure + profils identiques → offset polyligne (meilleur multi-coins L)
    // Profils hétérogènes (offsets/priorités différents) → résolveur nœud (priorités)
    if (maxDeg <= 2 && comp.length >= 1) {
      const subSegs = comp.map((i) => segs[i]!);
      if (wallProfilesCompatible(subSegs)) {
        const localPts: Vec3[] = [];
        for (const i of comp) {
          localPts.push(segs[i]!.start, segs[i]!.end);
        }
        const clustered = clusterPoints(localPts, tol);
        // Rebuild atNode local
        type Inc = { segIdx: number; which: 'start' | 'end'; leaveDir: Vec3 };
        const localAt: Inc[][] = Array.from(
          { length: clustered.centroids.length },
          () => [],
        );
        for (let li = 0; li < comp.length; li++) {
          const s = segs[comp[li]!]!;
          if (dist(s.start, s.end) < EPS) continue;
          const lsi = clustered.rep[li * 2]!;
          const lei = clustered.rep[li * 2 + 1]!;
          localAt[lsi]!.push({
            segIdx: li,
            which: 'start',
            leaveDir: normalize(sub(s.end, s.start)),
          });
          localAt[lei]!.push({
            segIdx: li,
            which: 'end',
            leaveDir: normalize(sub(s.start, s.end)),
          });
        }
        const localDeg = localAt.map((l) => l.length);
        const ordered = orderSegsAsPolyline(
          subSegs,
          clustered.rep,
          localAt,
          localDeg,
        );
        if (ordered) {
          const part = offsetPolylineStrokesById(
            ordered.poly,
            ordered.segOrder,
            ordered.reversed,
            ordered.closed,
            subSegs,
          );
          for (const [id, strokes] of part) {
            byId.set(id, strokes);
          }
          for (const i of comp) handled.add(i);
          continue;
        }
      }
    }

    // T / L / étoile : d’abord traits simples, puis résolution par nœud
    for (const i of comp) {
      if (handled.has(i)) continue;
      const s = segs[i]!;
      if (dist(s.start, s.end) < EPS) {
        byId.set(s.id, []);
        handled.add(i);
        continue;
      }
      // Traits de base (sans joint) — les nœuds les ajustent ensuite
      byId.set(
        s.id,
        linearWallStrokes(s.start, s.end, s.lines, s.flip),
      );
      handled.add(i);
    }

    // Résoudre chaque nœud de degré ≥ 2 (L, T, Y…)
    const nodesDone = new Set<number>();
    for (const i of comp) {
      for (const which of [0, 1] as const) {
        const ni = rep[i * 2 + which]!;
        if (nodesDone.has(ni)) continue;
        nodesDone.add(ni);
        const incidents = atNode[ni]!;
        if (!incidents || incidents.length < 2) continue;
        const corner = centroids[ni]!;
        const nodeStrategy = pickNodeStrategy(incidents, segs, strategy);
        resolveStarNodeStrokes(
          segs,
          incidents.map((inc) => ({
            segIdx: inc.segIdx,
            which: inc.which,
            leaveDir: inc.leaveDir,
          })),
          corner,
          byId,
          nodeStrategy,
        );
        if (incidents.length >= 3 && nodeStrategyOut) {
          for (const inc of incidents) {
            const root = centerSegRootId(segs[inc.segIdx]!.id);
            nodeStrategyOut.set(root, nodeStrategy);
          }
        }
      }
    }
  }

  // Sécurité : segments non couverts
  for (let i = 0; i < segs.length; i++) {
    if (byId.has(segs[i]!.id)) continue;
    const s = segs[i]!;
    byId.set(
      s.id,
      dist(s.start, s.end) < EPS
        ? []
        : linearWallStrokes(s.start, s.end, s.lines, s.flip),
    );
  }
  return byId;
}

/** Version plate (polymurs, preview) — conserve l’ordre d’insertion des segs. */
function strokesForCenterSegs(
  segsIn: readonly CenterSeg[],
  tol: number,
): WallStroke[] {
  const byId = strokesForCenterSegsById(segsIn, tol);
  const out: WallStroke[] = [];
  for (const s of segsIn) {
    const strokes = byId.get(s.id);
    if (strokes) out.push(...strokes);
  }
  return out;
}

/** Ordonne les segments en une polyligne (null si pas une chaîne/boucle simple). */
function orderSegsAsPolyline(
  segs: readonly CenterSeg[],
  rep: number[],
  atNode: { segIdx: number; which: 'start' | 'end'; leaveDir: Vec3 }[][],
  degree: number[],
): {
  poly: Vec3[];
  segOrder: number[];
  reversed: boolean[];
  closed: boolean;
} | null {
  const n = segs.length;
  if (n === 0) return null;

  // Trouver une extrémité de chaîne (degré 1) ou démarrer n’importe où (boucle)
  let startSeg = 0;
  let startWhich: 'start' | 'end' = 'start';
  let foundEnd = false;
  for (let i = 0; i < n; i++) {
    const si = rep[i * 2]!;
    const ei = rep[i * 2 + 1]!;
    if (degree[si] === 1) {
      startSeg = i;
      startWhich = 'start';
      foundEnd = true;
      break;
    }
    if (degree[ei] === 1) {
      startSeg = i;
      startWhich = 'end';
      foundEnd = true;
      break;
    }
  }

  const segOrder: number[] = [];
  const reversed: boolean[] = [];
  const used = new Set<number>();
  let cur = startSeg;
  let enterWhich = startWhich;
  let guard = 0;

  while (!used.has(cur) && guard++ < n + 2) {
    used.add(cur);
    const rev = enterWhich === 'end';
    segOrder.push(cur);
    reversed.push(rev);

    const leaveWhich: 'start' | 'end' = rev ? 'start' : 'end';
    const node = rep[cur * 2 + (leaveWhich === 'start' ? 0 : 1)]!;
    if (degree[node]! > 2) return null;

    let next: number | null = null;
    let nextEnter: 'start' | 'end' = 'start';
    for (const inc of atNode[node]!) {
      if (inc.segIdx === cur || used.has(inc.segIdx)) continue;
      next = inc.segIdx;
      nextEnter = inc.which;
      break;
    }
    if (next == null) break;
    cur = next;
    enterWhich = nextEnter;
  }

  if (segOrder.length !== n) {
    // Pas tous les segments dans une seule chaîne
    return null;
  }

  const poly: Vec3[] = [];
  for (let c = 0; c < segOrder.length; c++) {
    const s = segs[segOrder[c]!]!;
    const rev = reversed[c]!;
    if (c === 0) poly.push(rev ? [...s.end] as Vec3 : [...s.start] as Vec3);
    poly.push(rev ? [...s.start] as Vec3 : [...s.end] as Vec3);
  }

  let closed = false;
  if (!foundEnd && n >= 3) {
    closed = true;
    if (dist(poly[0]!, poly[poly.length - 1]!) > 1e-9) {
      poly.push([poly[0]![0], poly[0]![1], poly[0]![2]]);
    }
  }

  return { poly, segOrder, reversed, closed };
}

/**
 * True si tous les segments partagent le même profil (offsets + priorités).
 * Sinon le raccord doit passer par le résolveur nœud (matching par priorité).
 */
function wallProfilesCompatible(segs: readonly CenterSeg[]): boolean {
  if (segs.length <= 1) return true;
  const ref = segs[0]!.lines;
  for (let i = 1; i < segs.length; i++) {
    const lines = segs[i]!.lines;
    if (lines.length !== ref.length) return false;
    // Comparer multisets (offset, priority) triés
    const a = ref
      .map((l) => `${l.offset.toFixed(6)}@${wallLineJoinPriority(ref, l)}`)
      .sort()
      .join('|');
    const b = lines
      .map((l) => `${l.offset.toFixed(6)}@${wallLineJoinPriority(lines, l)}`)
      .sort()
      .join('|');
    if (a !== b) return false;
  }
  return true;
}

/**
 * Offset polyligne → un tableau de strokes par id de segment.
 * Chaque mur garde ses propres `lines` / flip (profil peut différer légèrement).
 * Prérequis : profils compatibles (mêmes offsets) — sinon utiliser resolveStarNodeStrokes.
 */
function offsetPolylineStrokesById(
  poly: Vec3[],
  segOrder: number[],
  reversed: boolean[],
  closed: boolean,
  segs: readonly CenterSeg[],
): Map<string, WallStroke[]> {
  const byId = new Map<string, WallStroke[]>();
  if (poly.length < 2 || segOrder.length === 0) return byId;

  for (const idx of segOrder) {
    byId.set(segs[idx]!.id, []);
  }

  // Union des offsets présents (même valeur d’offset = même trait de profil)
  const offsetKeys = new Map<number, WallLineDef>();
  for (const idx of segOrder) {
    const s = segs[idx]!;
    for (const ln of s.lines) {
      if (!offsetKeys.has(ln.offset)) offsetKeys.set(ln.offset, ln);
    }
  }

  for (const [rawOff, sampleLn] of offsetKeys) {
    // Offset signé : on calcule une polyligne miterée par flip-group
    // (tous les segs d’une chaîne pure partagent en pratique le même flip via chainKey)
    const flipGroups = new Map<boolean, number[]>();
    for (let c = 0; c < segOrder.length; c++) {
      const s = segs[segOrder[c]!]!;
      const list = flipGroups.get(s.flip) ?? [];
      list.push(c);
      flipGroups.set(s.flip, list);
    }

    for (const [flip, _cs] of flipGroups) {
      const side = flip ? -1 : 1;
      const o = rawOff * side;
      const miterPoly = closed
        ? offsetPolylineClosed(poly, o)
        : offsetPolylineOpen(poly, o);

      for (let c = 0; c < segOrder.length; c++) {
        const s = segs[segOrder[c]!]!;
        if (s.flip !== flip) continue;
        if (!s.lines.some((l) => l.offset === rawOff)) continue;

        const rev = reversed[c]!;
        const a = miterPoly[c]!;
        const b = miterPoly[c + 1]!;
        if (!a || !b) continue;
        const baseStart = rev ? s.end : s.start;
        const baseEnd = rev ? s.start : s.end;
        const baseDir = normalize(sub(baseEnd, baseStart));
        if (xyLen(baseDir) < EPS) continue;
        const nn = leftNormalFromDir(baseDir);
        const lineOrigin: Vec3 = [
          baseStart[0] + nn[0] * o,
          baseStart[1] + nn[1] * o,
          baseStart[2],
        ];
        const sa = projectOnLine(lineOrigin, baseDir, a);
        const sb = projectOnLine(lineOrigin, baseDir, b);
        const prof = s.lines.find((l) => l.offset === rawOff) ?? sampleLn;
        byId.get(s.id)!.push({
          points: rev ? [sb, sa] : [sa, sb],
          color: prof.color,
          lineWidth: prof.lineWidth,
          lineStyle: prof.lineStyle,
          offset: prof.offset,
        });
      }
    }
  }
  return byId;
}

/** Explose un polymur en murs unitaires line/arc (pour /explode). */
export function explodePolyWall(wall: WallEntity): WallEntity[] {
  if (wall.path !== 'poly' || !wall.segments || wall.segments.length === 0) {
    return [];
  }
  const styleSnap = {
    id: wall.styleId,
    name: wall.styleId,
    tab: '',
    lines: wall.lines.map((l) => ({ ...l })),
  };
  const parts: WallEntity[] = [];
  for (const s of wall.segments) {
    if (s.type === 'line') {
      parts.push(
        createLinearWallEntity(s.start, s.end, styleSnap, wall.flip),
      );
    } else {
      parts.push(
        createArcWallEntity(
          s.center,
          s.radius,
          s.startAngle,
          s.endAngle,
          styleSnap,
          wall.flip,
        ),
      );
    }
  }
  // Préserver styleId exact (create* utilise style.id)
  return parts.map((p) => ({
    ...p,
    styleId: wall.styleId,
    lines: wall.lines.map((l) => ({ ...l })),
  }));
}

export function translateWallSegments(
  segs: readonly WallSegment[],
  dx: number,
  dy: number,
  dz: number,
): WallSegment[] {
  const m = (p: Vec3): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  return segs.map((s): WallSegment => {
    if (s.type === 'line') {
      return { type: 'line', start: m(s.start), end: m(s.end) };
    }
    return {
      type: 'arc',
      center: m(s.center),
      radius: s.radius,
      startAngle: s.startAngle,
      endAngle: s.endAngle,
      normal: [...s.normal] as Vec3,
    };
  });
}

export function cloneWallSegments(segs: readonly WallSegment[]): WallSegment[] {
  return segs.map((s): WallSegment => {
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
}

/**
 * Paramètre t ∈ ℝ le long de A→B (0 = A, 1 = B) + distance 2D au support.
 */
function projectOnSegmentParam(
  a: Vec3,
  b: Vec3,
  p: Vec3,
): { t: number; dist: number; proj: Vec3 } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < EPS * EPS) {
    return { t: 0, dist: dist(a, p), proj: [...a] as Vec3 };
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  const proj: Vec3 = [a[0] + t * dx, a[1] + t * dy, a[2]];
  return { t, dist: dist(proj, p), proj };
}

/**
 * Paires T bout→flanc : extrémité du pied sur l’intérieur de la barre.
 * Détecte les T mid-span ; le peigne + découpe sont dans joinStemToBarPeigne.
 */
type MidTJoin = {
  stemId: string;
  which: 'start' | 'end';
  barId: string;
};

function joinEndZone(
  a: readonly WallLineDef[],
  b: readonly WallLineDef[],
): number {
  return Math.max(wallProfileWidth(a), wallProfileWidth(b), 0.05);
}

function findMidTJoins(
  segs: readonly CenterSeg[],
  tol: number,
): MidTJoin[] {
  const onLineTol = Math.max(tol * 3, 0.01);
  const out: MidTJoin[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < segs.length; i++) {
    const stem = segs[i]!;
    // Uniquement murs line (id sans #)
    if (stem.id.includes('#')) continue;
    for (const which of ['start', 'end'] as const) {
      const ep = which === 'start' ? stem.start : stem.end;
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const bar = segs[j]!;
        if (bar.id.includes('#')) continue;
        if (stem.id === bar.id) continue;
        const { t, dist: d } = projectOnSegmentParam(bar.start, bar.end, ep);
        if (d > onLineTol) continue;
        const barLen = dist(bar.start, bar.end);
        if (barLen < EPS) continue;
        const endZone = joinEndZone(stem.lines, bar.lines);
        const along = t * barLen;
        if (along < endZone || along > barLen - endZone) continue;
        if (t <= 0.001 || t >= 0.999) continue;
        const key = `${stem.id}|${which}|${bar.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ stemId: stem.id, which, barId: bar.id });
      }
    }
  }
  return out;
}

/**
 * T bout→flanc — peigne BIM (priorités de **raccord** = bandes matériaux).
 *
 * Modèle (Revit / multi-couches-wall_Y.md) :
 * - Prio P traverse uniquement les prio **> P** (plus faibles).
 * - Prio **≤ P** = barrière : 1ʳᵉ rencontre = stop.
 * - Structure = prio de raccord minimale sur la barre (pas un 1 figé).
 *   Face d’entrée structure ouverte dans la bande structure du pied.
 * - Peaux plus faibles, côté pied, ouvertes sur la hauteur du pied.
 */
function joinStemToBarPeigne(
  stem: WallEntity,
  which: 'start' | 'end',
  bar: WallEntity,
  barGeomsIn: readonly WallStrokeGeom[],
  stemGeomsIn?: readonly WallStrokeGeom[],
): { stemGeoms: WallStrokeGeom[]; barGeoms: WallStrokeGeom[] } {
  const copyBar = (): WallStrokeGeom[] =>
    barGeomsIn.map((g) => ({
      ...g,
      start: [...g.start] as Vec3,
      end: [...g.end] as Vec3,
    }));

  const stemSeg: CenterSeg = {
    id: stem.id,
    start: stem.start,
    end: stem.end,
    lines: stem.lines,
    flip: stem.flip,
  };
  const barSeg: CenterSeg = {
    id: bar.id,
    start: bar.start,
    end: bar.end,
    lines: bar.lines,
    flip: bar.flip,
  };
  const near = which === 'start' ? stem.start : stem.end;
  const far = which === 'start' ? stem.end : stem.start;
  const baseDir = normalize(sub(stem.end, stem.start));
  if (xyLen(baseDir) < EPS || bar.lines.length === 0) {
    return { stemGeoms: simpleStrokeGeom(stem), barGeoms: copyBar() };
  }

  const side = stem.flip ? -1 : 1;
  const n = leftNormalFromDir(baseDir);
  const towardNear = normalize(sub(near, far));
  const maxSearch =
    Math.max(wallProfileWidth(bar.lines), wallProfileWidth(stem.lines), 0.5) *
      3 +
    1;

  // Structure = priorité de raccord la plus forte (nombre min) présente sur la barre
  const barPrios = bar.lines.map((l) => wallLineJoinPriority(bar.lines, l));
  const structPrio = barPrios.length > 0 ? Math.min(...barPrios) : 1;
  const barStructOffs = bar.lines
    .filter((l) => wallLineJoinPriority(bar.lines, l) === structPrio)
    .map((l) => l.offset)
    .sort((a, b) => a - b);
  const coreOuter =
    barStructOffs.length > 0 ? Math.max(...barStructOffs) : -Infinity;
  const coreInner =
    barStructOffs.length > 0 ? Math.min(...barStructOffs) : Infinity;

  // Côté d’attache du pied : milieu du pied projeté sur la normale d’offset
  // de la barre (pas un point collé au nœud, sinon signe instable).
  const barDir = normalize(sub(bar.end, bar.start));
  const barN = leftNormalFromDir(barDir);
  const barSide = bar.flip ? -1 : 1;
  const stemMid: Vec3 = [
    (stem.start[0]! + stem.end[0]!) * 0.5,
    (stem.start[1]! + stem.end[1]!) * 0.5,
    stem.start[2],
  ];
  // Offset signé du milieu du pied dans le repère offset de la barre
  const stemSignedOff =
    ((stemMid[0]! - bar.start[0]!) * barN[0]! +
      (stemMid[1]! - bar.start[1]!) * barN[1]!) *
    barSide;
  // stemSignedOff > 0 → pied du côté des offsets croissants (souvent extérieur)
  const stemFromHighOffset = stemSignedOff > 0;

  // Face d’entrée de la structure = 1ʳᵉ face struct rencontrée depuis le pied
  const structureEntryOff = stemFromHighOffset
    ? coreOuter
    : coreInner;

  // Peaux barre à ouvrir :
  // 1) peaux faibles extérieures au béton (côté pied)
  // 2) face d’entrée du béton (ouverte dans la bande structure du pied)
  const weakCutOffsets = new Set<number>();
  for (const oln of bar.lines) {
    const jp = wallLineJoinPriority(bar.lines, oln);
    if (jp <= structPrio) continue;
    if (stemFromHighOffset && oln.offset > coreOuter + 1e-9) {
      weakCutOffsets.add(oln.offset);
    } else if (!stemFromHighOffset && oln.offset < coreInner - 1e-9) {
      weakCutOffsets.add(oln.offset);
    }
  }

  const stemGeoms: WallStrokeGeom[] = [];

  for (const ln of stem.lines) {
    const myPrio = wallLineJoinPriority(stem.lines, ln);
    const preferredSame = findPartnerLayer(stem.lines, ln, bar.lines);

    const o = ln.offset * side;
    const origin: Vec3 = [
      stem.start[0] + n[0]! * o,
      stem.start[1] + n[1]! * o,
      stem.start[2],
    ];
    const farOff: Vec3 = [
      far[0] + n[0]! * o,
      far[1] + n[1]! * o,
      far[2],
    ];
    const simpleNear: Vec3 = [
      near[0] + n[0]! * o,
      near[1] + n[1]! * o,
      near[2],
    ];

    const paramT = (pt: Vec3): number => {
      const p = projectOnLine(farOff, towardNear, pt);
      return (
        (p[0]! - farOff[0]!) * towardNear[0]! +
        (p[1]! - farOff[1]!) * towardNear[1]!
      );
    };
    const tSimple = paramT(simpleNear);
    const tMin = Math.max(0, tSimple * 0.4 - 0.05);

    let bestT = Infinity;
    let bestHit: Vec3 | null = null;
    let bestSame = false;

    for (const oln of bar.lines) {
      const op = wallLineJoinPriority(bar.lines, oln);
      // Traverse uniquement les prio plus faibles (nombre > myPrio)
      if (op > myPrio) continue;
      // op ≤ myPrio : barrière ou joint — 1ʳᵉ rencontre (min-t)
      // Même prio : TOUJOURS stop (ne pas traverser l’épaisseur du même matériau)
      //   ex. face béton intérieure du pied s’arrête sur la face ext. béton barre

      const isPreferred =
        !!preferredSame && Math.abs(preferredSame.offset - oln.offset) < 1e-9;

      const hit = segsIntersectAtOffset(
        stemSeg,
        barSeg,
        ln.offset,
        oln.offset,
        near,
      );
      if (!hit || dist(hit, near) > maxSearch) continue;
      const t = paramT(hit);
      if (t < tMin - 1e-9) continue;
      const samePrioJoin = op === myPrio && isPreferred;
      if (
        t < bestT - 1e-9 ||
        (Math.abs(t - bestT) <= 1e-9 && samePrioJoin && !bestSame)
      ) {
        bestT = t;
        bestHit = hit;
        bestSame = samePrioJoin;
      }
    }

    // Repli jumelle si aucun hit
    if (!bestHit && preferredSame) {
      const hit = segsIntersectAtOffset(
        stemSeg,
        barSeg,
        ln.offset,
        preferredSame.offset,
        near,
      );
      if (hit && dist(hit, near) <= maxSearch) bestHit = hit;
    }

    const endPt = bestHit
      ? projectOnLine(origin, baseDir, bestHit)
      : simpleNear;
    const existing = stemGeomsIn?.find(
      (g) => Math.abs(g.offset - ln.offset) < 1e-9,
    );
    const existingFar = existing
      ? which === 'start'
        ? existing.end
        : existing.start
      : farOff;
    const startPt = projectOnLine(origin, baseDir, existingFar);
    stemGeoms.push({
      offset: ln.offset,
      start: which === 'start' ? endPt : startPt,
      end: which === 'start' ? startPt : endPt,
      color: ln.color,
      lineWidth: ln.lineWidth,
      lineStyle: ln.lineStyle,
    });
  }

  const alongBar = (p: Vec3): number =>
    (p[0]! - bar.start[0]!) * barDir[0]! +
    (p[1]! - bar.start[1]!) * barDir[1]!;

  const stemLayerAlong = (ln: WallLineDef): number => {
    const o = ln.offset * side;
    return alongBar([
      near[0] + n[0]! * o,
      near[1] + n[1]! * o,
      near[2],
    ]);
  };

  // Bande le long de la barre pour une prio du pied (ex. faces béton)
  const stemBandForPrio = (prio: number): { bMin: number; bMax: number } | null => {
    const vals: number[] = [];
    for (const sln of stem.lines) {
      if (wallLineJoinPriority(stem.lines, sln) === prio) {
        vals.push(stemLayerAlong(sln));
      }
    }
    if (vals.length === 0) return null;
    return {
      bMin: Math.min(...vals) - 0.001,
      bMax: Math.max(...vals) + 0.001,
    };
  };

  // Bande large du pied entier (peaux faibles)
  const stemFullBand = (): { bMin: number; bMax: number } | null => {
    const vals = stem.lines.map(stemLayerAlong);
    if (vals.length === 0) return null;
    return {
      bMin: Math.min(...vals) - 0.001,
      bMax: Math.max(...vals) + 0.001,
    };
  };

  let barGeoms = copyBar();

  // 1) Ouvrir la face d’entrée de la structure dans la bande structure du pied
  if (Number.isFinite(structureEntryOff) && structureEntryOff !== Infinity) {
    const stemPrios = stem.lines.map((l) => wallLineJoinPriority(stem.lines, l));
    const stemStructPrio =
      stemPrios.length > 0 ? Math.min(...stemPrios) : structPrio;
    const structBand = stemBandForPrio(stemStructPrio);
    if (structBand && structBand.bMax > structBand.bMin + EPS) {
      barGeoms = cutBarGeomsInBand(
        barGeoms,
        alongBar,
        structBand.bMin,
        structBand.bMax,
        new Set([structureEntryOff]),
      );
    }
  }

  // 2) Ouvrir les peaux faibles extérieures sur la hauteur du pied
  const fullBand = stemFullBand();
  if (fullBand && weakCutOffsets.size > 0) {
    // Par couche : bande = du béton d’entrée jusqu’à la jumelle (ou tout le pied)
    for (const off of weakCutOffsets) {
      const oln = bar.lines.find((l) => Math.abs(l.offset - off) < 1e-9);
      if (!oln) continue;
      const op = wallLineJoinPriority(bar.lines, oln);
      const preferred = findPartnerLayer(bar.lines, oln, stem.lines);
      const partnerVals: number[] = [];
      const barrierVals: number[] = [];
      for (const sln of stem.lines) {
        const sp = wallLineJoinPriority(stem.lines, sln);
        if (sp > op) continue;
        if (sp === op) {
          if (
            preferred &&
            Math.abs(preferred.offset - sln.offset) < 1e-9
          ) {
            partnerVals.push(stemLayerAlong(sln));
          }
          continue;
        }
        barrierVals.push(stemLayerAlong(sln));
      }
      let bMin: number;
      let bMax: number;
      const all = [...barrierVals, ...partnerVals];
      if (all.length > 0) {
        bMin = Math.min(...all) - 0.0005;
        bMax = Math.max(...all) + 0.0005;
      } else {
        bMin = fullBand.bMin;
        bMax = fullBand.bMax;
      }
      if (bMax <= bMin + EPS) continue;
      barGeoms = cutBarGeomsInBand(
        barGeoms,
        alongBar,
        bMin,
        bMax,
        new Set([off]),
      );
    }
  }

  return { stemGeoms, barGeoms };
}

/**
 * Coupe les traits de la barre dans [bMin, bMax] (le long de l’axe).
 * Uniquement les offsets dans `cutOffsets`.
 */
function cutBarGeomsInBand(
  geoms: readonly WallStrokeGeom[],
  alongBar: (p: Vec3) => number,
  bMin: number,
  bMax: number,
  cutOffsets: ReadonlySet<number>,
): WallStrokeGeom[] {
  if (cutOffsets.size === 0 || bMax <= bMin + EPS) {
    return geoms.map((g) => ({
      ...g,
      start: [...g.start] as Vec3,
      end: [...g.end] as Vec3,
    }));
  }

  const out: WallStrokeGeom[] = [];
  for (const g of geoms) {
    const shouldCut = [...cutOffsets].some(
      (o) => Math.abs(o - g.offset) < 1e-9,
    );
    if (!shouldCut) {
      out.push({
        ...g,
        start: [...g.start] as Vec3,
        end: [...g.end] as Vec3,
      });
      continue;
    }

    const a0 = alongBar(g.start);
    const a1 = alongBar(g.end);
    const span = a1 - a0;
    const atU = (u: number): Vec3 => [
      g.start[0] + (g.end[0] - g.start[0]) * u,
      g.start[1] + (g.end[1] - g.start[1]) * u,
      g.start[2],
    ];

    if (Math.abs(span) < EPS) {
      if (a0 < bMin - EPS || a0 > bMax + EPS) {
        out.push({
          ...g,
          start: [...g.start] as Vec3,
          end: [...g.end] as Vec3,
        });
      }
      continue;
    }

    const uAtAlong = (a: number): number => (a - a0) / span;
    const cuts: number[] = [0, 1];
    for (const b of [bMin, bMax]) {
      const u = uAtAlong(b);
      if (u > EPS && u < 1 - EPS) cuts.push(u);
    }
    cuts.sort((x, y) => x - y);

    for (let i = 0; i + 1 < cuts.length; i++) {
      const u0 = cuts[i]!;
      const u1 = cuts[i + 1]!;
      if (u1 - u0 < 1e-12) continue;
      const midA = a0 + ((u0 + u1) / 2) * span;
      if (midA < bMin - EPS || midA > bMax + EPS) {
        const s = atU(u0);
        const e = atU(u1);
        if (dist(s, e) < EPS) continue;
        out.push({
          offset: g.offset,
          start: s,
          end: e,
          color: g.color,
          lineWidth: g.lineWidth,
          lineStyle: g.lineStyle,
        });
      }
    }
  }
  return out;
}

/** Id racine d’un CenterSeg (poly #i ou split mid-T __mid*). */
function centerSegRootId(sid: string): string {
  const mid = sid.indexOf('__mid');
  if (mid >= 0) return sid.slice(0, mid);
  const hash = sid.indexOf('#');
  if (hash >= 0) return sid.slice(0, hash);
  return sid;
}

/**
 * Recalcule strokeGeom pour tous les murs (line + segments line des polymurs).
 *
 * - Coins L / extrémités : `resolveStarNodeStrokes` (priorités de raccord).
 * - T mid-span (bout→flanc) : peigne `joinStemToBarPeigne`.
 */
export function recomputeLinearWallJoints(
  walls: readonly WallEntity[],
  tol = WALL_JOIN_TOL,
  strategy: JonctionStrategyId = 'first-hit',
): WallEntity[] {
  const centerSegs: CenterSeg[] = [];

  for (const w of walls) {
    if (w.path === 'line' && dist(w.start, w.end) > EPS) {
      centerSegs.push({
        id: w.id,
        start: [...w.start] as Vec3,
        end: [...w.end] as Vec3,
        lines: w.lines,
        flip: w.flip,
        joinStrategy: w.joinStrategy,
      });
    } else if (w.path === 'poly' && w.segments?.length) {
      w.segments.forEach((seg, i) => {
        if (seg.type !== 'line') return;
        if (dist(seg.start, seg.end) <= EPS) return;
        centerSegs.push({
          id: `${w.id}#${i}`,
          start: [...seg.start] as Vec3,
          end: [...seg.end] as Vec3,
          lines: w.lines,
          flip: w.flip,
          joinStrategy: w.joinStrategy,
        });
      });
    }
  }

  const geomById = new Map<string, WallStrokeGeom[]>();
  const nodeStrategyByRoot = new Map<string, JonctionStrategyId>();
  if (centerSegs.length > 0) {
    // Snap des pieds T mid sur l’axe de la barre (sans scinder la barre)
    const midJoins = findMidTJoins(centerSegs, tol);
    // Copie mutable des axes (snap pied → barre) pour le peigne
    const snappedWalls = new Map<string, WallEntity>();
    for (const w of walls) {
      if (w.path === 'line') {
        snappedWalls.set(w.id, {
          ...w,
          start: [...w.start] as Vec3,
          end: [...w.end] as Vec3,
          lines: w.lines.map((l) => ({ ...l })),
        });
      }
    }

    for (const mid of midJoins) {
      const stem = snappedWalls.get(mid.stemId);
      const bar = snappedWalls.get(mid.barId);
      if (!stem || !bar || stem.path !== 'line' || bar.path !== 'line') continue;
      const ep = mid.which === 'start' ? stem.start : stem.end;
      const { t, proj } = projectOnSegmentParam(bar.start, bar.end, ep);
      if (t <= 0.001 || t >= 0.999) continue;
      if (mid.which === 'start') stem.start = [...proj] as Vec3;
      else stem.end = [...proj] as Vec3;
      // Mettre à jour centerSeg pour le snap L aux coins
      const cStem = centerSegs.find((s) => s.id === mid.stemId);
      if (cStem) {
        if (mid.which === 'start') cStem.start = [...proj] as Vec3;
        else cStem.end = [...proj] as Vec3;
      }
    }

    // Résolveur L / coins (pas de demis mid-T — barre reste entière)
    const strokesById = strokesForCenterSegsById(
      centerSegs,
      tol,
      strategy,
      nodeStrategyByRoot,
    );

    // Regrouper par mur racine (polymur `id#i` → `id`)
    const byRoot = new Map<string, WallStroke[]>();
    for (const [sid, strokes] of strokesById) {
      const root = centerSegRootId(sid);
      const list = byRoot.get(root) ?? [];
      list.push(...strokes);
      byRoot.set(root, list);
    }

    for (const w of walls) {
      const raw = byRoot.get(w.id);
      if (raw && raw.length > 0) {
        const geoms: WallStrokeGeom[] = [];
        for (const s of raw) {
          const a = s.points[0];
          const b = s.points[s.points.length - 1];
          if (!a || !b) continue;
          if (dist(a, b) < EPS) continue;
          geoms.push({
            offset: s.offset,
            start: a,
            end: b,
            color: s.color,
            lineWidth: s.lineWidth,
            lineStyle: s.lineStyle,
          });
        }
        if (geoms.length) geomById.set(w.id, geoms);
        else if (w.path === 'line') geomById.set(w.id, simpleStrokeGeom(w));
      } else if (w.path === 'line') {
        geomById.set(w.id, simpleStrokeGeom(w));
      }
    }

    // ── T mid : peigne pied + ouverture peaux ext. barre ──────────────
    for (const mid of midJoins) {
      const stem = snappedWalls.get(mid.stemId);
      const bar = snappedWalls.get(mid.barId);
      if (!stem || !bar || stem.path !== 'line' || bar.path !== 'line') continue;

      const barGeomsIn =
        geomById.get(mid.barId) ?? simpleStrokeGeom(bar);
      const stemGeomsIn = geomById.get(mid.stemId);
      const { stemGeoms, barGeoms } = joinStemToBarPeigne(
        stem,
        mid.which,
        bar,
        barGeomsIn,
        stemGeomsIn,
      );
      geomById.set(mid.stemId, stemGeoms);
      geomById.set(mid.barId, barGeoms);
    }
  }

  return walls.map((w) => {
    const joinStrategy = nodeStrategyByRoot.get(w.id) ?? w.joinStrategy;
    if (w.path === 'poly') {
      const geoms = geomById.get(w.id);
      return {
        ...w,
        lines: w.lines.map((l) => ({ ...l })),
        segments: w.segments ? cloneWallSegments(w.segments) : [],
        strokeGeom: geoms && geoms.length > 0 ? geoms : undefined,
        joinStrategy,
      };
    }
    if (w.path === 'arc') {
      return {
        ...w,
        lines: w.lines.map((l) => ({ ...l })),
        strokeGeom: undefined,
        joinStrategy,
      };
    }
    if (w.path !== 'line') {
      return {
        ...w,
        lines: w.lines.map((l) => ({ ...l })),
        strokeGeom: undefined,
        joinStrategy,
      };
    }
    const geoms = geomById.get(w.id);
    return {
      ...w,
      lines: w.lines.map((l) => ({ ...l })),
      strokeGeom: geoms && geoms.length > 0 ? geoms : simpleStrokeGeom(w),
      joinStrategy,
    };
  });
}

function simpleStrokeGeom(w: WallEntity): WallStrokeGeom[] {
  const strokes = linearWallStrokes(w.start, w.end, w.lines, w.flip);
  return strokes.map((s) => ({
    offset: s.offset,
    start: s.points[0]!,
    end: s.points[1]!,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
  }));
}

export function applyWallJointsToEntities(
  entities: readonly Entity[],
  tol = WALL_JOIN_TOL,
  strategy: JonctionStrategyId = 'first-hit',
): Entity[] {
  const walls = entities.filter((e): e is WallEntity => e.kind === 'wall');
  if (walls.length === 0) return entities.map((e) => ({ ...e }));
  const joined = recomputeLinearWallJoints(walls, tol, strategy);
  const map = new Map(joined.map((w) => [w.id, w]));
  return entities.map((e) => (e.kind === 'wall' && map.has(e.id) ? map.get(e.id)! : e));
}

// ─── /join : mur A (à prolonger) → mur B (cible) ─────────────────────────────

export type JoinWallPick = {
  wall: WallEntity;
  point: Vec3;
  dist: number;
};

/** Mur le plus proche du clic (traits strokeGeom / offsets). */
export function findNearestWall(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
  excludeId?: string,
): JoinWallPick | null {
  if (maxDist <= 0) return null;
  let best: JoinWallPick | null = null;
  for (const e of entities) {
    if (e.kind !== 'wall') continue;
    if (excludeId && e.id === excludeId) continue;
    if (e.path === 'arc') continue; // v1 : line + poly line
    const strokes = wallEntityStrokes(e, 24);
    for (const s of strokes) {
      const pts = s.points;
      for (let j = 0; j + 1 < pts.length; j++) {
        const a = pts[j]!;
        const b = pts[j + 1]!;
        const { t } = projectOnSegmentParam(a, b, click);
        const tc = Math.max(0, Math.min(1, t));
        const clamped: Vec3 = [
          a[0] + (b[0] - a[0]) * tc,
          a[1] + (b[1] - a[1]) * tc,
          a[2],
        ];
        const dd = dist(clamped, click);
        if (dd > maxDist) continue;
        if (!best || dd < best.dist) {
          best = { wall: e, point: clamped, dist: dd };
        }
      }
    }
    // Fallback axe de référence
    if (e.path === 'line') {
      const { t } = projectOnSegmentParam(e.start, e.end, click);
      const tc = Math.max(0, Math.min(1, t));
      const clamped: Vec3 = [
        e.start[0] + (e.end[0] - e.start[0]) * tc,
        e.start[1] + (e.end[1] - e.start[1]) * tc,
        e.start[2],
      ];
      const dd = dist(clamped, click);
      if (dd <= maxDist && (!best || dd < best.dist)) {
        best = { wall: e, point: clamped, dist: dd };
      }
    }
  }
  return best;
}

export type JoinWallsResult =
  | {
      ok: true;
      stem: WallEntity;
      target: WallEntity;
      which: 'start' | 'end';
      mode: 'T' | 'L';
      lengthened: number;
      hit: Vec3;
    }
  | { ok: false; reason: string };

/**
 * /join — prolonge le mur `stem` jusqu’à l’axe du mur `target`, puis laisse
 * `recomputeLinearWallJoints` faire le raccord multi-couches (priorités).
 *
 * - T : intersection au milieu de la cible (bout → flanc)
 * - L : intersection près d’une extrémité de la cible (les deux bouts se joignent)
 *
 * v1 : murs `path === 'line'` uniquement.
 */
export function joinWallToWall(
  stemIn: WallEntity,
  targetIn: WallEntity,
  opts?: {
    /** Extrémité du stem à bouger ; défaut = plus proche de la cible. */
    which?: 'start' | 'end';
    /** Point de clic sur le stem (affine le choix d’extrémité). */
    clickOnStem?: Vec3;
  },
): JoinWallsResult {
  if (stemIn.id === targetIn.id) {
    return { ok: false, reason: 'Choisir deux murs distincts.' };
  }
  if (stemIn.path !== 'line') {
    return {
      ok: false,
      reason: 'Le 1er mur doit être linéaire (/ml). Polymurs : pas encore supportés.',
    };
  }
  if (targetIn.path !== 'line') {
    return {
      ok: false,
      reason: 'Le 2e mur (cible) doit être linéaire (/ml).',
    };
  }
  if (dist(stemIn.start, stemIn.end) < EPS) {
    return { ok: false, reason: 'Mur source dégénéré.' };
  }
  if (dist(targetIn.start, targetIn.end) < EPS) {
    return { ok: false, reason: 'Mur cible dégénéré.' };
  }

  // Quelle extrémité du stem prolonger ?
  let which: 'start' | 'end';
  if (opts?.which) {
    which = opts.which;
  } else if (opts?.clickOnStem) {
    which =
      dist(opts.clickOnStem, stemIn.start) <= dist(opts.clickOnStem, stemIn.end)
        ? 'start'
        : 'end';
  } else {
    const dS = projectOnSegmentParam(
      targetIn.start,
      targetIn.end,
      stemIn.start,
    ).dist;
    const dE = projectOnSegmentParam(
      targetIn.start,
      targetIn.end,
      stemIn.end,
    ).dist;
    which = dS <= dE ? 'start' : 'end';
  }

  const far: Vec3 =
    which === 'start'
      ? ([...stemIn.end] as Vec3)
      : ([...stemIn.start] as Vec3);
  const near: Vec3 =
    which === 'start'
      ? ([...stemIn.start] as Vec3)
      : ([...stemIn.end] as Vec3);

  const stemDir = sub(near, far);
  if (xyLen(stemDir) < EPS) {
    return { ok: false, reason: 'Direction du mur source invalide.' };
  }
  const tDir = sub(targetIn.end, targetIn.start);
  if (xyLen(tDir) < EPS) {
    return { ok: false, reason: 'Direction du mur cible invalide.' };
  }

  const hit = lineIntersect2d(far, stemDir, targetIn.start, tDir);
  if (!hit) {
    return {
      ok: false,
      reason: 'Murs parallèles — pas d’intersection d’axes.',
    };
  }

  // Hit doit être « devant » le far (dans le sens du stem vers la cible)
  const toHit = sub(hit, far);
  const stemLen = xyLen(stemDir);
  const alongStem =
    (toHit[0]! * stemDir[0]! + toHit[1]! * stemDir[1]!) / (stemLen * stemLen);
  if (alongStem < 0.05) {
    return {
      ok: false,
      reason:
        'Intersection derrière l’autre extrémité — retournez le mur ou choisissez l’autre bout.',
    };
  }

  // Hit sur (ou près de) le segment cible
  const barLen = dist(targetIn.start, targetIn.end);
  const { t: tBar, dist: dBar } = projectOnSegmentParam(
    targetIn.start,
    targetIn.end,
    hit,
  );
  const maxW =
    Math.max(
      wallProfileWidth(stemIn.lines),
      wallProfileWidth(targetIn.lines),
      0.3,
    ) + 0.5;
  // Autoriser un peu hors segment pour L (extrémités presque jointes)
  if (tBar < -0.15 || tBar > 1.15 || dBar > maxW) {
    return {
      ok: false,
      reason:
        'L’intersection des axes est hors du mur cible (trop loin du segment).',
    };
  }

  const endZone = joinEndZone(stemIn.lines, targetIn.lines);
  const alongBar = tBar * barLen;
  const nearTargetEnd =
    alongBar <= endZone || alongBar >= barLen - endZone || tBar < 0 || tBar > 1;
  const mode: 'T' | 'L' = nearTargetEnd ? 'L' : 'T';

  // Snap hit sur le segment si L légèrement hors bout
  let joinPt: Vec3 = [hit[0], hit[1], hit[2]];
  if (mode === 'L') {
    if (tBar < 0) joinPt = [...targetIn.start] as Vec3;
    else if (tBar > 1) joinPt = [...targetIn.end] as Vec3;
    else joinPt = hit;
    // Préférer l’intersection d’axes si elle est proche du bout
    const dStart = dist(hit, targetIn.start);
    const dEnd = dist(hit, targetIn.end);
    if (dStart <= endZone || dEnd <= endZone) {
      joinPt = hit;
    }
  }

  const oldNear = near;
  const lengthened = dist(oldNear, joinPt);

  let newStart: Vec3 =
    which === 'start' ? joinPt : ([...stemIn.start] as Vec3);
  let newEnd: Vec3 = which === 'end' ? joinPt : ([...stemIn.end] as Vec3);
  if (dist(newStart, newEnd) < EPS) {
    return { ok: false, reason: 'Allongement dégénéré.' };
  }

  const stem: WallEntity = {
    ...stemIn,
    start: newStart,
    end: newEnd,
    lines: stemIn.lines.map((l) => ({ ...l })),
    strokeGeom: undefined,
  };

  let target: WallEntity = {
    ...targetIn,
    lines: targetIn.lines.map((l) => ({ ...l })),
    strokeGeom: undefined,
  };

  // L : coller aussi l’extrémité cible à l’intersection des axes
  if (mode === 'L') {
    const dS = dist(joinPt, targetIn.start);
    const dE = dist(joinPt, targetIn.end);
    if (dS <= dE) {
      target = {
        ...target,
        start: [...joinPt] as Vec3,
        end: [...targetIn.end] as Vec3,
      };
    } else {
      target = {
        ...target,
        start: [...targetIn.start] as Vec3,
        end: [...joinPt] as Vec3,
      };
    }
    if (dist(target.start, target.end) < EPS) {
      return { ok: false, reason: 'Mur cible dégénéré après snap L.' };
    }
  }

  return {
    ok: true,
    stem,
    target,
    which,
    mode,
    lengthened,
    hit: joinPt,
  };
}

/**
 * Applique /join sur une liste d’entités : met à jour les 2 murs + joints.
 */
export function applyJoinWallsToEntities(
  entities: readonly Entity[],
  stemId: string,
  targetId: string,
  opts?: { which?: 'start' | 'end'; clickOnStem?: Vec3 },
): { entities: Entity[]; result: JoinWallsResult } {
  const stem = entities.find(
    (e): e is WallEntity => e.kind === 'wall' && e.id === stemId,
  );
  const target = entities.find(
    (e): e is WallEntity => e.kind === 'wall' && e.id === targetId,
  );
  if (!stem || !target) {
    return {
      entities: entities.map((e) => ({ ...e })),
      result: { ok: false, reason: 'Mur introuvable dans le document.' },
    };
  }
  const result = joinWallToWall(stem, target, opts);
  if (!result.ok) {
    return { entities: entities.map((e) => ({ ...e })), result };
  }
  const next = entities.map((e) => {
    if (e.id === stemId) return result.stem;
    if (e.id === targetId) return result.target;
    return e;
  });
  return {
    entities: applyWallJointsToEntities(next, WALL_JOIN_TOL, 'first-hit'),
    result,
  };
}

/**
 * Tolérance de fusion des extrémités dans /jonction (65 cm).
 * Plus large que WALL_JOIN_TOL (5 mm, coïncidence après snap).
 */
export const WALL_REJOIN_SNAP_TOL = 0.65;

/** Clé d’une extrémité : start/end (mur simple) ou seg:i:start|end (polymur). */
type EndRef = {
  wallId: string;
  key: string;
  point: Vec3;
};

/**
 * Axe support d’une extrémité : far → near (extrémité dans le cluster).
 * Permet de snapper **sur l’axe** sans faire tourner le mur.
 */
function endRefAxis(
  g: EndRef,
  wallById: Map<string, WallEntity>,
): { far: Vec3; near: Vec3 } | null {
  const w = wallById.get(g.wallId);
  if (!w) return null;

  if (w.path === 'line' || w.path === 'arc') {
    if (g.key === 'start') {
      return { far: [...w.end] as Vec3, near: [...w.start] as Vec3 };
    }
    if (g.key === 'end') {
      return { far: [...w.start] as Vec3, near: [...w.end] as Vec3 };
    }
    return null;
  }

  if (w.path === 'poly' && w.segments?.length) {
    const m = /^seg:(\d+):(start|end)$/.exec(g.key);
    if (!m) return null;
    const seg = w.segments[Number(m[1])];
    if (!seg || seg.type !== 'line') return null;
    if (m[2] === 'start') {
      return { far: [...seg.end] as Vec3, near: [...seg.start] as Vec3 };
    }
    return { far: [...seg.start] as Vec3, near: [...seg.end] as Vec3 };
  }
  return null;
}

function axisDir(ax: { far: Vec3; near: Vec3 }): Vec3 {
  return normalize(sub(ax.near, ax.far));
}

function projectOnAxis(ax: { far: Vec3; near: Vec3 }, p: Vec3): Vec3 {
  const dir = axisDir(ax);
  if (xyLen(dir) < EPS) return [...ax.near] as Vec3;
  return projectOnLine(ax.far, dir, p);
}

function axesCollinear(
  a: { far: Vec3; near: Vec3 },
  b: { far: Vec3; near: Vec3 },
  tol: number,
): boolean {
  const da = axisDir(a);
  const db = axisDir(b);
  if (xyLen(da) < EPS || xyLen(db) < EPS) return false;
  const dot = da[0]! * db[0]! + da[1]! * db[1]!;
  if (Math.abs(Math.abs(dot) - 1) > 0.05) return false;
  const n = leftNormalFromDir(da);
  const d = Math.abs(
    (b.near[0]! - a.far[0]!) * n[0]! + (b.near[1]! - a.far[1]!) * n[1]!,
  );
  return d <= tol;
}

/**
 * Snap d’un cluster : chaque extrémité glisse sur **son** axe (jamais de rotation).
 * L = intersection des supports ; T barre colinéaire = pied ∩ barre ;
 * Y/X = moyenne des intersections 2-à-2, puis projection sur chaque axe.
 */
function resolveClusterSnap(
  group: EndRef[],
  wallById: Map<string, WallEntity>,
  snapTol: number,
): { corner: Vec3; perEnd: Map<string, Vec3> } {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const g of group) {
    sx += g.point[0];
    sy += g.point[1];
    sz += g.point[2];
  }
  const avg: Vec3 = [sx / group.length, sy / group.length, sz / group.length];

  const byWall = new Map<string, EndRef>();
  for (const g of group) {
    if (!byWall.has(g.wallId)) byWall.set(g.wallId, g);
  }
  const unique = [...byWall.values()];
  const valid: { g: EndRef; ax: { far: Vec3; near: Vec3 } }[] = [];
  for (const g of unique) {
    const ax = endRefAxis(g, wallById);
    if (ax) valid.push({ g, ax });
  }

  const maxReach = Math.max(snapTol * 4, 1.0);
  let P: Vec3 = avg;

  if (valid.length === 2) {
    const a = valid[0]!.ax;
    const b = valid[1]!.ax;
    const hit = lineIntersect2d(
      a.far,
      sub(a.near, a.far),
      b.far,
      sub(b.near, b.far),
    );
    if (
      hit &&
      dist(hit, valid[0]!.g.point) <= maxReach &&
      dist(hit, valid[1]!.g.point) <= maxReach
    ) {
      P = hit;
    } else if (!hit) {
      P = projectOnAxis(a, avg);
    }
  } else if (valid.length >= 3) {
    let barI = -1;
    let barJ = -1;
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const da = axisDir(valid[i]!.ax);
        const db = axisDir(valid[j]!.ax);
        const dot = da[0]! * db[0]! + da[1]! * db[1]!;
        if (dot <= -0.95 && axesCollinear(valid[i]!.ax, valid[j]!.ax, snapTol)) {
          barI = i;
          barJ = j;
          break;
        }
      }
      if (barI >= 0) break;
    }
    if (barI >= 0) {
      const bar = valid[barI]!.ax;
      const stem = valid.find((_, k) => k !== barI && k !== barJ);
      if (stem) {
        const hit = lineIntersect2d(
          stem.ax.far,
          sub(stem.ax.near, stem.ax.far),
          bar.far,
          sub(bar.near, bar.far),
        );
        if (hit && dist(hit, stem.g.point) <= maxReach) P = hit;
        else P = projectOnAxis(bar, avg);
      } else {
        P = projectOnAxis(bar, avg);
      }
    } else {
      const hits: Vec3[] = [];
      for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
          const hit = lineIntersect2d(
            valid[i]!.ax.far,
            sub(valid[i]!.ax.near, valid[i]!.ax.far),
            valid[j]!.ax.far,
            sub(valid[j]!.ax.near, valid[j]!.ax.far),
          );
          if (!hit) continue;
          if (
            dist(hit, valid[i]!.g.point) <= maxReach &&
            dist(hit, valid[j]!.g.point) <= maxReach
          ) {
            hits.push(hit);
          }
        }
      }
      if (hits.length > 0) {
        P = [
          hits.reduce((s, h) => s + h[0], 0) / hits.length,
          hits.reduce((s, h) => s + h[1], 0) / hits.length,
          hits.reduce((s, h) => s + h[2], 0) / hits.length,
        ];
      }
    }
  }

  const perEnd = new Map<string, Vec3>();
  for (const g of group) {
    const ax = endRefAxis(g, wallById);
    perEnd.set(`${g.wallId}|${g.key}`, ax ? projectOnAxis(ax, P) : ([...P] as Vec3));
  }
  return { corner: P, perEnd };
}

function collectWallEndsInBox(
  e: WallEntity,
  inBox: (p: Vec3) => boolean,
): EndRef[] {
  const ends: EndRef[] = [];
  const push = (key: string, p: Vec3) => {
    if (inBox(p)) {
      ends.push({ wallId: e.id, key, point: [p[0], p[1], p[2]] });
    }
  };

  if (e.path === 'line') {
    push('start', e.start);
    push('end', e.end);
    return ends;
  }

  if (e.path === 'arc') {
    push('start', e.start);
    push('end', e.end);
    return ends;
  }

  // path === 'poly' : chaque extrémité de segment
  const segs = e.segments ?? [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.type === 'line') {
      push(`seg:${i}:start`, s.start);
      push(`seg:${i}:end`, s.end);
    } else {
      push(`seg:${i}:start`, [
        s.center[0] + s.radius * Math.cos(s.startAngle),
        s.center[1] + s.radius * Math.sin(s.startAngle),
        s.center[2],
      ]);
      push(`seg:${i}:end`, [
        s.center[0] + s.radius * Math.cos(s.endAngle),
        s.center[1] + s.radius * Math.sin(s.endAngle),
        s.center[2],
      ]);
    }
  }
  return ends;
}

export type JonctionResult = {
  entities: Entity[];
  /** Entités après snap des extrémités, **avant** recalcul des joints. */
  snappedEntities: Entity[];
  wallsTouched: number;
  clusters: number;
  /** Degré max d’un nœud fusionné (nb d’extrémités dans le plus gros cluster). */
  maxNodeDegree: number;
  /** Signature du plus gros nœud (pour mémoriser la solution Y/N). */
  signature: string | null;
  /**
   * Plus petite distance entre deux extrémités de murs distincts dans le cadre
   * (utile si aucun snap : « trop loin, plus proche = X cm »).
   */
  nearestEndDist: number | null;
};

/**
 * Signature d’un nœud : nb murs, nb couches, priorités, angles leave (5°).
 * Sert à mémoriser la stratégie préférée pour un même type de raccord.
 */
function buildNodeSignature(
  group: EndRef[],
  entities: readonly Entity[],
  corner: Vec3,
): string {
  const wallById = new Map(
    entities.filter((e): e is WallEntity => e.kind === 'wall').map((w) => [w.id, w]),
  );
  const angles: number[] = [];
  let layers = 0;
  const prios = new Set<number>();
  for (const g of group) {
    const w = wallById.get(g.wallId);
    if (!w) continue;
    layers = Math.max(layers, w.lines?.length ?? 0);
    for (const ln of w.lines ?? []) prios.add(layerPriorityOf(ln));
    let other: Vec3 | null = null;
    if (g.key === 'start') other = w.end;
    else if (g.key === 'end') other = w.start;
    else if (g.key.startsWith('seg:') && w.path === 'poly' && w.segments) {
      const m = /^seg:(\d+):(start|end)$/.exec(g.key);
      if (m) {
        const seg = w.segments[Number(m[1])];
        if (seg?.type === 'line') {
          other = m[2] === 'start' ? seg.end : seg.start;
        }
      }
    }
    if (!other) continue;
    const dx = other[0] - corner[0];
    const dy = other[1] - corner[1];
    if (Math.hypot(dx, dy) < EPS) continue;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    angles.push(Math.round(deg / 5) * 5);
  }
  angles.sort((a, b) => a - b);
  const prioKey = [...prios].sort((a, b) => a - b).join('+') || '3';
  return `${group.length}w/${layers}L/p${prioKey}/${angles.join(',')}`;
}

/**
 * /jonction : dans un cadre, regroupe les extrémités de murs (simples **et**
 * polymurs) proches, les fusionne **sur les axes** (jamais de rotation),
 * puis recalcule les onglets.
 */
export function snapAndRejoinWallsInBox(
  entities: readonly Entity[],
  box: { minX: number; minY: number; maxX: number; maxY: number },
  snapTol = WALL_REJOIN_SNAP_TOL,
  strategy: JonctionStrategyId = 'first-hit',
): JonctionResult {
  const inBox = (p: Vec3) =>
    p[0] >= box.minX &&
    p[0] <= box.maxX &&
    p[1] >= box.minY &&
    p[1] <= box.maxY;

  const wallById = new Map(
    entities
      .filter((e): e is WallEntity => e.kind === 'wall')
      .map((w) => [w.id, w]),
  );

  const ends: EndRef[] = [];
  for (const e of entities) {
    if (e.kind !== 'wall') continue;
    ends.push(...collectWallEndsInBox(e, inBox));
  }

  if (ends.length < 2) {
    const joined = applyWallJointsToEntities(entities, WALL_JOIN_TOL, strategy);
    return {
      entities: joined,
      snappedEntities: entities.map((e) => ({ ...e })),
      wallsTouched: 0,
      clusters: 0,
      maxNodeDegree: 0,
      signature: null,
      nearestEndDist: null,
    };
  }

  // Plus petite distance entre extrémités de murs distincts (diagnostic)
  let nearestEndDist: number | null = null;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i]!.wallId === ends[j]!.wallId) continue;
      const d = dist(ends[i]!.point, ends[j]!.point);
      if (nearestEndDist == null || d < nearestEndDist) nearestEndDist = d;
    }
  }

  const { rep } = clusterPoints(
    ends.map((e) => e.point),
    snapTol,
  );
  const clusters = new Map<number, EndRef[]>();
  for (let i = 0; i < ends.length; i++) {
    const r = rep[i]!;
    const list = clusters.get(r) ?? [];
    list.push(ends[i]!);
    clusters.set(r, list);
  }

  const snapAt = new Map<string, Vec3>();
  let multiClusters = 0;
  let maxNodeDegree = 0;
  let maxSnapGap = 0;
  let signature: string | null = null;
  const wallsTouched = new Set<string>();

  for (const group of clusters.values()) {
    if (group.length < 2) continue;
    multiClusters += 1;
    for (const g of group) wallsTouched.add(g.wallId);

    const { corner, perEnd } = resolveClusterSnap(group, wallById, snapTol);
    for (const [k, p] of perEnd) snapAt.set(k, p);
    const pts = [...perEnd.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        maxSnapGap = Math.max(maxSnapGap, dist(pts[i]!, pts[j]!));
      }
    }
    if (group.length > maxNodeDegree) {
      maxNodeDegree = group.length;
      signature = buildNodeSignature(group, entities, corner);
    }
  }

  if (snapAt.size === 0) {
    // Extrémités dans le cadre mais trop loin pour fusionner → recalcul joints seuls
    const joined = applyWallJointsToEntities(entities, WALL_JOIN_TOL, strategy);
    return {
      entities: joined,
      snappedEntities: entities.map((e) => ({ ...e })),
      wallsTouched: 0,
      clusters: 0,
      maxNodeDegree: 0,
      signature: null,
      nearestEndDist,
    };
  }

  const next = entities.map((e): Entity => {
    if (e.kind !== 'wall') return e;

    if (e.path === 'line' || e.path === 'arc') {
      const ns = snapAt.get(`${e.id}|start`);
      const ne = snapAt.get(`${e.id}|end`);
      if (!ns && !ne) return e;
      const start = ns ? ([...ns] as Vec3) : ([...e.start] as Vec3);
      const end = ne ? ([...ne] as Vec3) : ([...e.end] as Vec3);
      if (e.path === 'arc' && e.center && e.radius != null) {
        // Recaler les angles si extrémités bougent (même centre)
        const startAngle = Math.atan2(
          start[1] - e.center[1],
          start[0] - e.center[0],
        );
        const endAngle = Math.atan2(end[1] - e.center[1], end[0] - e.center[0]);
        return {
          ...e,
          start,
          end,
          startAngle,
          endAngle,
          strokeGeom: undefined,
        };
      }
      return {
        ...e,
        start,
        end,
        strokeGeom: undefined,
      };
    }

    // Polymur
    if (e.path === 'poly' && e.segments?.length) {
      let changed = false;
      const segments: WallSegment[] = e.segments.map((s, i) => {
        if (s.type === 'line') {
          const ns = snapAt.get(`${e.id}|seg:${i}:start`);
          const ne = snapAt.get(`${e.id}|seg:${i}:end`);
          if (!ns && !ne) {
            return {
              type: 'line' as const,
              start: [...s.start] as Vec3,
              end: [...s.end] as Vec3,
            };
          }
          changed = true;
          return {
            type: 'line' as const,
            start: ns ? ([...ns] as Vec3) : ([...s.start] as Vec3),
            end: ne ? ([...ne] as Vec3) : ([...s.end] as Vec3),
          };
        }
        // Arc : recaler angles si extrémités snappées
        const ns = snapAt.get(`${e.id}|seg:${i}:start`);
        const ne = snapAt.get(`${e.id}|seg:${i}:end`);
        if (!ns && !ne) {
          return {
            ...s,
            center: [...s.center] as Vec3,
            normal: [...s.normal] as Vec3,
          };
        }
        changed = true;
        const start = ns ?? [
          s.center[0] + s.radius * Math.cos(s.startAngle),
          s.center[1] + s.radius * Math.sin(s.startAngle),
          s.center[2],
        ];
        const end = ne ?? [
          s.center[0] + s.radius * Math.cos(s.endAngle),
          s.center[1] + s.radius * Math.sin(s.endAngle),
          s.center[2],
        ];
        const startAngle = Math.atan2(
          start[1] - s.center[1],
          start[0] - s.center[0],
        );
        const endAngle = Math.atan2(
          end[1] - s.center[1],
          end[0] - s.center[0],
        );
        // Préserver le sens CW/CCW approximatif
        let a0 = startAngle;
        let a1 = endAngle;
        if (s.endAngle < s.startAngle) {
          while (a1 > a0) a1 -= Math.PI * 2;
        } else {
          while (a1 < a0) a1 += Math.PI * 2;
        }
        return {
          type: 'arc' as const,
          center: [...s.center] as Vec3,
          radius: s.radius,
          startAngle: a0,
          endAngle: a1,
          normal: [...s.normal] as Vec3,
        };
      });

      if (!changed) return e;

      // Cohérence joints entre segments consécutifs (même point)
      for (let i = 0; i < segments.length - 1; i++) {
        const a = segments[i]!;
        const b = segments[i + 1]!;
        if (a.type === 'line' && b.type === 'line') {
          // Si l’un a été snappé, l’autre suit
          if (dist(a.end, b.start) > 1e-9 && dist(a.end, b.start) < snapTol * 2) {
            const mid: Vec3 = [
              (a.end[0] + b.start[0]) / 2,
              (a.end[1] + b.start[1]) / 2,
              (a.end[2] + b.start[2]) / 2,
            ];
            a.end = mid;
            b.start = mid;
          }
        }
      }

      const first = segments[0]!;
      const last = segments[segments.length - 1]!;
      const start =
        first.type === 'line'
          ? first.start
          : ([
              first.center[0] + first.radius * Math.cos(first.startAngle),
              first.center[1] + first.radius * Math.sin(first.startAngle),
              first.center[2],
            ] as Vec3);
      const end =
        last.type === 'line'
          ? last.end
          : ([
              last.center[0] + last.radius * Math.cos(last.endAngle),
              last.center[1] + last.radius * Math.sin(last.endAngle),
              last.center[2],
            ] as Vec3);

      return {
        ...e,
        segments,
        start,
        end,
        strokeGeom: undefined,
      };
    }

    return e;
  });

  const joinTol = Math.max(WALL_JOIN_TOL, maxSnapGap + 1e-6);
  return {
    entities: applyWallJointsToEntities(next, joinTol, strategy),
    snappedEntities: next,
    wallsTouched: wallsTouched.size,
    clusters: multiClusters,
    maxNodeDegree,
    signature,
    nearestEndDist,
  };
}

export function createLinearWallEntity(
  start: Vec3,
  end: Vec3,
  style: WallStyle,
  flip: boolean,
): WallEntity {
  return {
    id: nextWallId(),
    kind: 'wall',
    layer: 'MURS',
    styleId: style.id,
    path: 'line',
    flip,
    lines: style.lines.map((l) => ({ ...l })),
    start: [start[0], start[1], start[2]],
    end: [end[0], end[1], end[2]],
  };
}

export function createArcWallEntity(
  center: Vec3,
  radius: number,
  startAngle: number,
  endAngle: number,
  style: WallStyle,
  flip: boolean,
): WallEntity {
  return {
    id: nextWallId(),
    kind: 'wall',
    layer: 'MURS',
    styleId: style.id,
    path: 'arc',
    flip,
    lines: style.lines.map((l) => ({ ...l })),
    start: [
      center[0] + radius * Math.cos(startAngle),
      center[1] + radius * Math.sin(startAngle),
      center[2],
    ],
    end: [
      center[0] + radius * Math.cos(endAngle),
      center[1] + radius * Math.sin(endAngle),
      center[2],
    ],
    center: [center[0], center[1], center[2]],
    radius,
    startAngle,
    endAngle,
    normal: v3(0, 0, 1),
  };
}

export function wallProfileWidth(lines: readonly WallLineDef[]): number {
  if (lines.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const l of lines) {
    min = Math.min(min, l.offset);
    max = Math.max(max, l.offset);
  }
  return Math.max(0, max - min);
}

export function paintWallCell(
  ctx: CanvasRenderingContext2D,
  size: number,
  lines: readonly WallLineDef[],
  opts?: { empty?: boolean; selected?: boolean },
): void {
  const pad = 3;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = opts?.empty ? '#1e2430' : '#2a303c';
  ctx.fillRect(0, 0, size, size);

  if (opts?.selected) {
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  } else {
    ctx.strokeStyle = '#3a4250';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  if (!lines.length) return;

  const offsets = lines.map((l) => l.offset);
  const minO = Math.min(...offsets);
  const maxO = Math.max(...offsets);
  const span = Math.max(maxO - minO, 1e-6);
  const usable = size - 2 * pad;
  const y0 = pad;
  const y1 = size - pad;

  for (const ln of lines) {
    const t = (ln.offset - minO) / span;
    const x = pad + t * usable;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.strokeStyle = ln.color === '#000000' || ln.color === '#000' ? '#e0e0e0' : ln.color;
    ctx.lineWidth = Math.max(1, Math.min(4, ln.lineWidth));
    ctx.setLineDash(ln.lineStyle !== 'plein' ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Petit repère de priorité (1 = structure, …) si défini
    if (typeof ln.priority === 'number' && Number.isFinite(ln.priority)) {
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(ln.priority)), x, pad + 9);
    }
  }
}

export function defaultTabName(): string {
  return 'Général';
}

export function emptyWallStyle(tab: string, name?: string): WallStyle {
  return {
    id: nextWallStyleId(),
    name: name ?? 'Nouveau mur',
    tab,
    lines: [],
  };
}
