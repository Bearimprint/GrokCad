/**
 * Tolérances physiques, exprimées en mètres SI.
 *
 * Les coordonnées du dessin sont dans l'unité du document (km, m, cm, mm,
 * ft, in). Un changement d'unité multiplie la géométrie (`scaleWorld`).
 * Toute longueur comparée à ces coordonnées passe par `metersToDoc`.
 * En mètres (défaut), le facteur vaut 1 : le comportement historique
 * est inchangé.
 *
 * Les seuils d'angle (`ANG`) sont sans dimension (produit scalaire de
 * directions unitaires).
 */

import { UNIT_TO_METERS, type UnitId } from './units';

export const TOL_M = {
  /** Coïncidence d'extrémités après snap. 5 mm. */
  wallJoin: 0.005,
  /** Snap `/jonction` des bouts. 65 cm. */
  wallRejoinSnap: 0.65,
  /** Plafond de la tolérance de nœud après snap. 8 cm. */
  wallRejoinNodeCap: 0.08,
  /** Recalage d'un bout de barre sur le hit (micro-trou). 4 cm. */
  combEndSnap: 0.04,
  /** Trait considéré sur la parallèle du hit. 3 mm. */
  onStroke: 0.003,
  /** Déplacement mini pour recaler un bout (évite un snap nul). 0,5 mm. */
  combMinMove: 0.0005,
  /** Rayon de recherche autour d'un coin de jonction. 1,5 m. */
  starNear: 1.5,
  /** Zone de bout mini d'un T (sinon confondu avec un L). 5 cm. */
  joinEndMin: 0.05,
  /** Zone de bout maxi d'un T. 10 cm. */
  joinEndMax: 0.1,
  /** Plancher de « sur le trait » pour un T mid-span. 1 cm. */
  onLineFloor: 0.01,
  /** Largeur mini du coussin « près du bout ». 30 cm. */
  midTNearWidth: 0.3,
  /** Rallonge de ce coussin. 50 cm. */
  midTNearExtra: 0.5,
  /** Largeur mini pour chercher l'autre bras d'un L. 50 cm. */
  extraBarMinWidth: 0.5,
  /** Marge ajoutée à cette recherche. 1 m. */
  extraBarPad: 1,
  /** Marge de bande d'ouverture (peigne). 1 mm. */
  openingBandPad: 0.001,
  /** Fermeture polyligne (dernier point ≈ premier). 1 mm. */
  polyClose: 0.001,
  /** Extrémités snap quasi confondues. 0,5 mm. */
  endpointMerge: 0.0005,
  /** Deux bouts déjà collés (L existant à ne pas recasser). 2 cm. */
  existingLGap: 0.02,
  /** Pied considéré sur le flanc (pas seulement à l'extrémité). 2 cm. */
  touchOnSegment: 0.02,
} as const;

export const ANG = {
  /**
   * leaveDir opposés : les deux murs forment la barre d'un T.
   * dot <= -0,95 ≈ angle ≥ 162°.
   */
  antiparallelDot: -0.95,
  /**
   * Paire la plus perpendiculaire d'un Y planté dans un L.
   * |dot| <= 0,4 ≈ écart à 90° d'au plus ~66°.
   */
  yInLPerpDot: 0.4,
} as const;

/** Longueur `meters` exprimée dans l'unité du document. */
export function metersToDoc(meters: number, unit: UnitId): number {
  const per = UNIT_TO_METERS[unit] ?? 1;
  return meters / per;
}
