/**
 * Test non-régression /jonction : onglets multi-traits L et T.
 * Run: node --experimental-strip-types scripts/test-jonction.mts
 */
import {
  JONCTION_STRATEGIES,
  recomputeLinearWallJoints,
  snapAndRejoinWallsInBox,
  wallEntityStrokes,
  type JonctionStrategyId,
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
): WallEntity {
  return {
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 'styleA',
    path: 'line',
    flip: false,
    lines: lines3.map((l) => ({ ...l })),
    start,
    end,
  };
}

function almostEq(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

function endsMeet(
  strokesA: { points: [number, number, number][] }[],
  strokesB: { points: [number, number, number][] }[],
  corner: [number, number, number],
  tol = 0.02,
): { ok: boolean; detail: string } {
  // Pour chaque offset, une extrémité de A et de B doit coïncider (onglet)
  if (strokesA.length !== strokesB.length) {
    return {
      ok: false,
      detail: `nb traits A=${strokesA.length} B=${strokesB.length}`,
    };
  }
  let misses = 0;
  for (let i = 0; i < strokesA.length; i++) {
    const aPts = strokesA[i]!.points;
    const bPts = strokesB[i]!.points;
    // Prendre le point de chaque trait le plus proche du coin théorique
    const aEnd = aPts.reduce((best, p) =>
      Math.hypot(p[0] - corner[0], p[1] - corner[1]) <
      Math.hypot(best[0] - corner[0], best[1] - corner[1])
        ? p
        : best,
    );
    const bEnd = bPts.reduce((best, p) =>
      Math.hypot(p[0] - corner[0], p[1] - corner[1]) <
      Math.hypot(best[0] - corner[0], best[1] - corner[1])
        ? p
        : best,
    );
    const d = Math.hypot(aEnd[0] - bEnd[0], aEnd[1] - bEnd[1]);
    if (d > tol) {
      misses += 1;
      console.log(
        `  offset#${i}: A@(${aEnd[0].toFixed(3)},${aEnd[1].toFixed(3)}) B@(${bEnd[0].toFixed(3)},${bEnd[1].toFixed(3)}) d=${d.toFixed(4)}`,
      );
    }
  }
  return {
    ok: misses === 0,
    detail: misses === 0 ? 'tous les traits se rejoignent' : `${misses} trait(s) ne se rejoignent pas`,
  };
}

let failed = 0;

// ─── L : 2 murs perpendiculaires multi-traits ───────────────────────────────
{
  console.log('TEST L — 2 murs perpendiculaires (3 traits)');
  // Horizontal (0,0)→(5,0) + vertical (5,0)→(5,4)
  const w1 = wall('w1', [0, 0, 0], [5, 0, 0]);
  const w2 = wall('w2', [5, 0, 0], [5, 4, 0]);
  const joined = recomputeLinearWallJoints([w1, w2]);
  const a = joined.find((w) => w.id === 'w1')!;
  const b = joined.find((w) => w.id === 'w2')!;
  const sa = wallEntityStrokes(a);
  const sb = wallEntityStrokes(b);
  console.log('  strokeGeom w1:', a.strokeGeom?.length, 'w2:', b.strokeGeom?.length);
  const r = endsMeet(sa as any, sb as any, [5, 0, 0]);
  console.log(r.ok ? '  OK' : '  FAIL', r.detail);
  if (!r.ok) failed += 1;

  // Les traits ne doivent PAS s’arrêter au simple offset (miters doivent dépasser/raccourcir)
  // Coin intérieur offset+ : miter à (5-o, o) approximativement pour L standard
  if (a.strokeGeom && a.strokeGeom[1]) {
    const g = a.strokeGeom[1]!; // offset 0.1
    const nearCorner = Math.hypot(g.end[0] - 5, g.end[1] - 0) < 0.5 ||
      Math.hypot(g.start[0] - 5, g.start[1] - 0) < 0.5;
    // Le bout côté coin de l’offset 0.1 doit être près de (5-0.1, 0.1) = (4.9, 0.1)
    const ends = [g.start, g.end];
    const miterLike = ends.some(
      (p) => almostEq(p[0], 4.9, 0.05) && almostEq(p[1], 0.1, 0.05),
    );
    console.log(
      miterLike
        ? '  OK miter offset 0.1 ≈ (4.9, 0.1)'
        : `  FAIL miter attendu (4.9,0.1) got starts/ends ${JSON.stringify(ends)}`,
    );
    if (!miterLike) failed += 1;
    if (!nearCorner && !miterLike) {
      /* already counted */
    }
  }
}

// ─── T : 3 murs (barre + pied) ──────────────────────────────────────────────
{
  console.log('TEST T — 3 murs (barre traversante + pied)');
  // Barre : (-3,0)→(0,0) et (0,0)→(3,0) ; pied : (0,0)→(0,3)
  const left = wall('tl', [-3, 0, 0], [0, 0, 0]);
  const right = wall('tr', [0, 0, 0], [3, 0, 0]);
  const stem = wall('ts', [0, 0, 0], [0, 3, 0]);
  const joined = recomputeLinearWallJoints([left, right, stem]);
  const L = joined.find((w) => w.id === 'tl')!;
  const R = joined.find((w) => w.id === 'tr')!;
  const S = joined.find((w) => w.id === 'ts')!;

  // La barre doit rester continue (traits left/right se rejoignent sur la même droite y=±offset)
  const sL = wallEntityStrokes(L);
  const sR = wallEntityStrokes(R);
  const sS = wallEntityStrokes(S);
  console.log(
    '  traits L/R/S:',
    sL.length,
    sR.length,
    sS.length,
    'geom?',
    !!L.strokeGeom,
    !!R.strokeGeom,
    !!S.strokeGeom,
  );

  // Pied doit rencontrer la barre : extrémité du stem près de y≈0 + offset miter
  let stemOk = 0;
  for (let i = 0; i < sS.length; i++) {
    const pts = sS[i]!.points;
    const atNode = pts.reduce((best, p) =>
      Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1]) ? p : best,
    );
    // Doit être proche de l’axe (pas un simple bout sans joint trop loin)
    if (Math.hypot(atNode[0], atNode[1]) < 0.5) stemOk += 1;
    console.log(
      `  stem trait#${i} near-node: (${atNode[0].toFixed(3)}, ${atNode[1].toFixed(3)})`,
    );
  }
  console.log(
    stemOk === sS.length ? '  OK pied rejoint le nœud' : '  FAIL pied loin du nœud',
  );
  if (stemOk !== sS.length) failed += 1;

  // Continuité barre : traits left/right colinéaires au nœud (même couche)
  let barOk = 0;
  for (let i = 0; i < sL.length; i++) {
    const lPts = sL[i]!.points;
    const rPts = sR[i]!.points;
    const lNear = lPts.reduce((best, p) =>
      Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1]) ? p : best,
    );
    const rNear = rPts.reduce((best, p) =>
      Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1]) ? p : best,
    );
    const d = Math.hypot(lNear[0] - rNear[0], lNear[1] - rNear[1]);
    // Même point ou chevauchement sur la parallèle (T avec pied collé)
    const onR = Math.hypot(
      lNear[0] -
        (rPts[0]![0] +
          Math.max(
            0,
            Math.min(
              1,
              ((lNear[0] - rPts[0]![0]) * (rPts[1]![0] - rPts[0]![0]) +
                (lNear[1] - rPts[0]![1]) * (rPts[1]![1] - rPts[0]![1])) /
                (Math.hypot(rPts[1]![0] - rPts[0]![0], rPts[1]![1] - rPts[0]![1]) **
                  2 +
                  1e-18),
            ),
          ) *
            (rPts[1]![0] - rPts[0]![0])),
      lNear[1] -
        (rPts[0]![1] +
          Math.max(
            0,
            Math.min(
              1,
              ((lNear[0] - rPts[0]![0]) * (rPts[1]![0] - rPts[0]![0]) +
                (lNear[1] - rPts[0]![1]) * (rPts[1]![1] - rPts[0]![1])) /
                (Math.hypot(rPts[1]![0] - rPts[0]![0], rPts[1]![1] - rPts[0]![1]) **
                  2 +
                  1e-18),
            ),
          ) *
            (rPts[1]![1] - rPts[0]![1])),
    );
    if (d < 0.05 || onR < 0.05) barOk += 1;
    else console.log(`  barre off#${i} d=${d.toFixed(4)} onR=${onR.toFixed(4)}`);
  }
  console.log(
    barOk === sL.length ? '  OK barre continue' : `  FAIL barre ${barOk}/${sL.length}`,
  );
  if (barOk !== sL.length) failed += 1;
}

// ─── L snap : axes préservés (pas de barycentre qui fait tourner) ───────────
{
  console.log('TEST L snap axes — murs ne doivent PAS tourner');
  // Horizontal (0,0)→(5,0) + vertical décalé (5.1, 0.2)→(5.1, 4)
  // Intersection des axes = (5.1, 0) — pas le barycentre (5.05, 0.1)
  const wH = wall('axH', [0, 0, 0], [5, 0, 0]);
  const wV = wall('axV', [5.1, 0.2, 0], [5.1, 4, 0]);
  const box = { minX: 4.5, minY: -0.5, maxX: 5.5, maxY: 0.5 };
  const { entities: next, clusters } = snapAndRejoinWallsInBox(
    [wH, wV],
    box,
    0.5,
  );
  const h = next.find((e): e is WallEntity => e.id === 'axH')!;
  const v = next.find((e): e is WallEntity => e.id === 'axV')!;

  const dirH = [h.end[0] - h.start[0], h.end[1] - h.start[1]] as const;
  const dirV = [v.end[0] - v.start[0], v.end[1] - v.start[1]] as const;
  const lenH = Math.hypot(dirH[0], dirH[1]);
  const lenV = Math.hypot(dirV[0], dirV[1]);
  const uH = [dirH[0] / lenH, dirH[1] / lenH];
  const uV = [dirV[0] / lenV, dirV[1] / lenV];

  // Horizontal reste // à X (uy ≈ 0) ; vertical // à Y (ux ≈ 0)
  const hAxisOk = Math.abs(uH[1]!) < 1e-9 && Math.abs(uH[0]!) > 0.99;
  const vAxisOk = Math.abs(uV[0]!) < 1e-9 && Math.abs(uV[1]!) > 0.99;
  // Coin à l’intersection des axes (5.1, 0)
  const cornerH = Math.hypot(h.end[0] - 5.1, h.end[1] - 0) < 1e-6;
  const cornerV = Math.hypot(v.start[0] - 5.1, v.start[1] - 0) < 1e-6;
  // Far ends inchangés
  const farH = Math.hypot(h.start[0] - 0, h.start[1] - 0) < 1e-9;
  const farV = Math.hypot(v.end[0] - 5.1, v.end[1] - 4) < 1e-9;

  console.log(
    `  clusters=${clusters} Hdir=(${uH[0]!.toFixed(4)},${uH[1]!.toFixed(4)}) Vdir=(${uV[0]!.toFixed(4)},${uV[1]!.toFixed(4)})`,
  );
  console.log(
    `  H end=(${h.end[0].toFixed(3)},${h.end[1].toFixed(3)}) V start=(${v.start[0].toFixed(3)},${v.start[1].toFixed(3)})`,
  );

  if (!hAxisOk || !vAxisOk) {
    console.log('  FAIL axes tournés (barycentre ?)');
    failed += 1;
  } else if (!cornerH || !cornerV) {
    console.log('  FAIL coin ≠ intersection des axes (5.1, 0)');
    failed += 1;
  } else if (!farH || !farV) {
    console.log('  FAIL extrémités lointaines déplacées');
    failed += 1;
  } else {
    console.log('  OK axes préservés + coin = intersection');
  }

  // Traits miter au coin L
  const r = endsMeet(
    wallEntityStrokes(h) as any,
    wallEntityStrokes(v) as any,
    [5.1, 0, 0],
  );
  console.log(r.ok ? '  OK onglets L' : `  FAIL onglets L ${r.detail}`);
  if (!r.ok) failed += 1;
}

// ─── T snap bien formé : 3 axes concourants, pas de rotation ───────────────
{
  console.log('TEST T snap axes — 3 murs concourants ne doivent PAS tourner');
  const left = wall('tsL', [-3, 0, 0], [-0.2, 0, 0]);
  const right = wall('tsR', [0.2, 0, 0], [3, 0, 0]);
  const stem = wall('tsS', [0.05, 0.25, 0], [0.05, 3, 0]);
  const box = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const { entities: next, clusters } = snapAndRejoinWallsInBox(
    [left, right, stem],
    box,
    0.5,
  );
  const L = next.find((e): e is WallEntity => e.id === 'tsL')!;
  const R = next.find((e): e is WallEntity => e.id === 'tsR')!;
  const S = next.find((e): e is WallEntity => e.id === 'tsS')!;
  const axisOk =
    Math.abs(L.end[1] - L.start[1]) < 1e-9 &&
    Math.abs(R.end[1] - R.start[1]) < 1e-9 &&
    Math.abs(S.end[0] - S.start[0]) < 1e-9;
  const node = L.end;
  const meet =
    Math.hypot(R.start[0] - node[0], R.start[1] - node[1]) < 1e-6 &&
    Math.hypot(S.start[0] - node[0], S.start[1] - node[1]) < 1e-6;
  const farOk =
    Math.hypot(L.start[0] + 3, L.start[1]) < 1e-9 &&
    Math.hypot(R.end[0] - 3, R.end[1]) < 1e-9 &&
    Math.hypot(S.end[0] - 0.05, S.end[1] - 3) < 1e-9;
  console.log(
    `  clusters=${clusters} node=(${node[0].toFixed(3)},${node[1].toFixed(3)})`,
  );
  if (!axisOk) {
    console.log('  FAIL axes tournés');
    failed += 1;
  } else if (!meet) {
    console.log(
      `  FAIL bouts pas au même nœud L=${L.end} R=${R.start} S=${S.start}`,
    );
    failed += 1;
  } else if (!farOk) {
    console.log('  FAIL extrémités lointaines déplacées');
    failed += 1;
  } else {
    console.log('  OK T snap axes préservés + nœud unique');
  }
}

// ─── /jonction snap : extrémités proches fusionnées (T un peu décalé) ────────
{
  console.log('TEST snap — 3 murs presque joints (tol 0.5 m), axes préservés');
  const w1 = wall('s1', [0, 0, 0], [4.85, 0, 0]);
  const w2 = wall('s2', [5.1, 0.05, 0], [5.1, 4, 0]);
  const w3 = wall('s3', [5.05, -0.1, 0], [8, -0.1, 0]);
  const entities: Entity[] = [w1, w2, w3];
  const box = { minX: 4, minY: -1, maxX: 6, maxY: 1 };
  const { entities: next, wallsTouched, clusters } = snapAndRejoinWallsInBox(
    entities,
    box,
    0.5,
  );
  console.log(`  clusters=${clusters} wallsTouched=${wallsTouched}`);
  if (clusters !== 1 || wallsTouched !== 3) {
    console.log('  FAIL attendu 1 nœud, 3 murs');
    failed += 1;
  } else {
    console.log('  OK snap');
  }
  const walls = next.filter((e): e is WallEntity => e.kind === 'wall');
  const h = walls.find((w) => w.id === 's1')!;
  const v = walls.find((w) => w.id === 's2')!;
  const h2 = walls.find((w) => w.id === 's3')!;
  const axesOk =
    Math.abs(h.end[1] - h.start[1]) < 1e-9 &&
    Math.abs(v.end[0] - v.start[0]) < 1e-9 &&
    Math.abs(h2.end[1] - h2.start[1]) < 1e-9;
  if (!axesOk) {
    console.log('  FAIL axes tournés (barycentre ?)');
    failed += 1;
  } else {
    console.log('  OK axes préservés (pas de barycentre)');
  }

  // Après snap : pied (s2) doit rencontrer la barre (s1/s3) trait par trait
  const byId = new Map(walls.map((w) => [w.id, w]));
  const stem = byId.get('s2')!;
  const bars = [byId.get('s1')!, byId.get('s3')!];
  let stemMeet = 0;
  for (const g of stem.strokeGeom ?? []) {
    const node = stem.start;
    const nodeish =
      Math.hypot(g.start[0] - node[0], g.start[1] - node[1]) <
      Math.hypot(g.end[0] - node[0], g.end[1] - node[1])
        ? g.start
        : g.end;
    let minD = Infinity;
    for (const b of bars) {
      for (const bg of b.strokeGeom ?? []) {
        const ax = bg.start[0],
          ay = bg.start[1],
          bx = bg.end[0],
          by = bg.end[1];
        const px = nodeish[0],
          py = nodeish[1];
        const abx = bx - ax,
          aby = by - ay;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((px - ax) * abx + (py - ay) * aby) /
              (abx * abx + aby * aby + 1e-18),
          ),
        );
        const d = Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
        minD = Math.min(minD, d);
      }
    }
    if (minD < 0.06) stemMeet += 1;
    else console.log(`  stem off ${g.offset} distToBar=${minD.toFixed(4)}`);
  }
  const nTraits = stem.strokeGeom?.length ?? 0;
  console.log(
    stemMeet === nTraits && nTraits > 0
      ? '  OK pied rencontre barre (T après snap)'
      : `  FAIL pied/barre ${stemMeet}/${nTraits}`,
  );
  if (stemMeet !== nTraits || nTraits === 0) failed += 1;

  // s1 et s3 restent chacun sur leur axe (s3 à y=-0.1, pas ramené au barycentre)
  const barA = byId.get('s1')!;
  const barB = byId.get('s3')!;
  const s1Horiz = Math.abs(barA.end[1] - barA.start[1]) < 1e-9;
  const s3Horiz = Math.abs(barB.end[1] + 0.1) < 1e-9 && Math.abs(barB.start[1] + 0.1) < 1e-9;
  console.log(
    s1Horiz && s3Horiz
      ? '  OK barre s1/s3 sur leurs axes'
      : `  FAIL barre axes s1y=${barA.end[1]} s3y=${barB.start[1]}`,
  );
  if (!s1Horiz || !s3Horiz) failed += 1;

  // maxNodeDegree / signature pour mode Y/N
  const full = snapAndRejoinWallsInBox(entities, box, 0.5, 'first-hit');
  console.log(
    full.maxNodeDegree >= 3
      ? `  OK maxNodeDegree=${full.maxNodeDegree} sig=${full.signature}`
      : `  FAIL maxNodeDegree=${full.maxNodeDegree}`,
  );
  if (full.maxNodeDegree < 3) failed += 1;
}

// ─── 4 stratégies T : traits // et non vides ────────────────────────────────
{
  console.log('TEST stratégies T/Y — 4 modes produisent des strokeGeom valides');
  const left = wall('sl', [-3, 0, 0], [0, 0, 0]);
  const right = wall('sr', [0, 0, 0], [3, 0, 0]);
  const stem = wall('ss', [0, 0, 0], [0, 3, 0]);

  for (const strategy of JONCTION_STRATEGIES as readonly JonctionStrategyId[]) {
    const joined = recomputeLinearWallJoints([left, right, stem], 0.005, strategy);
    let ok = true;
    for (const w of joined) {
      const n = w.strokeGeom?.length ?? 0;
      if (n !== 3) {
        console.log(`  FAIL ${strategy} mur ${w.id} traits=${n}`);
        ok = false;
      }
      // chaque trait // à la base (Δy≈0 pour barre, Δx≈0 pour pied)
      for (const g of w.strokeGeom ?? []) {
        const dx = g.end[0] - g.start[0];
        const dy = g.end[1] - g.start[1];
        if (w.id === 'ss') {
          // pied vertical : dx ≈ 0
          if (Math.abs(dx) > 1e-6) {
            console.log(
              `  FAIL ${strategy} pied non-// dx=${dx.toFixed(6)}`,
            );
            ok = false;
          }
        } else {
          // barre horizontale : dy ≈ 0
          if (Math.abs(dy) > 1e-6) {
            console.log(
              `  FAIL ${strategy} barre non-// dy=${dy.toFixed(6)}`,
            );
            ok = false;
          }
        }
      }
    }
    console.log(ok ? `  OK ${strategy}` : `  FAIL ${strategy}`);
    if (!ok) failed += 1;
  }
}

// ─── Stratégie Y/N persistée sur le mur (recompute ne l’écrase pas) ──────────
{
  console.log('TEST joinStrategy persistée après recompute défaut');
  const left = wall('pl', [-3, 0, 0], [0, 0, 0]);
  const right = wall('pr', [0, 0, 0], [3, 0, 0]);
  const stem = wall('ps', [0, 0, 0], [0, 3, 0]);
  const mt = recomputeLinearWallJoints([left, right, stem], 0.005, 'max-t');
  const stamped = mt.filter((w) => w.joinStrategy === 'max-t').length;
  if (stamped < 3) {
    console.log(`  FAIL stamp max-t sur ${stamped}/3 murs`);
    failed += 1;
  } else {
    console.log('  OK stamp max-t');
  }
  const again = recomputeLinearWallJoints(mt); // défaut first-hit
  const kept = again.filter((w) => w.joinStrategy === 'max-t').length;
  if (kept < 3) {
    console.log(`  FAIL persist ${kept}/3`);
    failed += 1;
  } else {
    console.log('  OK persistée au recompute suivant');
  }
}

// ─── /jonction : bout distant dans le cadre → allonger comme /join ───────────
{
  console.log('TEST /jonction étend un pied distant (cadre 3 murs, gap 1 m)');
  const v = wall('jv', [0, 2, 0], [0, 0, 0]);
  const h = wall('jh', [0, 0, 0], [3, 0, 0]);
  const stem = wall('jd', [-1.2, 0.25, 0], [-2.5, 0.25, 0]);
  const box = { minX: -1.5, minY: -0.5, maxX: 0.5, maxY: 1.5 };
  const { entities: next, extended, clusters } = snapAndRejoinWallsInBox(
    [v, h, stem],
    box,
    0.65,
  );
  const d = next.find((e): e is WallEntity => e.id === 'jd')!;
  const bar = next.find((e): e is WallEntity => e.id === 'jv')!;
  const hitX = Math.abs(d.start[0]) < 1e-6 || Math.abs(d.end[0]) < 1e-6;
  const barKept =
    Math.hypot(bar.start[0], bar.start[1] - 2) < 1e-6 &&
    Math.hypot(bar.end[0], bar.end[1]) < 1e-6;
  if (extended < 1) {
    console.log(`  FAIL extended=${extended} clusters=${clusters}`);
    failed += 1;
  } else if (!hitX) {
    console.log(`  FAIL pied pas sur x=0 start=${d.start} end=${d.end}`);
    failed += 1;
  } else if (!barKept) {
    console.log('  FAIL barre verticale raccourcie', bar.start, bar.end);
    failed += 1;
  } else {
    console.log('  OK pied allongé en T, barre intacte');
  }
}

// ─── L + diagonal : 1ʳᵉ rencontre = horizontal, pas le vertical ─────────────
{
  console.log('TEST /jonction L+diag — 1ʳᵉ barre = horizontal, isolant→béton, placo→enduit');
  const profile: WallLineDef[] = [
    { offset: 0, color: '#a', lineWidth: 1, lineStyle: 'plein' },
    { offset: 0.02, color: '#b', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'enduit' },
    { offset: 0.18, color: '#c', lineWidth: 2, lineStyle: 'plein', priority: 1, layerTypeId: 'structure-beton' },
    { offset: 0.28, color: '#d', lineWidth: 1, lineStyle: 'plein', priority: 3, layerTypeId: 'isolant' },
    { offset: 0.293, color: '#e', lineWidth: 1, lineStyle: 'plein', priority: 5, layerTypeId: 'placo-13' },
  ];
  const mk = (
    id: string,
    start: [number, number, number],
    end: [number, number, number],
  ): WallEntity => ({
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 's',
    path: 'line',
    flip: false,
    lines: profile.map((l) => ({ ...l })),
    start,
    end,
  });
  const v = mk('jv', [-4.672, 1.027, 0], [-4.672, -1.497, 0]);
  const h = mk('jh', [-4.672, -1.497, 0], [-0.839, -1.497, 0]);
  const d = mk('jd', [-5.551, -1.854, 0], [-7.097, -2.825, 0]);
  const box = { minX: -6.2, minY: -2.4, maxX: -3.5, maxY: 0.2 };
  const { entities: next, extended } = snapAndRejoinWallsInBox([v, h, d], box, 0.65);
  const dd = next.find((e): e is WallEntity => e.id === 'jd')!;
  const near =
    dd.start[1]! > dd.end[1]! ? dd.start : dd.end;
  // 1ʳᵉ rencontre = axe horizontal y=-1.497, pas le vertical x=-4.672 (y=-1.30)
  const onHoriz = Math.abs(near[1]! + 1.497) < 0.05;
  const notVertOnly = Math.abs(near[1]! + 1.302) > 0.05;
  if (extended < 1) {
    console.log('  FAIL pas d’allongement');
    failed += 1;
  } else if (!onHoriz || !notVertOnly) {
    console.log(
      `  FAIL pied sur ${near.map((x) => x.toFixed(3))} (attendu y≈-1.50, pas -1.30)`,
    );
    failed += 1;
  } else {
    console.log('  OK pied sur l’horizontal (1ʳᵉ rencontre)');
  }

  const nearLayer = (off: number): [number, number] => {
    const g = (dd.strokeGeom ?? []).find((x) => Math.abs(x.offset - off) < 1e-9);
    if (!g) return [NaN, NaN];
    const a = g.start;
    const b = g.end;
    return a[1]! > b[1]! ? [a[0]!, a[1]!] : [b[0]!, b[1]!];
  };
  const face0 = nearLayer(0);
  const face02 = nearLayer(0.02);
  const iso = nearLayer(0.28);
  const pla = nearLayer(0.293);
  // Face 0 / enduit : 1ʳᵉ face réelle = vertical du L
  const face0OnVert = Math.abs(face0[0] + 4.672) < 0.06;
  if (!face0OnVert) {
    console.log(
      `  FAIL face0/enduit sur (${face0[0].toFixed(3)},${face0[1].toFixed(3)}) (attendu vertical x≈-4.67)`,
    );
    failed += 1;
  } else {
    console.log('  OK face0/enduit → vertical du L');
  }
  // Y dans un L : butée sur la face extérieure (x≈-4.672), pas le béton à -4.652.
  const face02OnVOuter = Math.abs(face02[0] + 4.672) < 0.03;
  if (!face02OnVOuter) {
    console.log(
      `  FAIL face 0.02 sur (${face02[0].toFixed(3)},${face02[1].toFixed(3)}) (attendu face ext. V x≈-4.672)`,
    );
    failed += 1;
  } else {
    console.log('  OK face 0.02 → face extérieure du vertical');
  }
  // Isolant (prio 3) s’arrête au béton de la barre (y=-1.317 ou -1.477)
  const isoOnBeton =
    Math.abs(iso[1] + 1.317) < 0.06 || Math.abs(iso[1] + 1.477) < 0.06;
  // Placo s’arrête à l’enduit (1ʳᵉ face y≈-1.497)
  const plaOnEnduit = Math.abs(pla[1] + 1.497) < 0.06;
  if (!isoOnBeton) {
    console.log(`  FAIL isolant y=${iso[1]?.toFixed(3)} (attendu béton ≈-1.32)`);
    failed += 1;
  } else {
    console.log('  OK isolant → béton (stop, pas d’onglet)');
  }
  if (!plaOnEnduit) {
    console.log(`  FAIL placo y=${pla[1]?.toFixed(3)} (attendu enduit ≈-1.50)`);
    failed += 1;
  } else {
    console.log('  OK placo → enduit (stop, pas d’onglet)');
  }
  const mid = nearLayer(0.18);
  const midOnH = Math.abs(mid[1] + 1.497) < 0.08 || Math.abs(mid[1] + 1.477) < 0.08;
  const midNotCorner = Math.abs(mid[0] + 4.652) > 0.04 || midOnH;
  if (!midOnH) {
    console.log(
      `  FAIL béton 0.18 sur (${mid[0].toFixed(3)},${mid[1].toFixed(3)}) (trou au coin)`,
    );
    failed += 1;
  } else {
    console.log('  OK béton 0.18 → horizontal (pas de trou)');
  }
}

console.log('\n' + (failed === 0 ? 'TOUS LES TESTS OK' : `${failed} ÉCHEC(S)`));
process.exit(failed === 0 ? 0 : 1);
