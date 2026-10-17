/**
 * Contrat d'un outil interactif.
 * `DrawingTools` reste la façade publique ; le dispatcher appelle `onPoint`.
 */

import type { Vec3 } from '../types';

export type ToolFeedbackLevel = 'info' | 'ok' | 'warn' | 'err';

export type ToolFeedback = (
  message: string,
  level?: ToolFeedbackLevel,
) => void;

export type PickSource = 'click' | 'snap' | 'right';

/**
 * Cycle de vie d'un outil. Les outils pas encore extraits de la façade
 * honorent le même cycle via `ToolManager.dispatchPoint`.
 */
export interface CadTool {
  readonly kind: string;
  start(): void;
  onPoint(pt: Vec3, source?: PickSource): void;
  preview(cur: Vec3): void;
  onEscape(): void;
  dispose(): void;
}
