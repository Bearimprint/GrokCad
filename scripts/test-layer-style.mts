/**
 * Attributs de calque, DuCalque, visibilité, sélection par calque.
 */
import { executeLine, type CommandContext } from '../src/commands/registry.ts';
import { DesignationManager } from '../src/core/designation.ts';
import { CadDocument } from '../src/core/document.ts';
import {
  applyLayerEdit,
  DrawLayerManager,
  effectiveStroke,
  effectiveTextStyle,
  entitiesOnVisibleLayers,
  entityIdsOnLayers,
  entityLayerVisible,
  interpretLayerArgs,
  LAYER_DEFAULT_COLOR,
  LAYER_DEFAULT_FONT,
  resolveLayerStyle,
  withLayerPatch,
} from '../src/core/drawLayers.ts';
import { defaultCamera, parseGkd, serializeGkd } from '../src/core/gkd.ts';
import { entitiesInAabb, SelectionManager } from '../src/core/selection.ts';
import { entitiesToSnapCurves } from '../src/core/snap.ts';
import type { LineEntity, TextEntity } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('TEST layer style');

const bare = resolveLayerStyle(4, []);
assert(bare.color === LAYER_DEFAULT_COLOR, 'défaut blanc');
assert(bare.lineWidth === 1, 'défaut 1 px');
assert(bare.lineStyle === 'plein', 'défaut plein');
assert(bare.fontFamily === LAYER_DEFAULT_FONT, 'défaut Tahoma');
assert(bare.fontBold === false && bare.fontItalic === false, 'pas de gras');
assert(bare.visible, 'visible par défaut');
assert(resolveLayerStyle(-2, [{ id: -2, label: 'x', visible: false }]).visible, 'négatif toujours visible');

const legacy = {
  magic: 'GKD1',
  version: '0.24.16',
  modified: new Date().toISOString(),
  camera: {
    target: [0, 0, 0],
    position: [0, 0, 50],
    up: [0, 1, 0],
    mode: 'ortho',
    orthoHalfHeight: 5,
    fov: 50,
    workplane: 'XY',
  },
  entities: [
    {
      id: 'old',
      kind: 'line',
      layer: 'DESSIN',
      start: [0, 0, 0],
      end: [2, 0, 0],
      color: '#112233',
      lineWidth: 3,
      lineStyle: 'tiret',
    },
  ],
  wallLibrary: [],
  objectLibrary: [],
};
const old = parseGkd(JSON.stringify(legacy));
const oldLine = old.entities[0] as LineEntity;
assert(oldLine.color === '#112233', 'ancienne couleur conservée');
assert(!oldLine.byLayer, 'ancien fichier sans DuCalque');
assert(effectiveStroke(oldLine, old.drawLayers).color === '#112233', 'pas d’héritage forcé');
assert(effectiveStroke(oldLine, old.drawLayers).lineWidth === 3, 'épaisseur stockée');
assert(resolveLayerStyle(1, old.drawLayers).color === '#ffffff', 'calque ancien = défauts');

const painted = withLayerPatch([], 2, { color: '#ff0000', lineWidth: 4, fontFamily: 'Georgia' });
const red = resolveLayerStyle(2, painted);
assert(red.color === '#ff0000' && red.lineWidth === 4 && red.fontFamily === 'Georgia', 'patch couleur');

const byLayer: LineEntity = {
  ...oldLine,
  id: 'new',
  drawLayer: 2,
  color: '#000000',
  lineWidth: 1,
  lineStyle: 'plein',
  byLayer: { color: true, width: true, style: true },
};
const eff = effectiveStroke(byLayer, painted);
assert(eff.color === '#ff0000', 'DuCalque couleur');
assert(eff.lineWidth === 4, 'DuCalque épaisseur');
assert(eff.lineStyle === 'plein', 'DuCalque style défaut');

const explicit: LineEntity = { ...byLayer, id: 'ex', byLayer: { width: true }, color: '#00ff00' };
assert(effectiveStroke(explicit, painted).color === '#00ff00', 'couleur explicite prime');
assert(effectiveStroke(explicit, painted).lineWidth === 4, 'épaisseur encore DuCalque');

const text: TextEntity = {
  id: 't',
  kind: 'text',
  layer: 'DESSIN',
  drawLayer: 2,
  position: [0, 0, 0],
  height: 0.2,
  content: 'A',
  rotation: 0,
  color: '#000',
  hAlign: 0,
  vAlign: 0,
  fontFamily: 'Arial',
  byLayer: { font: true, color: true },
};
const fontTable = withLayerPatch(painted, 2, { fontBold: true, fontItalic: true });
const te = effectiveTextStyle(text, fontTable);
assert(te.fontFamily === 'Georgia' && te.bold && te.italic, 'police du calque');
assert(te.color === '#ff0000', 'couleur texte DuCalque');
const pinned = effectiveTextStyle({ ...text, byLayer: undefined, fontFamily: 'Courier' }, fontTable);
assert(pinned.fontFamily === 'Courier' && !pinned.bold, 'police explicite');

const doc = new CadDocument();
doc.setDrawLayers(painted);
doc.addEntity(byLayer);
doc.addEntity({ ...oldLine, id: 'keep', drawLayer: 1 });
const hide = interpretLayerArgs(['masquer', '2']);
assert(hide.ok && hide.edit.kind === 'hide', 'parse masquer');
let applied = applyLayerEdit(doc.drawLayerLabels, doc.currentDrawLayer, hide.edit);
doc.setDrawLayers(applied.table);
assert(!entityLayerVisible(byLayer, doc.drawLayerLabels), 'calque 2 masqué');
assert(entityLayerVisible(oldLine, doc.drawLayerLabels), 'calque 1 reste');
const curves = entitiesToSnapCurves([], doc.entities, 'm', doc.drawLayerLabels);
assert(!curves.some((c) => c.id === 'new'), 'snap ignore le calque masqué');
assert(curves.some((c) => c.id === 'keep'), 'snap garde le calque visible');
const box = { minX: -1, minY: -1, maxX: 5, maxY: 5 };
const picked = entitiesInAabb(entitiesOnVisibleLayers(doc.entities, doc.drawLayerLabels), box);
assert(picked.length === 1 && picked[0]!.id === 'keep', 'fenêtre ignore le masqué');
assert(
  entityIdsOnLayers(doc.entities, [2], doc.drawLayerLabels).length === 0,
  'selcalque ne prend pas le masqué',
);

const blocked = applyLayerEdit(doc.drawLayerLabels, 1, {
  kind: 'hide',
  ids: [1],
});
assert(!blocked.ok && blocked.message.includes('ne peut pas être masqué'), blocked.message);
assert(resolveLayerStyle(1, blocked.table).visible, 'courant toujours visible');

const range = interpretLayerArgs(['masquer', '5-7', '9']);
assert(range.ok && range.edit.kind === 'hide', 'parse plage');
if (range.ok && range.edit.kind === 'hide') {
  assert(range.edit.ids.join(',') === '5,6,7,9', `ids ${range.edit.ids.join(',')}`);
}
const iso = applyLayerEdit([], 1, { kind: 'isolate', id: 4 });
assert(iso.ok && iso.message.includes('reste affiché'), iso.message);
assert(!resolveLayerStyle(3, iso.table).visible, '3 masqué par isoler');
assert(resolveLayerStyle(4, iso.table).visible, '4 isolé');
assert(resolveLayerStyle(1, iso.table).visible, 'courant 1 gardé');

const shown = applyLayerEdit(iso.table, 1, { kind: 'showAll' });
assert(resolveLayerStyle(3, shown.table).visible, 'toutafficher');

doc.assignDrawLayer(['keep'], 6);
const moved = doc.entities.find((e) => e.id === 'keep');
assert(moved?.drawLayer === 6, 'verscalque');

const round = parseGkd(serializeGkd(doc.snapshot(defaultCamera())));
const layer2 = (round.drawLayers ?? []).find((l) => l.id === 2);
assert(layer2?.color === '#ff0000', `couleur sauvée (${layer2?.color})`);
assert(layer2?.visible === false, 'masquage sauvé');
const keptColor = round.entities.find((e) => e.id === 'old' || e.id === 'keep');
assert(keptColor && 'color' in keptColor && keptColor.color === '#112233', 'couleur entité inchangée au roundtrip');

function lineOn(id: string, layer: number): LineEntity {
  return {
    id,
    kind: 'line',
    layer: 'DESSIN',
    drawLayer: layer,
    start: [0, 0, 0],
    end: [1, 0, 0],
    color: '#ffffff',
    lineWidth: 1,
    lineStyle: 'plein',
  };
}

function commandCtx(
  doc: CadDocument,
  selection: SelectionManager,
  layers: DrawLayerManager,
): CommandContext {
  return {
    doc,
    selection,
    layers,
    tools: { isActive: false },
    viewport: { clearSnap() {} },
    feedback() {},
  } as unknown as CommandContext;
}

const hiddenDoc = new CadDocument();
hiddenDoc.addEntity(lineOn('hid', 3));
hiddenDoc.addEntity(lineOn('vis', 1));
const hiddenSel = new SelectionManager();
const hiddenDes = new DesignationManager();
hiddenSel.set(['hid', 'vis']);
hiddenDes.set(['hid', 'vis']);
const hiddenLayers = new DrawLayerManager(hiddenDoc);
hiddenLayers.bindPicks(hiddenSel, hiddenDes);
const hiddenCtx = commandCtx(hiddenDoc, hiddenSel, hiddenLayers);
await executeLine('/calques masquer 3', hiddenCtx);
assert(hiddenDoc.entities.some((e) => e.id === 'hid'), 'masquer n’efface pas');
assert(!hiddenSel.has('hid') && hiddenSel.has('vis'), 'masquer retire seulement le calque masqué');
assert(!hiddenDes.has('hid') && hiddenDes.has('vis'), 'désignation retire le calque masqué');
await executeLine('/delete', hiddenCtx);
assert(hiddenDoc.entities.some((e) => e.id === 'hid'), '/delete n’efface rien sur le calque masqué');
assert(!hiddenDoc.entities.some((e) => e.id === 'vis'), '/delete efface encore la sélection visible');

const boxDoc = new CadDocument();
boxDoc.addEntity(lineOn('box', 4));
const boxSel = new SelectionManager();
const boxDes = new DesignationManager();
boxSel.set(['box']);
boxDes.set(['box']);
const boxLayers = new DrawLayerManager(boxDoc);
boxLayers.bindPicks(boxSel, boxDes);
const boxHide = boxLayers.setVisible(4, false);
assert(boxHide.ok, boxHide.message);
assert(!boxSel.has('box') && !boxDes.has('box'), 'case du dialogue retire sélection et désignation');

const isoDoc = new CadDocument();
isoDoc.addEntity(lineOn('other', 5));
isoDoc.addEntity(lineOn('cur', 1));
const isoSel = new SelectionManager();
const isoDes = new DesignationManager();
isoSel.set(['other', 'cur']);
isoDes.set(['other', 'cur']);
const isoLayers = new DrawLayerManager(isoDoc);
isoLayers.bindPicks(isoSel, isoDes);
await executeLine('/calques isoler 4', commandCtx(isoDoc, isoSel, isoLayers));
assert(!isoSel.has('other') && !isoDes.has('other'), 'isoler retire les calques masqués');
assert(isoSel.has('cur') && isoDes.has('cur'), 'isoler garde le calque courant');

const moveDoc = new CadDocument();
moveDoc.setDrawLayers(withLayerPatch([], 6, { visible: false }));
moveDoc.addEntity(lineOn('moved', 1));
const moveSel = new SelectionManager();
const moveDes = new DesignationManager();
moveSel.set(['moved']);
moveDes.set(['moved']);
const moveLayers = new DrawLayerManager(moveDoc);
moveLayers.bindPicks(moveSel, moveDes);
await executeLine('/verscalque 6', commandCtx(moveDoc, moveSel, moveLayers));
assert(moveDoc.entities.find((e) => e.id === 'moved')?.drawLayer === 6, 'verscalque vers 6');
assert(!moveSel.has('moved') && !moveDes.has('moved'), 'verscalque masqué retire sélection et désignation');
await executeLine('/delete', commandCtx(moveDoc, moveSel, moveLayers));
assert(moveDoc.entities.some((e) => e.id === 'moved'), '/delete après verscalque masqué n’efface rien');

console.log('OK layer style');
