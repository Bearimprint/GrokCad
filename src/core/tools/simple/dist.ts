/**
 * /dist — mesure entre deux points, affichée dans l'unité du document.
 */

import { dist } from '../../geometry';
import type { Vec3 } from '../../types';
import { formatLength, lengthDigits, type UnitId } from '../../units';
import type { ToolFeedback } from '../types';

export function distStep(args: {
  pt: Vec3;
  step: number;
  p0: Vec3 | null;
  unit: UnitId;
  feedback: ToolFeedback;
  formatPt(p: Vec3): string;
}): { step: number; p0: Vec3 | null; clearPreview: boolean } {
  if (args.step === 0) {
    args.feedback(
      `DIST — 1er point (${args.formatPt(args.pt)}). 2ᵉ point…  ·  Échap = fin`,
      'ok',
    );
    return { step: 1, p0: [...args.pt] as Vec3, clearPreview: false };
  }
  if (!args.p0) return { step: args.step, p0: args.p0, clearPreview: false };
  const d = dist(args.p0, args.pt);
  const digits = lengthDigits(args.unit);
  const f = (v: number) => formatLength(v, args.unit, digits);
  const dx = args.pt[0] - args.p0[0];
  const dy = args.pt[1] - args.p0[1];
  const dz = args.pt[2] - args.p0[2];
  args.feedback(
    `DIST = ${f(d)}   (Δx ${f(dx)}, Δy ${f(dy)}, Δz ${f(dz)})   ·  recliquer 1er point, Échap = fin`,
    'ok',
  );
  return { step: 0, p0: null, clearPreview: true };
}
