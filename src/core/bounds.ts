/**
 * Emprise 3D du dessin (pour /center = zoom extents).
 * Les aides infinies (helper) sont exclues — elles n’ont pas de bornes.
 */

import { sampleArc, sampleCircle } from './drawing';
import { objectInstanceStrokes } from './objectInstance';
import { polylineStrokes } from './polyline';
import type { Entity, Vec3 } from './types';
import { wallEntityStrokes } from './walls';

export interface WorldAabb {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  /** true s’il y a au moins un point utile */
  empty: boolean;
}

/** Collecte des points représentatifs de l’emprise d’une entité. */
export function entityExtentPoints(e: Entity): Vec3[] {
  switch (e.kind) {
    case 'line':
      return [e.start, e.end];
    case 'arc':
      return sampleArc(e, 48);
    case 'circle':
      return sampleCircle(e, 48);
    case 'wall': {
      const pts: Vec3[] = [];
      for (const s of wallEntityStrokes(e, 32)) {
        pts.push(...s.points);
      }
      if (pts.length === 0) {
        pts.push(e.start, e.end);
      }
      return pts;
    }
    case 'object': {
      const pts: Vec3[] = [];
      for (const s of objectInstanceStrokes(e)) {
        pts.push(...s.points);
      }
      // Fallback : origine seule si cache library vide
      if (pts.length === 0) pts.push([...e.origin] as Vec3);
      return pts;
    }
    case 'text': {
      const h = e.height;
      const w = Math.max(h * 0.55 * Math.max(e.content.length, 1), h);
      const p = e.position;
      return [
        [p[0] - w * 0.5, p[1] - h * 0.5, p[2]],
        [p[0] + w * 0.5, p[1] + h * 0.5, p[2]],
      ];
    }
    case 'dimension': {
      const pts: Vec3[] = [[...e.lineAnchor] as Vec3];
      for (const p of e.defPoints) pts.push([...p] as Vec3);
      for (const p of e.labelPositions ?? []) pts.push([...p] as Vec3);
      return pts;
    }
    case 'polyline': {
      const pts: Vec3[] = [];
      for (const s of polylineStrokes(e, 32)) {
        pts.push(...s.points);
      }
      return pts;
    }
    case 'point':
      return [[...e.position] as Vec3];
    case 'helper':
      // Droite infinie : ne contribue pas à l’emprise
      return [];
    default:
      return [];
  }
}

/** Points d’emprise de tout le dessin (hors aides infinies). */
export function drawingExtentPoints(entities: readonly Entity[]): Vec3[] {
  const out: Vec3[] = [];
  for (const e of entities) {
    if (e.kind === 'helper' || e.isHelper) continue;
    out.push(...entityExtentPoints(e));
  }
  return out;
}

/** AABB monde des points. */
export function aabbFromPoints(points: readonly Vec3[]): WorldAabb {
  if (points.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      empty: true,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    empty: false,
  };
}

export function drawingAabb(entities: readonly Entity[]): WorldAabb {
  return aabbFromPoints(drawingExtentPoints(entities));
}
