import {
  snapAndRejoinWallsInBox,
  wallEntityStrokes,
  applyWallJointsToEntities,
} from '../src/core/walls.ts';
import type { WallEntity, WallLineDef, Entity } from '../src/core/types.ts';

const lines: WallLineDef[] = [
  { offset: 0, color: '#fff', lineWidth: 1, lineStyle: 'plein' },
  {
    offset: 0.02,
    color: '#fff',
    lineWidth: 1,
    lineStyle: 'plein',
    priority: 5,
    layerTypeId: 'enduit',
  },
  {
    offset: 0.18,
    color: '#fff',
    lineWidth: 2,
    lineStyle: 'plein',
    priority: 1,
    layerTypeId: 'structure-beton',
  },
  {
    offset: 0.28,
    color: '#fff',
    lineWidth: 1,
    lineStyle: 'tiret',
    priority: 3,
    layerTypeId: 'isolant',
  },
  {
    offset: 0.293,
    color: '#fff',
    lineWidth: 1,
    lineStyle: 'plein',
    priority: 5,
    layerTypeId: 'placo-13',
  },
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
    styleId: 's',
    path: 'line',
    flip: false,
    lines: lines.map((l) => ({ ...l })),
    start,
    end,
  };
}

function endsNearCorner(w: WallEntity, corner: [number, number], label: string) {
  const strokes = wallEntityStrokes(w);
  console.log(label);
  for (const off of [0, 0.02, 0.18, 0.28, 0.293]) {
    const st = strokes.filter((s) => Math.abs(s.offset - off) < 1e-9);
    let bestD = Infinity;
    let best: number[] | null = null;
    for (const s of st)
      for (const p of s.points) {
        const d = Math.hypot(p[0]! - corner[0], p[1]! - corner[1]);
        if (d < bestD) {
          bestD = d;
          best = p as number[];
        }
      }
    console.log(
      `  off ${off} d=${bestD.toFixed(4)} @ (${best?.[0]?.toFixed(3)},${best?.[1]?.toFixed(3)}) segs=${st.length}`,
    );
  }
}

// Presque en contact
const a = wall('a', [-2, -2, 0], [-0.05, -0.05, 0]);
const b = wall('b', [-2, 2, 0], [-0.05, 0.05, 0]);
const box = { minX: -3, minY: -3, maxX: 1, maxY: 3 };
const r = snapAndRejoinWallsInBox([a, b] as Entity[], box, 0.5, 'first-hit');
console.log(
  'snap clusters',
  r.clusters,
  'touched',
  r.wallsTouched,
  'deg',
  r.maxNodeDegree,
);
const wa = r.entities.find((e) => e.id === 'a') as WallEntity;
const wb = r.entities.find((e) => e.id === 'b') as WallEntity;
console.log('a end', wa.end, 'b end', wb.end, 'dist', Math.hypot(wa.end[0]! - wb.end[0]!, wa.end[1]! - wb.end[1]!));
endsNearCorner(wa, [0, 0], 'A after snap');
endsNearCorner(wb, [0, 0], 'B after snap');

// Exact L
const a2 = wall('a2', [-2, -2, 0], [0, 0, 0]);
const b2 = wall('b2', [-2, 2, 0], [0, 0, 0]);
const joined = applyWallJointsToEntities([a2, b2] as Entity[]);
const ja = joined.find((e) => e.id === 'a2') as WallEntity;
const jb = joined.find((e) => e.id === 'b2') as WallEntity;
console.log('\nExact L axes:');
endsNearCorner(ja, [0, 0], 'A2');
endsNearCorner(jb, [0, 0], 'B2');
const sa = wallEntityStrokes(ja);
const sb = wallEntityStrokes(jb);
for (const off of [0, 0.02, 0.18, 0.28, 0.293]) {
  const pa = sa.filter((s) => Math.abs(s.offset - off) < 1e-9).flatMap((s) => s.points);
  const pb = sb.filter((s) => Math.abs(s.offset - off) < 1e-9).flatMap((s) => s.points);
  let minD = Infinity;
  for (const p of pa)
    for (const q of pb)
      minD = Math.min(minD, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!));
  console.log(`  layer ${off} min meet d=${minD.toFixed(4)}`);
}

// Perpendicular classic L
const h = wall('h', [0, 0, 0], [3, 0, 0]);
const v = wall('v', [3, 0, 0], [3, 3, 0]);
const j2 = applyWallJointsToEntities([h, v] as Entity[]);
const jh = j2.find((e) => e.id === 'h') as WallEntity;
const jv = j2.find((e) => e.id === 'v') as WallEntity;
console.log('\nPerp L:');
const sh = wallEntityStrokes(jh);
const sv = wallEntityStrokes(jv);
for (const off of [0, 0.02, 0.18]) {
  const pa = sh.filter((s) => Math.abs(s.offset - off) < 1e-9).flatMap((s) => s.points);
  const pb = sv.filter((s) => Math.abs(s.offset - off) < 1e-9).flatMap((s) => s.points);
  let minD = Infinity;
  for (const p of pa)
    for (const q of pb)
      minD = Math.min(minD, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!));
  console.log(`  layer ${off} min meet d=${minD.toFixed(4)}`);
}
