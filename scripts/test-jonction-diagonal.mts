/**
 * Repro cas utilisateur : mur diagonal multi-traits + L (H+V) multi-traits.
 * node --experimental-strip-types n/a → esbuild bundle
 */
import {
  recomputeLinearWallJoints,
  snapAndRejoinWallsInBox,
  wallEntityStrokes,
} from '../src/core/walls.ts';
import type { WallEntity, WallLineDef, Entity } from '../src/core/types.ts';

const lines3: WallLineDef[] = [
  { offset: 0, color: '#fff', lineWidth: 1, lineStyle: 'plein' },
  { offset: 0.1, color: '#fff', lineWidth: 1, lineStyle: 'plein' },
  { offset: 0.2, color: '#fff', lineWidth: 1, lineStyle: 'plein' },
];

function wall(
  id: string,
  start: [number, number, number],
  end: [number, number, number],
  flip = false,
): WallEntity {
  return {
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 'styleA',
    path: 'line',
    flip,
    lines: lines3.map((l) => ({ ...l })),
    start,
    end,
  };
}

function distPtSeg(
  p: [number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby + 1e-18),
    ),
  );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/** Distance à la droite infinie (1ʳᵉ rencontre même couche peut dépasser le segment). */
function distPtLine(
  p: [number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby + 1e-18;
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

// Coin à (5, 5). Diagonal depuis SW, H vers E, V vers N — extrémités un peu décalées
const diag = wall('diag', [1, 2, 0], [4.9, 4.85, 0]); // ~ vers (5,5)
const horiz = wall('horiz', [5.1, 5.05, 0], [10, 5.05, 0]);
const vert = wall('vert', [5.05, 5.1, 0], [5.05, 10, 0]);

const box = { minX: 4, minY: 4, maxX: 6, maxY: 6 };
const { entities, wallsTouched, clusters } = snapAndRejoinWallsInBox(
  [diag, horiz, vert] as Entity[],
  box,
  0.5,
);
console.log(`snap: clusters=${clusters} walls=${wallsTouched}`);

const walls = entities.filter((e): e is WallEntity => e.kind === 'wall');
for (const w of walls) {
  console.log(
    w.id,
    'center',
    w.start.map((x) => +x.toFixed(3)),
    '→',
    w.end.map((x) => +x.toFixed(3)),
  );
  for (const g of w.strokeGeom ?? []) {
    console.log(
      '  off',
      g.offset,
      g.start.map((x) => +x.toFixed(3)),
      '→',
      g.end.map((x) => +x.toFixed(3)),
    );
  }
}

// Chaque trait du diagonal doit rencontrer la // même offset (seg ou droite)
const d = walls.find((w) => w.id === 'diag')!;
const others = walls.filter((w) => w.id !== 'diag');
const node = d.end; // after snap should be at fused corner
let bad = 0;
for (const g of d.strokeGeom ?? []) {
  const near =
    Math.hypot(g.start[0] - node[0], g.start[1] - node[1]) <
    Math.hypot(g.end[0] - node[0], g.end[1] - node[1])
      ? g.start
      : g.end;
  let minD = Infinity;
  for (const o of others) {
    for (const bg of o.strokeGeom ?? []) {
      if (Math.abs(bg.offset - g.offset) > 1e-9) continue;
      minD = Math.min(
        minD,
        distPtSeg([near[0], near[1]], bg.start, bg.end),
        distPtLine([near[0], near[1]], bg.start, bg.end),
      );
    }
  }
  console.log(
    `diag off ${g.offset} near-node (${near[0].toFixed(3)},${near[1].toFixed(3)}) dist=${minD.toFixed(4)}`,
  );
  if (minD > 0.08) bad += 1;
}

// H et V : même couche sur la droite // de l’autre (1ʳᵉ rencontre peut trimer le L)
const h = walls.find((w) => w.id === 'horiz')!;
const v = walls.find((w) => w.id === 'vert')!;
let lvBad = 0;
for (let i = 0; i < (h.strokeGeom?.length ?? 0); i++) {
  const hg = h.strokeGeom![i]!;
  const vg = v.strokeGeom![i]!;
  const hNear =
    Math.hypot(hg.start[0] - node[0], hg.start[1] - node[1]) <
    Math.hypot(hg.end[0] - node[0], hg.end[1] - node[1])
      ? hg.start
      : hg.end;
  const vNear =
    Math.hypot(vg.start[0] - node[0], vg.start[1] - node[1]) <
    Math.hypot(vg.end[0] - node[0], vg.end[1] - node[1])
      ? vg.start
      : vg.end;
  const dHOnV = Math.min(
    distPtSeg([hNear[0], hNear[1]], vg.start, vg.end),
    distPtLine([hNear[0], hNear[1]], vg.start, vg.end),
  );
  const dVOnH = Math.min(
    distPtSeg([vNear[0], vNear[1]], hg.start, hg.end),
    distPtLine([vNear[0], vNear[1]], hg.start, hg.end),
  );
  const d2 = Math.min(dHOnV, dVOnH);
  console.log(
    `L off ${hg.offset} H-on-V=${dHOnV.toFixed(4)} V-on-H=${dVOnH.toFixed(4)}`,
  );
  if (d2 > 0.08) lvBad += 1;
}

// Axes préservés (pas de barycentre qui fait tourner)
const dDir = [d.end[0] - d.start[0], d.end[1] - d.start[1]] as const;
const dLen = Math.hypot(dDir[0], dDir[1]);
const orig = [4.9 - 1, 4.85 - 2] as const;
const oLen = Math.hypot(orig[0], orig[1]);
const axisOk =
  Math.abs(dDir[0] / dLen - orig[0] / oLen) < 1e-9 &&
  Math.abs(dDir[1] / dLen - orig[1] / oLen) < 1e-9 &&
  Math.abs(h.end[1] - h.start[1]) < 1e-9 &&
  Math.abs(v.end[0] - v.start[0]) < 1e-9;

console.log(
  bad === 0 && lvBad === 0 && axisOk
    ? 'PASS diagonal T'
    : `FAIL badDiag=${bad} badL=${lvBad} axes=${axisOk}`,
);
process.exit(bad === 0 && lvBad === 0 && axisOk ? 0 : 1);
