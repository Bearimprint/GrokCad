/**
 * Un seul traceur d'aperçu pour le déplacement, la rotation et le stretch.
 * Le vecteur (curseur brut ou extrémité contrainte) est ajouté par l'appelant.
 */

import { sampleArc, sampleCircle } from '../../drawing';
import { buildDimensionGeom } from '../../dimension';
import { objectInstanceStrokes } from '../../objectInstance';
import { polylineStrokes } from '../../polyline';
import type { Entity, LineStyleId, Vec3 } from '../../types';
import type { UnitId } from '../../units';
import { wallEntityStrokes } from '../../walls';

export interface PreviewStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

export interface EntityPreviewOpts {
  color: string;
  /** Décalage des échantillons. 0 si l'entité est déjà transformée. */
  dx?: number;
  dy?: number;
  /**
   * Marqueur des entités `point` :
   * - `cross` : croix (déplacement multiple, demi-taille liée au zoom)
   * - `hline` : trait horizontal (stretch et déplacement d'un seul objet)
   */
  pointMark?: 'cross' | 'hline';
  /** Demi-taille imposée. Sinon 0,05 (trait) ou la formule zoom (croix). */
  pointHalf?: number;
  worldPerPixel?: number;
  polySamples?: number;
  arcSamples?: number;
  wallSamples?: number;
  /**
   * `offset` : reconstruit la cotation avec ancre et points décalés.
   * `entity` : géométrie déjà portée par l'entité (libellés inclus).
   */
  dimension?: 'offset' | 'entity';
  /** Kinds ignorés (le stretch n'affiche pas texte, objet, cotation). */
  skip?: ReadonlySet<string>;
  unit?: UnitId;
}

export function appendEntityPreview(
  e: Entity,
  out: PreviewStroke[],
  opts: EntityPreviewOpts,
): void {
  if (opts.skip?.has(e.kind)) return;
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  const color = opts.color;
  const shift = (p: Vec3): Vec3 => [p[0] + dx, p[1] + dy, p[2]];

  if (e.kind === 'line') {
    out.push({
      points: [shift(e.start), shift(e.end)],
      color,
      lineWidth: e.lineWidth,
      lineStyle: e.lineStyle,
    });
    return;
  }

  if (e.kind === 'arc' || e.kind === 'circle') {
    const n = opts.arcSamples ?? 32;
    const samples = e.kind === 'circle' ? sampleCircle(e, n) : sampleArc(e, n);
    out.push({
      points: samples.map(shift),
      color,
      lineWidth: e.lineWidth,
      lineStyle: e.lineStyle,
    });
    return;
  }

  if (e.kind === 'wall') {
    for (const s of wallEntityStrokes(e, opts.wallSamples ?? 16, opts.unit ?? 'm')) {
      out.push({
        points: s.points.map(shift),
        color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    }
    return;
  }

  if (e.kind === 'object') {
    for (const s of objectInstanceStrokes(e)) {
      out.push({
        points: s.points.map(shift),
        color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    }
    return;
  }

  if (e.kind === 'text') {
    const p = shift(e.position);
    const h = e.height * 0.5;
    out.push(
      {
        points: [
          [p[0] - h, p[1], p[2]],
          [p[0] + h, p[1], p[2]],
        ],
        color,
        lineWidth: 1,
        lineStyle: 'plein',
      },
      {
        points: [
          [p[0], p[1] - h, p[2]],
          [p[0], p[1] + h, p[2]],
        ],
        color,
        lineWidth: 1,
        lineStyle: 'plein',
      },
    );
    return;
  }

  if (e.kind === 'polyline') {
    for (const s of polylineStrokes(e, opts.polySamples ?? 24)) {
      out.push({
        points: s.points.map(shift),
        color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    }
    return;
  }

  if (e.kind === 'point') {
    const p = shift(e.position);
    const mark = opts.pointMark ?? 'hline';
    const h =
      opts.pointHalf ??
      (mark === 'cross'
        ? Math.max(0.02, e.lineWidth * 0.5 * (opts.worldPerPixel ?? 1))
        : 0.05);
    out.push({
      points: [
        [p[0] - h, p[1], p[2]],
        [p[0] + h, p[1], p[2]],
      ],
      color,
      lineWidth: e.lineWidth,
      lineStyle: 'plein',
    });
    if (mark === 'cross') {
      out.push({
        points: [
          [p[0], p[1] - h, p[2]],
          [p[0], p[1] + h, p[2]],
        ],
        color,
        lineWidth: e.lineWidth,
        lineStyle: 'plein',
      });
    }
    return;
  }

  if (e.kind === 'dimension') {
    const geom =
      opts.dimension === 'offset'
        ? buildDimensionGeom(
            e.style,
            shift(e.lineAnchor),
            e.direction,
            e.defPoints.map(shift),
          )
        : buildDimensionGeom(e.style, e.lineAnchor, e.direction, e.defPoints, {
            labelPositions: e.labelPositions,
            labelRotations: e.labelRotations,
          });
    for (const s of geom.strokes) {
      out.push({
        points: s.points,
        color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      });
    }
  }
}
