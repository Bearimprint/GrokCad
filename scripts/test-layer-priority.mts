/**
 * Priorités = bandes matériaux (traits partagés).
 * Deux faces du béton (début+fin de bande) ont prio de raccord 1.
 */
import {
  recomputeLinearWallJoints,
  applyJoinWallsToEntities,
  wallEntityStrokes,
} from '../src/core/walls.ts';
import { wallLineJoinPriority } from '../src/core/wallLayerCatalog.ts';
import type { WallEntity, WallLineDef, Entity } from '../src/core/types.ts';

function wall(
  id: string,
  start: [number, number, number],
  end: [number, number, number],
  lines: WallLineDef[],
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

function nearNode(
  strokes: { points: [number, number, number][]; offset: number }[],
  off: number,
  corner: [number, number, number],
): [number, number, number] | null {
  const matches = strokes.filter((s) => Math.abs(s.offset - off) < 1e-9);
  if (!matches.length) return null;
  let best: [number, number, number] | null = null;
  let bestD = Infinity;
  for (const st of matches) {
    for (const p of st.points) {
      const d = Math.hypot(p[0] - corner[0], p[1] - corner[1]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

console.log('TEST prio raccord — bandes partagées');
// Comme le mur utilisateur : face0 sans type, enduit, béton, isolant, placo
const profile: WallLineDef[] = [
  { offset: 0, color: '#a', lineWidth: 1, lineStyle: 'plein' }, // 1ère face
  { offset: 0.02, color: '#b', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'enduit' },
  { offset: 0.18, color: '#c', lineWidth: 2, lineStyle: 'plein', priority: 1, layerTypeId: 'structure-beton' },
  { offset: 0.28, color: '#d', lineWidth: 1, lineStyle: 'plein', priority: 3, layerTypeId: 'isolant' },
  { offset: 0.293, color: '#e', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'placo-13' },
];
const expectedJoinPrio = [5, 1, 1, 3, 5];
for (let i = 0; i < profile.length; i++) {
  const p = wallLineJoinPriority(profile, profile[i]!);
  console.log(`  trait off ${profile[i]!.offset} → prio_raccord ${p} (attendu ${expectedJoinPrio[i]})`);
  if (p !== expectedJoinPrio[i]) {
    console.error('FAIL prio raccord');
    process.exit(1);
  }
}
// Les DEUX faces du béton (0.02 et 0.18) ont prio 1
if (wallLineJoinPriority(profile, profile[1]!) !== 1 || wallLineJoinPriority(profile, profile[2]!) !== 1) {
  console.error('FAIL faces béton');
  process.exit(1);
}
console.log('  OK deux faces béton en prio 1');

console.log('\nTEST L — faces béton se rejoignent');
// Mur A horizontal : face0, béton 0.15, placo 0.3
const linesA: WallLineDef[] = [
  { offset: 0, color: '#ccc', lineWidth: 1, lineStyle: 'plein' },
  { offset: 0.15, color: '#444', lineWidth: 2, lineStyle: 'plein', priority: 1, layerTypeId: 'structure-beton' },
  { offset: 0.3, color: '#ccc', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'placo-13' },
];
// Mur B vertical : face0, béton 0.2 (une seule bande structure puis rien d'autre → 2 traits)
const linesB: WallLineDef[] = [
  { offset: 0, color: '#444', lineWidth: 2, lineStyle: 'plein' },
  { offset: 0.2, color: '#444', lineWidth: 2, lineStyle: 'plein', priority: 1, layerTypeId: 'structure-beton' },
];
const ents = recomputeLinearWallJoints([
  wall('A', [0, 0, 0], [5, 0, 0], linesA),
  wall('B', [5, 0, 0], [5, 4, 0], linesB),
] as Entity[]) as WallEntity[];
const sa = wallEntityStrokes(ents.find((e) => e.id === 'A')!);
const sb = wallEntityStrokes(ents.find((e) => e.id === 'B')!);
// Face béton A à 0.15 et face béton B à 0.2 (outer) ou 0 (inner prio 1)
const aCore = nearNode(sa, 0.15, [5, 0, 0]);
const bCore = nearNode(sb, 0.2, [5, 0, 0]) ?? nearNode(sb, 0, [5, 0, 0]);
if (!aCore || !bCore) {
  console.error('FAIL traits béton manquants', aCore, bCore);
  process.exit(1);
}
const dCore = Math.hypot(aCore[0] - bCore[0], aCore[1] - bCore[1]);
console.log(`  prio1 d=${dCore.toFixed(4)}`);
if (dCore > 0.05) {
  console.error('FAIL L structure');
  process.exit(1);
}
console.log('  OK L faces béton');

console.log('\nTEST T mid — béton = bande (stop 1ʳᵉ face, pas traverse)');
const { entities, result } = applyJoinWallsToEntities(
  [
    wall('stem', [-3, 0.3, 0], [-0.5, 0.3, 0], profile),
    wall('bar', [0, -2, 0], [0, 2, 0], profile),
  ],
  'stem',
  'bar',
  { which: 'end' },
);
if (!result.ok || result.mode !== 'T') {
  console.error('FAIL join', result);
  process.exit(1);
}
const st = entities.find((e) => e.id === 'stem') as WallEntity;
const barE = entities.find((e) => e.id === 'bar') as WallEntity;
const ss = wallEntityStrokes(st);
const bs = wallEntityStrokes(barE);
// Les deux faces béton du pied s’arrêtent sur la face d’entrée barre (0.18)
const faceIn = nearNode(ss, 0.02, [0, 0.3, 0])!;
const faceOut = nearNode(ss, 0.18, [0, 0.3, 0])!;
console.log(`  face béton 0.02 → x=${faceIn[0].toFixed(3)}  face 0.18 → x=${faceOut[0].toFixed(3)}`);
if (Math.abs(faceOut[0] + 0.18) > 0.05) {
  console.error('FAIL face béton outer', faceOut[0]);
  process.exit(1);
}
if (Math.abs(faceIn[0] + 0.18) > 0.05) {
  console.error('FAIL face béton inner traverse →', faceIn[0], 'attendu -0.18');
  process.exit(1);
}
// Face entrée béton barre (0.18) ouverte dans la bande structure du pied
const entrySegs = bs.filter((s) => Math.abs(s.offset - 0.18) < 1e-9);
if (entrySegs.length < 2) {
  console.error('FAIL face entrée béton barre non ouverte', entrySegs.length);
  process.exit(1);
}
console.log('  OK béton bande : stop face entrée + ouverture barre');

console.log('\nTEST T mid — structure parpaing (prio 2) ouverte comme le béton');
{
  const parpaing: WallLineDef[] = [
    { offset: 0, color: '#a', lineWidth: 1, lineStyle: 'plein' },
    { offset: 0.02, color: '#b', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'enduit' },
    { offset: 0.22, color: '#c', lineWidth: 2, lineStyle: 'plein', priority: 2, layerTypeId: 'structure-parpaing' },
    { offset: 0.32, color: '#d', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'placo-13' },
  ];
  const { entities: pe, result: pr } = applyJoinWallsToEntities(
    [
      wall('stemP', [-3, 0.3, 0], [-0.5, 0.3, 0], parpaing),
      wall('barP', [0, -2, 0], [0, 2, 0], parpaing),
    ],
    'stemP',
    'barP',
    { which: 'end' },
  );
  if (!pr.ok || pr.mode !== 'T') {
    console.error('FAIL join parpaing', pr);
    process.exit(1);
  }
  const barP = pe.find((e) => e.id === 'barP') as WallEntity;
  const entry = wallEntityStrokes(barP).filter(
    (s) => Math.abs(s.offset - 0.22) < 1e-9,
  );
  if (entry.length < 2) {
    console.error('FAIL face structure parpaing non ouverte', entry.length);
    process.exit(1);
  }
  console.log('  OK parpaing (prio 2) : face entrée ouverte');
}

console.log('\nPASS priorités de couches (modèle bandes)');
