/**
 * Calques de dessin 1–127 + insertions −1…−127.
 */
import {
  ANCHOR_LAYER,
  clampLayerLabel,
  DEFAULT_DRAW_LAYER,
  defaultLayerLabel,
  entityDrawLayer,
  findAnchorPoint,
  hasAnchorPoint,
  hasInsertLayers,
  insertionTab,
  isDrawLayerId,
  isInsertionsTab,
  LAYER_LABEL_MAX,
  parseEntityDrawLayer,
  stretchAxesOf,
} from '../src/core/drawLayers.ts';
import { parseAbsoluteXyz } from '../src/core/geometry.ts';
import { parseGkd, serializeGkd, createEmptyDocument } from '../src/core/gkd.ts';
import { placeInsertEntities } from '../src/core/insertTransform.ts';
import type { LineEntity, PointEntity, Vec3 } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('TEST draw layers');

assert(isInsertionsTab('insertions/doors'), 'tab nested insertions');
assert(insertionTab('windows') === 'insertions/windows', 'insertionTab windows');
assert(!isInsertionsTab('sanitaire'), 'sanitaire n’est pas insertion');

const xyzOk = parseAbsoluteXyz(['0,0,0']);
assert(xyzOk.ok && xyzOk.point[0] === 0 && xyzOk.point[2] === 0, '0,0,0');
const xyzSp = parseAbsoluteXyz(['1.2', '0.5', '0']);
assert(xyzSp.ok && xyzSp.point[0] === 1.2 && xyzSp.point[1] === 0.5, '1.2 0.5 0');
assert(!parseAbsoluteXyz(['dx', '0']).ok, 'refuse dx');
assert(!parseAbsoluteXyz(['dxy', '0,0']).ok, 'refuse dxy');
assert(!parseAbsoluteXyz(['0,0']).ok, 'refuse XY seul');
assert(!parseAbsoluteXyz(['.']).ok, 'refuse .');
assert(!parseAbsoluteXyz(['@']).ok, 'refuse @');

assert(!isDrawLayerId(0), 'pas de couche 0');
assert(isDrawLayerId(1) && isDrawLayerId(127), '1 et 127 ok');
assert(!isDrawLayerId(128), '128 interdit');
assert(isDrawLayerId(-1) && isDrawLayerId(-127), 'négatifs ok');
assert(!isDrawLayerId(-128), '-128 interdit');

assert(parseEntityDrawLayer(undefined) === 1, 'absent → 1');
assert(parseEntityDrawLayer('DESSIN') === 1, 'string DXF → 1 (pas de négatif inventé)');
assert(parseEntityDrawLayer(0) === 1, '0 → 1');
assert(parseEntityDrawLayer(12) === 12, '12 conservé');
assert(parseEntityDrawLayer(-9) === -9, '-9 conservé');

assert(defaultLayerLabel(1) === 'Bedrock layer', 'libellé 1');
assert(defaultLayerLabel(7) === 'Couche numero 7', 'libellé défaut');
assert(defaultLayerLabel(-2) === 'Étirable X', 'libellé -2');
assert(defaultLayerLabel(-9) === 'Point d’ancrage', 'libellé -9');

const long = 'a'.repeat(300);
assert(clampLayerLabel(long).length === LAYER_LABEL_MAX, 'libellé max 255');

assert(stretchAxesOf(-1).x === false && stretchAxesOf(-1).y === false, '-1 fixe');
assert(stretchAxesOf(-2).x === true && stretchAxesOf(-2).y === false, '-2 X');
assert(stretchAxesOf(-5).x && stretchAxesOf(-5).y && !stretchAxesOf(-5).z, '-5 XY');
assert(stretchAxesOf(-8).x && stretchAxesOf(-8).y && stretchAxesOf(-8).z, '-8 XYZ');

const empty = createEmptyDocument();
assert(empty.currentDrawLayer === DEFAULT_DRAW_LAYER, 'nouveau doc couche 1');
const json = serializeGkd(empty);
const re = parseGkd(json);
assert(re.currentDrawLayer === 1, 'roundtrip current');
assert(
  (re.drawLayers ?? []).some((l) => l.id === 1 && l.label === 'Bedrock layer'),
  'Bedrock stocké sur nouveau doc',
);

// Ancien .gkd sans drawLayer
const legacy = {
  magic: 'GKD1',
  version: '0.24.16',
  modified: new Date().toISOString(),
  camera: re.camera,
  entities: [
    {
      id: 'l1',
      kind: 'line',
      layer: 'DESSIN',
      start: [0, 0, 0],
      end: [1, 0, 0],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    },
  ],
  wallLibrary: [],
  objectLibrary: [],
};
const old = parseGkd(JSON.stringify(legacy));
assert(old.entities[0] && entityDrawLayer(old.entities[0]) === 1, 'legacy → couche 1');
assert(!old.entities.some((e) => (e.drawLayer ?? 1) < 0), 'pas de couche négative inventée');
assert(old.currentDrawLayer === 1, 'current legacy = 1');

const pt: PointEntity = {
  id: 'a',
  kind: 'point',
  layer: 'DESSIN',
  drawLayer: ANCHOR_LAYER,
  position: [0, 0, 0],
  color: '#fb8c00',
  lineWidth: 3,
};
const line: LineEntity = {
  id: 's',
  kind: 'line',
  layer: 'DESSIN',
  drawLayer: -2,
  start: [0, 0, 0],
  end: [1, 0.2, 0],
  color: '#000',
  lineWidth: 1,
  lineStyle: 'plein',
};
assert(hasAnchorPoint([pt, line]), 'ancre détectée');
assert(hasInsertLayers([pt, line]), 'calques insertion');
const anc = findAnchorPoint([pt, line]);
assert(anc && anc[0] === 0 && anc[1] === 0, 'ancre 0,0');

const placed = placeInsertEntities([pt, line], {
  origin: [10, 5, 0],
  axisX: [1, 0, 0],
  axisY: [0, 1, 0],
  scaleX: 0.65,
  scaleY: 1,
  scaleZ: 1,
});
assert(placed.length === 1 && placed[0]!.kind === 'line', 'ancre omise, ligne posée');
if (placed[0]!.kind === 'line') {
  const dx = placed[0].end[0] - placed[0].start[0];
  const dy = placed[0].end[1] - placed[0].start[1];
  assert(Math.abs(dx - 0.65) < 1e-9, `étirement X 1m → 0.65 (got ${dx})`);
  assert(Math.abs(dy - 0.2) < 1e-9, `Y fixe 0.20 (got ${dy})`);
  const origin = placed[0].start as Vec3;
  assert(Math.abs(origin[0] - 10) < 1e-9 && Math.abs(origin[1] - 5) < 1e-9, 'ancre au host');
}

const flipped = placeInsertEntities([pt, line], {
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisY: [0, -1, 0], // ALT
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
});
if (flipped[0]!.kind === 'line') {
  assert(Math.abs(flipped[0].end[1] - -0.2) < 1e-9, 'ALT inverse Y');
}

const ctrl = placeInsertEntities([pt, line], {
  origin: [0, 0, 0],
  axisX: [-1, 0, 0], // CTRL
  axisY: [0, 1, 0],
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
});
if (ctrl[0]!.kind === 'line') {
  assert(Math.abs(ctrl[0].end[0] - -1) < 1e-9, 'CTRL inverse X');
}

console.log('OK draw layers');
