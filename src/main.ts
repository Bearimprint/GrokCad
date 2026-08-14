import { AppPrefsManager } from './core/appPrefs';
import { DesignationManager } from './core/designation';
import { DimPrefsManager } from './core/dimPrefs';
import { CadDocument } from './core/document';
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

new StyleBar(styleBarRoot, pen, textPrefs, dimPrefs, dimStyles);

// Unité document = prefs app (sans marquer dirty au démarrage)
doc.setUnits(app.units, { dirty: false });

/** Édition d’un fichier library en cours. */
let libraryEdit: { tab: string; name: string } | null = null;
/** Document principal mis de côté pendant l’édition library. */
let stashedMain: { doc: GkdDocument; filename: string } | null = null;

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
  viewport.setEntities(doc.entities);
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

doc.onChange(syncScene);
syncScene();

function openLibraryEdit(tab: string, name: string, libDoc: GkdDocument): void {
  // Ne pas empiler si déjà en édition d’un autre
  if (!libraryEdit) {
    stashedMain = {
      doc: doc.snapshot(viewport.getCameraState()),
      filename: doc.filename,
    };
  }
  libraryEdit = { tab, name };
  selection.clear();
  designation.clear();
  doc.load(libDoc, `library/${tab}/${name}.gkd`);
  viewport.applyCameraState(libDoc.camera);
  setDocTitle(`✎ library/${tab}/${name}.gkd`);
  cmdBar.setFeedback(
    `Édition library/${tab}/${name}.gkd — /save pour enregistrer · /closelib pour revenir au dessin`,
    'info',
  );
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
  libraryEdit = null;
  selection.clear();
  designation.clear();
  if (stashedMain) {
    doc.load(stashedMain.doc, stashedMain.filename);
    viewport.applyCameraState(stashedMain.doc.camera);
    walls.loadFromDocument(stashedMain.doc.wallLibrary ?? []);
    setDocTitle(stashedMain.filename);
    stashedMain = null;
  } else {
    doc.reset();
    setDocTitle(doc.filename);
  }
  cmdBar.setFeedback('Retour au dessin principal.', 'ok');
}

objLib.setPlaceHandler((tab, name, _d) => {
  tools.startPlaceObject(tab, name);
});

objLib.setEditHandler((tab, name, d) => {
  openLibraryEdit(tab, name, d);
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
