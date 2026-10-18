import { AppPrefsManager } from './core/appPrefs';
import { DesignationManager } from './core/designation';
import { DimPrefsManager } from './core/dimPrefs';
import { CadDocument } from './core/document';
import { runSave } from './commands/registry';
import { DrawLayerManager, isInsertionsTab, resolveLayerStyle } from './core/drawLayers';
import { fsRead } from './core/fsClient';
import { createEmptyDocument, parseGkd } from './core/gkd';
import { onHatchCacheChange } from './core/hatchCache';
import { HatchPrefsManager } from './core/hatchPrefs';
import { objectDefCache } from './core/objectCache';
import { PenManager } from './core/penPrefs';
import { SelectionManager } from './core/selection';
import { SelectionSlots } from './core/selectionSlots';
import { TextPrefsManager } from './core/textPrefs';
import { DrawingTools } from './core/tools';
import type { GkdDocument, Workplane } from './core/types';
import { APP_VERSION } from './core/types';
import { convertFactor } from './core/units';
import { WallLibraryManager } from './core/wallPrefs';
import { CommandBar } from './ui/CommandBar';
import { DimStyleDialog } from './ui/DimStyleDialog';
import { HatchLibraryDialog } from './ui/HatchLibraryDialog';
import { InsertLayerRail } from './ui/InsertLayerRail';
import { LayersDialog } from './ui/LayersDialog';
import { ObjectLibraryDialog } from './ui/ObjectLibraryDialog';
import { SettingsDialog } from './ui/SettingsDialog';
import { StyleBar } from './ui/StyleBar';
import { WallLibraryDialog } from './ui/WallLibraryDialog';
import { Viewport } from './viewport/Viewport';

function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} manquant dans le DOM`);
  return n as T;
}

const canvas = el<HTMLCanvasElement>('viewport');
const cmdInput = el<HTMLInputElement>('cmd-input');
const cmdFeedback = el<HTMLElement>('cmd-feedback');
const docTitle = el<HTMLElement>('doc-title');
const statScale = el<HTMLElement>('stat-scale');
const statMouse = el<HTMLElement>('stat-mouse');
const statView = el<HTMLElement>('stat-view');
const statGrid = el<HTMLButtonElement>('stat-grid');
const statGridSnap = el<HTMLButtonElement>('stat-gridsnap');
const workplaneBadge = el<HTMLElement>('workplane-badge');
const styleBarRoot = el<HTMLElement>('style-bar');

// Marque + version courante (titlebar)
const brandLogo = document.querySelector<HTMLElement>('#titlebar .logo');
if (brandLogo) {
  brandLogo.textContent = `GrokCad v.${APP_VERSION}`;
}
document.title = `GrokCad v.${APP_VERSION}`;

const doc = new CadDocument();
const pen = new PenManager();
pen.setLayerSource(() => {
  const s = resolveLayerStyle(doc.currentDrawLayer, doc.drawLayerLabels);
  return { color: s.color, lineWidth: s.lineWidth, lineStyle: s.lineStyle };
});
const app = new AppPrefsManager();
const textPrefs = new TextPrefsManager();
const dimPrefs = new DimPrefsManager();
const walls = new WallLibraryManager();
const hatch = new HatchPrefsManager();
const selection = new SelectionManager();
const designation = new DesignationManager();
const selectionSlots = new SelectionSlots();

doc.setWallLibrary(walls.toDocumentLibrary());

const viewport = new Viewport(canvas, {
  setScale: (t) => {
    statScale.textContent = t;
  },
  setMouse: (t) => {
    statMouse.textContent = t;
  },
  setView: (t) => {
    statView.textContent = t;
  },
  setWorkplane: (wp: Workplane) => {
    workplaneBadge.textContent = wp;
  },
});
viewport.setAppPrefs(app);

const tools = new DrawingTools(doc, viewport, pen);
window.addEventListener('beforeunload', () => {
  tools.dispose();
});
tools.setWallLibrary(walls);
tools.setHatchPrefs(hatch);
tools.setSelection(selection);
tools.setDesignation(designation);
tools.setTextPrefs(textPrefs);
tools.setDimPrefs(dimPrefs);

const settings = new SettingsDialog(app, pen, textPrefs);
const dimStyles = new DimStyleDialog(dimPrefs, pen);
const wallLib = new WallLibraryDialog(walls, pen);
const objLib = new ObjectLibraryDialog();
const hatchLib = new HatchLibraryDialog(hatch);
const layers = new DrawLayerManager(doc);
layers.bindPicks(selection, designation);
const layersDialog = new LayersDialog(layers);

new StyleBar(styleBarRoot, pen, textPrefs, dimPrefs, dimStyles, layers, layersDialog);

const viewportWrap = el<HTMLElement>('viewport-wrap');
const viewportStage = el<HTMLElement>('viewport-stage');
const insertRail = new InsertLayerRail(el<HTMLElement>('insert-layer-rail'), layers);

function applyInsertRailSide(): void {
  viewportWrap.classList.toggle('rail-right', app.insertLayerRailSide === 'right');
  viewport.resizeNow();
}
applyInsertRailSide();
app.onChange(() => applyInsertRailSide());

// Unité document = prefs app (sans marquer dirty au démarrage)
doc.setUnits(app.units, { dirty: false });

/** Édition d’un fichier library en cours. */
let libraryEdit: {
  tab: string;
  name: string;
  insertion?: boolean;
  returnPath?: string | null;
} | null = null;
/** Document principal mis de côté pendant l’édition library. */
let stashedMain: {
  doc: GkdDocument;
  filename: string;
  filePath: string | null;
} | null = null;

walls.onChange(() => {
  doc.setWallLibrary(walls.toDocumentLibrary());
});

selection.onChange((ids) => {
  viewport.setSelectedIds(ids);
});

designation.onChange((ids) => {
  viewport.setDesignatedIds(ids);
});

// Re-rendu quand une def library change (save / invalidation)
objectDefCache.onChange(() => {
  viewport.setEntities(doc.entities);
  viewport.setSelectedIds(selection.selectedIds);
  viewport.setDesignatedIds(designation.designatedIds);
});

// Re-rendu quand un motif hachure est chargé (async)
onHatchCacheChange(() => {
  viewport.setEntities(doc.entities);
  viewport.setSelectedIds(selection.selectedIds);
  viewport.setDesignatedIds(designation.designatedIds);
});

function setDocTitle(name: string): void {
  docTitle.textContent = name;
}

function syncScene(): void {
  viewport.setHelpers(doc.helpers);
  viewport.setEntities(doc.entities, doc.drawLayerLabels);
  viewport.setSelectedIds(selection.selectedIds);
  viewport.setDesignatedIds(designation.designatedIds);
  // Charger en arrière-plan les defs manquantes
  for (const e of doc.entities) {
    if (e.kind === 'object') {
      void objectDefCache.ensure(e.libTab, e.libName).then((d) => {
        if (d) {
          viewport.setEntities(doc.entities);
          viewport.setSelectedIds(selection.selectedIds);
          viewport.setDesignatedIds(designation.designatedIds);
        }
      });
    }
  }
}

doc.onChange(() => {
  layers.notifyDocChanged();
  syncScene();
});
syncScene();

function setInsertCanvasUi(on: boolean): void {
  viewportStage.classList.toggle('insert-edit', on);
  if (on) {
    applyInsertRailSide();
    insertRail.show();
  } else {
    insertRail.hide();
  }
  viewport.resizeNow();
}

async function ensureMainDrawingSaved(): Promise<boolean> {
  if (libraryEdit) return true;
  return runSave(cmdBar.context, { forceDialog: !doc.filePath });
}

async function enterInsertCanvas(
  tab: string,
  name: string,
  libDoc: GkdDocument,
): Promise<void> {
  const saved = await ensureMainDrawingSaved();
  if (!saved) {
    cmdBar.setFeedback('Création / modification annulée (dessin non enregistré).', 'warn');
    return;
  }
  if (!libraryEdit) {
    stashedMain = {
      doc: doc.snapshot(viewport.getCameraState()),
      filename: doc.filename,
      filePath: doc.filePath,
    };
  }
  libraryEdit = {
    tab,
    name,
    insertion: true,
    returnPath: doc.filePath,
  };
  selection.clear();
  designation.clear();
  doc.load(libDoc, `library/${tab}/${name || 'nouveau'}.gkd`);
  layers.setInsertMode(true);
  layers.notifyDocChanged();
  setInsertCanvasUi(true);
  viewport.applyCameraState(libDoc.camera);
  setDocTitle(`✎ library/${tab}/${name || '(nouveau)'}.gkd`);
  cmdBar.setFeedback(
    `Canvas d’insertion library/${tab}/ — calques spéciaux à ${app.insertLayerRailSide === 'right' ? 'droite' : 'gauche'}. /save enregistre l’objet (ancre −9 obligatoire) et rouvre le dessin.`,
    'info',
  );
}

function openLibraryEdit(tab: string, name: string, libDoc: GkdDocument): void {
  if (isInsertionsTab(tab)) {
    void enterInsertCanvas(tab, name, libDoc);
    return;
  }
  if (!libraryEdit) {
    stashedMain = {
      doc: doc.snapshot(viewport.getCameraState()),
      filename: doc.filename,
      filePath: doc.filePath,
    };
  }
  libraryEdit = { tab, name };
  selection.clear();
  designation.clear();
  doc.load(libDoc, `library/${tab}/${name}.gkd`);
  layers.setInsertMode(false);
  layers.notifyDocChanged();
  setInsertCanvasUi(false);
  viewport.applyCameraState(libDoc.camera);
  setDocTitle(`✎ library/${tab}/${name}.gkd`);
  cmdBar.setFeedback(
    `Édition library/${tab}/${name}.gkd — /save pour enregistrer · /closelib pour revenir au dessin`,
    'info',
  );
}

async function restoreMainDrawing(): Promise<void> {
  const returnPath = libraryEdit?.returnPath ?? stashedMain?.filePath ?? null;
  libraryEdit = null;
  selection.clear();
  designation.clear();
  layers.setInsertMode(false);
  setInsertCanvasUi(false);
  if (returnPath) {
    try {
      const { content, name } = await fsRead(returnPath);
      const loaded = parseGkd(content);
      doc.load(loaded, name, returnPath);
      viewport.applyCameraState(loaded.camera);
      walls.loadFromDocument(loaded.wallLibrary ?? []);
      setDocTitle(name);
      stashedMain = null;
      layers.notifyDocChanged();
      cmdBar.setFeedback('Retour au dessin principal.', 'ok');
      return;
    } catch (e) {
      cmdBar.setFeedback(
        `Impossible de rouvrir ${returnPath} : ${e instanceof Error ? e.message : String(e)}`,
        'warn',
      );
    }
  }
  if (stashedMain) {
    doc.load(stashedMain.doc, stashedMain.filename, stashedMain.filePath);
    viewport.applyCameraState(stashedMain.doc.camera);
    walls.loadFromDocument(stashedMain.doc.wallLibrary ?? []);
    setDocTitle(stashedMain.filename);
    stashedMain = null;
  } else {
    doc.reset();
    setDocTitle(doc.filename);
  }
  layers.notifyDocChanged();
  cmdBar.setFeedback('Retour au dessin principal.', 'ok');
}

function closeLibraryEdit(): void {
  if (!libraryEdit) {
    cmdBar.setFeedback('Pas d’édition library en cours.', 'warn');
    return;
  }
  if (doc.dirty) {
    const ok = window.confirm(
      'Modifications non enregistrées dans la library. Fermer quand même ?',
    );
    if (!ok) return;
  }
  void restoreMainDrawing();
}

objLib.setPlaceHandler((tab, name, _d) => {
  tools.startPlaceObject(tab, name);
});

objLib.setEditHandler((tab, name, d) => {
  openLibraryEdit(tab, name, d);
});

objLib.setCreateInsertHandler((tab) => {
  const empty = createEmptyDocument('insertion');
  void enterInsertCanvas(tab, '', empty);
});

objLib.setInsertBrowseHandler((open) => {
  layers.setLibraryInsertOpen(open);
});

hatchLib.setEditHandler((name, d) => {
  openLibraryEdit('hatch', name, d);
});

const cmdBar = new CommandBar(
  cmdInput,
  cmdFeedback,
  doc,
  viewport,
  pen,
  tools,
  app,
  settings,
  walls,
  wallLib,
  objLib,
  hatch,
  hatchLib,
  selection,
  selectionSlots,
  textPrefs,
  dimPrefs,
  dimStyles,
  layers,
  layersDialog,
  setDocTitle,
);

// Changement d’unité : convertit la géométrie pour rester cohérent
settings.setUnitsChangeHandler((prev, next) => {
  const f = convertFactor(prev, next);
  doc.scaleWorld(f);
  doc.setUnits(next);
  walls.scaleOffsets(f);
  viewport.applyCameraState(doc.camera);
  cmdBar.setFeedback(
    `Unité → ${next} (géométrie ×${f === 1 ? '1' : f.toPrecision(4)}). Grille = ${app.gridSpacingMeters} m réel.`,
    'ok',
  );
});

// Hooks édition library dans le contexte commandes
cmdBar.context.getLibraryEdit = () => libraryEdit;
cmdBar.context.closeLibraryEdit = closeLibraryEdit;
cmdBar.context.finishInsertSession = restoreMainDrawing;
cmdBar.context.onMissingInsertAnchor = () => {
  layers.setInsertMode(true);
  layers.forceAnchorLayer();
  setInsertCanvasUi(true);
  cmdBar.setFeedback(
    'Calque −9 (point d’ancrage) activé — placez un point, puis /save.',
    'warn',
  );
};

function renderGridChip(
  btn: HTMLButtonElement,
  label: string,
  on: boolean,
): void {
  btn.replaceChildren();
  btn.append(`${label} `);
  const st = document.createElement('span');
  st.className = `grid-state ${on ? 'on' : 'off'}`;
  st.textContent = on ? 'ON' : 'OFF';
  btn.append(st);
}

function syncGridStatus(): void {
  const vis = app.gridVisible;
  renderGridChip(statGrid, 'Grid', vis);
  statGrid.setAttribute('aria-pressed', vis ? 'true' : 'false');

  // Snap jamais affiché ON si la grille est cachée (texte grisé, non cliquable)
  const snapOn = vis && app.gridSnap;
  renderGridChip(statGridSnap, 'Grid Snap', snapOn);
  statGridSnap.disabled = !vis;
  statGridSnap.setAttribute('aria-pressed', snapOn ? 'true' : 'false');
  statGridSnap.title = vis
    ? 'Accroche sur la grille au clic droit (/gridsnap on|off)'
    : 'Grid Snap indisponible tant que la grille est cachée';
}

syncGridStatus();
app.onChange(syncGridStatus);

statGrid.addEventListener('click', () => {
  const on = app.toggleGridVisible();
  cmdBar.setFeedback(on ? 'Grid ON' : 'Grid OFF', 'ok');
});

statGridSnap.addEventListener('click', () => {
  const r = app.toggleGridSnap();
  if (!r.ok) {
    cmdBar.setFeedback(r.error, 'err');
    return;
  }
  cmdBar.setFeedback(r.enabled ? 'Grid Snap ON' : 'Grid Snap OFF', 'ok');
});

setDocTitle(doc.filename);
cmdBar.setFeedback(
  `GrokCAD ${APP_VERSION} — /text · /rect · /textbox · /cote · /help`,
  'info',
);

queueMicrotask(() => cmdBar.focus());

if (import.meta.env.DEV) {
  (window as unknown as { grokcad: unknown }).grokcad = {
    doc,
    viewport,
    pen,
    tools,
    app,
    settings,
    walls,
    wallLib,
    objLib,
    hatch,
    hatchLib,
    textPrefs,
    dimPrefs,
    dimStyles,
    selection,
    designation,
    selectionSlots,
    objectDefCache,
  };
}
