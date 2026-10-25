/**
 * /d — efface l'entité la plus proche, reste actif jusqu'à Échap.
 */

import { findNearestEntity } from '../../designation';
import type { Entity, Vec3 } from '../../types';
import type { ToolFeedback } from '../types';

export function deletePickAtPoint(args: {
  pt: Vec3;
  entities: readonly Entity[];
  maxDist: number;
  snapRadiusPx: number;
  remove(id: string): boolean;
  selection: { has(id: string): boolean; remove(ids: string[]): void } | null;
  feedback: ToolFeedback;
}): void {
  const hit = findNearestEntity(args.pt, args.entities, args.maxDist);
  if (!hit) {
    args.feedback(
      `Aucun élément dans ${args.snapRadiusPx} px — cliquez plus près (ligne, arc, cercle, mur, aide, objet).`,
      'warn',
    );
    return;
  }
  const id = hit.entity.id;
  const kind = hit.entity.kind;
  if (!args.remove(id)) {
    args.feedback('Échec de la suppression.', 'err');
    return;
  }
  if (args.selection?.has(id)) args.selection.remove([id]);
  const label =
    kind === 'line'
      ? 'ligne'
      : kind === 'arc'
        ? 'arc'
        : kind === 'circle'
          ? 'cercle'
          : kind === 'polyline'
            ? 'polyligne'
            : kind === 'point'
              ? 'point'
              : kind === 'wall'
                ? 'mur'
                : kind === 'helper'
                  ? 'aide'
                  : kind === 'object'
                    ? hit.entity.kind === 'object' && hit.entity.insert
                      ? 'insertion (le mur se referme)'
                      : 'objet'
                    : kind;
  args.feedback(
    `Effacé : ${label} — désignez un autre élément, ou Échap pour terminer.`,
    'ok',
  );
}
