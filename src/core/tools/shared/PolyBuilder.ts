/**
 * Entrée commune des outils chaîne (/pline /parc /parct et /pmur /pmarc /pmarct).
 * Le contenu (messages, tangente, flip) reste fourni par l'appelant.
 */

import type { Vec3 } from '../../types';

export interface ChainCursor {
  p0: Vec3 | null;
  p1: Vec3 | null;
  step: number;
  contPoint: Vec3 | null;
  contTangent: Vec3 | null;
}

/**
 * Bascule ou démarre un outil de polyligne / polymur.
 * @returns le tip conservé si on change de mode au milieu d'une chaîne.
 */
export function enterChainedTool(args: {
  switching: boolean;
  /** Abandonne l'outil précédent (pas un simple changement de mode). */
  reset(): void;
  /** Pointe courante à conserver lors d'un changement de mode. */
  currentTip(): Vec3 | null;
  /** Oublie le point de passage / la tangente en cours. */
  clearPending(cursor: ChainCursor): void;
  /** Pose kind, id de chaîne, flip, écouteurs propres au mode. */
  assignIdentity(): void;
  armPick(): void;
  cursor: ChainCursor;
}): Vec3 | null {
  let tip: Vec3 | null = null;
  if (args.switching) {
    tip = args.currentTip();
    args.clearPending(args.cursor);
  } else {
    args.reset();
  }
  args.assignIdentity();
  args.armPick();
  if (tip) {
    args.cursor.p0 = tip;
    return tip;
  }
  args.cursor.p0 = null;
  args.cursor.p1 = null;
  args.cursor.step = 0;
  args.cursor.contPoint = null;
  args.cursor.contTangent = null;
  return null;
}
