/**
 * Annuler / rétablir : entités + unités du document (régression v0.26.0).
 * Run: tsx scripts/test-undo.mts
 */
import { CadDocument } from '../src/core/document.ts';
import { convertFactor } from '../src/core/units.ts';
import type { LineEntity, UnitId } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log('TEST undo');

const doc = new CadDocument();
doc.setUnits('m', { dirty: false });
const restored: Array<[UnitId, UnitId]> = [];
doc.onUnitsRestored((p, n) => restored.push([p, n]));

const line: LineEntity = { id: 'l1', kind: 'line', layer: '0', start: [0, 0, 0], end: [2, 0, 0] };
doc.addEntities([line]);
const endX = () => (doc.entities.find((e) => e.id === 'l1') as LineEntity).end[0];

// Changement d’unité m → cm : un seul pas
doc.convertUnits('cm', convertFactor('m', 'cm'));
assert(doc.units === 'cm', 'unité cm');
assert(near(endX(), 200), 'géométrie ×100');

assert(doc.undo(), 'undo unité');
assert(doc.units === 'm', 'undo restaure m');
assert(near(endX(), 2), 'undo restaure géométrie');
assert(restored.length === 1 && restored[0]![0] === 'cm' && restored[0]![1] === 'm', 'listener undo');

assert(doc.redo(), 'redo unité');
assert(doc.units === 'cm', 'redo réapplique cm');
assert(near(endX(), 200), 'redo réapplique géométrie');
assert(restored.length === 2 && restored[1]![1] === 'cm', 'listener redo');

// Mélange : ajout en cm, puis mm, puis annulations successives
const l2: LineEntity = { id: 'l2', kind: 'line', layer: '0', start: [0, 0, 0], end: [50, 0, 0] };
doc.addEntities([l2]);
doc.convertUnits('mm', convertFactor('cm', 'mm'));
assert(doc.units === 'mm' && near(endX(), 2000), 'mm');
const l2x = () => (doc.entities.find((e) => e.id === 'l2') as LineEntity | undefined)?.end[0];
assert(near(l2x()!, 500), 'l2 en mm');

doc.undo(); // mm → cm
assert(doc.units === 'cm' && near(l2x()!, 50), 'retour cm, l2 présent');
doc.undo(); // retire l2, reste cm
assert(doc.units === 'cm' && l2x() === undefined, 'l2 annulé, unité inchangée');
assert(restored.length === 3, 'pas de listener si unité inchangée');
doc.undo(); // cm → m
assert(doc.units === 'm' && near(endX(), 2), 'retour m');
doc.undo(); // retire l1
assert(doc.entities.length === 0 && doc.units === 'm', 'document vide en m');
assert(!doc.undo(), 'plus rien à annuler');

for (let i = 0; i < 4; i++) assert(doc.redo(), `redo ${i}`);
assert(doc.units === 'mm' && near(endX(), 2000) && near(l2x()!, 500), 'tout rétabli en mm');
assert(!doc.redo(), 'plus rien à rétablir');

// Nouvelle action après undo : la pile redo est vidée
doc.undo();
doc.addEntities([{ id: 'l3', kind: 'line', layer: '0', start: [0, 0, 0], end: [1, 0, 0] } as LineEntity]);
assert(!doc.canRedo, 'redo vidé');
assert(doc.units === 'cm', 'unité cm conservée');

console.log('OK undo');
