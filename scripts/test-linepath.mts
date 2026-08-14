/**
 * Tests parseLinePath — /ligne · /pline multi-args.
 * Run: npx tsx scripts/test-linepath.mts
 */
import { parseLinePath } from '../src/core/linePath.ts';

let failed = 0;

function check(name: string, args: string, expectPts: number[][]): void {
  const r = parseLinePath(args.trim().split(/\s+/).filter(Boolean));
  if (!r.ok) {
    console.log(`FAIL ${name}: ${r.error}`);
    failed += 1;
    return;
  }
  if (r.points.length !== expectPts.length) {
    console.log(
      `FAIL ${name}: ${r.points.length} pts, attendu ${expectPts.length}`,
      r.points,
    );
    failed += 1;
    return;
  }
  for (let i = 0; i < expectPts.length; i++) {
    const a = r.points[i]!;
    const b = expectPts[i]!;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(a[k]! - b[k]!) > 1e-9) {
        console.log(`FAIL ${name}: pt${i}=${a} attendu ${b}`);
        failed += 1;
        return;
      }
    }
  }
  console.log(`OK ${name}`);
}

// Exemple utilisateur
check(
  'user example',
  '0,0,0 dx 1 dy 7 dx 3.2 dy -6.9 0,38,0 dx 5 dy 1 4,89.6,0',
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 7, 0],
    [4.2, 7, 0],
    [4.2, 0.1, 0],
    [0, 38, 0],
    [5, 38, 0],
    [5, 39, 0],
    [4, 89.6, 0],
  ],
);

// Forme collée refusée (uniquement décollée)
{
  const r = parseLinePath('0,0,0 dx1.5'.split(/\s+/));
  if (r.ok) {
    console.log('FAIL glued should be rejected');
    failed += 1;
  } else {
    console.log('OK glued rejected');
  }
}

// Absolus mélangés
check('abs mix', '1,1 5,5,0 0,0,0', [
  [1, 1, 0],
  [5, 5, 0],
  [0, 0, 0],
]);

// dxy CSV
check('dxy', '0,0,0 dxy 3.7,5.9', [
  [0, 0, 0],
  [3.7, 5.9, 0],
]);

console.log(failed === 0 ? '\nTOUS LES TESTS OK' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
