/**
 * Désigner / effacer une insertion (porte, fenêtre, rectangle) dans un mur.
 * Run: tsx scripts/test-delete-insertion.mts
 */
import { readFileSync } from 'node:fs';
import { CadDocument } from '../src/core/document.ts';
import { findNearestEntity } from '../src/core/designation.ts';
import { parseGkd } from '../src/core/gkd.ts';
import { findNearestInsertHost, rotationFromAxisX } from '../src/core/insertHost.ts';
import { collectWallOpenings, composeInsertFrame } from '../src/core/insertOpening.ts';
import { defaultInsertPlacement } from '../src/core/insertTransform.ts';
import { objectDefCache } from '../src/core/objectCache.ts';
import { createObjectInstance } from '../src/core/objectInstance.ts';
import type { ObjectInstanceEntity, Vec3, WallEntity } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}
console.log('TEST delete insertion');

const TAB = 'insertions/doors';
for (const n of ['porte', 'text_rect_Vide']) {
  objectDefCache.set(TAB, n, parseGkd(readFileSync(new URL(`../library/insertions/doors/${n}.gkd`, import.meta.url), 'utf8')));
}

function wall(id: string, start: Vec3, end: Vec3): WallEntity {
  return {
    id, kind: 'wall', layer: 'MURS', styleId: 's', path: 'line', flip: false,
    lines: [0, 0.02, 0.18, 0.2].map((offset) => ({ offset, color: '#fff', lineWidth: 1, lineStyle: 'plein' as const })),
    start, end,
  };
}

function insert(w: WallEntity, name: string, near: Vec3, length: number): ObjectInstanceEntity {
  const def = objectDefCache.get(TAB, name)!;
  const hit = findNearestInsertHost(near, [w], 1)!;
  const frame = composeInsertFrame(hit, def.entities, { flipAlt: false, flipCtrl: false, length, xSign: 1 });
  return createObjectInstance(TAB, name, frame.origin, rotationFromAxisX(hit.tangent), {
    insert: { ...defaultInsertPlacement(w.id, hit.along), flipAlt: false, flipCtrl: false,
      scaleX: frame.scaleX, scaleY: frame.scaleY, scaleZ: frame.scaleZ, xSign: 1 },
  });
}

const tol = 0.05;
for (const [name, len] of [['text_rect_Vide', 1], ['text_rect_Vide', 1.5], ['porte', 0.9]] as const) {
  for (const diag of [false, true]) {
    const w = diag ? wall('m', [0, 0, 0], [3, 3, 0]) : wall('m', [0, 0, 0], [4, 0, 0]);
    const near: Vec3 = diag ? [1, 1, 0] : [1.2, 0.05, 0];
    const ins = insert(w, name, near, len);
    const doc = new CadDocument();
    doc.addEntities([w, ins]);
    assert(collectWallOpenings(doc.entities).length === 1, 'ouverture');
    const tag = `${name} ${len} ${diag ? 'diag' : 'H'}`;

    // Clic au milieu de l’ouverture et sur la face du mur dans l’ouverture
    const ax = diag ? [Math.SQRT1_2, Math.SQRT1_2] : [1, 0];
    const ay = [-ax[1]!, ax[0]!];
    const along = Math.min(len, 0.9) / 2;
    const o = ins.origin;
    for (const off of [0.1, 0, 0.2]) {
      const pt: Vec3 = [o[0] + ax[0]! * along + ay[0]! * off, o[1] + ax[1]! * along + ay[1]! * off, 0];
      const hit = findNearestEntity(pt, doc.entities, tol);
      assert(hit?.entity.id === ins.id, `${tag} : clic offset ${off} → insertion (got ${hit?.entity.kind})`);
    }
    // Loin de l’ouverture → le mur
    const far: Vec3 = diag ? [2.6, 2.6, 0] : [3.5, 0, 0];
    assert(findNearestEntity(far, doc.entities, tol)?.entity.id === 'm', `${tag} : mur hors ouverture`);

    // Effacer l’insertion seule : le mur reste et se referme
    assert(doc.removeEntities([ins.id]) === 1, `${tag} : 1 effacé`);
    assert(doc.entities.length === 1 && doc.entities[0]!.id === 'm', `${tag} : mur conservé`);
    assert(collectWallOpenings(doc.entities).length === 0, `${tag} : mur refermé`);
    doc.undo();
    assert(doc.entities.length === 2 && collectWallOpenings(doc.entities).length === 1, `${tag} : undo rouvre`);
    doc.redo();
    assert(doc.entities.length === 1, `${tag} : redo referme`);
    doc.undo();

    // Effacer le mur : ses insertions partent avec lui (un seul pas)
    assert(doc.removeEntities(['m']) === 2, `${tag} : mur + insertion`);
    assert(doc.entities.length === 0, `${tag} : rien d’orphelin`);
    doc.undo();
    assert(doc.entities.length === 2, `${tag} : undo mur + insertion`);
  }
}

console.log('OK delete insertion');
