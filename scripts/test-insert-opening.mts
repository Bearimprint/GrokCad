/**
 * Ouverture /iw : longueur, épaisseur du mur, traits coupés.
 */
import { readFileSync } from 'node:fs';
import { parseGkd } from '../src/core/gkd.ts';
import { findNearestInsertHost } from '../src/core/insertHost.ts';
import {
  composeInsertFrame,
  formatInsertLength,
  measureOpening,
  openingFromFrame,
  clipWallStrokes,
} from '../src/core/insertOpening.ts';
import { placeInsertEntities } from '../src/core/insertTransform.ts';
import type {
  Entity,
  LineStyleId,
  PointEntity,
  PolylineEntity,
  Vec3,
  WallEntity,
} from '../src/core/types.ts';
import { wallEntityStrokes } from '../src/core/walls.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const stroke = {
  color: '#ffffff',
  lineWidth: 1,
  lineStyle: 'plein' as LineStyleId,
};

function anchorAt(p: Vec3): PointEntity {
  return {
    id: 'anc',
    kind: 'point',
    layer: 'DESSIN',
    drawLayer: -9,
    position: p,
    color: '#ffcc66',
    lineWidth: 3,
  };
}

function rect(layer: number, x1 = 1, y1 = 0.2): PolylineEntity {
  const pts: Vec3[] = [
    [0, 0, 0],
    [x1, 0, 0],
    [x1, y1, 0],
    [0, y1, 0],
  ];
  const segments = pts.map((start, i) => ({
    type: 'line' as const,
    start,
    end: pts[(i + 1) % pts.length]!,
    ...stroke,
  }));
  return {
    id: 'rect',
    kind: 'polyline',
    layer: 'DESSIN',
    drawLayer: layer,
    closed: true,
    segments,
  };
}

function wallOf(offsets: number[]): WallEntity {
  return {
    id: 'mur1',
    kind: 'wall',
    layer: 'MURS',
    styleId: 's',
    path: 'line',
    flip: false,
    lines: offsets.map((offset) => ({ offset, ...stroke })),
    start: [0, 0, 0],
    end: [4, 0, 0],
  };
}

function hitWall(wall: WallEntity, x: number) {
  const hit = findNearestInsertHost([x, 0.02, 0], [wall], 1);
  assert(hit, `hôte à x=${x}`);
  return hit!;
}

function worldBox(entities: Entity[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const e of entities) {
    if (e.kind !== 'polyline') continue;
    for (const s of e.segments) {
      if (s.type !== 'line') continue;
      for (const p of [s.start, s.end]) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
    }
  }
  return { x0, x1, y0, y1 };
}

/** true si un trait d’offset donné traverse x (segment horizontal). */
function crosses(wall: WallEntity, openings: ReturnType<typeof openingFromFrame>[], offset: number, x: number): boolean {
  const clipped = clipWallStrokes(
    wall,
    wallEntityStrokes(wall),
    openings.filter((o): o is NonNullable<typeof o> => !!o),
  );
  for (const s of clipped) {
    if (Math.abs(s.offset - offset) > 1e-6) continue;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const a = s.points[i]!;
      const b = s.points[i + 1]!;
      const lo = Math.min(a[0], b[0]);
      const hi = Math.max(a[0], b[0]);
      if (x > lo + 1e-4 && x < hi - 1e-4) return true;
    }
  }
  return false;
}

console.log('TEST insert opening');

assert(formatInsertLength(1.2) === 'dx 1.2', formatInsertLength(1.2));
assert(formatInsertLength(1) === 'dx 1', formatInsertLength(1));
assert(formatInsertLength(0.65) === 'dx 0.65', formatInsertLength(0.65));

// Symbole réel : rectangle 1 × 0,2 sur calque fixe −1
const gkd = parseGkd(
  readFileSync(
    new URL('../library/insertions/doors/text_rect_Vide.gkd', import.meta.url),
    'utf8',
  ),
);
const specFile = measureOpening(gkd.entities);
assert(specFile.fallbackXY, 'rectangle −1 = ouverture entière');
assert(Math.abs(specFile.reachX - 1) < 1e-9, `reachX 1 (got ${specFile.reachX})`);
assert(Math.abs(specFile.spanY - 0.2) < 1e-9, `spanY 0.2 (got ${specFile.spanY})`);

const wall = wallOf([0, 0.02, 0.18, 0.28, 0.293]);
const hit = hitWall(wall, 1);
assert(Math.abs(hit.along - 1) < 1e-6, `along 1 (got ${hit.along})`);

const frame = composeInsertFrame(hit, gkd.entities, {
  flipAlt: false,
  flipCtrl: false,
  length: 1.2,
  xSign: 1,
});
const placed = placeInsertEntities(gkd.entities, frame);
const box = worldBox(placed);
assert(Math.abs(box.x0 - 1) < 1e-6, `départ x ${box.x0}`);
assert(Math.abs(box.x1 - 2.2) < 1e-6, `longueur 1.2 → x ${box.x1}`);
assert(Math.abs(box.y0 - 0) < 1e-6, `y0 ${box.y0}`);
assert(Math.abs(box.y1 - 0.293) < 1e-4, `largeur mur ${box.y1}`);

const op = openingFromFrame(wall, hit.along, frame, gkd.entities);
assert(op, 'ouverture');
assert(Math.abs(op!.along0 - 1) < 1e-4, `along0 ${op!.along0}`);
assert(Math.abs(op!.along1 - 2.2) < 1e-4, `along1 ${op!.along1}`);

for (const off of [0, 0.02, 0.18, 0.28, 0.293]) {
  assert(crosses(wall, [op], off, 0.4), `offset ${off} gardé avant l’ouverture`);
  assert(!crosses(wall, [op], off, 1.5), `offset ${off} coupé dans l’ouverture`);
  assert(crosses(wall, [op], off, 3.2), `offset ${off} gardé après l’ouverture`);
}

// Sens inverse : le bord suit la souris de l’autre côté de l’ancre
const hitB = hitWall(wall, 2);
const frameB = composeInsertFrame(hitB, gkd.entities, {
  flipAlt: false,
  flipCtrl: false,
  length: 1.2,
  xSign: -1,
});
const boxB = worldBox(placeInsertEntities(gkd.entities, frameB));
assert(Math.abs(boxB.x0 - 0.8) < 1e-4, `sens inverse x0 ${boxB.x0}`);
assert(Math.abs(boxB.x1 - 2) < 1e-4, `sens inverse x1 ${boxB.x1}`);
assert(!crosses(wall, [openingFromFrame(wall, hitB.along, frameB, gkd.entities)], 0, 1.2), 'trou à gauche de l’ancre');
assert(crosses(wall, [openingFromFrame(wall, hitB.along, frameB, gkd.entities)], 0, 2.5), 'mur intact à droite');

// Calque −2 seulement : la longueur change, pas l’épaisseur ; seul l’offset 0 est percé
const xOnly: Entity[] = [
  anchorAt([0, 0, 0]),
  {
    id: 'lx',
    kind: 'line',
    layer: 'DESSIN',
    drawLayer: -2,
    start: [0, 0, 0],
    end: [1, 0, 0],
    ...stroke,
  },
];
const specX = measureOpening(xOnly);
assert(!specX.fallbackXY && specX.stretchAnyX && !specX.stretchAnyY, '−2 = X seul');
const frameX = composeInsertFrame(hit, xOnly, {
  flipAlt: false,
  flipCtrl: false,
  length: 1.5,
  xSign: 1,
});
const placedX = placeInsertEntities(xOnly, frameX);
const lineX = placedX.find((e) => e.kind === 'line');
assert(lineX && lineX.kind === 'line', 'ligne posée');
if (lineX && lineX.kind === 'line') {
  assert(Math.abs(lineX.end[0] - lineX.start[0] - 1.5) < 1e-6, 'X = 1.5 m');
  assert(Math.abs(lineX.end[1]) < 1e-6 && Math.abs(lineX.start[1]) < 1e-6, 'Y reste 0');
}
const opX = openingFromFrame(wall, hit.along, frameX, xOnly);
assert(opX, 'trou X');
assert(!crosses(wall, [opX], 0, 1.5), 'face 0 coupée');
assert(crosses(wall, [opX], 0.293, 1.5), 'les autres faces restent');

console.log('OK insert opening');
