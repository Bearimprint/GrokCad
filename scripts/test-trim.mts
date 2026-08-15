/**
 * Tests /trim + historique fichiers récents.
 */
import { pushRecentFile } from '../src/core/appPrefs.ts';
import { isPolylineClosed } from '../src/core/extend.ts';
import {
  applyTrim,
  findNearestTrimCandidate,
  projectPerpOnObject,
  sideToKeep,
} from '../src/core/trim.ts';
import { createPolylineFromPoints } from '../src/core/polyline.ts';
import type {
  ArcEntity,
  LineEntity,
  Vec3,
  WallEntity,
  WallLineDef,
} from '../src/core/types.ts';

let failed = 0;

function line(id: string, start: Vec3, end: Vec3): LineEntity {
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

const wallLines: WallLineDef[] = [
  { offset: 0, color: '#a', lineWidth: 1, lineStyle: 'plein' },
  { offset: 0.2, color: '#b', lineWidth: 1, lineStyle: 'plein', priority: 1 },
];

function wall(id: string, start: Vec3, end: Vec3): WallEntity {
  return {
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 's',
    path: 'line',
    flip: false,
    lines: wallLines.map((l) => ({ ...l })),
    start,
    end,
  };
}

console.log('TEST /trim ligne — garder le départ');
{
  const ln = line('l1', [0, 0, 0], [10, 0, 0]);
  const r = applyTrim(ln, [4, 0, 0], 'start');
  if (!r || r.entity.kind !== 'line') {
    console.log('  FAIL pas de résultat');
    failed += 1;
  } else if (Math.abs(r.entity.end[0] - 4) > 1e-9 || r.entity.start[0] !== 0) {
    console.log('  FAIL', r.entity.start, r.entity.end);
    failed += 1;
  } else {
    console.log('  OK (0,0) → (4,0)');
  }
}

console.log('TEST /trim ligne — garder la fin');
{
  const ln = line('l2', [0, 0, 0], [10, 0, 0]);
  const r = applyTrim(ln, [4, 0, 0], 'end');
  if (!r || r.entity.kind !== 'line') {
    console.log('  FAIL pas de résultat');
    failed += 1;
  } else if (Math.abs(r.entity.start[0] - 4) > 1e-9 || r.entity.end[0] !== 10) {
    console.log('  FAIL', r.entity.start, r.entity.end);
    failed += 1;
  } else {
    console.log('  OK (4,0) → (10,0)');
  }
}

console.log('TEST /trim côté selon le clic');
{
  const ln = line('l3', [0, 0, 0], [10, 0, 0]);
  const left = sideToKeep(ln, [5, 0, 0], [1, 1, 0]);
  const right = sideToKeep(ln, [5, 0, 0], [9, 1, 0]);
  if (left !== 'start' || right !== 'end') {
    console.log(`  FAIL left=${left} right=${right}`);
    failed += 1;
  } else {
    console.log('  OK clic gauche=départ, clic droit=fin');
  }
}

console.log('TEST /trim arc quart — garder le départ');
{
  const a = arc('a1', [0, 0, 0], 2, 0, Math.PI / 2);
  const cut: Vec3 = [2 * Math.cos(Math.PI / 4), 2 * Math.sin(Math.PI / 4), 0];
  const r = applyTrim(a, cut, 'start');
  if (!r || r.entity.kind !== 'arc') {
    console.log('  FAIL pas d’arc');
    failed += 1;
  } else if (Math.abs(r.entity.endAngle - Math.PI / 4) > 0.05) {
    console.log('  FAIL endAngle', r.entity.endAngle);
    failed += 1;
  } else {
    console.log('  OK arc raccourci à π/4');
  }
}

console.log('TEST /trim polyligne ouverte');
{
  const poly = createPolylineFromPoints(
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 3, 0],
    ],
    { color: '#fff', lineWidth: 1, lineStyle: 'plein' },
  )!;
  if (isPolylineClosed(poly)) {
    console.log('  FAIL ouverte détectée fermée');
    failed += 1;
  }
  const r = applyTrim(poly, [2, 0, 0], 'start');
  if (!r || r.entity.kind !== 'polyline' || r.entity.segments.length !== 1) {
    console.log('  FAIL segs', r?.entity);
    failed += 1;
  } else {
    const s = r.entity.segments[0]!;
    if (s.type !== 'line' || Math.abs(s.end[0] - 2) > 1e-6) {
      console.log('  FAIL segment', s);
      failed += 1;
    } else {
      console.log('  OK reste le 1er morceau jusqu’à x=2');
    }
  }
}

console.log('TEST /trim refuse polyligne fermée (rectangle)');
{
  const poly = createPolylineFromPoints(
    [
      [0, 0, 0],
      [4, 0, 0],
      [4, 3, 0],
      [0, 3, 0],
      [0, 0, 0],
    ],
    { color: '#fff', lineWidth: 1, lineStyle: 'plein' },
    { closed: true },
  )!;
  const cand = findNearestTrimCandidate([2, 0, 0], [poly], 0.5);
  if (!cand || cand.reject !== 'closed-poly') {
    console.log('  FAIL devrait refuser', cand);
    failed += 1;
  } else {
    console.log('  OK closed-poly');
  }
}

console.log('TEST /trim mur linéaire');
{
  const w = wall('w1', [0, 0, 0], [5, 0, 0]);
  const r = applyTrim(w, [2, 0, 0], 'end');
  if (!r || r.entity.kind !== 'wall') {
    console.log('  FAIL pas de mur');
    failed += 1;
  } else if (Math.abs(r.entity.start[0] - 2) > 1e-9 || r.entity.end[0] !== 5) {
    console.log('  FAIL', r.entity.start, r.entity.end);
    failed += 1;
  } else {
    console.log('  OK mur (2,0) → (5,0)');
  }
}

console.log('TEST trim perpendiculaire loin + hors objet');
{
  const ln = line('lp', [0, 0, 0], [10, 0, 0]);
  const on = projectPerpOnObject(ln, [4, 8, 0]);
  const hors = projectPerpOnObject(ln, [12, 3, 0]);
  if (!on?.onObject || Math.abs(on.point[0] - 4) > 1e-9) {
    console.log('  FAIL perp sur objet', on);
    failed += 1;
  } else if (!hors || hors.onObject) {
    console.log('  FAIL hors objet devrait être refusé', hors);
    failed += 1;
  } else {
    console.log('  OK clic loin → x=4 ; au-delà du bout → hors');
  }
}

console.log('TEST historique 7 fichiers, sans doublon');
{
  let list: { path: string; name: string }[] = [];
  for (let i = 1; i <= 9; i++) {
    list = pushRecentFile(list, `/tmp/f${i}.gkd`);
  }
  if (list.length !== 7) {
    console.log('  FAIL length', list.length);
    failed += 1;
  } else if (list[0]!.path !== '/tmp/f9.gkd' || list[6]!.path !== '/tmp/f3.gkd') {
    console.log('  FAIL order', list.map((e) => e.name));
    failed += 1;
  } else {
    list = pushRecentFile(list, '/tmp/f5.gkd');
    if (list.length !== 7 || list[0]!.path !== '/tmp/f5.gkd') {
      console.log('  FAIL dedup front', list.map((e) => e.name));
      failed += 1;
    } else if (list.filter((e) => e.path === '/tmp/f5.gkd').length !== 1) {
      console.log('  FAIL doublon');
      failed += 1;
    } else {
      console.log('  OK max 7 + dédup (f5 remonté)');
    }
  }
}

console.log('\n' + (failed === 0 ? 'PASS /trim' : `${failed} ÉCHEC(S)`));
process.exit(failed === 0 ? 0 : 1);
