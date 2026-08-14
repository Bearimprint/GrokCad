/**
 * Géométrie / explosion des instances d'objets library.
 */

import { sampleArc, sampleCircle } from './drawing';
import { cloneEntity, translateEntity } from './entityOps';
import { objectDefCache } from './objectCache';
import type {
  Entity,
  GkdDocument,
  LineStyleId,
  ObjectInstanceEntity,
  Vec3,
} from './types';
import { wallEntityStrokes } from './walls';

export interface ObjStroke {
  points: Vec3[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyleId;
}

let seq = 0;
export function nextObjectId(): string {
  seq += 1;
  return `obj_${seq}_${Date.now().toString(36)}`;
}

export function createObjectInstance(
  tab: string,
  name: string,
  origin: Vec3,
  rotation = 0,
): ObjectInstanceEntity {
  return {
    id: nextObjectId(),
    kind: 'object',
    layer: 'OBJETS',
    libTab: tab,
    libName: name,
    origin: [origin[0], origin[1], origin[2]],
    rotation,
  };
}

/** Applique origin (+ rotation Z future) à un point local. */
export function localToWorld(
  local: Vec3,
  origin: Vec3,
  rotation = 0,
): Vec3 {
  let x = local[0];
  let y = local[1];
  if (Math.abs(rotation) > 1e-12) {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    x = rx;
    y = ry;
  }
  return [origin[0] + x, origin[1] + y, origin[2] + local[2]];
}

/**
 * Entités de définition en coordonnées monde (pour explosion / bounds).
 * Ignore les helpers et les instances imbriquées (pas de récursion).
 */
export function expandObjectEntities(
  inst: ObjectInstanceEntity,
  def?: GkdDocument | null,
): Entity[] {
  const doc = def ?? objectDefCache.get(inst.libTab, inst.libName);
  if (!doc) return [];
  const out: Entity[] = [];
  for (const e of doc.entities) {
    if (e.kind === 'helper' || e.kind === 'object') continue;
    // clone + rotate/translate
    let c = cloneEntity(e);
    if (Math.abs(inst.rotation) > 1e-12) {
      c = rotateEntityZ(c, inst.rotation);
    }
    c = translateEntity(c, inst.origin[0], inst.origin[1], inst.origin[2]);
    out.push(c);
  }
  return out;
}

function rotateEntityZ(e: Entity, rot: number): Entity {
  const r = (p: Vec3): Vec3 => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  };
  if (e.kind === 'line') {
    return { ...e, start: r(e.start), end: r(e.end) };
  }
  if (e.kind === 'arc' || e.kind === 'circle') {
    return { ...e, center: r(e.center) };
  }
  if (e.kind === 'wall') {
    return {
      ...e,
      start: r(e.start),
      end: r(e.end),
      center: e.center ? r(e.center) : undefined,
      strokeGeom: e.strokeGeom?.map((g) => ({
        ...g,
        start: r(g.start),
        end: r(g.end),
      })),
    };
  }
  if (e.kind === 'text') {
    return {
      ...e,
      position: r(e.position),
      rotation: e.rotation + rot,
    };
  }
  return e;
}

/** Traits pour rendu / preview / snap. */
export function objectInstanceStrokes(
  inst: ObjectInstanceEntity,
  def?: GkdDocument | null,
): ObjStroke[] {
  const entities = expandObjectEntities(inst, def);
  const strokes: ObjStroke[] = [];
  for (const e of entities) {
    if (e.kind === 'line') {
      strokes.push({
        points: [e.start, e.end],
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'circle') {
      strokes.push({
        points: sampleCircle(e, 48),
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'arc') {
      strokes.push({
        points: sampleArc(e, 48),
        color: e.color,
        lineWidth: e.lineWidth,
        lineStyle: e.lineStyle,
      });
    } else if (e.kind === 'wall') {
      for (const s of wallEntityStrokes(e, 24)) {
        strokes.push({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
    }
  }
  return strokes;
}

/** Traits en preview (placement souris) depuis une def + origine temporaire. */
export function previewObjectStrokes(
  tab: string,
  name: string,
  origin: Vec3,
  rotation = 0,
): ObjStroke[] {
  const def = objectDefCache.get(tab, name);
  if (!def) return [];
  const fake: ObjectInstanceEntity = {
    id: 'preview',
    kind: 'object',
    layer: 'OBJETS',
    libTab: tab,
    libName: name,
    origin,
    rotation,
  };
  return objectInstanceStrokes(fake, def);
}
