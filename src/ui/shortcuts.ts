/** Raccourcis clavier purs (testables sans DOM). */
/**
 * Ctrl/Cmd+Z → undo · Ctrl/Cmd+Y ou Ctrl/Cmd+Shift+Z → redo.
 * `e.key` d’abord (AZERTY/QWERTZ corrects), `e.code` en secours.
 */
export function undoShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = (e.key ?? '').toLowerCase();
  const isZ = k === 'z' || (k.length !== 1 && e.code === 'KeyZ');
  const isY = k === 'y' || (k.length !== 1 && e.code === 'KeyY');
  if (isY) return 'redo';
  if (isZ) return e.shiftKey ? 'redo' : 'undo';
  return null;
}
