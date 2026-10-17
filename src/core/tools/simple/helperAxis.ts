/**
 * /hx /hy /hz — pose une aide parallèle à un axe.
 */

import {
  helperParallelX,
  helperParallelY,
  helperParallelZ,
} from '../../helpers';
import type { HelperLineEntity, Vec3 } from '../../types';
import type { ToolFeedback } from '../types';

export type HelperAxisId = 'x' | 'y' | 'z';

export function placeHelperOnAxis(args: {
  axis: HelperAxisId;
  pt: Vec3;
  add(helper: HelperLineEntity): void;
  feedback: ToolFeedback;
  len(n: number): string;
}): void {
  const { axis, pt } = args;
  if (axis === 'x') {
    args.add(helperParallelX(pt[1], pt[2]));
    args.feedback(
      `Aide // X  à Y=${args.len(pt[1])} Z=${args.len(pt[2])}  (X ignoré)`,
      'ok',
    );
    return;
  }
  if (axis === 'y') {
    args.add(helperParallelY(pt[0], pt[2]));
    args.feedback(
      `Aide // Y  à X=${args.len(pt[0])} Z=${args.len(pt[2])}  (Y ignoré)`,
      'ok',
    );
    return;
  }
  args.add(helperParallelZ(pt[0], pt[1]));
  args.feedback(
    `Aide // Z  en X=${args.len(pt[0])} Y=${args.len(pt[1])}  (Z ignoré)`,
    'ok',
  );
}
