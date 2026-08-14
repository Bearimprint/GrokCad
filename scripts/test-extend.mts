/**
 * Tests /extend — allongement ligne / arc.
 * Run: npx tsx scripts/test-extend.mts
 */
import { applyExtend, findNearestExtendable, isPolylineClosed } from '../src/core/extend.ts';
import type {
  ArcEntity,
  LineEntity,
  PolylineEntity,
  Vec3,
} from '../src/core/types.ts';

let failed = 0;

function line(
  id: string,
  start: Vec3,
  end: Vec3,
): LineEntity {
  return {
    id,
    kind: 'line',
    layer: 'DESSIN',
    start,
    end,
    color: '#fff',
    lineWidth: 1,
    lineStyle: 'plein',
  };
}

function arc(
  id: string,
  center: Vec3,
  radius: number,
  a0: number,
  a1: number,
): ArcEntity {
  return {
    id,
    kind: 'arc',
    layer: 'DESSIN',
    center,
    radius,
    startAngle: a0,
    endAngle: a1,
    normal: [0, 0, 1],
    color: '#fff',
    lineWidth: 1,
    lineStyle: 'plein',
  };
}

// Ligne horizontale (0,0)→(2,0) étendue jusqu’à verticale x=5
{
  const src = line('L', [0, 0, 0], [2, 0, 0]);
  const bound = line('B', [5, -2, 0], [5, 3, 0]);
  const r = applyExtend(
    { entity: src, end: 'end', point: [2, 0, 0], dist: 0 },
    bound,
  );
  if (!r || r.entity.kind !== 'line') {
    console.log('FAIL line extend missing');
    failed += 1;
  } else {
    const e = r.entity.end;
    const ok = Math.abs(e[0] - 5) < 1e-9 && Math.abs(e[1]) < 1e-9;
    console.log(
      ok
        ? `OK line extend → (${e[0]},${e[1]}) +${r.lengthened.toFixed(3)}`
        : `FAIL line end=${e}`,
    );
    if (!ok) failed += 1;
  }
}

// Allonger le début de la ligne vers la gauche
{
  const src = line('L2', [2, 0, 0], [4, 0, 0]);
  const bound = line('B2', [0, -1, 0], [0, 1, 0]);
  const r = applyExtend(
    { entity: src, end: 'start', point: [2, 0, 0], dist: 0 },
    bound,
  );
  if (!r || r.entity.kind !== 'line') {
    console.log('FAIL line start extend');
    failed += 1;
  } else {
    const s = r.entity.start;
    const ok = Math.abs(s[0]) < 1e-9 && Math.abs(s[1]) < 1e-9;
    console.log(ok ? `OK line start → (${s[0]},${s[1]})` : `FAIL start=${s}`);
    if (!ok) failed += 1;
  }
}

// Parallèle → null
{
  const src = line('Lp', [0, 0, 0], [2, 0, 0]);
  const bound = line('Bp', [0, 1, 0], [2, 1, 0]);
  const r = applyExtend(
    { entity: src, end: 'end', point: [2, 0, 0], dist: 0 },
    bound,
  );
  console.log(r == null ? 'OK parallel null' : 'FAIL expected null parallel');
  if (r != null) failed += 1;
}

// Arc 1/4 de cercle, étendre jusqu’à une droite
// Arc centre 0, rayon 1, de 0 à π/2 (quart) — étendre end jusqu’à y=0? already at end?
// Étendre end (π/2) jusqu’à la droite x=-2 (cercle ∩ droite)
// Cercle x²+y²=1 ∩ x=-2 : pas d’intersection. Better: droite y=-0.5
// Intersection: x²+0.25=1 → x=±√0.75. Angles atan2(-0.5, ±√0.75)
// From end π/2 CCW: going past π/2 toward π and beyond to the angle of (-√0.75, -0.5)
{
  const src = arc('A', [0, 0, 0], 1, 0, Math.PI / 2);
  const bound = line('By', [-2, -0.5, 0], [2, -0.5, 0]);
  const r = applyExtend(
    { entity: src, end: 'end', point: [0, 1, 0], dist: 0 },
    bound,
  );
  if (!r || r.entity.kind !== 'arc') {
    console.log('FAIL arc extend');
    failed += 1;
  } else {
    // end should reach an intersection with y=-0.5
    const a1 = r.entity.endAngle;
    const y = Math.sin(a1); // radius 1
    const ok = Math.abs(y - -0.5) < 1e-6 && a1 > Math.PI / 2;
    console.log(
      ok
        ? `OK arc extend endAngle=${a1.toFixed(3)}`
        : `FAIL arc endAngle=${a1} y=${y}`,
    );
    if (!ok) failed += 1;
  }
}

// Polyligne fermée
{
  const poly: PolylineEntity = {
    id: 'P',
    kind: 'polyline',
    layer: 'DESSIN',
    closed: true,
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
        end: [0, 0, 0],
        color: '#fff',
        lineWidth: 1,
        lineStyle: 'plein',
      },
    ],
  };
  console.log(
    isPolylineClosed(poly) ? 'OK closed poly' : 'FAIL closed poly',
  );
  if (!isPolylineClosed(poly)) failed += 1;

  const hit = findNearestExtendable([0.5, 0, 0], [poly], 1);
  console.log(
    hit == null ? 'OK closed not extendable' : 'FAIL closed was picked',
  );
  if (hit != null) failed += 1;
}

// Polyligne ouverte : allonger le dernier segment
{
  const poly: PolylineEntity = {
    id: 'Po',
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
        end: [2, 0, 0],
        color: '#fff',
        lineWidth: 1,
        lineStyle: 'plein',
      },
    ],
  };
  const bound = line('Bb', [5, -1, 0], [5, 1, 0]);
  const r = applyExtend(
    { entity: poly, end: 'end', point: [2, 0, 0], dist: 0 },
    bound,
  );
  if (!r || r.entity.kind !== 'polyline') {
    console.log('FAIL open poly extend');
    failed += 1;
  } else {
    const last = r.entity.segments[r.entity.segments.length - 1]!;
    const ok =
      last.type === 'line' &&
      Math.abs(last.end[0] - 5) < 1e-9 &&
      Math.abs(last.end[1]) < 1e-9;
    console.log(ok ? 'OK open poly extend' : `FAIL last=${JSON.stringify(last)}`);
    if (!ok) failed += 1;
  }
}

console.log(failed === 0 ? '\nTOUS LES TESTS OK' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
