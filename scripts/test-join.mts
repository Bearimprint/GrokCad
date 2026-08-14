/**
 * /join — modèle bandes : 2 faces béton (prio raccord 1) + nœud T star.
 */
import {
  applyJoinWallsToEntities,
  joinWallToWall,
  wallEntityStrokes,
} from '../src/core/walls.ts';
import { wallLineJoinPriority } from '../src/core/wallLayerCatalog.ts';
import type { Entity, WallEntity, WallLineDef } from '../src/core/types.ts';

/** Profil correct : face0 sans type, puis bandes enduit / béton / isolant / placo */
const lines: WallLineDef[] = [
  { offset: 0, color: '#a', lineWidth: 1, lineStyle: 'plein' },
  { offset: 0.02, color: '#b', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'enduit' },
  { offset: 0.18, color: '#c', lineWidth: 2, lineStyle: 'plein', priority: 1, layerTypeId: 'structure-beton' },
  { offset: 0.28, color: '#d', lineWidth: 1, lineStyle: 'plein', priority: 3, layerTypeId: 'isolant' },
  { offset: 0.293, color: '#e', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'placo-13' },
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

function nearEnd(
  strokes: { points: [number, number, number][]; offset: number }[],
  off: number,
  target: [number, number],
): [number, number, number] {
  const st = strokes.find((s) => Math.abs(s.offset - off) < 1e-9);
  if (!st) throw new Error(`missing ${off}`);
  return st.points.reduce((best, p) =>
    Math.hypot(p[0] - target[0], p[1] - target[1]) <
    Math.hypot(best[0] - target[0], best[1] - target[1])
      ? p
      : best,
  );
}

console.log('TEST /join — bandes matériaux + nœud T');
// Priorités de raccord
const jp = lines.map((l) => wallLineJoinPriority(lines, l));
console.log('  prio raccord par trait:', jp.join(', '));
if (jp.join(',') !== '5,1,1,3,5') {
  console.error('FAIL prio raccord', jp);
  process.exit(1);
}
console.log('  OK prio raccord (2 faces béton = 1)');

const { entities, result } = applyJoinWallsToEntities(
  [wall('stem', [-3, 0.3, 0], [-0.5, 0.3, 0]), wall('bar', [0, -2, 0], [0, 2, 0])] as Entity[],
  'stem',
  'bar',
  { which: 'end' },
);
if (!result.ok || result.mode !== 'T') {
  console.error('FAIL', result);
  process.exit(1);
}
const s = entities.find((e) => e.id === 'stem') as WallEntity;
const b = entities.find((e) => e.id === 'bar') as WallEntity;
const ss = wallEntityStrokes(s);
const bs = wallEntityStrokes(b);

for (const ln of lines) {
  const p = nearEnd(ss, ln.offset, [0, 0.3]);
  console.log(`  stem off ${ln.offset} → (${p[0].toFixed(3)},${p[1].toFixed(3)})`);
}

// Béton = bande matériau : les DEUX faces du pied s’arrêtent sur la 1ʳᵉ face
// béton de la barre (extérieure, offset 0.18) — ne traversent PAS l’épaisseur.
const f02 = nearEnd(ss, 0.02, [0, 0.3]);
const f18 = nearEnd(ss, 0.18, [0, 0.3]);
if (Math.abs(f18[0] + 0.18) > 0.04) {
  console.error('FAIL face béton 0.18 →', f18[0], 'attendu ~-0.18 (face entrée)');
  process.exit(1);
}
if (Math.abs(f02[0] + 0.18) > 0.04) {
  console.error(
    'FAIL face béton 0.02 traverse le béton →',
    f02[0],
    'attendu ~-0.18 (stop 1ʳᵉ face, pas -0.02)',
  );
  process.exit(1);
}
console.log('  OK faces béton pied stoppent sur face entrée barre (0.18)');

// Isolant outer
const iso = nearEnd(ss, 0.28, [0, 0.3]);
if (Math.abs(iso[0] + 0.28) > 0.04) {
  console.error('FAIL isolant', iso[0]);
  process.exit(1);
}
console.log('  OK isolant → isolant');

// Barre :
// - face0 + face béton lointaine (0.02) continues
// - face entrée béton (0.18) OUVERTE dans la bande structure du pied
// - peaux ext. ouvertes
const face0Bar = bs.filter((st) => Math.abs(st.offset) < 1e-9);
const coreInnerBar = bs.filter((st) => Math.abs(st.offset - 0.02) < 1e-9);
const coreEntryBar = bs.filter((st) => Math.abs(st.offset - 0.18) < 1e-9);
const extBar = bs.filter((st) => Math.abs(st.offset - 0.28) < 1e-9);
const spanY = (segs: typeof bs) => {
  let lo = Infinity, hi = -Infinity;
  for (const st of segs) {
    for (const p of st.points) {
      lo = Math.min(lo, p[1]!);
      hi = Math.max(hi, p[1]!);
    }
  }
  return hi - lo;
};
if (spanY(face0Bar) < 3.5) {
  console.error('FAIL face0 barre non continue', spanY(face0Bar), face0Bar.length);
  process.exit(1);
}
if (spanY(coreInnerBar) < 3.5) {
  console.error('FAIL béton intérieur barre non continue', spanY(coreInnerBar));
  process.exit(1);
}
if (coreEntryBar.length < 2) {
  console.error(
    'FAIL face entrée béton barre non ouverte',
    coreEntryBar.length,
  );
  process.exit(1);
}
if (extBar.length < 2) {
  console.error('FAIL peaux ext. non ouvertes', extBar.length);
  process.exit(1);
}
console.log('  OK barre : face0+béton int. continus, entrée béton + peaux ouvertes');

const jl = joinWallToWall(
  wall('h', [0, 0, 0], [2, 0, 0]),
  wall('v', [2.2, 0, 0], [2.2, 2, 0]),
  { which: 'end' },
);
if (!jl.ok || jl.mode !== 'L') {
  console.error('FAIL L', jl);
  process.exit(1);
}
if (Math.abs(jl.hit[0] - 2.2) > 1e-9 || Math.abs(jl.hit[1]) > 1e-9) {
  console.error('FAIL L hit', jl.hit);
  process.exit(1);
}
console.log('  OK L');

// Longue barre : 50 cm du bout d’une façade 10 m = T, pas L
{
  const long = joinWallToWall(
    wall('stem10', [-3, 4.5, 0], [-0.5, 4.5, 0]),
    wall('bar10', [0, -5, 0], [0, 5, 0]),
    { which: 'end' },
  );
  if (!long.ok || long.mode !== 'T') {
    console.error('FAIL longue barre doit rester T (pas 8% L)', long);
    process.exit(1);
  }
  if (Math.hypot(long.target.start[0], long.target.start[1] + 5) > 1e-9) {
    console.error('FAIL barre raccourcie', long.target.start);
    process.exit(1);
  }
  console.log('  OK T à 50 cm du bout d’une barre 10 m (barre intacte)');
}

// L au loin + T mid : le miter L du pied doit survivre au peigne
{
  const h = wall('hl', [0.3, 0, 0], [2, 0, 0]);
  const v = wall('vl', [2, 0, 0], [2, 2, 0]);
  const bar = wall('bl', [0, -2, 0], [0, 2, 0]);
  const afterL = applyJoinWallsToEntities([h, v] as Entity[], 'hl', 'vl', {
    which: 'end',
  });
  if (!afterL.result.ok) {
    console.error('FAIL L préalable', afterL.result);
    process.exit(1);
  }
  const afterT = applyJoinWallsToEntities(
    [...afterL.entities, bar],
    'hl',
    'bl',
    { which: 'start' },
  );
  if (!afterT.result.ok || afterT.result.mode !== 'T') {
    console.error('FAIL T après L', afterT.result);
    process.exit(1);
  }
  const hh = afterT.entities.find((e) => e.id === 'hl') as WallEntity;
  const g = hh.strokeGeom?.find((x) => Math.abs(x.offset - 0.02) < 1e-9);
  if (!g) {
    console.error('FAIL pas de trait 0.02 après L+T');
    process.exit(1);
  }
  const far = g.end[0] > g.start[0] ? g.end : g.start;
  // miter L offset 0.02 ≈ (1.98, 0.02) — pas le simple (2, 0.02)
  if (Math.abs(far[0] - 1.98) > 0.05 || Math.abs(far[1] - 0.02) > 0.05) {
    console.error('FAIL miter L loin perdu', far);
    process.exit(1);
  }
  console.log('  OK miter L du pied survit au T mid');
}

console.log('\nPASS /join');
