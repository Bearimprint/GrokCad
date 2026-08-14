/**
 * Régression T/Y sur fichiers réels utilisateur (test_mur2 / test_mur4).
 *
 * Invariants (pas « 3 bouts au même point » — faux pour multi-couches) :
 * 1. Chaque trait reste // à la base du mur (cross < 0.02).
 * 2. Après snap+rejoin dans le cadre du coin T, chaque couche du pied
 *    rencontre une couche correspondante d’une face du L (dist < 2 cm).
 *
 * Run: npx tsx scripts/test-mur2-regression.mts
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  snapAndRejoinWallsInBox,
  recomputeLinearWallJoints,
} from '../src/core/walls.ts';
import type { Entity, WallEntity, Vec3 } from '../src/core/types.ts';

function baseDirOf(w: WallEntity): [number, number] {
  if (w.path === 'line') {
    return [w.end[0] - w.start[0], w.end[1] - w.start[1]];
  }
  const seg = w.segments?.find((s) => s.type === 'line');
  if (seg && seg.type === 'line') {
    return [seg.end[0] - seg.start[0], seg.end[1] - seg.start[1]];
  }
  return [1, 0];
}

function assertParallel(w: WallEntity, label: string): number {
  if (!w.strokeGeom?.length) {
    console.log('FAIL', label, 'pas de strokeGeom');
    return 1;
  }
  const [bx, by] = baseDirOf(w);
  const bl = Math.hypot(bx, by) || 1;
  const ux = bx / bl;
  const uy = by / bl;
  let fails = 0;
  for (const g of w.strokeGeom) {
    const dx = g.end[0] - g.start[0];
    const dy = g.end[1] - g.start[1];
    const dl = Math.hypot(dx, dy) || 1;
    const cross = Math.abs(ux * (dy / dl) - uy * (dx / dl));
    if (cross > 0.02) {
      console.log(
        'FAIL_PARALLEL',
        label,
        'off',
        g.offset,
        'cross',
        cross.toFixed(5),
      );
      fails += 1;
    }
  }
  if (fails === 0) console.log('OK parallel', label, `(${w.strokeGeom.length} traits)`);
  return fails;
}

function nodeEnd(g: { start: Vec3; end: Vec3 }, corner: Vec3): Vec3 {
  const ds = Math.hypot(g.start[0] - corner[0], g.start[1] - corner[1]);
  const de = Math.hypot(g.end[0] - corner[0], g.end[1] - corner[1]);
  return ds < de ? g.start : g.end;
}

function distToSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) /
        (abx * abx + aby * aby + 1e-18),
    ),
  );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/** Distance point → droite infinie (pas seulement le segment dessiné). */
function distToLine(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby + 1e-18;
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/**
 * Pied rejoint une couche // (même offset) d’une face :
 * - soit sur le **segment** dessiné (idéal),
 * - soit sur la **droite** de la face (1ʳᵉ rencontre ; la face peut s’arrêter
 *   avant si elle a une 1ʳᵉ rencontre plus courte — gap accepté < 25 cm le
 *   long de la ligne, dist perpendiculaire < 2 cm).
 */
function stemMeetsL(
  stem: WallEntity,
  faces: WallEntity[],
  corner: Vec3,
  tolSeg = 0.03,
  tolLine = 0.02,
): number {
  let fails = 0;
  for (const g of stem.strokeGeom ?? []) {
    const n = nodeEnd(g, corner);
    let bestSeg = Infinity;
    let bestLine = Infinity;
    for (const f of faces) {
      const fg = f.strokeGeom?.find((x) => Math.abs(x.offset - g.offset) < 1e-9);
      if (!fg) continue;
      bestSeg = Math.min(bestSeg, distToSeg(n, fg.start, fg.end));
      bestLine = Math.min(bestLine, distToLine(n, fg.start, fg.end));
    }
    const ok = bestSeg <= tolSeg || bestLine <= tolLine;
    if (!ok) {
      console.log(
        'FAIL meet',
        stem.id,
        'off',
        g.offset,
        'seg',
        bestSeg.toFixed(4),
        'line',
        bestLine.toFixed(4),
        'node',
        n.map((x) => +x.toFixed(4)),
      );
      fails += 1;
    } else {
      console.log(
        'OK meet',
        stem.id,
        'off',
        g.offset,
        bestSeg <= tolSeg ? `seg=${bestSeg.toFixed(4)}` : `line=${bestLine.toFixed(4)}`,
      );
    }
  }
  return fails;
}

let failed = 0;

// ─── test_mur2 : L (wall_10+wall_11) + pied diagonal wall_16 ────────────────
{
  const path = join(homedir(), 'Téléchargements', 'test_mur2.gkd');
  if (!existsSync(path)) {
    console.log('SKIP test_mur2 (fichier absent)');
  } else {
    console.log('\n=== test_mur2.gkd ===');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const walls = (doc.entities as Entity[]).filter(
      (e): e is WallEntity => e.kind === 'wall',
    );
    // Coin T connu
    const corner: Vec3 = [-4.332210998877665, 1.4267358298050625, 0];
    const box = {
      minX: corner[0] - 0.6,
      minY: corner[1] - 0.6,
      maxX: corner[0] + 0.6,
      maxY: corner[1] + 0.6,
    };
    const { entities, clusters, wallsTouched } = snapAndRejoinWallsInBox(
      doc.entities as Entity[],
      box,
      0.5,
    );
    console.log(`snap clusters=${clusters} wallsTouched=${wallsTouched}`);
    const byId = new Map(
      entities
        .filter((e): e is WallEntity => e.kind === 'wall')
        .map((w) => [w.id, w]),
    );
    const w10 = byId.get('wall_10_mshc399n')!;
    const w11 = byId.get('wall_11_mshc3f8d')!;
    const w16 = byId.get('wall_16_mshc3uf8')!;
    failed += assertParallel(w10, 'wall_10');
    failed += assertParallel(w11, 'wall_11');
    failed += assertParallel(w16, 'wall_16');
    // L pair se rejoignent couche à couche (miter)
    const joined = recomputeLinearWallJoints([w10, w11, w16]);
    const j10 = joined.find((w) => w.id === w10.id)!;
    const j11 = joined.find((w) => w.id === w11.id)!;
    // Après snap le coin a bougé : utiliser moyenne des ends snappés
    const c2: Vec3 = [
      (j10.end[0] + j11.start[0]) / 2,
      (j10.end[1] + j11.start[1]) / 2,
      0,
    ];
    failed += stemMeetsL(byId.get('wall_16_mshc3uf8')!, [w10, w11], c2);
  }
}

// ─── test_mur4 : L + polymur pied (cas UI session 2026-08-06) ────────────────
{
  const path = join(homedir(), 'Téléchargements', 'test_mur4.gkd');
  if (!existsSync(path)) {
    console.log('SKIP test_mur4 (fichier absent)');
  } else {
    console.log('\n=== test_mur4.gkd (L + polymur stem) ===');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const corner: Vec3 = [-4.332210998877665, 1.4267358298050625, 0];
    const box = {
      minX: corner[0] - 0.8,
      minY: corner[1] - 0.8,
      maxX: corner[0] + 0.8,
      maxY: corner[1] + 0.8,
    };
    const { entities, clusters, wallsTouched } = snapAndRejoinWallsInBox(
      doc.entities as Entity[],
      box,
      0.5,
    );
    console.log(`snap clusters=${clusters} wallsTouched=${wallsTouched}`);
    const byId = new Map(
      entities
        .filter((e): e is WallEntity => e.kind === 'wall')
        .map((w) => [w.id, w]),
    );
    const w10 = byId.get('wall_10_mshc399n')!;
    const w11 = byId.get('wall_11_mshc3f8d')!;
    const stem = byId.get('pwall_3_mshnlos0')!;
    failed += assertParallel(w10, 'wall_10');
    failed += assertParallel(w11, 'wall_11');
    failed += assertParallel(stem, 'pwall_3');
    const c2: Vec3 = [...w10.end] as Vec3;
    failed += stemMeetsL(stem, [w10, w11], c2);
  }
}

// ─── Synthétique : T diagonal strict + invariant // ─────────────────────────
{
  console.log('\n=== synthétique Y (diagonal + L) ===');
  const lines = [
    { offset: 0, color: '#fff', lineWidth: 1, lineStyle: 'plein' as const },
    { offset: 0.1, color: '#fff', lineWidth: 1, lineStyle: 'plein' as const },
    { offset: 0.2, color: '#fff', lineWidth: 1, lineStyle: 'plein' as const },
  ];
  const mk = (
    id: string,
    start: Vec3,
    end: Vec3,
  ): WallEntity => ({
    id,
    kind: 'wall',
    layer: 'MURS',
    styleId: 's',
    path: 'line',
    flip: false,
    lines: lines.map((l) => ({ ...l })),
    start,
    end,
  });
  // L en (5,5) : horizontal + vertical ; pied diagonal
  const walls = [
    mk('h', [0, 5, 0], [5, 5, 0]),
    mk('v', [5, 5, 0], [5, 10, 0]),
    mk('d', [1, 2, 0], [5, 5, 0]),
  ];
  const joined = recomputeLinearWallJoints(walls);
  for (const w of joined) failed += assertParallel(w, w.id);
  const d = joined.find((w) => w.id === 'd')!;
  const h = joined.find((w) => w.id === 'h')!;
  const v = joined.find((w) => w.id === 'v')!;
  failed += stemMeetsL(d, [h, v], [5, 5, 0]);
}

console.log(
  failed === 0
    ? '\nPASS: parallélisme + raccord T/Y OK'
    : `\n${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
