/**
 * /undo /redo enregistrées + raccourcis Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z.
 * Run: tsx scripts/test-undo-commands.mts
 */
import { executeLine, findCommand, type CommandContext } from '../src/commands/registry.ts';
import { CadDocument } from '../src/core/document.ts';
import { undoShortcut } from '../src/ui/shortcuts.ts';
import type { LineEntity } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
console.log('TEST undo commands');

for (const n of ['undo', '/undo', 'u', 'annuler']) assert(findCommand(n)?.name === 'undo', `alias ${n}`);
for (const n of ['redo', '/redo', 'retablir', 'rétablir', 'refaire']) assert(findCommand(n)?.name === 'redo', `alias ${n}`);

const doc = new CadDocument();
const msgs: string[] = [];
const ctx = {
  doc,
  feedback: (m: string) => msgs.push(m),
  tools: { isActive: false, cancel() {} },
  viewport: { clearSnap() {} },
} as unknown as CommandContext;

doc.addEntities([{ id: 'l1', kind: 'line', layer: '0', start: [0, 0, 0], end: [1, 0, 0] } as LineEntity]);
await executeLine('/undo', ctx);
assert(doc.entities.length === 0 && msgs.at(-1) === 'Annulé.', '/undo appelle doc.undo');
await executeLine('/redo', ctx);
assert(doc.entities.length === 1 && msgs.at(-1) === 'Rétabli.', '/redo appelle doc.redo');
await executeLine('/redo', ctx);
assert(msgs.at(-1) === 'Rien à rétablir.', 'redo vide');

const k = (key: string, o: Partial<KeyboardEvent> = {}) =>
  undoShortcut({ key, code: '', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o });
assert(k('z') === 'undo', 'Ctrl+Z');
assert(k('Z', { shiftKey: true }) === 'redo', 'Ctrl+Shift+Z');
assert(k('y') === 'redo', 'Ctrl+Y');
assert(k('z', { ctrlKey: false, metaKey: true }) === 'undo', 'Cmd+Z');
assert(k('z', { ctrlKey: false }) === null, 'Z seul');
assert(k('z', { altKey: true }) === null, 'Ctrl+Alt+Z ignoré');
assert(k('w', { code: 'KeyZ' }) === null, 'AZERTY : touche W physique Z ≠ undo');
assert(k('Unidentified', { code: 'KeyZ' }) === 'undo', 'secours e.code');

console.log('OK undo commands');
