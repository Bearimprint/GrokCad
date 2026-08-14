import { readFileSync } from 'fs';
import { applyJoinWallsToEntities } from '../src/core/walls.ts';
import type { Entity, WallEntity } from '../src/core/types.ts';

const gkd = JSON.parse(
  readFileSync('/home/red/Téléchargements/test_New_wall.gkd', 'utf8'),
);
const entities = (gkd.entities as Entity[]).map((e) => {
  if (e.kind === 'wall') return { ...e, strokeGeom: undefined };
  return e;
});

const { entities: out, result } = applyJoinWallsToEntities(
  entities,
  'wall_9_msiz6sll',
  'wall_8_msiz58fa',
  { which: 'end' },
);
console.log('result', result);

const bar = out.find((e) => e.id === 'wall_8_msiz58fa') as WallEntity;
const stem = out.find((e) => e.id === 'wall_9_msiz6sll') as WallEntity;

console.log('stem end', stem.end);
console.log('\nBAR geoms:');
for (const g of (bar.strokeGeom ?? []).sort(
  (a, b) => a.offset - b.offset || a.start[1]! - b.start[1]!,
)) {
  console.log(
    `  off=${g.offset.toFixed(3)} (${g.start[0]!.toFixed(4)},${g.start[1]!.toFixed(4)})->(${g.end[0]!.toFixed(4)},${g.end[1]!.toFixed(4)})`,
  );
}
console.log('\nSTEM geoms:');
for (const g of (stem.strokeGeom ?? []).sort((a, b) => a.offset - b.offset)) {
  console.log(
    `  off=${g.offset.toFixed(3)} (${g.start[0]!.toFixed(4)},${g.start[1]!.toFixed(4)})->(${g.end[0]!.toFixed(4)},${g.end[1]!.toFixed(4)})`,
  );
}

// Gap analysis bar face0 and structure
console.log('\n--- gaps bar ---');
for (const off of [0, 0.02, 0.18, 0.28, 0.293]) {
  const segs = (bar.strokeGeom ?? []).filter(
    (g) => Math.abs(g.offset - off) < 1e-6,
  );
  const intervals = segs
    .map((g) => {
      const y0 = Math.min(g.start[1]!, g.end[1]!);
      const y1 = Math.max(g.start[1]!, g.end[1]!);
      return [y0, y1] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 0; i + 1 < intervals.length; i++) {
    const gap = intervals[i + 1]![0] - intervals[i]![1];
    if (gap > 1e-4) {
      gaps++;
      console.log(
        `off ${off}: GAP ${gap.toFixed(4)} (${intervals[i]![1].toFixed(4)}→${intervals[i + 1]![0].toFixed(4)})`,
      );
    }
  }
  if (!gaps)
    console.log(
      `off ${off}: continuous ${intervals.map((i) => `[${i[0].toFixed(3)},${i[1].toFixed(3)}]`).join(' ')}`,
    );
}
