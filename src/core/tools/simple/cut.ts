/**
 * /cut — coupe l'entité la plus proche dans le rayon snap.
 */

import { applyCut, findNearestCuttable } from '../../cut';
import type { Entity, Vec3 } from '../../types';
import type { ToolFeedback } from '../types';

export function cutAtPoint(args: {
  pt: Vec3;
  entities: readonly Entity[];
  maxDist: number;
  replace(removedId: string, replacements: Entity[]): void;
  feedback: ToolFeedback;
}): void {
  const hit = findNearestCuttable(args.pt, args.entities, args.maxDist);
  if (!hit) return;
  const result = applyCut(hit);
  if (!result) return;
  args.replace(result.removedId, result.replacements);
  if (result.kind === 'line') {
    args.feedback('Ligne coupée → 2 segments.', 'ok');
  } else if (result.kind === 'arc') {
    args.feedback('Arc coupé → 2 arcs.', 'ok');
  } else {
    args.feedback(
      'Cercle ouvert au point de coupe (arc plein) — recliquer pour scinder.',
      'ok',
    );
  }
}
