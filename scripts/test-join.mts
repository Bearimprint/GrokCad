/**
 * /join — modèle bandes : 2 faces béton (prio raccord 1) + nœud T star.
 */
import {
  applyJoinWallsToEntities,
  cornerWallToWall,
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

// T mid sur une barre qui forme déjà un L : extraBars ne doit PAS
// forcer une butée d’enveloppe (les couches gardent le BIM).
{
  const v = wall('lv', [0, 2, 0], [0, 0, 0]);
  const h = wall('lh', [0, 0, 0], [4, 0, 0]);
  const stem = wall('st', [2, 1.2, 0], [2, 0.4, 0]);
  const afterL = applyJoinWallsToEntities([v, h] as Entity[], 'lv', 'lh', {
    which: 'end',
  });
  const afterT = applyJoinWallsToEntities(
    [...afterL.entities, stem],
    'st',
    'lh',
    { which: 'end' },
  );
  if (!afterT.result.ok || afterT.result.mode !== 'T') {
    console.error('FAIL T sur barre de L', afterT.result);
    process.exit(1);
  }
  const st = afterT.entities.find((e) => e.id === 'st') as WallEntity;
  const ssT = wallEntityStrokes(st);
  const beton = nearEnd(ssT, 0.18, [2, 0]);
  const isoT = nearEnd(ssT, 0.28, [2, 0]);
  // Approche depuis +Y = côté offsets de lh (haut) → entrée béton = 0.18, y≈0.18
  if (Math.abs(beton[1] - 0.18) > 0.04) {
    console.error('FAIL T-sur-L béton →', beton, 'attendu y≈0.18 (pas enveloppe 0)');
    process.exit(1);
  }
  // Isolant rejoint isolant (0.28) sans traverser le béton
  if (Math.abs(isoT[1] - 0.28) > 0.04) {
    console.error('FAIL T-sur-L isolant →', isoT, 'attendu y≈0.28 (jumelle)');
    process.exit(1);
  }
  console.log('  OK T sur barre d’un L : BIM (béton→béton, isolant→isolant)');
}

// /join avec flip [ALT] : offsets inversés, le BIM reste côté d’attache
{
  const bar = wall('bf', [0, -2, 0], [0, 2, 0]);
  const stemF: WallEntity = {
    ...wall('sf', [-3, 0.3, 0], [-0.5, 0.3, 0]),
    flip: true,
  };
  const { entities: entF, result: resF } = applyJoinWallsToEntities(
    [stemF, bar] as Entity[],
    'sf',
    'bf',
    { which: 'end' },
  );
  if (!resF.ok || resF.mode !== 'T') {
    console.error('FAIL T flip', resF);
    process.exit(1);
  }
  const sf = entF.find((e) => e.id === 'sf') as WallEntity;
  const sfs = wallEntityStrokes(sf);
  const f18 = nearEnd(sfs, 0.18, [0, 0.3]);
  if (Math.abs(f18[0] + 0.18) > 0.05) {
    console.error('FAIL T flip béton →', f18, 'attendu x≈-0.18');
    process.exit(1);
  }
  console.log('  OK T avec flip [ALT] : béton → face entrée');
}

// Approche depuis la face 0 (extérieur) : béton traverse l’enduit, isolant
// s’arrête contre le béton (pas de vide jusqu’à l’enveloppe).
{
  const bar = wall('bo', [0, -2, 0], [0, 2, 0]);
  // Pied à x=+0.5 (côté face 0 de la barre, offsets vers −X)
  const stem = wall('so', [3, 0.3, 0], [0.5, 0.3, 0]);
  const { entities: entO, result: resO } = applyJoinWallsToEntities(
    [stem, bar] as Entity[],
    'so',
    'bo',
    { which: 'end' },
  );
  if (!resO.ok || resO.mode !== 'T') {
    console.error('FAIL T face0', resO);
    process.exit(1);
  }
  const so = entO.find((e) => e.id === 'so') as WallEntity;
  const sos = wallEntityStrokes(so);
  const o18 = nearEnd(sos, 0.18, [0, 0.3]);
  const o28 = nearEnd(sos, 0.28, [0, 0.3]);
  // Face entrée béton depuis face0 = offset 0.02 → x≈-0.02
  if (Math.abs(o18[0] + 0.02) > 0.05) {
    console.error('FAIL T face0 béton →', o18, 'attendu x≈-0.02');
    process.exit(1);
  }
  if (Math.abs(o28[0] + 0.02) > 0.05) {
    console.error('FAIL T face0 isolant vide →', o28, 'attendu stop béton x≈-0.02');
    process.exit(1);
  }
  console.log('  OK T depuis face 0 : béton+isolant stoppent sur béton entrée');
}

// /corner : 2 murs qui ne se touchent pas → L au croisement des axes
{
  const a = wall('ca', [0, 0.4, 0], [1.2, 0.4, 0]);
  const b = wall('cb', [2, 0, 0], [2, 1.5, 0]);
  const r = cornerWallToWall(a, [0.2, 0.4, 0], b, [2, 1.2, 0]);
  if (!r.ok) {
    console.error('FAIL corner gap', r);
    process.exit(1);
  }
  const aEnd = r.a.start[0] === 0 ? r.a.end : r.a.start;
  if (Math.abs(aEnd[0] - 2) > 1e-6 || Math.abs(aEnd[1] - 0.4) > 1e-6) {
    console.error('FAIL corner A pas sur P', r.a.start, r.a.end);
    process.exit(1);
  }
  console.log('  OK /corner murs séparés → coin en (2, 0.4)');
}

// /corner X : le clic choisit le quadrant
{
  const a = wall('xa', [-2, 0, 0], [2, 0, 0]);
  const b = wall('xb', [0, -2, 0], [0, 2, 0]);
  const r = cornerWallToWall(a, [-1, 0, 0], b, [0, 1, 0]);
  if (!r.ok) {
    console.error('FAIL corner X', r);
    process.exit(1);
  }
  // A garde x<=0, B garde y>=0
  const aXs = [r.a.start[0]!, r.a.end[0]!];
  const bYs = [r.b.start[1]!, r.b.end[1]!];
  if (Math.max(...aXs) > 0.01 || Math.min(...bYs) < -0.01) {
    console.error('FAIL quadrant X', r.a, r.b);
    process.exit(1);
  }
  console.log('  OK /corner X : clic = quadrant (ouest + nord)');
}

// L flip mixte : les couches se rejoignent (pas de butée ratée)
{
  const a = wall('fa', [0, 0, 0], [2, 0, 0]);
  const b: WallEntity = { ...wall('fb', [0, 0, 0], [0, 2, 0]), flip: true };
  const { entities } = applyJoinWallsToEntities([a, b] as Entity[], 'fa', 'fb', {
    which: 'start',
  });
  const aa = entities.find((e) => e.id === 'fa') as WallEntity;
  const bb = entities.find((e) => e.id === 'fb') as WallEntity;
  const ssA = wallEntityStrokes(aa);
  const ssB = wallEntityStrokes(bb);
  let maxGap = 0;
  for (const sa of ssA) {
    const ea = sa.points.reduce((best, p) =>
      Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1]) ? p : best,
    );
    let best = Infinity;
    for (const sb of ssB) {
      for (const p of sb.points) {
        const d = Math.hypot(p[0] - ea[0], p[1] - ea[1]);
        if (d < best) best = d;
      }
    }
    if (best > maxGap) maxGap = best;
  }
  if (maxGap > 0.03) {
    console.error('FAIL L flip mixte gap', maxGap);
    process.exit(1);
  }
  console.log('  OK L flip [ALT] : couches se rejoignent (gap', maxGap.toFixed(4), 'm)');
}

console.log('\nPASS /join');
