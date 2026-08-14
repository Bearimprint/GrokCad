/**
 * Unités d'affichage / stockage monde.
 * La grille est toujours exprimée en mètres réels (défaut 1 m entre carrés).
 */

export type UnitId = 'km' | 'm' | 'cm' | 'mm';

export const UNIT_IDS: readonly UnitId[] = ['km', 'm', 'cm', 'mm'] as const;

export const UNIT_LABELS: Record<UnitId, string> = {
  km: 'Kilomètre',
  m: 'Mètre',
  cm: 'Centimètre',
  mm: 'Millimètre',
};

/** Facteur : 1 unité monde → mètres SI. */
export const UNIT_TO_METERS: Record<UnitId, number> = {
  km: 1000,
  m: 1,
  cm: 0.01,
  mm: 0.001,
};

export const DEFAULT_UNIT: UnitId = 'm';
/** Écart de grille par défaut : 1 mètre (réel), quel que soit l'unité choisie. */
export const DEFAULT_GRID_SPACING_METERS = 1;

export function isUnitId(v: unknown): v is UnitId {
  return v === 'km' || v === 'm' || v === 'cm' || v === 'mm';
}

/** Multiplicateur pour convertir une longueur de `from` vers `to`. */
export function convertFactor(from: UnitId, to: UnitId): number {
  return UNIT_TO_METERS[from] / UNIT_TO_METERS[to];
}

/** Écart de grille en unités monde (toujours basé sur des mètres réels). */
export function gridSpacingInWorld(
  gridSpacingMeters: number,
  unit: UnitId,
): number {
  const m = Number.isFinite(gridSpacingMeters) && gridSpacingMeters > 0
    ? gridSpacingMeters
    : DEFAULT_GRID_SPACING_METERS;
  return m / UNIT_TO_METERS[unit];
}

export function unitShortLabel(unit: UnitId): string {
  return unit;
}

export function formatLength(value: number, unit: UnitId, digits = 3): string {
  const v = Math.abs(value) < 1e-12 ? 0 : value;
  return `${v.toFixed(digits)} ${unit}`;
}
