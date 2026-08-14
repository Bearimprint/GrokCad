/**
 * Désignation d’entités (≠ sélection).
 * Utilisée par /paral, /copy (sans sélection), etc.
 * Ne modifie jamais le SelectionManager.
 */

import { closestOnDimension } from './dimension';
import { objectInstanceStrokes } from './objectInstance';
import { closestOnPolyline } from './polyline';
import { findNearestDesignatable } from './paral';
import type { Entity, Vec3 } from './types';

export type DesignationListener = (ids: ReadonlySet<string>) => void;

/** Gestionnaire de désignation (ids d’entités surlignés hors sélection). */
export class DesignationManager {
  private ids = new Set<string>();
  private listeners = new Set<DesignationListener>();

  get size(): number {
    return this.ids.size;
  }

  get designatedIds(): ReadonlySet<string> {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  onChange(fn: DesignationListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.ids);
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids.clear();
    this.emit();
  }

  set(ids: Iterable<string>): void {
    this.ids = new Set(ids);
    this.emit();
  }

  designatedEntities(entities: readonly Entity[]): Entity[] {
    return entities.filter((e) => this.ids.has(e.id));
  }
}

export interface NearestEntityHit {
  entity: Entity;
  point: Vec3;
  dist: number;
}

/**
 * Entité la plus proche du clic pour désignation générique (/copy…).
 * Inclut objets library (en plus de line/arc/circle/wall/helper de /paral).
 */
export function findNearestEntity(
  click: Vec3,
  entities: readonly Entity[],
  maxDist: number,
): NearestEntityHit | null {
  const dHit = findNearestDesignatable(click, entities, maxDist);
  let best: NearestEntityHit | null = dHit
    ? { entity: dHit.entity, point: dHit.point, dist: dHit.dist }
    : null;

  for (const e of entities) {
    if (e.kind === 'object') {
      const near = closestOnObject(e, click);
      if (near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'polyline') {
      const near = closestOnPolyline(e, click);
      if (!near || near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = { entity: e, point: near.point, dist: near.dist };
      }
    } else if (e.kind === 'point') {
      const d = Math.hypot(
        e.position[0] - click[0],
        e.position[1] - click[1],
        e.position[2] - click[2],
      );
      if (d > maxDist) continue;
      if (!best || d < best.dist) {
        best = {
          entity: e,
          point: [...e.position] as Vec3,
          dist: d,
        };
      }
    } else if (e.kind === 'text') {
      // Zone de clic ≈ boîte autour de la baseline (hauteur × largeur approx.)
      const h = Math.max(e.height, 1e-6);
      const w = Math.max(h * 0.55 * Math.max(e.content.length, 1), h);
      const dx = click[0] - e.position[0];
      const dy = click[1] - e.position[1];
      // Distance à la boîte AABB locale (approx. sans rotation pour le hit)
      const ax = Math.max(Math.abs(dx) - w * 0.5, 0);
      const ay = Math.max(Math.abs(dy) - h * 0.75, 0);
      const d = Math.hypot(ax, ay);
      if (d > maxDist) continue;
      if (!best || d < best.dist) {
        best = {
          entity: e,
          point: [...e.position] as Vec3,
          dist: d,
        };
      }
    } else if (e.kind === 'dimension') {
      // Corps uniquement (lignes). Le libellé est une TextEntity séparée.
      const near = closestOnDimension(e, click);
      if (near.dist > maxDist) continue;
      if (!best || near.dist < best.dist) {
        best = {
          entity: e,
          point: near.point,
          dist: near.dist,
        };
      }
    }
  }
  return best;
}

function closestOnObject(
  e: Extract<Entity, { kind: 'object' }>,
  click: Vec3,
): { point: Vec3; dist: number } {
  let bestD = Infinity;
  let bestP: Vec3 = [...e.origin] as Vec3;
  for (const s of objectInstanceStrokes(e)) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = s.points[i]!;
      const b = s.points[i + 1]!;
      const near = closestOnSegment(a, b, click);
      if (near.dist < bestD) {
        bestD = near.dist;
        bestP = near.point;
      }
    }
  }
  // Fallback : origine si pas de traits
  if (!Number.isFinite(bestD) || bestD === Infinity) {
    const dx = click[0] - e.origin[0];
    const dy = click[1] - e.origin[1];
    const dz = click[2] - e.origin[2];
    return {
      point: [...e.origin] as Vec3,
      dist: Math.hypot(dx, dy, dz),
    };
  }
  return { point: bestP, dist: bestD };
}

function closestOnSegment(
  a: Vec3,
  b: Vec3,
  click: Vec3,
): { point: Vec3; dist: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = click[0] - a[0];
  const apy = click[1] - a[1];
  const apz = click[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 < 1e-18 ? 0 : (apx * abx + apy * aby + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  const point: Vec3 = [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t];
  const dx = click[0] - point[0];
  const dy = click[1] - point[1];
  const dz = click[2] - point[2];
  return { point, dist: Math.hypot(dx, dy, dz) };
}
