/**
 * SVG debug of T-join geometry (wall8 + wall9 + L corners)
 */
import { readFileSync, writeFileSync } from 'fs';
import { recomputeLinearWallJoints } from '../src/core/walls.ts';
import type { WallEntity } from '../src/core/types.ts';

const gkd = JSON.parse(
  readFileSync('/home/red/Téléchargements/test_New_wall.gkd', 'utf8'),
);
const walls = (gkd.entities as WallEntity[]).filter((e) => e.kind === 'wall');
const joined = recomputeLinearWallJoints(walls);

const focus = joined.filter((w) =>
  [
    'wall_8_msiz58fa',
    'wall_9_msiz6sll',
    'wall_3_msiz4b0i',
    'wall_7_msiz56yy',
  ].includes(w.id),
);

let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
for (const w of focus) {
  for (const g of w.strokeGeom ?? []) {
    for (const p of [g.start, g.end]) {
      minX = Math.min(minX, p[0]!);
      maxX = Math.max(maxX, p[0]!);
      minY = Math.min(minY, p[1]!);
      maxY = Math.max(maxY, p[1]!);
    }
  }
}
const pad = 0.05;
minX -= pad;
maxX += pad;
minY -= pad;
maxY += pad;
const W = 900,
  H = 700;
const sx = (x: number) => ((x - minX) / (maxX - minX)) * W;
const sy = (y: number) => H - ((y - minY) / (maxY - minY)) * H;

const colors: Record<string, string> = {
  '0': '#ff4444',
  '0.02': '#44ff44',
  '0.18': '#44aaff',
  '0.28': '#ffaa00',
  '0.293': '#ff44ff',
};

let svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#1a1a1a">`;
svg += `<text x="10" y="20" fill="#fff" font-size="13">red=face0 enduit | green=béton0.02 | blue=béton0.18 | orange=isolant | magenta=placo</text>`;

for (const w of focus) {
  for (const g of w.strokeGeom ?? []) {
    const off = Math.round(g.offset * 1000) / 1000;
    const col = colors[String(off)] ?? '#ffffff';
    const sw = off === 0.02 || off === 0.18 ? 2.5 : 1.5;
    svg += `<line x1="${sx(g.start[0]!)}" y1="${sy(g.start[1]!)}" x2="${sx(g.end[0]!)}" y2="${sy(g.end[1]!)}" stroke="${col}" stroke-width="${sw}"/>`;
    svg += `<circle cx="${sx(g.start[0]!)}" cy="${sy(g.start[1]!)}" r="2.5" fill="${col}"/>`;
    svg += `<circle cx="${sx(g.end[0]!)}" cy="${sy(g.end[1]!)}" r="2.5" fill="${col}"/>`;
  }
}
for (const w of focus) {
  svg += `<line x1="${sx(w.start[0]!)}" y1="${sy(w.start[1]!)}" x2="${sx(w.end[0]!)}" y2="${sy(w.end[1]!)}" stroke="#555" stroke-width="0.5" stroke-dasharray="4"/>`;
}
svg += '</svg>';
writeFileSync('/tmp/join_debug.svg', svg);
console.log('wrote /tmp/join_debug.svg');

const bar = joined.find((w) => w.id === 'wall_8_msiz58fa')!;
const stem = joined.find((w) => w.id === 'wall_9_msiz6sll')!;
console.log('\n--- Gap analysis wall_8 (bar) ---');
for (const off of [0, 0.02, 0.18, 0.28, 0.293]) {
  const segs = (bar.strokeGeom ?? []).filter(
    (g) => Math.abs(g.offset - off) < 1e-6,
  );
  const intervals = segs
    .map((g) => {
      const y0 = Math.min(g.start[1]!, g.end[1]!);
      const y1 = Math.max(g.start[1]!, g.end[1]!);
      return [y0, y1] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  console.log(
    `off ${off}:`,
    intervals.map((i) => `[${i[0].toFixed(4)},${i[1].toFixed(4)}]`).join(' '),
  );
  for (let i = 0; i + 1 < intervals.length; i++) {
    const gap = intervals[i + 1]![0] - intervals[i]![1];
    if (gap > 1e-4)
      console.log(
        `  ** GAP ${gap.toFixed(4)} m  (${intervals[i]![1].toFixed(4)} → ${intervals[i + 1]![0].toFixed(4)})`,
      );
    else console.log(`  meet ok (Δ=${gap.toExponential(2)})`);
  }
}
console.log('\n--- Stem ends (wall_9) near bar ---');
for (const g of stem.strokeGeom ?? []) {
  const end = g.end[0]! > g.start[0]! ? g.end : g.start;
  console.log(
    `off ${g.offset.toFixed(3)} → (${end[0]!.toFixed(4)}, ${end[1]!.toFixed(4)})`,
  );
}
