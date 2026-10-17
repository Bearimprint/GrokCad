/**
 * /point — pose un point au clic.
 */

import { createPointEntity } from '../../drawing';
import type { ByLayerFlags, Entity, Vec3 } from '../../types';
import type { ToolFeedback } from '../types';

export function placePointEntity(args: {
  pt: Vec3;
  color: string;
  lineWidth: number;
  byLayer?: ByLayerFlags;
  colorLabel: string;
  add(entity: Entity): void;
  feedback: ToolFeedback;
  formatPt(p: Vec3): string;
}): void {
  args.add(
    createPointEntity(args.pt, {
      color: args.color,
      lineWidth: args.lineWidth,
      byLayer: args.byLayer,
    }),
  );
  args.feedback(
    `Point @ (${args.formatPt(args.pt)})  [${args.colorLabel}, ${args.lineWidth}×${args.lineWidth} px] — recliquer, Échap = fin`,
    'ok',
  );
}
