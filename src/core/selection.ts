/**
 * Sélection d'entités + test d'intersection cadre (AABB plan XY).
 * Toute entité qui touche le rectangle (même partiellement) est retenue.
 */

import { sampleArc, sampleCircle } from './drawing';
import { objectInstanceStrokes } from './objectInstance';
import { polylineStrokes } from './polyline';
import type { Entity, Vec3, WallEntity } from './types';
import { wallEntityStrokes } from './walls';

export type Aabb2 = { minX: number; minY: number; maxX: number; maxY: number };

export function normalizeAabb(a: Vec3, b: Vec3): Aabb2 {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

export function pointInAabb(x: number, y: number, box: Aabb2): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/** Segment [a,b] intersecte le rectangle (y compris entièrement dedans). */
export function segmentHitsAabb(a: Vec3, b: Vec3, box: Aabb2): boolean {
  if (pointInAabb(a[0], a[1], box) || pointInAabb(b[0], b[1], box)) return true;

  // Liang-Barsky / clip test : si le segment croise un bord
  const edges: [Vec3, Vec3][] = [
    [
      [box.minX, box.minY, 0],
      [box.maxX, box.minY, 0],
    ],
    [
      [box.maxX, box.minY, 0],
      [box.maxX, box.maxY, 0],
    ],
    [
      [box.maxX, box.maxY, 0],
      [box.minX, box.maxY, 0],
    ],
    [
      [box.minX, box.maxY, 0],
      [box.minX, box.minY, 0],
    ],
  ];
  for (const [e0, e1] of edges) {
    if (segmentsIntersect2d(a, b, e0, e1)) return true;
  }

  // Rectangle entièrement à l'intérieur du « tube » ? déjà couvert si un coin du box
  // est dans le segment... non. Cas : box entièrement dans le segment impossible.
  // Cas : segment traverse le box sans que extrémités soient dedans — couvert par edges.
  return false;
}

function segmentsIntersect2d(a: Vec3, b: Vec3, c: Vec3, d: Vec3): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  // colinéaires touchants
  if (o1 === 0 && onSeg(a, c, b)) return true;
  if (o2 === 0 && onSeg(a, d, b)) return true;
  if (o3 === 0 && onSeg(c, a, d)) return true;
  if (o4 === 0 && onSeg(c, b, d)) return true;
  return false;
}

function orient(a: Vec3, b: Vec3, c: Vec3): number {
  const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSeg(a: Vec3, p: Vec3, b: Vec3): boolean {
  return (
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-12
  );
}

/** Polyline : un segment touche le cadre. */
export function polylineHitsAabb(pts: Vec3[], box: Aabb2): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentHitsAabb(pts[i]!, pts[i + 1]!, box)) return true;
  }
  // point isolé
  if (pts.length === 1) return pointInAabb(pts[0]![0], pts[0]![1], box);
  return false;
}

export function entityHitsAabb(e: Entity, box: Aabb2): boolean {
  if (e.kind === 'helper') {
    // Ligne d'aide infinie : touche si la droite croise le rectangle
    return infiniteLineHitsAabb(e.origin, e.direction, box);
  }
  if (e.kind === 'line') {
    return segmentHitsAabb(e.start, e.end, box);
  }
  if (e.kind === 'circle') {
    const pts = sampleCircle(e, 48);
    return polylineHitsAabb(pts, box);
  }
  if (e.kind === 'arc') {
    const pts = sampleArc(e, 48);
    return polylineHitsAabb(pts, box);
  }
  if (e.kind === 'wall') {
    const strokes = wallEntityStrokes(e as WallEntity, 32);
    for (const s of strokes) {
      if (polylineHitsAabb(s.points, box)) return true;
    }
    return false;
  }
  if (e.kind === 'object') {
    for (const s of objectInstanceStrokes(e)) {
      if (polylineHitsAabb(s.points, box)) return true;
    }
    return false;
  }
  if (e.kind === 'text') {
    const h = e.height;
    const w = Math.max(h * 0.55 * Math.max(e.content.length, 1), h);
    const p = e.position;
    const minX = p[0] - w * 0.5;
    const maxX = p[0] + w * 0.5;
    const minY = p[1] - h * 0.5;
    const maxY = p[1] + h * 0.5;
    // Chevauchement de boîtes
    return !(
      maxX < box.minX ||
      minX > box.maxX ||
      maxY < box.minY ||
      minY > box.maxY
    );
  }
  if (e.kind === 'dimension') {
    if (pointInAabb(e.lineAnchor[0], e.lineAnchor[1], box)) return true;
    for (const p of e.defPoints) {
      if (pointInAabb(p[0], p[1], box)) return true;
    }
    // Segments entre projections sur la ligne de côte
    if (e.defPoints.length >= 2) {
      const dir = e.direction;
      const anchor = e.lineAnchor;
      const proj = (p: typeof e.defPoints[0]) => {
        const t =
          (p[0] - anchor[0]) * dir[0] + (p[1] - anchor[1]) * dir[1];
        return [
          anchor[0] + t * dir[0],
          anchor[1] + t * dir[1],
          anchor[2],
        ] as Vec3;
      };
      for (let i = 0; i + 1 < e.defPoints.length; i++) {
        if (
          segmentHitsAabb(
            proj(e.defPoints[i]!),
            proj(e.defPoints[i + 1]!),
            box,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }
  if (e.kind === 'polyline') {
    for (const s of polylineStrokes(e, 32)) {
      if (polylineHitsAabb(s.points, box)) return true;
    }
    return false;
  }
  if (e.kind === 'point') {
    return pointInAabb(e.position[0], e.position[1], box);
  }
  return false;
}

function infiniteLineHitsAabb(origin: Vec3, direction: Vec3, box: Aabb2): boolean {
  // Teste le segment long qui traverse le box élargi
  const L = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * 10 + 1000;
  const d = direction;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const ux = d[0] / len;
  const uy = d[1] / len;
  const a: Vec3 = [origin[0] - ux * L, origin[1] - uy * L, origin[2]];
  const b: Vec3 = [origin[0] + ux * L, origin[1] + uy * L, origin[2]];
  return segmentHitsAabb(a, b, box);
}

export function entitiesInAabb(
  entities: readonly Entity[],
  box: Aabb2,
  opts?: { includeHelpers?: boolean },
): Entity[] {
  const includeHelpers = opts?.includeHelpers ?? false;
  return entities.filter((e) => {
    if (e.kind === 'helper' && !includeHelpers) return false;
    return entityHitsAabb(e, box);
  });
}

export type SelectionListener = (ids: ReadonlySet<string>) => void;

/** Gestionnaire de sélection (ids d'entités). */
export class SelectionManager {
  private ids = new Set<string>();
  private listeners = new Set<SelectionListener>();

  get size(): number {
    return this.ids.size;
  }

  get selectedIds(): ReadonlySet<string> {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  onChange(fn: SelectionListener): () => void {
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

  add(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (!this.ids.has(id)) {
        this.ids.add(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  remove(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (this.ids.delete(id)) changed = true;
    }
    if (changed) this.emit();
  }

  /** Sélection cadre : add ou remove (ALT). */
  applyRect(
    entities: readonly Entity[],
    box: Aabb2,
    mode: 'add' | 'remove',
  ): number {
    const hit = entitiesInAabb(entities, box);
    const hitIds = hit.map((e) => e.id);
    if (mode === 'add') {
      this.add(hitIds);
    } else {
      this.remove(hitIds);
    }
    return hitIds.length;
  }

  selectedEntities(entities: readonly Entity[]): Entity[] {
    return entities.filter((e) => this.ids.has(e.id));
  }
}
