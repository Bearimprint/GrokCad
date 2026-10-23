/**
 * Pose d’un objet insertions : ancre −9, étirement par calque, ALT/CTRL.
 *
 * Les parties étirables sont définies à 1 m sur les axes concernés.
 * scaleX = 0.65 → largeur 0,65 m. Les parties fixes (−1) ne changent pas.
 */

import {
  ANCHOR_LAYER,
  entityDrawLayer,
  findAnchorPoint,
  stretchAxesOf,
  type StretchAxes,
} from './drawLayers';
import { add, scale as vscale } from './geometry';
import { arcFrom3Points } from './drawing';
import type { ArcEntity, CircleEntity, Entity, InsertPlacement, PolylineArcSeg, Vec3 } from './types';

export interface InsertFrame {
  origin: Vec3;
  axisX: Vec3;
  axisY: Vec3;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  /**
   * Décalage Y (unités monde, le long de +axisY) ajouté aux parties
   * étirables en Y. Sert à caler le symbole sur l’intervalle d’offsets du mur.
   */
  biasY?: number;
  /**
   * Étirer X et Y même sur un calque fixe.
   * Vrai quand le symbole n’a aucun calque étirable : il EST l’ouverture
   * (rectangle de test sur −1, par exemple).
   */
  forceXY?: boolean;
}

export interface InsertSample {
  lx: number;
  ly: number;
  world: Vec3;
  /** Participe au trou dans le mur. */
  cutter: boolean;
}

export function defaultInsertPlacement(
  hostId: string,
  along: number,
): InsertPlacement {
  return {
    hostId,
    along,
    flipAlt: false,
    flipCtrl: false,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
}

function clampScale(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 1;
  return Math.max(0.001, Math.abs(n));
}

function localOf(
  p: Vec3,
  anchor: Vec3,
  axes: StretchAxes,
  frame: InsertFrame,
): { lx: number; ly: number; world: Vec3; cutter: boolean } {
  const rel: Vec3 = [p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]];
  const force = frame.forceXY === true;
  if (axes.swing && !force) {
    const lx = rel[0] * frame.scaleX;
    const ly = rel[1] * frame.scaleX;
    const world = add(
      add(frame.origin, vscale(frame.axisX, lx)),
      add(vscale(frame.axisY, ly), [0, 0, rel[2]]),
    );
    return { lx, ly, world, cutter: false };
  }
  const sx = axes.x || force;
  const sy = axes.y || force;
  const lx = sx ? rel[0] * frame.scaleX : rel[0];
  const ly = sy ? rel[1] * frame.scaleY + (frame.biasY ?? 0) : rel[1];
  const lz = axes.z ? rel[2] * frame.scaleZ : rel[2];
  const world = add(
    add(frame.origin, vscale(frame.axisX, lx)),
    add(vscale(frame.axisY, ly), [0, 0, lz]),
  );
  return { lx, ly, world, cutter: sx || sy };
}

/** Points de définition réellement déplacés par `mapEntity` (pas le rayon des arcs). */
function definitionPoints(e: Entity): Vec3[] {
  if (e.kind === 'line') return [e.start, e.end];
  if (e.kind === 'point') return [e.position];
  if (e.kind === 'text') return [e.position];
  if (e.kind === 'arc' || e.kind === 'circle') return [e.center];
  if (e.kind === 'polyline') {
    const pts: Vec3[] = [];
    for (const s of e.segments) {
      if (s.type === 'line') pts.push(s.start, s.end);
      else pts.push(s.center);
    }
    return pts;
  }
  if (e.kind === 'wall') return [e.start, e.end];
  if (e.kind === 'dimension') return [e.lineAnchor, ...e.defPoints];
  return [];
}

function pointOnCircle(center: Vec3, radius: number, angle: number): Vec3 {
  return [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
    center[2],
  ];
}

/** Remet un arc circulaire après rotation / échelle uniforme du cadre. */
function mapArc(e: ArcEntity, map: (p: Vec3) => Vec3): ArcEntity {
  const start = map(pointOnCircle(e.center, e.radius, e.startAngle));
  const mid = map(pointOnCircle(e.center, e.radius, (e.startAngle + e.endAngle) / 2));
  const end = map(pointOnCircle(e.center, e.radius, e.endAngle));
  const rebuilt = arcFrom3Points(start, mid, end, {
    id: e.id,
    layer: e.layer,
    color: e.color,
    lineWidth: e.lineWidth,
    lineStyle: e.lineStyle,
    ...(e.byLayer ? { byLayer: e.byLayer } : {}),
  });
  if (!rebuilt) {
    return { ...e, center: map(e.center) };
  }
  return {
    ...rebuilt,
    id: e.id,
    layer: e.layer,
    drawLayer: e.drawLayer,
    byLayer: e.byLayer,
  };
}

function mapArcSeg(s: PolylineArcSeg, map: (p: Vec3) => Vec3): PolylineArcSeg {
  const asArc: ArcEntity = {
    id: 'seg',
    kind: 'arc',
    layer: 'DESSIN',
    center: s.center,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    normal: s.normal,
    color: s.color,
    lineWidth: s.lineWidth,
    lineStyle: s.lineStyle,
    ...(s.byLayer ? { byLayer: s.byLayer } : {}),
  };
  const mapped = mapArc(asArc, map);
  return {
    ...s,
    center: mapped.center,
    radius: mapped.radius,
    startAngle: mapped.startAngle,
    endAngle: mapped.endAngle,
    normal: mapped.normal,
  };
}

function mapCircle(e: CircleEntity, map: (p: Vec3) => Vec3, radiusScale: number): CircleEntity {
  return {
    ...e,
    center: map(e.center),
    radius: Math.max(1e-6, e.radius * radiusScale),
  };
}
function radiusScaleOf(axes: StretchAxes, frame: InsertFrame): number {
  if (axes.swing || frame.forceXY) return clampScale(frame.scaleX);
  if (axes.x && !axes.y) return clampScale(frame.scaleX);
  if (axes.y && !axes.x) return clampScale(frame.scaleY);
  if (axes.x && axes.y) return clampScale(frame.scaleX);
  return 1;
}

function mapEntity(
  e: Entity,
  map: (p: Vec3) => Vec3,
  radiusScale: number,
): Entity {
  if (e.kind === 'line') {
    return { ...e, start: map(e.start), end: map(e.end) };
  }
  if (e.kind === 'arc') {
    return mapArc(e, map);
  }
  if (e.kind === 'circle') {
    return mapCircle(e, map, radiusScale);
  }
  if (e.kind === 'point') {
    return { ...e, position: map(e.position) };
  }
  if (e.kind === 'text') {
    return { ...e, position: map(e.position) };
  }
  if (e.kind === 'polyline') {
    return {
      ...e,
      segments: e.segments.map((s) => {
        if (s.type === 'line') {
          return { ...s, start: map(s.start), end: map(s.end) };
        }
        return mapArcSeg(s, map);
      }),
    };
  }
  if (e.kind === 'wall') {
    return {
      ...e,
      start: map(e.start),
      end: map(e.end),
      center: e.center ? map(e.center) : undefined,
      radius:
        e.radius !== undefined
          ? Math.max(1e-6, e.radius * radiusScale)
          : undefined,
      strokeGeom: e.strokeGeom?.map((g) => ({
        ...g,
        start: map(g.start),
        end: map(g.end),
      })),
      segments: e.segments?.map((s) => {
        if (s.type === 'line') {
          return { ...s, start: map(s.start), end: map(s.end) };
        }
        const mapped = mapArc(
          {
            id: 'wseg',
            kind: 'arc',
            layer: 'MURS',
            center: s.center,
            radius: s.radius,
            startAngle: s.startAngle,
            endAngle: s.endAngle,
            normal: s.normal,
            color: '#ffffff',
            lineWidth: 1,
            lineStyle: 'plein',
          },
          map,
        );
        return {
          ...s,
          center: mapped.center,
          radius: mapped.radius,
          startAngle: mapped.startAngle,
          endAngle: mapped.endAngle,
          normal: mapped.normal,
        };
      }),
    };
  }
  if (e.kind === 'dimension') {
    return {
      ...e,
      lineAnchor: map(e.lineAnchor),
      defPoints: e.defPoints.map((p) => map(p)),
    };
  }
  if (e.kind === 'object') {
    return { ...e, origin: map(e.origin) };
  }
  return e;
}

/**
 * Transforme les entités de définition dans le cadre hôte.
 * Ignore helpers. L’ancre −9 est omise (sauf `keepAnchor`).
 */
export function placeInsertEntities(
  entities: readonly Entity[],
  frame: InsertFrame,
  opts?: { keepAnchor?: boolean },
): Entity[] {
  const anchor = findAnchorPoint(entities) ?? ([0, 0, 0] as Vec3);
  const sx = clampScale(frame.scaleX);
  const sy = clampScale(frame.scaleY);
  const sz = clampScale(frame.scaleZ);
  const fr: InsertFrame = { ...frame, scaleX: sx, scaleY: sy, scaleZ: sz };
  const out: Entity[] = [];
  for (const e of entities) {
    if (e.kind === 'helper' || e.kind === 'object') continue;
    const dl = entityDrawLayer(e);
    if (dl === ANCHOR_LAYER && !opts?.keepAnchor) continue;
    const axes = stretchAxesOf(dl);
    const mapped = mapEntity(
      e,
      (p) => localOf(p, anchor, axes, fr).world,
      radiusScaleOf(axes, fr),
    );
    out.push(mapped);
  }
  return out;
}

/**
 * Échantillons locaux (lx le long de l’hôte, ly = offset) après étirement.
 * Sert au trou dans le mur : même transformation que le dessin.
 */
export function sampleInsertLocals(
  entities: readonly Entity[],
  frame: InsertFrame,
): InsertSample[] {
  const anchor = findAnchorPoint(entities) ?? ([0, 0, 0] as Vec3);
  const sx = clampScale(frame.scaleX);
  const sy = clampScale(frame.scaleY);
  const sz = clampScale(frame.scaleZ);
  const fr: InsertFrame = { ...frame, scaleX: sx, scaleY: sy, scaleZ: sz };
  const out: InsertSample[] = [];
  for (const e of entities) {
    if (e.kind === 'helper' || e.kind === 'object') continue;
    const dl = entityDrawLayer(e);
    if (dl === ANCHOR_LAYER) continue;
    const axes = stretchAxesOf(dl);
    for (const p of definitionPoints(e)) {
      const loc = localOf(p, anchor, axes, fr);
      out.push({ lx: loc.lx, ly: loc.ly, world: loc.world, cutter: loc.cutter });
    }
  }
  return out;
}

/** Cercle d’aperçu (ancre) autour de l’origine. */
export function anchorPreviewCircle(origin: Vec3, radius = 0.08, n = 24): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([
      origin[0] + radius * Math.cos(t),
      origin[1] + radius * Math.sin(t),
      origin[2],
    ]);
  }
  return pts;
}

export function signedAlongScale(
  origin: Vec3,
  axisX: Vec3,
  mouse: Vec3,
): number {
  const dx = mouse[0] - origin[0];
  const dy = mouse[1] - origin[1];
  const s = dx * axisX[0] + dy * axisX[1];
  return Math.max(0.001, s);
}
