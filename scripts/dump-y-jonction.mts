/**
 * Dump /jonction on the 3-wall Y from Murs_pour_testV2.gkd
 */
import { readFileSync } from 'fs';
import {
  snapAndRejoinWallsInBox,
  recomputeLinearWallJoints,
} from '../src/core/walls.ts';
import { wallLineJoinPriority } from '../src/core/wallLayerCatalog.ts';
import type { WallEntity, Entity } from '../src/core/types.ts';

const path = process.argv[2] ?? '/home/red/Téléchargements/Murs_pour_testV2.gkd';
const gkd = JSON.parse(readFileSync(path, 'utf8'));
const entities = gkd.entities as Entity[];
const walls = entities.filter((e): e is WallEntity => e.kind === 'wall');

console.log('file', path, 'walls', walls.length);
for (const w of walls) {
  const jp = w.lines.map((l) => `${l.offset.toFixed(3)}:p${wallLineJoinPriority(w.lines, l)}/${l.layerTypeId ?? '-'}`);
  console.log(
    w.id,
    `start=(${w.start[0].toFixed(3)},${w.start[1].toFixed(3)})`,
    `end=(${w.end[0].toFixed(3)},${w.end[1].toFixed(3)})`,
    'flip',
    w.flip,
  );
  console.log('  ', jp.join('  '));
}

// Box around the L corner + diagonal (from previous tests)
const box = { minX: -6.2, minY: -2.4, maxX: -3.5, maxY: 0.2 };
const r = snapAndRejoinWallsInBox(entities, box, 0.65, 'first-hit');
console.log('\njonction', {
  extended: r.extended,
  clusters: r.clusters,
  wallsTouched: r.wallsTouched,
  deg: r.maxNodeDegree,
  sig: r.signature,
});

const after = r.entities.filter((e): e is WallEntity => e.kind === 'wall');
for (const w of after) {
  const before = walls.find((x) => x.id === w.id)!;
  const moved =
    Math.hypot(w.start[0] - before.start[0], w.start[1] - before.start[1]) > 1e-6 ||
    Math.hypot(w.end[0] - before.end[0], w.end[1] - before.end[1]) > 1e-6;
  if (!moved && !boxOverlaps(w)) continue;
  console.log(`\n=== ${w.id} axis (${w.start[0].toFixed(3)},${w.start[1].toFixed(3)}) → (${w.end[0].toFixed(3)},${w.end[1].toFixed(3)}) ===`);
  for (const g of w.strokeGeom ?? []) {
    console.log(
      `  off ${g.offset.toFixed(3)}  (${g.start[0].toFixed(3)},${g.start[1].toFixed(3)}) → (${g.end[0].toFixed(3)},${g.end[1].toFixed(3)})`,
    );
  }
}

function boxOverlaps(w: WallEntity): boolean {
  const minX = Math.min(w.start[0], w.end[0]);
  const maxX = Math.max(w.start[0], w.end[0]);
  const minY = Math.min(w.start[1], w.end[1]);
  const maxY = Math.max(w.start[1], w.end[1]);
  return maxX >= box.minX && minX <= box.maxX && maxY >= box.minY && minY <= box.maxY;
}

// Also dump just the 3 walls of interest if we can identify them
const v = walls.find((w) => Math.abs(w.start[0] - w.end[0]) < 1e-6 && Math.abs(w.start[0] + 4.672) < 0.01);
const h = walls.find((w) => Math.abs(w.start[1] - w.end[1]) < 1e-6 && Math.abs(w.start[1] + 1.497) < 0.01);
const d = walls.find((w) => {
  const dx = w.end[0] - w.start[0];
  const dy = w.end[1] - w.start[1];
  return Math.abs(dx) > 0.3 && Math.abs(dy) > 0.3 && w.start[0] < -5;
});
console.log('\nidentified', { v: v?.id, h: h?.id, d: d?.id });
if (v && h && d) {
  console.log('V', v.start, v.end);
  console.log('H', h.start, h.end);
  console.log('D', d.start, d.end);
  const r2 = snapAndRejoinWallsInBox([v, h, d], box, 0.65, 'first-hit');
  const dd = r2.entities.find((e): e is WallEntity => e.id === d.id)!;
  console.log('\n3-wall only D axis', dd.start, dd.end, 'ext', r2.extended);
  for (const g of dd.strokeGeom ?? []) {
    const near = g.start[1] > g.end[1] ? g.start : g.end;
    const target =
      Math.abs(near[0] + 4.672) < 0.08
        ? 'V'
        : Math.abs(near[1] + 1.497) < 0.08
          ? 'H0'
          : Math.abs(near[1] + 1.477) < 0.08
            ? 'Henduit'
            : Math.abs(near[1] + 1.317) < 0.08
              ? 'Hbeton'
              : '?';
    console.log(
      `  off ${g.offset.toFixed(3)} near=(${near[0].toFixed(3)},${near[1].toFixed(3)}) → ${target}`,
    );
  }
}
