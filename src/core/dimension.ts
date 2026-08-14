/**
 * Géométrie des cotations architecturales linéaires.
 *
 * Ligne de côte // direction, passant par lineAnchor.
 * Lignes d’attache ⟂ direction, depuis les defPoints.
 * Distance affichée = |projection (p1−p0) sur direction|.
 * Libellés : baseline décalée de `style.textOffset`, positions stockables.
 */

import type {
  DimensionEntity,
  DimensionStyle,
  LineStyleId,
  TextEntity,
  Vec3,
} from './types';
import { formatLength, type UnitId } from './units';

const DRAW_LAYER = 'DESSIN';
const EPS = 1e-12;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export interface DimStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

export interface DimLabel {
  content: string;
  position: Vec3;
  rotation: number;
  height: number;
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  background: string | null;
  /** 0=baseline (défaut cotations). */
  hAlign: number;
  vAlign: number;
}

export interface DimGeom {
  strokes: DimStroke[];
  labels: DimLabel[];
}

/** Normalise direction XY (Z ignoré). */
export function normalizeDimDir(d: Vec3): Vec3 | null {
  const L = Math.hypot(d[0], d[1]);
  if (L < EPS) return null;
  return [d[0] / L, d[1] / L, 0];
}

/** Projection scalaire de p sur l’axe (anchor + t·dir). */
export function projectScalar(p: Vec3, anchor: Vec3, dir: Vec3): number {
  return (p[0] - anchor[0]) * dir[0] + (p[1] - anchor[1]) * dir[1];
}

/** Point sur la ligne de côte correspondant à la projection de p. */
export function projectOnDimLine(p: Vec3, anchor: Vec3, dir: Vec3): Vec3 {
  const t = projectScalar(p, anchor, dir);
  return [anchor[0] + t * dir[0], anchor[1] + t * dir[1], anchor[2]];
}

/**
 * Rotation lisible du texte (// direction, pas à l’envers)
 * + normale « au-dessus » de la ligne pour le décalage textOffset.
 */
export function dimTextOrientation(dir: Vec3): {
  rotation: number;
  /** Unitaire ⟂ dir, côté « dessus » du texte. */
  normal: Vec3;
} {
  let rot = Math.atan2(dir[1], dir[0]);
  let nx = -dir[1];
  let ny = dir[0];
  // Si on retourne le texte de 180°, inverser la normale pour garder le texte du même côté visuel
  if (rot > Math.PI / 2 || rot < -Math.PI / 2) {
    rot += Math.PI;
    nx = -nx;
    ny = -ny;
  }
  const nL = Math.hypot(nx, ny) || 1;
  return {
    rotation: rot,
    normal: [nx / nL, ny / nL, 0],
  };
}

/**
 * Position par défaut d’un libellé : milieu du segment de côte + textOffset ⟂.
 * `position` = point de **baseline** (centre horizontal).
 */
export function defaultLabelPosition(
  a: Vec3,
  b: Vec3,
  dir: Vec3,
  textOffset: number,
): Vec3 {
  const { normal } = dimTextOrientation(dir);
  const off = Number.isFinite(textOffset) ? textOffset : 0;
  return [
    (a[0] + b[0]) / 2 + normal[0] * off,
    (a[1] + b[1]) / 2 + normal[1] * off,
    (a[2] + b[2]) / 2 + 0.001,
  ];
}

/**
 * Construit les traits + labels d’une cotation (ou d’un aperçu partiel).
 */
export function buildDimensionGeom(
  style: DimensionStyle,
  lineAnchor: Vec3,
  direction: Vec3,
  defPoints: readonly Vec3[],
  opts?: {
    /** Point souris (projection) pour le dernier segment en cours. */
    previewEnd?: Vec3;
    unit?: UnitId;
    /**
     * Positions stockées des libellés (par segment).
     * Si absente pour un index → calcul défaut (milieu + textOffset).
     */
    labelPositions?: readonly (Vec3 | null | undefined)[];
    /** Rotations Z stockées des libellés (radians). */
    labelRotations?: readonly (number | null | undefined)[];
  },
): DimGeom {
  const dir = normalizeDimDir(direction);
  if (!dir) return { strokes: [], labels: [] };

  const nx = -dir[1];
  const ny = dir[0];
  const z = lineAnchor[2];
  const strokeBase = {
    color: style.lineColor,
    lineWidth: style.lineWidth,
    lineStyle: style.lineStyle,
  };

  const pts = [...defPoints];
  if (opts?.previewEnd) pts.push(opts.previewEnd);
  if (pts.length < 2) return { strokes: [], labels: [] };

  const strokes: DimStroke[] = [];
  const labels: DimLabel[] = [];
  const unit = opts?.unit ?? 'm';
  const digits = unit === 'mm' ? 1 : unit === 'cm' ? 2 : 3;
  const textOffset = style.textOffset ?? 0.05;
  const { rotation } = dimTextOrientation(dir);

  const projected: Vec3[] = pts.map((p) => projectOnDimLine(p, lineAnchor, dir));

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const onLine = projected[i]!;

    const vx = onLine[0] - p[0];
    const vy = onLine[1] - p[1];
    const dist = Math.hypot(vx, vy);
    let ux = 0;
    let uy = 0;
    if (dist > EPS) {
      ux = vx / dist;
      uy = vy / dist;
    } else {
      ux = nx;
      uy = ny;
    }

    const start: Vec3 = [
      p[0] + ux * style.extensionOffset,
      p[1] + uy * style.extensionOffset,
      z,
    ];
    const end: Vec3 = [
      onLine[0] + ux * style.extensionOverhang,
      onLine[1] + uy * style.extensionOverhang,
      z,
    ];
    strokes.push({
      points: [start, end],
      ...strokeBase,
    });

    if (style.tickSize > 0) {
      const half = style.tickSize / 2;
      const c45 = Math.SQRT1_2;
      const tx = (dir[0] + nx) * c45;
      const ty = (dir[1] + ny) * c45;
      const tL = Math.hypot(tx, ty) || 1;
      const tux = tx / tL;
      const tuy = ty / tL;
      strokes.push({
        points: [
          [onLine[0] - tux * half, onLine[1] - tuy * half, z],
          [onLine[0] + tux * half, onLine[1] + tuy * half, z],
        ],
        ...strokeBase,
      });
    }
  }

  for (let i = 0; i + 1 < projected.length; i++) {
    const a = projected[i]!;
    const b = projected[i + 1]!;
    strokes.push({
      points: [a, b],
      ...strokeBase,
    });

    const raw =
      (pts[i + 1]![0] - pts[i]![0]) * dir[0] +
      (pts[i + 1]![1] - pts[i]![1]) * dir[1];
    const distVal = Math.abs(raw);

    const stored = opts?.labelPositions?.[i];
    const position: Vec3 =
      stored && Array.isArray(stored)
        ? [stored[0], stored[1], stored[2] ?? z]
        : defaultLabelPosition(a, b, dir, textOffset);

    const rotStored = opts?.labelRotations?.[i];
    const labelRot =
      typeof rotStored === 'number' && Number.isFinite(rotStored)
        ? rotStored
        : rotation;

    labels.push({
      content: formatLength(distVal, unit, digits),
      position,
      rotation: labelRot,
      height: style.textHeight,
      color: style.textColor,
      fontFamily: style.fontFamily,
      bold: style.bold,
      italic: style.italic,
      background: style.textBackground,
      hAlign: 1, // centre
      vAlign: 0, // baseline
    });
  }

  return { strokes, labels };
}

/** Calcule les positions de libellés par défaut pour tous les segments. */
export function computeDefaultLabelPositions(
  style: DimensionStyle,
  lineAnchor: Vec3,
  direction: Vec3,
  defPoints: readonly Vec3[],
): Vec3[] {
  const dir = normalizeDimDir(direction);
  if (!dir || defPoints.length < 2) return [];
  const projected = defPoints.map((p) => projectOnDimLine(p, lineAnchor, dir));
  const out: Vec3[] = [];
  const off = style.textOffset ?? 0.05;
  for (let i = 0; i + 1 < projected.length; i++) {
    out.push(defaultLabelPosition(projected[i]!, projected[i + 1]!, dir, off));
  }
  return out;
}

/**
 * Crée **un segment** de cotation `/cote` + son TextEntity libellé.
 * Les deux sont des entités du document (texte sélectionnable / déplaçable).
 */
export function createSingleCoteSegment(
  style: DimensionStyle,
  lineAnchor: Vec3,
  direction: Vec3,
  p0: Vec3,
  p1: Vec3,
  opts?: { unit?: UnitId; layer?: string },
): { dim: DimensionEntity; text: TextEntity } | null {
  const dir = normalizeDimDir(direction);
  if (!dir) return null;
  if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < EPS) return null;

  const anchor: Vec3 = [lineAnchor[0], lineAnchor[1], lineAnchor[2]];
  const defs: Vec3[] = [
    [p0[0], p0[1], p0[2]],
    [p1[0], p1[1], p1[2]],
  ];
  const dimId = nextId('dim');
  const textId = nextId('dimtxt');

  const geom = buildDimensionGeom(style, anchor, dir, defs, {
    unit: opts?.unit ?? 'm',
  });
  const lb = geom.labels[0];
  if (!lb) return null;

  const text: TextEntity = {
    id: textId,
    kind: 'text',
    layer: opts?.layer ?? DRAW_LAYER,
    position: [...lb.position] as Vec3,
    height: lb.height,
    content: lb.content,
    rotation: lb.rotation,
    color: lb.color,
    hAlign: 1,
    vAlign: 0,
    fontFamily: lb.fontFamily,
    bold: lb.bold,
    italic: lb.italic,
    background: lb.background,
    dimId,
  };

  const dim: DimensionEntity = {
    id: dimId,
    kind: 'dimension',
    layer: opts?.layer ?? DRAW_LAYER,
    style: { ...style },
    lineAnchor: anchor,
    direction: dir,
    defPoints: defs,
    labelId: textId,
    mode: 'single',
  };

  return { dim, text };
}

/** @deprecated Préférer createSingleCoteSegment pour /cote. */
export function createDimensionEntity(
  style: DimensionStyle,
  lineAnchor: Vec3,
  direction: Vec3,
  defPoints: Vec3[],
  opts?: {
    id?: string;
    layer?: string;
    labelId?: string;
    mode?: 'single' | 'chain';
  },
): DimensionEntity | null {
  const dir = normalizeDimDir(direction);
  if (!dir || defPoints.length < 2) return null;
  const anchor: Vec3 = [lineAnchor[0], lineAnchor[1], lineAnchor[2]];
  const defs = defPoints.map((p) => [p[0], p[1], p[2]] as Vec3);
  return {
    id: opts?.id ?? nextId('dim'),
    kind: 'dimension',
    layer: opts?.layer ?? DRAW_LAYER,
    style: { ...style },
    lineAnchor: anchor,
    direction: dir,
    defPoints: defs,
    labelId: opts?.labelId,
    mode: opts?.mode ?? (defs.length === 2 ? 'single' : 'chain'),
  };
}

/**
 * Hit-test sur le **corps** de la cotation (lignes uniquement).
 * Le libellé est une TextEntity séparée — hit via findNearestEntity sur les textes.
 */
export function closestOnDimension(
  e: DimensionEntity,
  click: Vec3,
): { point: Vec3; dist: number } {
  const geom = buildDimensionGeom(
    e.style,
    e.lineAnchor,
    e.direction,
    e.defPoints,
  );

  let bestBody: { point: Vec3; dist: number } | null = null;
  for (const s of geom.strokes) {
    for (let i = 0; i + 1 < s.points.length; i++) {
      const near = closestPointOnSeg(s.points[i]!, s.points[i + 1]!, click);
      if (!bestBody || near.dist < bestBody.dist) bestBody = near;
    }
  }
  if (bestBody) return bestBody;
  const d = Math.hypot(
    e.lineAnchor[0] - click[0],
    e.lineAnchor[1] - click[1],
  );
  return { point: [...e.lineAnchor] as Vec3, dist: d };
}

function closestPointOnSeg(
  a: Vec3,
  b: Vec3,
  p: Vec3,
): { point: Vec3; dist: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 < 1e-18 ? 0 : (apx * abx + apy * aby + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  const q: Vec3 = [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t];
  return {
    point: q,
    dist: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]),
  };
}

/** Labels → TextEntity temporaires pour le rendu (non stockés dans le doc). */
export function dimLabelsAsTextEntities(
  dimId: string,
  labels: DimLabel[],
): TextEntity[] {
  return labels.map((lb, i) => ({
    id: `${dimId}__lbl_${i}`,
    kind: 'text' as const,
    layer: DRAW_LAYER,
    position: lb.position,
    height: lb.height,
    content: lb.content,
    rotation: lb.rotation,
    color: lb.color,
    hAlign: lb.hAlign,
    vAlign: lb.vAlign,
    fontFamily: lb.fontFamily,
    bold: lb.bold,
    italic: lb.italic,
    background: lb.background,
  }));
}
