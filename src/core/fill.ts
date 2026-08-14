/**
 * /fill — géométrie de remplissage hachure d’une polyligne.
 *
 * Motif = entités d’un .gkd 1 m × 1 m (library/hatch/).
 * Tuilage + rotation + échelle, segments clipés dans le polygone.
 */

import { sampleArc } from './drawing';
import { dist } from './geometry';
import { polylineEnd, polylineStart } from './polyline';
import type {
  Entity,
  HatchFill,
  LineStyleId,
  PolylineEntity,
  Vec3,
} from './types';

const EPS = 1e-9;
const POLY_CLOSE_TOL = 0.001;

export interface HatchStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

/** Polyligne fermée géométriquement (1er ≈ dernier) ou flag closed. */
export function isPolylineClosedGeom(poly: PolylineEntity): boolean {
  if (poly.closed === true) return true;
  const s = polylineStart(poly);
  const e = polylineEnd(poly);
  if (!s || !e) return false;
  return dist(s, e) <= POLY_CLOSE_TOL;
}

/**
 * Anneau 2D (XY) dans le sens du tracé.
 * Si ouverte : ferme virtuellement (dernier → premier) sans segment dessiné.
 */
export function polylineToRing(poly: PolylineEntity, arcSamples = 24): Vec3[] {
  const ring: Vec3[] = [];
  for (const seg of poly.segments) {
    if (seg.type === 'line') {
      if (ring.length === 0) ring.push([...seg.start] as Vec3);
      const last = ring[ring.length - 1]!;
      if (dist(last, seg.start) > EPS) ring.push([...seg.start] as Vec3);
      ring.push([...seg.end] as Vec3);
    } else {
      const fake = {
        id: '',
        kind: 'arc' as const,
        layer: '',
        center: seg.center,
        radius: seg.radius,
        startAngle: seg.startAngle,
        endAngle: seg.endAngle,
        normal: seg.normal,
        color: seg.color,
        lineWidth: seg.lineWidth,
        lineStyle: seg.lineStyle,
      };
      const pts = sampleArc(fake, arcSamples);
      for (const p of pts) {
        if (ring.length === 0 || dist(ring[ring.length - 1]!, p) > EPS) {
          ring.push([...p] as Vec3);
        }
      }
    }
  }
  if (ring.length < 3) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (dist(a, b) > POLY_CLOSE_TOL) {
    ring.push([...a] as Vec3);
  }
  return ring;
}

/** Applique hatch sur une polyligne (marque closed si fermeture virtuelle). */
export function applyHatchToPolyline(
  poly: PolylineEntity,
  hatch: HatchFill,
): PolylineEntity {
  return {
    ...poly,
    // Fermeture géométrique réelle uniquement ; ouverte → fermeture virtuelle au rendu
    closed: isPolylineClosedGeom(poly) ? true : poly.closed,
    hatch: {
      hatchName: hatch.hatchName,
      scale: hatch.scale,
      rotationDeg: hatch.rotationDeg,
    },
  };
}

export function clearHatchFromPolyline(poly: PolylineEntity): PolylineEntity {
  const { hatch: _h, ...rest } = poly;
  return { ...rest, closed: poly.closed };
}

/**
 * Génère les traits de hachure clipés dans la polyligne.
 * @param patternEntities entités du motif (coord. dans [0,1] m idéalement)
 */
export function generateHatchStrokes(
  poly: PolylineEntity,
  patternEntities: readonly Entity[],
  hatch: HatchFill,
): HatchStroke[] {
  const ring = polylineToRing(poly);
  if (ring.length < 4 || patternEntities.length === 0) return [];

  const scale = Math.max(1e-6, hatch.scale);
  const rot = (hatch.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  // Bbox polygone (monde)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  // Marge d’une cellule (rotation)
  const margin = scale * 1.5;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;

  // Cellules du motif (origine monde alignée sur 0,0 grille)
  const i0 = Math.floor(minX / scale) - 1;
  const i1 = Math.ceil(maxX / scale) + 1;
  const j0 = Math.floor(minY / scale) - 1;
  const j1 = Math.ceil(maxY / scale) + 1;

  // Préparer segments motif en unitaires [0,1]
  const patternSegs = patternToSegments(patternEntities);
  const out: HatchStroke[] = [];

  // Limiter le nombre de tuiles (perf)
  const maxTiles = 80 * 80;
  let tiles = 0;

  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (tiles++ > maxTiles) break;
      const ox = i * scale;
      const oy = j * scale;
      for (const seg of patternSegs) {
        // Point motif (u,v) ∈ [0,1]² → monde
        const a = xform(seg.a, ox, oy, scale, cos, sin);
        const b = xform(seg.b, ox, oy, scale, cos, sin);
        const clips = clipSegmentToPolygon(a, b, ring);
        for (const [p0, p1] of clips) {
          if (dist(p0, p1) < 1e-6) continue;
          out.push({
            points: [p0, p1],
            color: seg.color,
            lineWidth: seg.lineWidth,
            lineStyle: seg.lineStyle,
          });
        }
      }
      // Points du motif
      for (const pt of patternPoints(patternEntities)) {
        const p = xform(pt.pos, ox, oy, scale, cos, sin);
        if (pointInPolygon(p, ring)) {
          // Point rendu comme croix minuscule (2 traits)
          const s = 0.02 * scale;
          out.push({
            points: [
              [p[0] - s, p[1], p[2]],
              [p[0] + s, p[1], p[2]],
            ],
            color: pt.color,
            lineWidth: pt.lineWidth,
            lineStyle: 'plein',
          });
          out.push({
            points: [
              [p[0], p[1] - s, p[2]],
              [p[0], p[1] + s, p[2]],
            ],
            color: pt.color,
            lineWidth: pt.lineWidth,
            lineStyle: 'plein',
          });
        }
      }
    }
  }

  return out;
}

function xform(
  p: Vec3,
  ox: number,
  oy: number,
  scale: number,
  cos: number,
  sin: number,
): Vec3 {
  // motif local [0,1]² → scale, rotate around tile origin, translate
  const lx = p[0] * scale;
  const ly = p[1] * scale;
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  return [ox + rx, oy + ry, p[2]];
}

type PatSeg = {
  a: Vec3;
  b: Vec3;
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
};

function patternToSegments(entities: readonly Entity[]): PatSeg[] {
  const out: PatSeg[] = [];
  for (const e of entities) {
    if (e.kind === 'line') {
      out.push({
        a: e.start,
        b: e.end,
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'arc') {
      const pts = sampleArc(e, 16);
      for (let i = 0; i + 1 < pts.length; i++) {
        out.push({
          a: pts[i]!,
          b: pts[i + 1]!,
          color: e.color,
          lineWidth: e.lineWidth,
          lineStyle: e.lineStyle,
        });
      }
    } else if (e.kind === 'circle') {
      // cercle → polygone
      const n = 24;
      const pts: Vec3[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([
          e.center[0] + e.radius * Math.cos(a),
          e.center[1] + e.radius * Math.sin(a),
          e.center[2],
        ]);
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        out.push({
          a: pts[i]!,
          b: pts[i + 1]!,
          color: e.color,
          lineWidth: e.lineWidth,
          lineStyle: e.lineStyle,
        });
      }
    } else if (e.kind === 'polyline') {
      for (const seg of e.segments) {
        if (seg.type === 'line') {
          out.push({
            a: seg.start,
            b: seg.end,
            color: seg.color,
            lineWidth: seg.lineWidth,
            lineStyle: seg.lineStyle,
          });
        } else {
          const fake = {
            id: '',
            kind: 'arc' as const,
            layer: '',
            center: seg.center,
            radius: seg.radius,
            startAngle: seg.startAngle,
            endAngle: seg.endAngle,
            normal: seg.normal,
            color: seg.color,
            lineWidth: seg.lineWidth,
            lineStyle: seg.lineStyle,
          };
          const pts = sampleArc(fake, 12);
          for (let i = 0; i + 1 < pts.length; i++) {
            out.push({
              a: pts[i]!,
              b: pts[i + 1]!,
              color: seg.color,
              lineWidth: seg.lineWidth,
              lineStyle: seg.lineStyle,
            });
          }
        }
      }
    }
  }
  return out;
}

function patternPoints(
  entities: readonly Entity[],
): { pos: Vec3; color: string; lineWidth: number }[] {
  const out: { pos: Vec3; color: string; lineWidth: number }[] = [];
  for (const e of entities) {
    if (e.kind === 'point') {
      out.push({
        pos: e.position,
        color: e.color,
        lineWidth: e.lineWidth,
      });
    }
  }
  return out;
}

/** Point-in-polygon (ray cast XY). */
export function pointInPolygon(p: Vec3, ring: Vec3[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect =
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Clip segment [a,b] au polygone : sous-segments dont le milieu est intérieur.
 */
export function clipSegmentToPolygon(
  a: Vec3,
  b: Vec3,
  ring: Vec3[],
): [Vec3, Vec3][] {
  const ts = new Set<number>([0, 1]);
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    const t = segSegParam(a, b, ring[i]!, ring[i + 1]!);
    if (t != null && t > 1e-9 && t < 1 - 1e-9) ts.add(t);
  }
  const sorted = [...ts].sort((x, y) => x - y);
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const t0 = sorted[i]!;
    const t1 = sorted[i + 1]!;
    const midT = (t0 + t1) / 2;
    const mid: Vec3 = [
      a[0] + (b[0] - a[0]) * midT,
      a[1] + (b[1] - a[1]) * midT,
      a[2] + (b[2] - a[2]) * midT,
    ];
    if (!pointInPolygon(mid, ring)) continue;
    const p0: Vec3 = [
      a[0] + (b[0] - a[0]) * t0,
      a[1] + (b[1] - a[1]) * t0,
      a[2] + (b[2] - a[2]) * t0,
    ];
    const p1: Vec3 = [
      a[0] + (b[0] - a[0]) * t1,
      a[1] + (b[1] - a[1]) * t1,
      a[2] + (b[2] - a[2]) * t1,
    ];
    out.push([p0, p1]);
  }
  return out;
}

/** Param t sur [a,b] de l’intersection avec [c,d], ou null. */
function segSegParam(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number | null {
  const ax = a[0];
  const ay = a[1];
  const adx = b[0] - a[0];
  const ady = b[1] - a[1];
  const bdx = d[0] - c[0];
  const bdy = d[1] - c[1];
  const det = adx * bdy - ady * bdx;
  if (Math.abs(det) < EPS) return null;
  const t = ((c[0] - ax) * bdy - (c[1] - ay) * bdx) / det;
  const u = ((c[0] - ax) * ady - (c[1] - ay) * adx) / det;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return Math.max(0, Math.min(1, t));
}

/** Motif par défaut « lignes 45° » (1 m × 1 m) si biblio vide. */
export function defaultHatchPatternEntities(): Entity[] {
  const color = '#888888';
  const lineWidth = 1;
  const lineStyle = 'plein' as LineStyleId;
  const lines: Entity[] = [];
  // Lignes // à 45° dans le carré unitaire [0,1]²
  const step = 0.1;
  for (let k = -1; k <= 2; k += step) {
    // ligne y = x + k traversant le carré
    const pts = clipUnitDiagonal(k);
    if (pts) {
      lines.push({
        id: `def_hatch_${k}`,
        kind: 'line',
        layer: 'HATCH',
        start: pts[0],
        end: pts[1],
        color,
        lineWidth,
        lineStyle,
      });
    }
  }
  return lines;
}

function clipUnitDiagonal(k: number): [Vec3, Vec3] | null {
  // y = x + k, clip [0,1]²
  const candidates: Vec3[] = [];
  // x=0 → y=k
  if (k >= 0 && k <= 1) candidates.push([0, k, 0]);
  // x=1 → y=1+k
  if (1 + k >= 0 && 1 + k <= 1) candidates.push([1, 1 + k, 0]);
  // y=0 → x=-k
  if (-k >= 0 && -k <= 1) candidates.push([-k, 0, 0]);
  // y=1 → x=1-k
  if (1 - k >= 0 && 1 - k <= 1) candidates.push([1 - k, 1, 0]);
  // dédup
  const uniq: Vec3[] = [];
  for (const p of candidates) {
    if (!uniq.some((q) => dist(p, q) < 1e-9)) uniq.push(p);
  }
  if (uniq.length < 2) return null;
  return [uniq[0]!, uniq[1]!];
}

