/**
 * Opérations sur entités : translation, clonage, extraction (origine).
 */

import type {
  ArcEntity,
  CircleEntity,
  DimensionEntity,
  Entity,
  HelperLineEntity,
  LineEntity,
  ObjectInstanceEntity,
  PointEntity,
  TextEntity,
  Vec3,
  WallEntity,
  WallStrokeGeom,
} from './types';
import {
  applyWallJointsToEntities,
  cloneWallSegments,
  translateWallSegments,
  wallEntityStrokes,
} from './walls';
import { objectInstanceStrokes } from './objectInstance';
import {
  clonePolyline,
  polylineStrokes,
  translatePolyline,
} from './polyline';

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export function translateVec(p: Vec3, dx: number, dy: number, dz = 0): Vec3 {
  return [p[0] + dx, p[1] + dy, p[2] + dz];
}

/** Rotation d’un point autour de `pivot` dans le plan XY (angle radians). */
export function rotateVecZ(p: Vec3, pivot: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p[0] - pivot[0];
  const y = p[1] - pivot[1];
  return [pivot[0] + x * c - y * s, pivot[1] + x * s + y * c, p[2]];
}

/**
 * Rotation d’une entité autour d’un pivot (axe Z).
 * Polyligne (hachures incluses via géométrie) · mur · objet library · cotation complète.
 */
export function rotateEntityAround(
  e: Entity,
  pivot: Vec3,
  angle: number,
): Entity {
  if (Math.abs(angle) < 1e-15) return e;
  const r = (p: Vec3) => rotateVecZ(p, pivot, angle);

  if (e.kind === 'line') {
    return { ...e, start: r(e.start), end: r(e.end) };
  }
  if (e.kind === 'arc') {
    return {
      ...e,
      center: r(e.center),
      startAngle: e.startAngle + angle,
      endAngle: e.endAngle + angle,
    };
  }
  if (e.kind === 'circle') {
    return { ...e, center: r(e.center) };
  }
  if (e.kind === 'helper') {
    const od = r([
      e.origin[0] + e.direction[0],
      e.origin[1] + e.direction[1],
      e.origin[2],
    ]);
    const o = r(e.origin);
    const dx = od[0] - o[0];
    const dy = od[1] - o[1];
    const L = Math.hypot(dx, dy) || 1;
    return {
      ...e,
      origin: o,
      direction: [dx / L, dy / L, 0],
    };
  }
  if (e.kind === 'point') {
    return { ...e, position: r(e.position) };
  }
  if (e.kind === 'text') {
    return {
      ...e,
      position: r(e.position),
      rotation: e.rotation + angle,
    };
  }
  if (e.kind === 'object') {
    return {
      ...e,
      origin: r(e.origin),
      rotation: (e.rotation ?? 0) + angle,
    };
  }
  if (e.kind === 'polyline') {
    return {
      ...e,
      segments: e.segments.map((seg) => {
        if (seg.type === 'line') {
          return { ...seg, start: r(seg.start), end: r(seg.end) };
        }
        return {
          ...seg,
          center: r(seg.center),
          startAngle: seg.startAngle + angle,
          endAngle: seg.endAngle + angle,
        };
      }),
    };
  }
  if (e.kind === 'wall') {
    return {
      ...e,
      start: r(e.start),
      end: r(e.end),
      center: e.center ? r(e.center) : undefined,
      startAngle:
        e.startAngle !== undefined ? e.startAngle + angle : undefined,
      endAngle: e.endAngle !== undefined ? e.endAngle + angle : undefined,
      segments: e.segments
        ? e.segments.map((seg) => {
            if (seg.type === 'line') {
              return { ...seg, start: r(seg.start), end: r(seg.end) };
            }
            return {
              ...seg,
              center: r(seg.center),
              startAngle: seg.startAngle + angle,
              endAngle: seg.endAngle + angle,
            };
          })
        : undefined,
      strokeGeom: e.strokeGeom?.map((g) => ({
        ...g,
        start: r(g.start),
        end: r(g.end),
      })),
      lines: e.lines.map((l) => ({ ...l })),
    };
  }
  if (e.kind === 'dimension') {
    const dir = e.direction;
    const nd: Vec3 = [
      dir[0] * Math.cos(angle) - dir[1] * Math.sin(angle),
      dir[0] * Math.sin(angle) + dir[1] * Math.cos(angle),
      0,
    ];
    const nL = Math.hypot(nd[0], nd[1]) || 1;
    return {
      ...e,
      lineAnchor: r(e.lineAnchor),
      direction: [nd[0] / nL, nd[1] / nL, 0],
      defPoints: e.defPoints.map((p) => r(p)),
      // Legacy virtuel (si encore présent)
      labelPositions: e.labelPositions?.map((p) => r(p)),
      labelRotations: e.labelRotations?.map((a) => a + angle),
    };
  }
  return e;
}

export function translateEntity(e: Entity, dx: number, dy: number, dz = 0): Entity {
  if (e.kind === 'line') {
    return {
      ...e,
      start: translateVec(e.start, dx, dy, dz),
      end: translateVec(e.end, dx, dy, dz),
    };
  }
  if (e.kind === 'arc') {
    return {
      ...e,
      center: translateVec(e.center, dx, dy, dz),
    };
  }
  if (e.kind === 'circle') {
    return {
      ...e,
      center: translateVec(e.center, dx, dy, dz),
    };
  }
  if (e.kind === 'helper') {
    return {
      ...e,
      origin: translateVec(e.origin, dx, dy, dz),
    };
  }
  if (e.kind === 'wall') {
    const w: WallEntity = {
      ...e,
      start: translateVec(e.start, dx, dy, dz),
      end: translateVec(e.end, dx, dy, dz),
      center: e.center ? translateVec(e.center, dx, dy, dz) : undefined,
      lines: e.lines.map((l) => ({ ...l })),
      segments: e.segments
        ? translateWallSegments(e.segments, dx, dy, dz)
        : undefined,
      strokeGeom: e.strokeGeom?.map(
        (g): WallStrokeGeom => ({
          ...g,
          start: translateVec(g.start, dx, dy, dz),
          end: translateVec(g.end, dx, dy, dz),
        }),
      ),
    };
    return w;
  }
  if (e.kind === 'object') {
    return {
      ...e,
      origin: translateVec(e.origin, dx, dy, dz),
    };
  }
  if (e.kind === 'text') {
    return {
      ...e,
      position: translateVec(e.position, dx, dy, dz),
    };
  }
  if (e.kind === 'dimension') {
    return {
      ...e,
      lineAnchor: translateVec(e.lineAnchor, dx, dy, dz),
      defPoints: e.defPoints.map((p) => translateVec(p, dx, dy, dz)),
      // Legacy virtuel (si encore présent)
      labelPositions: e.labelPositions?.map((p) =>
        translateVec(p, dx, dy, dz),
      ),
      labelRotations: e.labelRotations ? [...e.labelRotations] : undefined,
    };
  }
  if (e.kind === 'point') {
    return {
      ...e,
      position: translateVec(e.position, dx, dy, dz),
    };
  }
  if (e.kind === 'polyline') {
    return translatePolyline(e, dx, dy, dz);
  }
  return e;
}

/** Clone profond avec nouveaux ids. */
export function cloneEntity(e: Entity): Entity {
  if (e.kind === 'line') {
    const c: LineEntity = {
      ...e,
      id: newId('line'),
      start: [...e.start] as Vec3,
      end: [...e.end] as Vec3,
    };
    return c;
  }
  if (e.kind === 'arc') {
    const c: ArcEntity = {
      ...e,
      id: newId('arc'),
      center: [...e.center] as Vec3,
      normal: [...e.normal] as Vec3,
    };
    return c;
  }
  if (e.kind === 'circle') {
    const c: CircleEntity = {
      ...e,
      id: newId('circle'),
      center: [...e.center] as Vec3,
      normal: [...e.normal] as Vec3,
    };
    return c;
  }
  if (e.kind === 'helper') {
    const c: HelperLineEntity = {
      ...e,
      id: newId('aide'),
      origin: [...e.origin] as Vec3,
      direction: [...e.direction] as Vec3,
    };
    return c;
  }
  if (e.kind === 'wall') {
    const c: WallEntity = {
      ...e,
      id: newId(e.path === 'poly' ? 'pwall' : 'wall'),
      start: [...e.start] as Vec3,
      end: [...e.end] as Vec3,
      center: e.center ? ([...e.center] as Vec3) : undefined,
      normal: e.normal ? ([...e.normal] as Vec3) : undefined,
      lines: e.lines.map((l) => ({ ...l })),
      segments: e.segments ? cloneWallSegments(e.segments) : undefined,
      strokeGeom: e.strokeGeom?.map((g) => ({
        ...g,
        start: [...g.start] as Vec3,
        end: [...g.end] as Vec3,
      })),
    };
    return c;
  }
  if (e.kind === 'object') {
    const c: ObjectInstanceEntity = {
      ...e,
      id: newId('obj'),
      origin: [...e.origin] as Vec3,
    };
    return c;
  }
  if (e.kind === 'text') {
    const c: TextEntity = {
      ...e,
      id: newId('text'),
      position: [...e.position] as Vec3,
      dimId: e.dimId,
    };
    return c;
  }
  if (e.kind === 'dimension') {
    const c: DimensionEntity = {
      ...e,
      id: newId('dim'),
      lineAnchor: [...e.lineAnchor] as Vec3,
      direction: [...e.direction] as Vec3,
      defPoints: e.defPoints.map((p) => [...p] as Vec3),
      labelId: e.labelId, // l’appelant doit cloner le texte et re-lier
      labelPositions: e.labelPositions?.map((p) => [...p] as Vec3),
      labelRotations: e.labelRotations ? [...e.labelRotations] : undefined,
      style: { ...e.style },
    };
    return c;
  }
  // Note: TextEntity clone déjà plus haut
  if (e.kind === 'point') {
    const c: PointEntity = {
      ...e,
      id: newId('pt'),
      position: [...e.position] as Vec3,
    };
    return c;
  }
  if (e.kind === 'polyline') {
    return clonePolyline(e);
  }
  return e;
}

export function cloneAndTranslate(
  entities: readonly Entity[],
  dx: number,
  dy: number,
  dz = 0,
): Entity[] {
  const idMap = new Map<string, string>();
  const cloned = entities.map((e) => {
    const c = translateEntity(cloneEntity(e), dx, dy, dz);
    idMap.set(e.id, c.id);
    return c;
  });
  // Re-lier cotation ↔ libellé après nouveaux ids
  for (const c of cloned) {
    if (c.kind === 'dimension' && c.labelId) {
      const mapped = idMap.get(c.labelId);
      c.labelId = mapped; // undefined si texte non copié
    }
    if (c.kind === 'text' && c.dimId) {
      const mapped = idMap.get(c.dimId);
      c.dimId = mapped;
    }
  }
  return applyWallJointsToEntities(cloned);
}

/**
 * Clone les entités en ramenant `origin` à (0,0,0).
 * Utile pour /obj et /extract.
 */
export function extractAtOrigin(
  entities: readonly Entity[],
  origin: Vec3,
): Entity[] {
  const dx = -origin[0];
  const dy = -origin[1];
  const dz = -origin[2];
  return cloneAndTranslate(entities, dx, dy, dz);
}

/** Boîte englobante XY d'un ensemble d'entités (pour vignettes biblio). */
export function entitiesBounds2d(
  entities: readonly Entity[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  const addPt = (p: Vec3) => {
    any = true;
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  };

  for (const e of entities) {
    if (e.kind === 'line') {
      addPt(e.start);
      addPt(e.end);
    } else if (e.kind === 'circle') {
      addPt([e.center[0] - e.radius, e.center[1], 0]);
      addPt([e.center[0] + e.radius, e.center[1], 0]);
      addPt([e.center[0], e.center[1] - e.radius, 0]);
      addPt([e.center[0], e.center[1] + e.radius, 0]);
    } else if (e.kind === 'arc') {
      for (const p of sampleArcPts(e, 24)) addPt(p);
    } else if (e.kind === 'wall') {
      for (const s of wallEntityStrokes(e, 16)) {
        for (const p of s.points) addPt(p);
      }
    } else if (e.kind === 'object') {
      for (const s of objectInstanceStrokes(e)) {
        for (const p of s.points) addPt(p);
      }
    } else if (e.kind === 'text') {
      const h = e.height;
      const w = Math.max(h * 0.55 * Math.max(e.content.length, 1), h);
      addPt([e.position[0] - w * 0.5, e.position[1] - h * 0.5, e.position[2]]);
      addPt([e.position[0] + w * 0.5, e.position[1] + h * 0.5, e.position[2]]);
    } else if (e.kind === 'dimension') {
      addPt(e.lineAnchor);
      for (const p of e.defPoints) addPt(p);
    } else if (e.kind === 'polyline') {
      for (const s of polylineStrokes(e, 24)) {
        for (const p of s.points) addPt(p);
      }
    } else if (e.kind === 'point') {
      addPt(e.position);
    }
  }

  if (!any || !Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function sampleArcPts(e: ArcEntity, n: number): Vec3[] {
  const pts: Vec3[] = [];
  let a0 = e.startAngle;
  let a1 = e.endAngle;
  while (a1 < a0) a1 += Math.PI * 2;
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    pts.push([
      e.center[0] + e.radius * Math.cos(t),
      e.center[1] + e.radius * Math.sin(t),
      e.center[2],
    ]);
  }
  return pts;
}
