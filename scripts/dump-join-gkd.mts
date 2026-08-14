/**
 * Dump strokeGeom after recomputeLinearWallJoints on test_New_wall.gkd
 */
import { readFileSync } from 'fs';
import { recomputeLinearWallJoints } from '../src/core/walls.ts';
import { wallLineJoinPriority } from '../src/core/wallLayerCatalog.ts';
import type { WallEntity } from '../src/core/types.ts';

const path = process.argv[2] ?? '/home/red/Téléchargements/test_New_wall.gkd';
const gkd = JSON.parse(readFileSync(path, 'utf8'));
const walls = (gkd.entities as WallEntity[]).filter((e) => e.kind === 'wall');
console.log('walls:', walls.length);
for (const w of walls) {
  console.log(
    w.id,
    w.path,
    'start',
    w.start,
    'end',
    w.end,
    'flip',
    w.flip,
  );
  console.log(
    '  lines',
    w.lines
      .map((l) => `${l.offset}@p${l.priority ?? '-'}/${l.layerTypeId ?? ''}`)
      .join(' | '),
  );
  console.log(
    '  jp',
    w.lines.map((l) => wallLineJoinPriority(w.lines, l)).join(','),
  );
}

const joined = recomputeLinearWallJoints(walls);
for (const w of joined) {
  console.log('\n===', w.id, '===');
  const geoms = w.strokeGeom ?? [];
  const byOff = new Map<number, typeof geoms>();
  for (const g of geoms) {
    const k = Math.round(g.offset * 1e6) / 1e6;
    const arr = byOff.get(k) ?? [];
    arr.push(g);
    byOff.set(k, arr);
  }
  for (const [off, gs] of [...byOff.entries()].sort((a, b) => a[0] - b[0])) {
    const src = w.lines.find((l) => Math.abs(l.offset - off) < 1e-9);
    const jp = wallLineJoinPriority(w.lines, src ?? { offset: off });
    console.log(`  off=${off} jp=${jp} segs=${gs.length}`);
    for (const g of gs) {
      const len = Math.hypot(g.end[0]! - g.start[0]!, g.end[1]! - g.start[1]!);
      console.log(
        `    (${g.start[0]!.toFixed(4)},${g.start[1]!.toFixed(4)}) → (${g.end[0]!.toFixed(4)},${g.end[1]!.toFixed(4)}) len=${len.toFixed(4)}`,
      );
    }
  }
}
