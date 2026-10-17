/**
 * Unités document : tolérances en mètres, $INSUNITS, INSERT circulaire.
 * Run: tsx scripts/test-units.mts
 */
import { createEmptyDocument } from '../src/core/gkd.ts';
import { parseDxf, serializeDxf } from '../src/core/dxf.ts';
import { metersToDoc } from '../src/core/tolerances.ts';
import { snapAndRejoinWallsInBox } from '../src/core/walls.ts';
import type { Entity, UnitId, WallEntity, WallLineDef } from '../src/core/types.ts';

const lines: WallLineDef[] = [
  { offset: 0, color: '#fff', lineWidth: 1, lineStyle: 'plein' },
];

function wall(
  id: string,
  start: [number, number, number],
  end: [number, number, number],
): WallEntity {
  return {
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 'styleA',
    path: 'line',
    flip: false,
    lines: lines.map((l) => ({ ...l })),
    start,
    end,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function almost(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

function insUnitsOf(text: string): number {
  const lines = text.split(/\r\n|\n|\r/);
  const i = lines.indexOf('$INSUNITS');
  if (i < 0 || i + 2 >= lines.length) throw new Error('$INSUNITS absent');
  return Number(lines[i + 2]);
}

function testMetersToDoc(): void {
  assert(almost(metersToDoc(0.65, 'm'), 0.65), 'm identique');
  assert(almost(metersToDoc(0.65, 'cm'), 65), '0,65 m = 65 cm');
  assert(almost(metersToDoc(0.005, 'mm'), 5), '5 mm');
  assert(almost(metersToDoc(0.0254, 'in'), 1), '1 pouce');
  assert(almost(metersToDoc(0.3048, 'ft'), 1), '1 pied');
  assert(almost(metersToDoc(1000, 'km'), 1), '1 km');
}

function testInsUnits(): void {
  const expect: Record<UnitId, number> = {
    in: 1,
    ft: 2,
    mm: 4,
    cm: 5,
    m: 6,
    km: 7,
  };
  for (const unit of Object.keys(expect) as UnitId[]) {
    const doc = createEmptyDocument('units');
    doc.meta = { ...doc.meta, units: unit };
    const dxf = serializeDxf(doc);
    const got = insUnitsOf(dxf.text);
    assert(got === expect[unit], `$INSUNITS ${unit} = ${got}, attendu ${expect[unit]}`);
  }
}

/**
 * Deux murs parallèles, extrémités distantes d'environ 2.
 * Le cluster suit la tolérance (0,65 m ou 65 cm).
 * Un snapTol numérique n'est pas reconverti.
 * (Des murs colinéaires sont aussi allongés par extend, hors de ce test.)
 */
function testSnapScalesWithUnit(): void {
  const box = { minX: -1, minY: -1, maxX: 5, maxY: 1 };
  const pair = (): Entity[] => [
    wall('a', [0, 0, 0], [1, 0, 0]),
    wall('b', [3, 0.2, 0], [4, 0.2, 0]),
  ];
  const endX = (entities: readonly Entity[]): number => {
    const a = entities.find((e) => e.id === 'a');
    if (!a || a.kind !== 'wall') throw new Error('mur a absent');
    return a.end[0];
  };

  const meters = snapAndRejoinWallsInBox(pair(), box, undefined, 'first-hit', 'm');
  assert(
    almost(endX(meters.entities), 1, 1e-6),
    `mètres : extrémité a déplacée à ${endX(meters.entities)} (écart 2 > 0,65)`,
  );

  const cm = snapAndRejoinWallsInBox(pair(), box, undefined, 'first-hit', 'cm');
  assert(
    Math.abs(endX(cm.entities) - 1) > 0.1,
    `cm : extrémité a restée à ${endX(cm.entities)} (tolérance 65)`,
  );

  const explicit = snapAndRejoinWallsInBox(pair(), box, 0.5, 'first-hit', 'cm');
  assert(
    almost(endX(explicit.entities), 1, 1e-6),
    `snapTol 0,5 explicite en cm a déplacé a à ${endX(explicit.entities)}`,
  );
}

function testCircularInsert(): void {
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'BLOCKS',
    '0', 'BLOCK',
    '2', 'SELF',
    '10', '0',
    '20', '0',
    '30', '0',
    '0', 'INSERT',
    '2', 'SELF',
    '10', '0',
    '20', '0',
    '30', '0',
    '0', 'ENDBLK',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'ENDSEC',
    '0', 'EOF',
    '',
  ].join('\n');
  const res = parseDxf(dxf, { units: 'm', title: 'circ' });
  const hit = res.warnings.some((w) => w.toLowerCase().includes('circulaire'));
  assert(hit, `warning circulaire absent : ${res.warnings.join(' | ')}`);
}

testMetersToDoc();
testInsUnits();
testSnapScalesWithUnit();
testCircularInsert();
console.log('test-units: ok');
