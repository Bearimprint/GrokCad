/**
 * Géométrie / explosion des instances d'objets library.
 */

import { sampleArc, sampleCircle } from './drawing';
import { isInsertionsTab } from './drawLayers';
import { cloneEntity, translateEntity } from './entityOps';
import { hostById } from './insertHost';
import { frameFromPlacement } from './insertOpening';
import { placeInsertEntities, type InsertFrame } from './insertTransform';
import { objectDefCache } from './objectCache';
import type {
  Entity,
  GkdDocument,
  LineStyleId,
  ObjectInstanceEntity,
  Vec3,
} from './types';
import { polylineStrokes } from './polyline';
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
  opts?: { insert?: ObjectInstanceEntity['insert'] },
): ObjectInstanceEntity {
  const inst: ObjectInstanceEntity = {
    id: nextObjectId(),
    kind: 'object',
    layer: 'OBJETS',
    libTab: tab,
    libName: name,
    origin: [origin[0], origin[1], origin[2]],
    rotation,
  };
  if (opts?.insert) inst.insert = { ...opts.insert };
  return inst;
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
  hosts?: readonly Entity[],
): Entity[] {
  const doc = def ?? objectDefCache.get(inst.libTab, inst.libName);
  if (!doc) return [];

  if (inst.insert && isInsertionsTab(inst.libTab)) {
    const placed = expandInsertInstance(inst, doc, hosts);
    if (placed) return placed;
  }

  const out: Entity[] = [];
  for (const e of doc.entities) {
    if (e.kind === 'helper' || e.kind === 'object') continue;
    let c = cloneEntity(e);
    if (Math.abs(inst.rotation) > 1e-12) {
      c = rotateEntityZ(c, inst.rotation);
    }
    c = translateEntity(c, inst.origin[0], inst.origin[1], inst.origin[2]);
    out.push(c);
  }
  return out;
}

function expandInsertInstance(
  inst: ObjectInstanceEntity,
  def: GkdDocument,
  hosts?: readonly Entity[],
): Entity[] | null {
  const ins = inst.insert!;
  const host = hosts ? hostById(hosts, ins.hostId) : null;
  if (host) {
    const frame = frameFromPlacement(host, ins, def.entities);
    if (frame) return placeInsertEntities(def.entities, frame);
  }
  let axisX: Vec3 = [
    Math.cos(inst.rotation),
    Math.sin(inst.rotation),
    0,
  ];
  let axisY: Vec3 = [-axisX[1], axisX[0], 0];
  if (ins.flipCtrl) axisX = [-axisX[0], -axisX[1], 0];
  if (ins.xSign === -1) axisX = [-axisX[0], -axisX[1], 0];
  if (ins.flipAlt) axisY = [-axisY[0], -axisY[1], 0];
  return placeInsertEntities(def.entities, {
    origin: inst.origin,
    axisX,
    axisY,
    scaleX: ins.scaleX,
    scaleY: ins.scaleY,
    scaleZ: ins.scaleZ,
  });
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
  if (e.kind === 'polyline') {
    return {
      ...e,
      segments: e.segments.map((s) => {
        if (s.type === 'line') {
          return { ...s, start: r(s.start), end: r(s.end) };
        }
        return {
          ...s,
          center: r(s.center),
          startAngle: s.startAngle + rot,
          endAngle: s.endAngle + rot,
        };
      }),
    };
  }
  if (e.kind === 'point') {
    return { ...e, position: r(e.position) };
  }
  return e;
}

/** Traits pour rendu / preview / snap. */
export function objectInstanceStrokes(
  inst: ObjectInstanceEntity,
  def?: GkdDocument | null,
  hosts?: readonly Entity[],
): ObjStroke[] {
  const entities = expandObjectEntities(inst, def, hosts);
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
    } else if (e.kind === 'polyline') {
      for (const s of polylineStrokes(e)) {
        strokes.push({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
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

/** Aperçu d’une insertion (définition déjà en cache). */
export function previewInsertStrokes(
  tab: string,
  name: string,
  frame: InsertFrame,
): ObjStroke[] {
  const def = objectDefCache.get(tab, name);
  if (!def) return [];
  const entities = placeInsertEntities(def.entities, frame);
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
    } else if (e.kind === 'polyline') {
      for (const s of polylineStrokes(e)) {
        strokes.push({
          points: s.points,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        });
      }
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
