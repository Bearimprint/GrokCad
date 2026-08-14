import * as THREE from 'three';
import type { HelperLineEntity, Vec3 } from '../core/types';

/**
 * Rendu des lignes d'aide : droites infinies en pointillés gris clair,
 * re-clippées à chaque changement de caméra pour rester « infinies » à l'écran.
 */
export class HelperLayer {
  readonly group = new THREE.Group();
  private lines = new Map<string, THREE.Line>();
  private helpers: HelperLineEntity[] = [];
  private snapMarker: THREE.Mesh;

  constructor() {
    this.group.name = 'helper-layer';
    const geo = new THREE.SphereGeometry(0.08, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
    this.snapMarker = new THREE.Mesh(geo, mat);
    this.snapMarker.visible = false;
    this.group.add(this.snapMarker);
  }

  setHelpers(helpers: readonly HelperLineEntity[]): void {
    this.helpers = helpers.slice();
    const ids = new Set(helpers.map((h) => h.id));

    for (const id of [...this.lines.keys()]) {
      if (!ids.has(id)) {
        const line = this.lines.get(id)!;
        this.group.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.lines.delete(id);
      }
    }

    for (const h of helpers) {
      if (!this.lines.has(h.id)) {
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(6);
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineDashedMaterial({
          color: new THREE.Color(h.color),
          dashSize: 0.35,
          gapSize: 0.22,
          scale: 1,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const line = new THREE.Line(geom, mat);
        line.frustumCulled = false;
        line.userData.helperId = h.id;
        this.lines.set(h.id, line);
        this.group.add(line);
      } else {
        const line = this.lines.get(h.id)!;
        const mat = line.material as THREE.LineDashedMaterial;
        mat.color.set(h.color);
      }
    }
  }

  /** Recalcule les segments visibles pour couvrir le frustum (effet ligne infinie). */
  updateForCamera(
    target: THREE.Vector3,
    halfHeight: number,
    aspect: number,
  ): void {
    // Boîte de clip un peu plus large que l'écran
    const margin = 1.4;
    const halfW = halfHeight * aspect * margin;
    const halfH = halfHeight * margin;
    // En vue plan dominante : étendre aussi en Z pour les aides verticales
    const halfZ = Math.max(halfW, halfH, 50);

    const box = new THREE.Box3(
      new THREE.Vector3(target.x - halfW, target.y - halfH, target.z - halfZ),
      new THREE.Vector3(target.x + halfW, target.y + halfH, target.z + halfZ),
    );

    // Longueur de trait pointillé proportionnelle au zoom
    const dash = Math.max(0.15, halfHeight * 0.035);
    const gap = dash * 0.65;

    for (const h of this.helpers) {
      const line = this.lines.get(h.id);
      if (!line) continue;
      const seg = clipInfiniteLineToBox(h.origin, h.direction, box);
      const mat = line.material as THREE.LineDashedMaterial;
      mat.dashSize = dash;
      mat.gapSize = gap;

      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (!seg) {
        // Hors vue : segment dégénéré
        pos.setXYZ(0, 0, 0, 0);
        pos.setXYZ(1, 0, 0, 0);
      } else {
        pos.setXYZ(0, seg[0][0], seg[0][1], seg[0][2]);
        pos.setXYZ(1, seg[1][0], seg[1][1], seg[1][2]);
      }
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      line.computeLineDistances();
    }
  }

  showSnap(point: Vec3 | null, scale = 1): void {
    if (!point) {
      this.snapMarker.visible = false;
      return;
    }
    this.snapMarker.visible = true;
    this.snapMarker.position.set(point[0], point[1], point[2]);
    const s = Math.max(0.05, scale * 0.012);
    this.snapMarker.scale.setScalar(s / 0.08);
  }

  dispose(): void {
    for (const line of this.lines.values()) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines.clear();
    this.snapMarker.geometry.dispose();
    (this.snapMarker.material as THREE.Material).dispose();
  }
}

/**
 * Intersection droite infinie ↔ boîte AABB (Liang–Barsky 3D simplifié via param t).
 */
function clipInfiniteLineToBox(
  origin: Vec3,
  direction: Vec3,
  box: THREE.Box3,
): [Vec3, Vec3] | null {
  const o = new THREE.Vector3(origin[0], origin[1], origin[2]);
  const d = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
  if (d.lengthSq() < 1e-12) return null;

  // Étendre largement puis clamper aux faces de la boîte
  const extent =
    Math.max(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z,
    ) * 2 + 10;

  let t0 = -extent;
  let t1 = extent;

  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const ax of axes) {
    const ro = o[ax];
    const rd = d[ax];
    const min = box.min[ax];
    const max = box.max[ax];
    if (Math.abs(rd) < 1e-12) {
      if (ro < min || ro > max) return null;
      continue;
    }
    let tNear = (min - ro) / rd;
    let tFar = (max - ro) / rd;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    t0 = Math.max(t0, tNear);
    t1 = Math.min(t1, tFar);
    if (t0 > t1) return null;
  }

  const p0 = o.clone().addScaledVector(d, t0);
  const p1 = o.clone().addScaledVector(d, t1);
  return [
    [p0.x, p0.y, p0.z],
    [p1.x, p1.y, p1.z],
  ];
}
