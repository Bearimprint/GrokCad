/**
 * /stretch — déplace les extrémités (ou l’objet entier) qui tombent dans un cadre.
 *
 * - Objet ENTIÈREMENT dans le cadre → translation globale (comme /move)
 * - Partiellement → seules les extrémités dans le cadre bougent
 * - Instance library : uniquement si entièrement dans le cadre (sinon ignorée)
 */

import {
  arcEndPoint,
  arcFrom3Points,
  arcStartPoint,
  sampleArc,
} from './drawing';
import { translateEntity, entitiesBounds2d } from './entityOps';
import { expandObjectEntities } from './objectInstance';
import type { Aabb2 } from './selection';
import { pointInAabb } from './selection';
import type {
  ArcEntity,
  Entity,
  LineEntity,
  PolylineEntity,
  PolylineSegment,
  Vec3,
  WallEntity,
  WallSegment,
} from './types';
import { applyWallJointsToEntities } from './walls';

const EPS = 1e-12;

function ptIn(p: Vec3, box: Aabb2): boolean {
  return pointInAabb(p[0], p[1], box);
}

function movePt(p: Vec3, dx: number, dy: number, dz: number): Vec3 {
  return [p[0] + dx, p[1] + dy, p[2] + dz];
}

/** true si toute la géométrie utile est dans le cadre. */
export function entityFullyInAabb(e: Entity, box: Aabb2): boolean {
  switch (e.kind) {
    case 'line':
      return ptIn(e.start, box) && ptIn(e.end, box);
    case 'point':
      return ptIn(e.position, box);
    case 'text':
      return ptIn(e.position, box);
    case 'dimension':
      return (
        ptIn(e.lineAnchor, box) && e.defPoints.every((p) => ptIn(p, box))
      );
    case 'helper':
      return ptIn(e.origin, box);
    case 'circle': {
      const c = e.center;
      const r = e.radius;
      return (
        c[0] - r >= box.minX &&
        c[0] + r <= box.maxX &&
        c[1] - r >= box.minY &&
        c[1] + r <= box.maxY
      );
    }
    case 'arc': {
      const pts = sampleArc(e, 32);
      return pts.every((p) => ptIn(p, box));
    }
    case 'polyline': {
      if (!e.segments.length) return false;
      return polylineVertices(e).every((p) => ptIn(p, box));
    }
    case 'wall': {
      if (e.path === 'poly' && e.segments?.length) {
        return wallPolyVertices(e).every((p) => ptIn(p, box));
      }
      if (e.path === 'arc') {
        return sampleArc(
          {
            id: '',
            kind: 'arc',
            layer: '',
            center: e.center ?? [0, 0, 0],
            radius: e.radius ?? 0,
            startAngle: e.startAngle ?? 0,
            endAngle: e.endAngle ?? 0,
            normal: e.normal ?? [0, 0, 1],
            color: '#000',
            lineWidth: 1,
            lineStyle: 'plein',
          },
          32,
        ).every((p) => ptIn(p, box));
      }
      return ptIn(e.start, box) && ptIn(e.end, box);
    }
    case 'object': {
      const expanded = expandObjectEntities(e);
      const b = entitiesBounds2d(expanded);
      if (!b) return ptIn(e.origin, box);
      return (
        b.minX >= box.minX &&
        b.maxX <= box.maxX &&
        b.minY >= box.minY &&
        b.maxY <= box.maxY
      );
    }
    default:
      return false;
  }
}

function polylineVertices(e: PolylineEntity): Vec3[] {
  const pts: Vec3[] = [];
  for (const s of e.segments) {
    if (s.type === 'line') {
      pts.push(s.start, s.end);
    } else {
      pts.push(
        arcStartPoint({
          id: '',
          kind: 'arc',
          layer: '',
          center: s.center,
          radius: s.radius,
          startAngle: s.startAngle,
          endAngle: s.endAngle,
          normal: s.normal,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        }),
        arcEndPoint({
          id: '',
          kind: 'arc',
          layer: '',
          center: s.center,
          radius: s.radius,
          startAngle: s.startAngle,
          endAngle: s.endAngle,
          normal: s.normal,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: s.lineStyle,
        }),
      );
    }
  }
  return pts;
}

function wallPolyVertices(e: WallEntity): Vec3[] {
  const pts: Vec3[] = [];
  for (const s of e.segments ?? []) {
    if (s.type === 'line') {
      pts.push(s.start, s.end);
    } else {
      pts.push(
        [
          s.center[0] + s.radius * Math.cos(s.startAngle),
          s.center[1] + s.radius * Math.sin(s.startAngle),
          s.center[2],
        ],
        [
          s.center[0] + s.radius * Math.cos(s.endAngle),
          s.center[1] + s.radius * Math.sin(s.endAngle),
          s.center[2],
        ],
      );
    }
  }
  return pts;
}

/**
 * Applique le stretch à une entité.
 * null = inchangée (ou non étirable partiellement).
 */
export function stretchEntity(
  e: Entity,
  box: Aabb2,
  dx: number,
  dy: number,
  dz = 0,
): Entity | null {
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS && Math.abs(dz) < EPS) {
    return null;
  }

  // Entièrement dans le cadre → move
  if (entityFullyInAabb(e, box)) {
    return translateEntity(e, dx, dy, dz);
  }

  // Library : pas de stretch partiel
  if (e.kind === 'object') return null;

  if (e.kind === 'line') return stretchLine(e, box, dx, dy, dz);
  if (e.kind === 'arc') return stretchArc(e, box, dx, dy, dz);
  if (e.kind === 'circle') return null; // partiel non supporté
  if (e.kind === 'point') {
    // pas fully → point hors cadre
    return null;
  }
  if (e.kind === 'text') return null;
  if (e.kind === 'dimension') return null;
  if (e.kind === 'helper') return null;
  if (e.kind === 'polyline') return stretchPolyline(e, box, dx, dy, dz);
  if (e.kind === 'wall') return stretchWall(e, box, dx, dy, dz);
  return null;
}

function stretchLine(
  e: LineEntity,
  box: Aabb2,
  dx: number,
  dy: number,
  dz: number,
): LineEntity | null {
  const ms = ptIn(e.start, box);
  const me = ptIn(e.end, box);
  if (!ms && !me) return null;
  return {
    ...e,
    start: ms ? movePt(e.start, dx, dy, dz) : ([...e.start] as Vec3),
    end: me ? movePt(e.end, dx, dy, dz) : ([...e.end] as Vec3),
  };
}

function stretchArc(
  e: ArcEntity,
  box: Aabb2,
  dx: number,
  dy: number,
  dz: number,
): Entity | null {
  let start = arcStartPoint(e);
  let end = arcEndPoint(e);
  const midAngle = (e.startAngle + e.endAngle) / 2;
  let mid: Vec3 = [
    e.center[0] + e.radius * Math.cos(midAngle),
    e.center[1] + e.radius * Math.sin(midAngle),
    e.center[2],
  ];

  const ms = ptIn(start, box);
  const me = ptIn(end, box);
  const mm = ptIn(mid, box);
  if (!ms && !me && !mm) return null;

  if (ms) start = movePt(start, dx, dy, dz);
  if (me) end = movePt(end, dx, dy, dz);
  if (mm) mid = movePt(mid, dx, dy, dz);

  const rebuilt = arcFrom3Points(start, mid, end, {
    color: e.color,
    lineWidth: e.lineWidth,
    lineStyle: e.lineStyle,
    layer: e.layer,
    id: e.id,
  });
  if (!rebuilt) {
    // Dégénéré → ligne entre extrémités
    return {
      id: e.id,
      kind: 'line',
      layer: e.layer,
      start,
      end,
      color: e.color,
      lineWidth: e.lineWidth,
      lineStyle: e.lineStyle,
    };
  }
  return { ...rebuilt, id: e.id, layer: e.layer };
}

function stretchPolyline(
  e: PolylineEntity,
  box: Aabb2,
  dx: number,
  dy: number,
  dz: number,
): PolylineEntity | null {
  let changed = false;
  const segments: PolylineSegment[] = e.segments.map((s) => {
    if (s.type === 'line') {
      const ms = ptIn(s.start, box);
      const me = ptIn(s.end, box);
      if (!ms && !me) {
        return {
          ...s,
          start: [...s.start] as Vec3,
          end: [...s.end] as Vec3,
        };
      }
      changed = true;
      return {
        ...s,
        start: ms ? movePt(s.start, dx, dy, dz) : ([...s.start] as Vec3),
        end: me ? movePt(s.end, dx, dy, dz) : ([...s.end] as Vec3),
      };
    }
    // arc segment
    const fake: ArcEntity = {
      id: '',
      kind: 'arc',
      layer: '',
      center: s.center,
      radius: s.radius,
      startAngle: s.startAngle,
      endAngle: s.endAngle,
      normal: s.normal,
      color: s.color,
      lineWidth: s.lineWidth,
      lineStyle: s.lineStyle,
    };
    const stretched = stretchArc(fake, box, dx, dy, dz);
    if (!stretched) {
      return {
        ...s,
        center: [...s.center] as Vec3,
        normal: [...s.normal] as Vec3,
      };
    }
    changed = true;
    if (stretched.kind === 'line') {
      return {
        type: 'line' as const,
        start: stretched.start,
        end: stretched.end,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      };
    }
    if (stretched.kind === 'arc') {
      return {
        type: 'arc' as const,
        center: stretched.center,
        radius: stretched.radius,
        startAngle: stretched.startAngle,
        endAngle: stretched.endAngle,
        normal: stretched.normal,
        color: s.color,
        lineWidth: s.lineWidth,
        lineStyle: s.lineStyle,
      };
    }
    return s;
  });

  // Cohérence des joints : fin de seg i = début de seg i+1 si proches
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const aEnd =
      a.type === 'line'
        ? a.end
        : arcEndPoint({
            id: '',
            kind: 'arc',
            layer: '',
            center: a.center,
            radius: a.radius,
            startAngle: a.startAngle,
            endAngle: a.endAngle,
            normal: a.normal,
            color: a.color,
            lineWidth: a.lineWidth,
            lineStyle: a.lineStyle,
          });
    const bStart =
      b.type === 'line'
        ? b.start
        : arcStartPoint({
            id: '',
            kind: 'arc',
            layer: '',
            center: b.center,
            radius: b.radius,
            startAngle: b.startAngle,
            endAngle: b.endAngle,
            normal: b.normal,
            color: b.color,
            lineWidth: b.lineWidth,
            lineStyle: b.lineStyle,
          });
    // Si l’un des deux a bougé et qu’ils devaient être joints, aligner
    if (ptIn(aEnd, box) || ptIn(bStart, box)) {
      const joint = ptIn(aEnd, box) ? aEnd : bStart;
      if (a.type === 'line') a.end = [...joint] as Vec3;
      if (b.type === 'line') b.start = [...joint] as Vec3;
      // arcs : plus complexe — laissé tel quel si déjà recalculés
    }
  }

  if (!changed) return null;
  return { ...e, segments };
}

function stretchWall(
  e: WallEntity,
  box: Aabb2,
  dx: number,
  dy: number,
  dz: number,
): WallEntity | null {
  if (e.path === 'poly' && e.segments?.length) {
    let changed = false;
    const segments: WallSegment[] = e.segments.map((s) => {
      if (s.type === 'line') {
        const ms = ptIn(s.start, box);
        const me = ptIn(s.end, box);
        if (!ms && !me) {
          return {
            type: 'line' as const,
            start: [...s.start] as Vec3,
            end: [...s.end] as Vec3,
          };
        }
        changed = true;
        return {
          type: 'line' as const,
          start: ms ? movePt(s.start, dx, dy, dz) : ([...s.start] as Vec3),
          end: me ? movePt(s.end, dx, dy, dz) : ([...s.end] as Vec3),
        };
      }
      // arc mur
      const fake: ArcEntity = {
        id: '',
        kind: 'arc',
        layer: '',
        center: s.center,
        radius: s.radius,
        startAngle: s.startAngle,
        endAngle: s.endAngle,
        normal: s.normal,
        color: '#000',
        lineWidth: 1,
        lineStyle: 'plein',
      };
      const st = stretchArc(fake, box, dx, dy, dz);
      if (!st || st.kind !== 'arc') {
        if (st?.kind === 'line') {
          changed = true;
          return {
            type: 'line' as const,
            start: st.start,
            end: st.end,
          };
        }
        return {
          ...s,
          center: [...s.center] as Vec3,
          normal: [...s.normal] as Vec3,
        };
      }
      changed = true;
      return {
        type: 'arc' as const,
        center: st.center,
        radius: st.radius,
        startAngle: st.startAngle,
        endAngle: st.endAngle,
        normal: st.normal,
      };
    });
    if (!changed) return null;
    const start = segments[0]!.type === 'line'
      ? segments[0]!.start
      : [
          segments[0]!.center[0] +
            segments[0]!.radius * Math.cos(segments[0]!.startAngle),
          segments[0]!.center[1] +
            segments[0]!.radius * Math.sin(segments[0]!.startAngle),
          segments[0]!.center[2],
        ];
    const last = segments[segments.length - 1]!;
    const end =
      last.type === 'line'
        ? last.end
        : [
            last.center[0] + last.radius * Math.cos(last.endAngle),
            last.center[1] + last.radius * Math.sin(last.endAngle),
            last.center[2],
          ];
    return {
      ...e,
      segments,
      start: start as Vec3,
      end: end as Vec3,
      strokeGeom: undefined,
    };
  }

  if (e.path === 'arc' && e.center && e.radius != null) {
    const fake: ArcEntity = {
      id: e.id,
      kind: 'arc',
      layer: e.layer,
      center: e.center,
      radius: e.radius,
      startAngle: e.startAngle ?? 0,
      endAngle: e.endAngle ?? 0,
      normal: e.normal ?? [0, 0, 1],
      color: '#000',
      lineWidth: 1,
      lineStyle: 'plein',
    };
    const st = stretchArc(fake, box, dx, dy, dz);
    if (!st) return null;
    if (st.kind === 'line') {
      return {
        ...e,
        path: 'line',
        start: st.start,
        end: st.end,
        center: undefined,
        radius: undefined,
        startAngle: undefined,
        endAngle: undefined,
        strokeGeom: undefined,
      };
    }
    if (st.kind === 'arc') {
      return {
        ...e,
        center: st.center,
        radius: st.radius,
        startAngle: st.startAngle,
        endAngle: st.endAngle,
        start: arcStartPoint(st),
        end: arcEndPoint(st),
        strokeGeom: undefined,
      };
    }
    return null;
  }

  // mur linéaire simple
  const ms = ptIn(e.start, box);
  const me = ptIn(e.end, box);
  if (!ms && !me) return null;
  return {
    ...e,
    start: ms ? movePt(e.start, dx, dy, dz) : ([...e.start] as Vec3),
    end: me ? movePt(e.end, dx, dy, dz) : ([...e.end] as Vec3),
    strokeGeom: undefined,
  };
}

/**
 * Applique le stretch à tout le document.
 * Retourne la nouvelle liste d’entités + nombre d’entités modifiées.
 */
export function stretchDocument(
  entities: readonly Entity[],
  box: Aabb2,
  dx: number,
  dy: number,
  dz = 0,
): { entities: Entity[]; changed: number } {
  let changed = 0;
  const next = entities.map((e) => {
    // Aides : optionnellement stretch origin
    if (e.kind === 'helper') {
      if (ptIn(e.origin, box)) {
        changed += 1;
        return {
          ...e,
          origin: movePt(e.origin, dx, dy, dz),
        };
      }
      return e;
    }
    const s = stretchEntity(e, box, dx, dy, dz);
    if (s) {
      changed += 1;
      return s;
    }
    return e;
  });
  // Recalcul jonctions murs
  return {
    entities: applyWallJointsToEntities(next),
    changed,
  };
}

/** Aperçu : entités après stretch (sans muter le doc). */
export function previewStretch(
  entities: readonly Entity[],
  box: Aabb2,
  dx: number,
  dy: number,
  dz = 0,
): Entity[] {
  return stretchDocument(entities, box, dx, dy, dz).entities;
}
