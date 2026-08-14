/**
 * Tests géométrie /fill (clip + ring).
 * Run: npx tsx scripts/test-fill.mts
 */
import {
  clipSegmentToPolygon,
  defaultHatchPatternEntities,
  generateHatchStrokes,
  pointInPolygon,
  polylineToRing,
} from '../src/core/fill.ts';
import type { PolylineEntity, Vec3 } from '../src/core/types.ts';

let failed = 0;

const square: PolylineEntity = {
  id: 'sq',
  kind: 'polyline',
  layer: 'DESSIN',
  closed: true,
  segments: [
    {
      type: 'line',
      start: [0, 0, 0],
      end: [2, 0, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    {
      type: 'line',
      start: [2, 0, 0],
      end: [2, 2, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    {
      type: 'line',
      start: [2, 2, 0],
      end: [0, 2, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    {
      type: 'line',
      start: [0, 2, 0],
      end: [0, 0, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
  ],
};

const ring = polylineToRing(square);
console.log(
  ring.length >= 4 ? `OK ring ${ring.length} pts` : `FAIL ring ${ring.length}`,
);
if (ring.length < 4) failed += 1;

const inside = pointInPolygon([1, 1, 0], ring);
const outside = pointInPolygon([3, 3, 0], ring);
console.log(inside && !outside ? 'OK pointInPolygon' : 'FAIL pip');
if (!inside || outside) failed += 1;

const clips = clipSegmentToPolygon([-1, 1, 0], [3, 1, 0], ring);
const okClip =
  clips.length >= 1 &&
  Math.abs(clips[0]![0][0] - 0) < 1e-6 &&
  Math.abs(clips[0]![1][0] - 2) < 1e-6;
console.log(okClip ? 'OK clip segment' : `FAIL clip ${JSON.stringify(clips)}`);
if (!okClip) failed += 1;

const pattern = defaultHatchPatternEntities();
const strokes = generateHatchStrokes(square, pattern, {
  hatchName: 'lignes45',
  scale: 1,
  rotationDeg: 0,
});
console.log(
  strokes.length > 0
    ? `OK hatch strokes ${strokes.length}`
    : 'FAIL no hatch strokes',
);
if (strokes.length === 0) failed += 1;

// Polyligne ouverte (fermeture virtuelle)
const open: PolylineEntity = {
  id: 'op',
  kind: 'polyline',
  layer: 'DESSIN',
  segments: [
    {
      type: 'line',
      start: [0, 0, 0],
      end: [1, 0, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    {
      type: 'line',
      start: [1, 0, 0],
      end: [1, 1, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
    {
      type: 'line',
      start: [1, 1, 0],
      end: [0, 1, 0],
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'plein',
    },
  ],
};
const r2 = polylineToRing(open);
const mid: Vec3 = [0.5, 0.5, 0];
console.log(
  pointInPolygon(mid, r2) ? 'OK open ring fill' : 'FAIL open ring',
);
if (!pointInPolygon(mid, r2)) failed += 1;

console.log(failed === 0 ? '\nTOUS LES TESTS OK' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
