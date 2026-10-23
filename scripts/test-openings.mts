/**
 * Portes et fenêtres : battant qui suit la largeur, trou dans le mur.
 */
import { readFileSync } from 'node:fs';
import { parseGkd } from '../src/core/gkd.ts';
import { findNearestInsertHost } from '../src/core/insertHost.ts';
import {
  composeInsertFrame,
  openingFromFrame,
  clipWallStrokes,
} from '../src/core/insertOpening.ts';
import { placeInsertEntities } from '../src/core/insertTransform.ts';
import type { ArcEntity, LineEntity, WallEntity } from '../src/core/types.ts';
import { wallEntityStrokes } from '../src/core/walls.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function load(rel: string) {
  return parseGkd(readFileSync(new URL(rel, import.meta.url), 'utf8'));
}

function wallH(): WallEntity {
  return {
    id: 'mur',
    kind: 'wall',
    layer: 'MURS',
    styleId: 's',
    path: 'line',
    flip: false,
    lines: [0, 0.02, 0.18, 0.2].map((offset) => ({
      offset,
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein' as const,
    })),
    start: [0, 0, 0],
    end: [4, 0, 0],
  };
}

function wallV(): WallEntity {
  return { ...wallH(), start: [0, 0, 0], end: [0, 4, 0] };
}

function crosses(wall: WallEntity, op: NonNullable<ReturnType<typeof openingFromFrame>>, offset: number, x: number, y: number): boolean {
  const clipped = clipWallStrokes(wall, wallEntityStrokes(wall), [op]);
  for (const s of clipped) {
    if (Math.abs(s.offset - offset) > 1e-6) continue;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const a = s.points[i]!;
      const b = s.points[i + 1]!;
      const c0 = Math.min(a[0], b[0]);
      const c1 = Math.max(a[0], b[0]);
      const d0 = Math.min(a[1], b[1]);
      const d1 = Math.max(a[1], b[1]);
      if (x > c0 + 1e-4 && x < c1 - 1e-4 && y > d0 - 1e-3 && y < d1 + 1e-3) return true;
      if (y > d0 + 1e-4 && y < d1 - 1e-4 && x > c0 - 1e-3 && x < c1 + 1e-3) return true;
    }
  }
  return false;
}

console.log('TEST openings');

const door = load('../library/insertions/doors/porte.gkd');
const wall = wallH();
const hit = findNearestInsertHost([1.2, 0.05, 0], [wall], 1);
assert(hit, 'hôte');
const frame = composeInsertFrame(hit!, door.entities, {
  flipAlt: false,
  flipCtrl: false,
  length: 0.9,
  xSign: 1,
});
const placed = placeInsertEntities(door.entities, frame);
const leaf = placed.find((e) => e.id === 'leaf') as LineEntity | undefined;
assert(leaf && leaf.kind === 'line', 'vantail');
assert(Math.abs(leaf!.start[0] - hit!.point[0]) < 1e-3, `charnière x ${leaf!.start[0]}`);
assert(Math.abs(leaf!.end[0] - hit!.point[0]) < 1e-3, 'vantail perpendiculaire au mur');
assert(Math.abs(leaf!.end[1] - leaf!.start[1] - 0.9) < 1e-3, `battant 0,9 m (got ${leaf!.end[1] - leaf!.start[1]})`);
const swing = placed.find((e) => e.id === 'swing') as ArcEntity | undefined;
assert(swing && swing.kind === 'arc', 'arc de battant');
assert(Math.abs(swing!.radius - 0.9) < 1e-3, `rayon ${swing!.radius}`);

const op = openingFromFrame(wall, hit!.along, frame, door.entities);
assert(op, 'trou');
assert(Math.abs(op!.along1 - op!.along0 - 0.9) < 1e-3, `largeur trou ${op!.along1 - op!.along0}`);
assert(!crosses(wall, op!, 0, hit!.point[0] + 0.4, 0), 'face coupée dans la porte');
assert(crosses(wall, op!, 0, 0.3, 0), 'mur intact avant');
assert(crosses(wall, op!, 0, 3.2, 0), 'mur intact après');
// Le battant (0,9 m) ne doit pas élargir le trou hors de l’épaisseur.
assert(op!.off1 - op!.off0 < 0.25, `offsets trou ${op!.off0}..${op!.off1}`);

const v = wallV();
const hitV = findNearestInsertHost([0.02, 1.5, 0], [v], 1);
assert(hitV, 'mur vertical');
const frameV = composeInsertFrame(hitV!, door.entities, {
  flipAlt: false,
  flipCtrl: false,
  length: 0.8,
  xSign: 1,
});
const placedV = placeInsertEntities(door.entities, frameV);
const leafV = placedV.find((e) => e.id === 'leaf') as LineEntity;
const dx = leafV.end[0] - leafV.start[0];
const dy = leafV.end[1] - leafV.start[1];
assert(Math.abs(dy) < 1e-3, `vantail pas le long du mur vertical (dy ${dy})`);
assert(Math.abs(Math.abs(dx) - 0.8) < 1e-3, `battant 0,8 (dx ${dx})`);

const win = load('../library/insertions/windows/fenetre.gkd');
const frameW = composeInsertFrame(hit!, win.entities, {
  flipAlt: false,
  flipCtrl: false,
  length: 1.2,
  xSign: 1,
});
const opW = openingFromFrame(wall, hit!.along, frameW, win.entities);
assert(opW, 'trou fenêtre');
assert(Math.abs(opW!.along1 - opW!.along0 - 1.2) < 1e-3, 'fenêtre 1,2 m');
const glass = placeInsertEntities(win.entities, frameW).filter((e) => e.id.startsWith('glass'));
assert(glass.length === 2, 'deux traits de vitrage');

console.log('OK openings');
