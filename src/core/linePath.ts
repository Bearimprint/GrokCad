/**
 * Parseur de chemin pour /ligne · /pline :
 *
 * Points absolus (virgule = axes, **point** = décimale) :
 *   0,0,0   ·  1,1,1  ·  2,3.5,18.6
 *   (2 composantes → Z = 0)
 *
 * Deltas relatifs — **uniquement forme décollée** (espace obligatoire) :
 *   dx 1.5          → +1.5 sur X
 *   dy -6.9         → −6.9 sur Y
 *   dxy 3.7,5.9     → +3.7 X, +5.9 Y
 *   dxyz 1,2,3      ·  dxz 1,3  ·  dz 0.5
 *
 * Chaque jeton absolu ou relatif ajoute **un sommet**.
 * Ex. `0,0,0 dx 1 dy 7` → (0,0,0) → (1,0,0) → (1,7,0)
 *
 * Exemples :
 *   /line 0,0,0 dx 1.5
 *   /line 0,0,0 dx 1 dy 7 dx 3.2 dy -6.9 0,38,0
 *   /pline 1,1,1 5,5,5 dx 2
 *
 * Rétrocompat : nombres séparés par espaces (x y [z] x y [z] …).
 */

import type { Vec3 } from './types';

export type LinePathResult =
  | { ok: true; points: Vec3[] }
  | { ok: false; error: string };

export type SpecialPointResolver = (token: string) => Vec3 | null;

/** `dx` / `dxy` … puis valeur(s) dans le(s) token(s) suivant(s). */
const REL_TOKEN = /^d([xyz]+)$/i;
const ABS_CSV = /^-?\d/; // commence comme un nombre (évent. négatif)

/**
 * Parse la liste d’arguments de /ligne ou /pline (sans le nom de commande).
 * @param resolveSpecial  résout `.` `@` `souris` `snap` → point monde, ou null
 */
export function parseLinePath(
  args: string[],
  resolveSpecial?: SpecialPointResolver,
): LinePathResult {
  if (args.length === 0) {
    return { ok: false, error: 'Aucun argument.' };
  }

  const points: Vec3[] = [];
  let i = 0;

  while (i < args.length) {
    const raw = args[i]!;
    const t = raw.toLowerCase();

    // ── Spéciaux : . @ souris snap ───────────────────────────────────────
    if (
      t === '.' ||
      t === 'm' ||
      t === 'souris' ||
      t === 'mouse' ||
      t === '@' ||
      t === 'snap'
    ) {
      const p = resolveSpecial?.(raw) ?? null;
      if (!p) {
        return {
          ok: false,
          error:
            t === '@' || t === 'snap'
              ? 'Pas de snap récent (@). Faites un clic droit d’abord.'
              : 'Souris hors canevas (.).',
        };
      }
      points.push([...p] as Vec3);
      i += 1;
      continue;
    }

    // ── Relatif décollé : dx 1.5 · dy -2 · dxy 3.7,5.9 ───────────────────
    const rel = REL_TOKEN.exec(raw);
    if (rel) {
      if (points.length === 0) {
        return {
          ok: false,
          error: `« ${raw} » est relatif : indiquez d’abord un point de départ (ex. 0,0,0 ${raw} …).`,
        };
      }
      const axes = uniqueAxes(rel[1]!);
      if (axes.length === 0) {
        return { ok: false, error: `Axes invalides dans « ${raw} » (utilisez x, y, z).` };
      }

      const { values, consumed } = takeNumbers(args, i + 1, axes.length);
      if (!values) {
        return {
          ok: false,
          error: `Attendu ${axes.length} valeur(s) après ${raw} (ex. ${raw} ${exampleValues(axes.length)}).`,
        };
      }
      i += 1 + consumed;

      const last = points[points.length - 1]!;
      const next: Vec3 = [last[0], last[1], last[2]];
      for (let k = 0; k < axes.length; k++) {
        const v = values[k]!;
        if (axes[k] === 'x') next[0] += v;
        else if (axes[k] === 'y') next[1] += v;
        else next[2] += v;
      }
      points.push(next);
      continue;
    }

    // ── Absolu CSV : 1,1,1  ou  2,3.5 ────────────────────────────────────
    if (raw.includes(',')) {
      const nums = parseCsvNumbers(raw);
      if (!nums) {
        return { ok: false, error: `Coordonnées invalides : « ${raw} » (ex. 1.5,2,0).` };
      }
      if (nums.length < 2 || nums.length > 3) {
        return {
          ok: false,
          error: `« ${raw} » : 2 ou 3 valeurs attendues (x,y ou x,y,z).`,
        };
      }
      points.push([nums[0]!, nums[1]!, nums[2] ?? 0]);
      i += 1;
      continue;
    }

    // ── Absolu espace (rétrocompat) : x y [z] ───────────────────────────
    if (ABS_CSV.test(raw) || raw === '-' || Number.isFinite(Number(raw))) {
      const got = takeSpacePoint(args, i);
      if (!got) {
        return { ok: false, error: `Nombre ou point attendu près de « ${raw} ».` };
      }
      points.push(got.point);
      i += got.consumed;
      continue;
    }

    return {
      ok: false,
      error: `Jeton non reconnu : « ${raw} ». Ex. 0,0,0 · dx 1.5 · dy -2 · dxy 3,4 · @ · .`,
    };
  }

  if (points.length < 2) {
    return {
      ok: false,
      error: 'Au moins 2 points requis (départ et arrivée).',
    };
  }

  return { ok: true, points };
}

function uniqueAxes(raw: string): Array<'x' | 'y' | 'z'> {
  const axes: Array<'x' | 'y' | 'z'> = [];
  for (const ch of raw.toLowerCase()) {
    if ((ch === 'x' || ch === 'y' || ch === 'z') && !axes.includes(ch)) {
      axes.push(ch);
    }
  }
  return axes;
}

function exampleValues(n: number): string {
  if (n === 1) return '1.5';
  if (n === 2) return '3.7,5.9';
  return '1,2,3';
}

/** Parse "1.5,2,0" ou "3.7,5.9" — virgule = séparateur, point = décimale. */
function parseCsvNumbers(token: string): number[] | null {
  const parts = token.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    // Pas de remplacement virgule→point : la virgule a déjà été splitée
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums;
}

/**
 * Lit exactement `need` nombres à partir de args[start].
 * Accepte un token CSV (`3.7,5.9`) ou des tokens séparés (`3.7` `5.9`).
 */
function takeNumbers(
  args: string[],
  start: number,
  need: number,
): { values: number[] | null; consumed: number } {
  if (start >= args.length) return { values: null, consumed: 0 };

  const first = args[start]!;
  // Token relatif suivant ou spécial → pas de valeurs
  if (REL_TOKEN.test(first) || isSpecialToken(first)) {
    return { values: null, consumed: 0 };
  }

  if (first.includes(',')) {
    const nums = parseCsvNumbers(first);
    if (!nums || nums.length !== need) return { values: null, consumed: 0 };
    return { values: nums, consumed: 1 };
  }

  // Tokens numériques séparés par espaces
  const values: number[] = [];
  let j = start;
  while (j < args.length && values.length < need) {
    const t = args[j]!;
    if (t.includes(',') || REL_TOKEN.test(t) || isSpecialToken(t)) break;
    const n = Number(t);
    if (!Number.isFinite(n)) break;
    values.push(n);
    j += 1;
  }
  if (values.length !== need) return { values: null, consumed: 0 };
  return { values, consumed: j - start };
}

/** Point x y [z] en tokens espaces (legacy). */
function takeSpacePoint(
  args: string[],
  start: number,
): { point: Vec3; consumed: number } | null {
  const nums: number[] = [];
  let j = start;
  while (j < args.length && nums.length < 3) {
    const t = args[j]!;
    if (t.includes(',') || REL_TOKEN.test(t) || isSpecialToken(t)) break;
    const n = Number(t);
    if (!Number.isFinite(n)) break;
    nums.push(n);
    j += 1;
  }
  if (nums.length < 2) return null;

  // Heuristique legacy : si le reste des nombres est multiple de 3, prendre xyz
  // Sinon si on a 3 nombres et le total restant (depuis start) % 2 == 1… 
  // Plus simple et prévisible : 3 nombres d’affilée = xyz, sinon xy (z=0).
  // Exception : s’il ne reste que 2 utiles pour un couple final…
  // Pour /ligne x1 y1 z1 x2 y2 z2 : 6 tokens → on consomme 3 puis 3.
  // Pour /ligne x1 y1 x2 y2 : 4 tokens → 2 puis 2.
  const restCount = countLeadingNumbers(args, start);
  if (restCount >= 3 && restCount % 3 === 0) {
    return {
      point: [nums[0]!, nums[1]!, nums[2]!],
      consumed: 3,
    };
  }
  // Si on a lu 3 mais le total n’est pas multiple de 3 → xy seulement
  if (nums.length >= 2) {
    return {
      point: [nums[0]!, nums[1]!, 0],
      consumed: 2,
    };
  }
  return null;
}

function countLeadingNumbers(args: string[], start: number): number {
  let n = 0;
  for (let j = start; j < args.length; j++) {
    const t = args[j]!;
    if (t.includes(',') || REL_TOKEN.test(t) || isSpecialToken(t)) break;
    if (!Number.isFinite(Number(t))) break;
    n += 1;
  }
  return n;
}

function isSpecialToken(t: string): boolean {
  const x = t.toLowerCase();
  return (
    x === '.' ||
    x === 'm' ||
    x === 'souris' ||
    x === 'mouse' ||
    x === '@' ||
    x === 'snap'
  );
}
