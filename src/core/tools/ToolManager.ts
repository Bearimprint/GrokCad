/**
 * Un seul chemin pour un clic : pick canvas, `acceptPoint` (ligne de commande)
 * et les handlers historiques passent par `dispatchPoint`.
 */

import type { ToolKind } from '../tools';
import type { Vec3 } from '../types';
import type { PickSource } from './types';

export interface ToolDispatch {
  readonly kind: ToolKind;
  onCutPoint(pt: Vec3): void;
  onTrimPoint(pt: Vec3): void;
  onExtendPoint(pt: Vec3): void;
  onCornerPoint(pt: Vec3): void;
  onFillPoint(pt: Vec3): void;
  onDelHatchPoint(pt: Vec3): void;
  onDeletePickPoint(pt: Vec3): void;
  onHelperAxisPoint(pt: Vec3): void;
  onParalPoint(pt: Vec3): void;
  onObjOrigin(pt: Vec3, extract: boolean): void;
  onPlaceObjectPoint(pt: Vec3): void;
  onInsertInPoint(pt: Vec3): void;
  placeAnchor(pt: Vec3, endTool?: boolean): void;
  onRejoinPoint(pt: Vec3, source?: PickSource): void;
  /** Outils dont le clic est encore routé par `DrawingTools.onPoint`. */
  onPoint(pt: Vec3): void;
}

export function dispatchPoint(
  host: ToolDispatch,
  pt: Vec3,
  source: PickSource = 'click',
): boolean {
  const kind = host.kind;
  if (!kind) return false;
  switch (kind) {
    case 'cut':
      host.onCutPoint(pt);
      return true;
    case 'trim':
      host.onTrimPoint(pt);
      return true;
    case 'extend':
      host.onExtendPoint(pt);
      return true;
    case 'corner':
      host.onCornerPoint(pt);
      return true;
    case 'fill':
      void host.onFillPoint(pt);
      return true;
    case 'delh':
      host.onDelHatchPoint(pt);
      return true;
    case 'deletepick':
      host.onDeletePickPoint(pt);
      return true;
    case 'helperaxis':
      host.onHelperAxisPoint(pt);
      return true;
    case 'paral':
      host.onParalPoint(pt);
      return true;
    case 'obj':
      void host.onObjOrigin(pt, false);
      return true;
    case 'extract':
      void host.onObjOrigin(pt, true);
      return true;
    case 'placeobj':
      host.onPlaceObjectPoint(pt);
      return true;
    case 'insertin':
      host.onInsertInPoint(pt);
      return true;
    case 'anchor':
      host.placeAnchor(pt, true);
      return true;
    case 'rejoin':
      host.onRejoinPoint(pt, source);
      return true;
    default:
      host.onPoint(pt);
      return true;
  }
}
