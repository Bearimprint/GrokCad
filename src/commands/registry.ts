import type { AppPrefsManager } from '../core/appPrefs';
import type { CadDocument } from '../core/document';
import {
  arcFrom3Points,
  arcFromCenterStartEnd,
  createCircleEntity,
  createLineEntity,
  createPointEntity,
  isDegenerateLine,
  isDegenerateRadius,
} from '../core/drawing';
import {
  ensureDxfName,
  ensureGkdName,
  parseDxf,
  serializeDxf,
  stripExt,
} from '../core/dxf';
import {
  basename,
  dirname,
  fsAvailable,
  fsExists,
  fsRead,
  fsWrite,
  joinPath,
} from '../core/fsClient';
import { downloadGkd, parseGkd, serializeGkd } from '../core/gkd';
import { objectDefCache } from '../core/objectCache';
import { saveLibraryObject } from '../core/objectLibrary';
import {
  createAxesHelpers,
  helperParallelX,
  helperParallelY,
  helperParallelZ,
  helperPerpendicularTo,
} from '../core/helpers';
import { clearHatchFromPolyline } from '../core/fill';
import { parseLinePath } from '../core/linePath';
import { parseParalDeltas } from '../core/paral';
import { createPolylineFromPoints } from '../core/polyline';
import type { PenManager } from '../core/penPrefs';
import type { DrawingTools } from '../core/tools';
import type { TextPrefsManager } from '../core/textPrefs';
import type { DimPrefsManager } from '../core/dimPrefs';
import type { Entity, GkdDocument, Vec3 } from '../core/types';
import type { SelectionManager } from '../core/selection';
import { showConfirm } from '../ui/ConfirmDialog';
import {
  pickDestinationDir,
  pickSaveFilePath,
  pickSourceFiles,
} from '../ui/FileBrowserDialog';
import type { SettingsDialog } from '../ui/SettingsDialog';
import type { ObjectLibraryDialog } from '../ui/ObjectLibraryDialog';
import type { WallLibraryDialog } from '../ui/WallLibraryDialog';
import type { HatchPrefsManager } from '../core/hatchPrefs';
import type { WallLibraryManager } from '../core/wallPrefs';
import type { HatchLibraryDialog } from '../ui/HatchLibraryDialog';
import type { DimStyleDialog } from '../ui/DimStyleDialog';
import { showTextInputDialog } from '../ui/TextInputDialog';
import type { Viewport } from '../viewport/Viewport';

export type FeedbackLevel = 'ok' | 'err' | 'warn' | 'info';

export interface CommandContext {
  doc: CadDocument;
  viewport: Viewport;
  pen: PenManager;
  tools: DrawingTools;
  app: AppPrefsManager;
  settings: SettingsDialog;
  walls: WallLibraryManager;
  wallLib: WallLibraryDialog;
  objLib: ObjectLibraryDialog;
  hatch: HatchPrefsManager;
  hatchLib: HatchLibraryDialog;
  selection: SelectionManager;
  textPrefs: TextPrefsManager;
  dimPrefs: DimPrefsManager;
  dimStyles: DimStyleDialog;
  feedback: (msg: string, level?: FeedbackLevel) => void;
  setDocTitle: (name: string) => void;
  focusCommand: () => void;
  /** Édition library en cours (tab/name) ou null. */
  getLibraryEdit?: () => { tab: string; name: string } | null;
  /** Ferme l’édition library et restaure le dessin. */
  closeLibraryEdit?: () => void;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  summary: string;
  usage?: string;
  run: (ctx: CommandContext, args: string[]) => void | Promise<void>;
}

const commands: CommandDef[] = [
  {
    name: 'help',
    aliases: ['?', 'h'],
    summary: 'Ouvre HELP.md avec le visualiseur par défaut de l’OS',
    run: async (ctx) => {
      try {
        const r = await fetch('/api/help/open', { method: 'POST' });
        const data = (await r.json()) as { ok?: boolean; error?: string; path?: string };
        if (!r.ok || !data.ok) {
          ctx.feedback(
            `Impossible d’ouvrir l’aide : ${data.error ?? r.statusText}. Ouvrez HELP.md manuellement.`,
            'err',
          );
          return;
        }
        ctx.feedback(
          `Aide ouverte dans le visualiseur système (${data.path ?? 'HELP.md'}).`,
          'ok',
        );
      } catch (e) {
        ctx.feedback(
          `Impossible d’ouvrir l’aide (serveur dev requis) : ${e instanceof Error ? e.message : String(e)}`,
          'err',
        );
      }
    },
  },

  // —— Navigation ——
  {
    name: 'pan',
    summary: 'Décalage de vue en mètres (le glisser-gauche panne déjà par défaut)',
    usage: '<dx> <dy>',
    run: (ctx, args) => {
      if (args.length >= 2) {
        const dx = Number(args[0]);
        const dy = Number(args[1]);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          ctx.feedback('Usage : /pan <dx> <dy>  (mètres)', 'err');
          return;
        }
        ctx.viewport.panByWorld(dx, dy);
        ctx.doc.setCamera(ctx.viewport.getCameraState());
        ctx.feedback(`Pan ${dx} m, ${dy} m`, 'ok');
        return;
      }
      ctx.feedback(
        'Pan souris : glisser bouton gauche (ou milieu). Commande : /pan <dx> <dy> en mètres.',
        'info',
      );
    },
  },
  {
    name: 'zoom',
    summary: 'Zoom (facteur >1 éloigne, <1 rapproche)',
    usage: '<facteur>',
    run: (ctx, args) => {
      const f = Number(args[0]);
      if (!Number.isFinite(f) || f <= 0) {
        ctx.feedback('Usage : /zoom <facteur>  (ex. /zoom 0.5 ou /zoom 2)', 'err');
        return;
      }
      ctx.viewport.zoomBy(f);
      ctx.doc.setCamera(ctx.viewport.getCameraState());
      ctx.feedback(`Zoom ×${f}`, 'ok');
    },
  },
  {
    name: 'center',
    aliases: ['centrer', 'fit', 'extents', 'ze', 'zoomextents'],
    summary:
      'Cadre tout le dessin dans le canvas (X,Y,Z) selon la vue courante (plan/axo/persp…)',
    run: (ctx) => {
      const res = ctx.viewport.fitToDrawing(ctx.doc.entities);
      if (!res.ok) {
        ctx.feedback(
          'Rien à cadrer : aucun élément de dessin (lignes, arcs, cercles, murs, objets). Les aides infinies sont ignorées.',
          'warn',
        );
        return;
      }
      ctx.doc.setCamera(ctx.viewport.getCameraState());
      const cam = ctx.viewport.getCameraState();
      ctx.feedback(
        cam.mode === 'ortho'
          ? `Vue centrée — emprise complète (halfH=${cam.orthoHalfHeight.toFixed(3)} m, ${cam.workplane}/${cam.mode}).`
          : `Vue centrée — emprise complète (${cam.mode}, ${cam.workplane}).`,
        'ok',
      );
    },
  },
  {
    name: 'axo',
    aliases: ['axonometrie', 'iso', 'isometrique'],
    summary: 'Vue axonométrique isométrique (ortho, Z-up). F10 = pivoter 45°',
    run: (ctx) => {
      ctx.viewport.setAxonometricView();
      ctx.doc.setCamera(ctx.viewport.getCameraState());
      const c = ctx.viewport.getCameraState();
      ctx.feedback(
        `Vue axonométrique (iso) — halfH=${c.orthoHalfHeight.toFixed(3)} m · F10 = +45° autour de Z`,
        'ok',
      );
    },
  },
  {
    name: 'pers',
    aliases: ['persp', 'perspective'],
    summary: 'Vue perspective (conserve la direction de vue). F10 = pivoter 45°',
    run: (ctx) => {
      ctx.viewport.setPerspectiveView();
      ctx.doc.setCamera(ctx.viewport.getCameraState());
      ctx.feedback(
        'Vue perspective — F10 = +45° autour de Z (vertical monde)',
        'ok',
      );
    },
  },
  {
    name: 'plan',
    aliases: ['top', 'dessus'],
    summary: 'Vue en plan XY (dessus, ortho). F10 = pivoter 45°',
    run: (ctx) => {
      ctx.viewport.setPlanView();
      ctx.doc.setCamera(ctx.viewport.getCameraState());
      const c = ctx.viewport.getCameraState();
      ctx.feedback(
        `Vue en plan XY — halfH=${c.orthoHalfHeight.toFixed(3)} m · F10 = +45°`,
        'ok',
      );
    },
  },
  {
    name: 'view',
    summary: 'Affiche la position caméra courante',
    run: (ctx) => {
      const c = ctx.viewport.getCameraState();
      ctx.feedback(
        `cam pos=(${c.position.map(r3).join(', ')}) target=(${c.target.map(r3).join(', ')}) halfH=${c.orthoHalfHeight.toFixed(3)} ${c.mode}/${c.workplane}`,
        'info',
      );
    },
  },

  // —— Fichier ——
  {
    name: 'new',
    aliases: ['nouveau'],
    summary: 'Nouveau dessin vide',
    run: (ctx) => {
      ctx.doc.reset();
      // Conserve la biblio murs (localStorage) dans le nouveau doc
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.viewport.applyCameraState(ctx.doc.camera);
      ctx.setDocTitle(ctx.doc.filename);
      ctx.feedback('Nouveau document (biblio murs conservée).', 'ok');
    },
  },
  {
    name: 'save',
    aliases: ['sauver', 'enregistrer'],
    summary:
      'Enregistrer le .GKD (Ctrl+S). Si déjà un chemin : écrit direct ; sinon dialogue comme /saveas',
    usage: '',
    run: async (ctx) => {
      await runSave(ctx, { forceDialog: false });
    },
  },
  {
    name: 'saveas',
    aliases: ['enregistrer_sous', 'sauveras', 'save_as'],
    summary:
      'Enregistrer sous… — dialogue emplacement + nom (devient le chemin pour les prochains /save)',
    usage: '[nom_suggéré]',
    run: async (ctx, args) => {
      await runSave(ctx, {
        forceDialog: true,
        suggestedName: args[0],
      });
    },
  },
  {
    name: 'open',
    aliases: ['ouvrir'],
    summary:
      'Ouvrir un fichier .GKD (restaure la caméra ; démarre dans le dernier dossier ouvert)',
    run: async (ctx) => {
      try {
        const result = await pickGkdOpen(ctx.app.lastOpenDir ?? undefined);
        if (!result) {
          ctx.feedback('Ouverture annulée.', 'warn');
          return;
        }
        ctx.doc.load(result.doc, result.name, result.path);
        ctx.walls.loadFromDocument(result.doc.wallLibrary ?? []);
        ctx.viewport.applyCameraState(result.doc.camera);
        ctx.setDocTitle(result.name);
        if (result.path) {
          ctx.app.rememberFile(result.path);
        }
        // Précharger les définitions des instances d'objets
        const objs = result.doc.entities.filter((e) => e.kind === 'object');
        for (const o of objs) {
          if (o.kind === 'object') void objectDefCache.ensure(o.libTab, o.libName);
        }
        const nh = ctx.doc.helpers.length;
        const nw = ctx.doc.entities.filter((e) => e.kind === 'wall').length;
        const nStyles = result.doc.wallLibrary?.length ?? 0;
        const no = objs.length;
        ctx.feedback(
          `Ouvert : ${result.name}  (v${result.doc.version}, ${nh} aide(s), ${nw} mur(s), ${nStyles} style(s), ${no} objet(s), caméra restaurée)`,
          'ok',
        );
      } catch (e) {
        ctx.feedback(e instanceof Error ? e.message : String(e), 'err');
      }
    },
  },
  {
    name: 'openlast',
    aliases: ['ouvrirdernier', 'last', 'reopen', 'dernier'],
    summary:
      'Ouvre le dernier fichier ouvert / enregistré (historique de 7, sans doublon)',
    run: async (ctx) => {
      await runOpenLast(ctx);
    },
  },
  {
    name: 'dxfin',
    aliases: ['dxfimport', 'importdxf'],
    summary:
      'Import DXF → .GKD : fichier(s) ou répertoire (récursif) ; .gkd à côté de chaque .dxf si dossier',
    run: async (ctx) => {
      try {
        ctx.tools.cancel(false);
        const src = await pickSourceFiles(
          'Import DXF — fichier(s) .dxf ou répertoire (+ sous-dossiers)',
          ['.dxf'],
        );
        if (!src) {
          ctx.feedback('Import DXF annulé.', 'warn');
          return;
        }

        /**
         * Répertoire source : parcours récursif déjà fait ;
         * chaque .gkd est écrit dans le même dossier que son .dxf.
         * Fichiers choisis un par un : destination unique demandée.
         */
        let destDir: string | null = null;
        const besideSource = src.wholeDirectory;
        if (!besideSource) {
          destDir = await pickDestinationDir(
            'Import DXF — dossier de destination des .GKD',
            src.directory,
          );
          if (!destDir) {
            ctx.feedback('Import DXF annulé (pas de destination).', 'warn');
            return;
          }
        }

        const units = ctx.doc.units;
        let ok = 0;
        let skipped = 0; // .gkd déjà présent (même nom)
        let fail = 0;
        const warnings: string[] = [];
        const total = src.files.length;

        for (const filePath of src.files) {
          try {
            const name = basename(filePath);
            const base = stripExt(name);
            const outName = ensureGkdName(base);
            const outPath = besideSource
              ? joinPath(dirname(filePath), outName)
              : joinPath(destDir!, outName);

            // Ne pas écraser un .gkd déjà existant
            if (await fsExists(outPath)) {
              skipped += 1;
              continue;
            }

            const { content } = await fsRead(filePath);
            const imported = parseDxf(content, { title: base, units });
            warnings.push(...imported.warnings);
            await fsWrite(outPath, serializeGkd(imported.doc));
            ok += 1;
          } catch (e) {
            fail += 1;
            warnings.push(
              `${basename(filePath)} : ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        const destHint = besideSource
          ? `à côté de chaque .dxf sous ${src.directory}`
          : destDir!;
        const skipHint = skipped > 0 ? ` · ${skipped} déjà existant(s)` : '';
        const failHint = fail > 0 ? ` · ${fail} échec(s)` : '';
        const wHint =
          warnings.length > 0
            ? ` · ${warnings.length} avertissement(s)`
            : '';
        ctx.feedback(
          `DXFIN : ${total} trouvé(s) · ${ok} converti(s)${skipHint}${failHint} → ${destHint}${wHint}`,
          fail && !ok ? 'err' : ok || skipped ? 'ok' : 'warn',
        );
        if (warnings.length > 0 && warnings.length <= 5) {
          for (const w of warnings) ctx.feedback(w, 'warn');
        }

        // Fenêtre de fin : statistiques claires
        const lines: string[] = ['Conversion terminée.', ''];
        lines.push(
          total === 1
            ? '1 fichier .dxf trouvé'
            : `${total} fichiers .dxf trouvés`,
        );
        lines.push(
          ok === 1
            ? '1 réellement converti'
            : `${ok} réellement convertis`,
        );
        if (skipped > 0) {
          lines.push(
            skipped === 1
              ? '1 non converti (déjà existant)'
              : `${skipped} non convertis (déjà existants)`,
          );
        }
        if (fail > 0) {
          lines.push(
            fail === 1 ? '1 échec' : `${fail} échecs`,
          );
        }
        if (ok === 0 && skipped === total && total > 0) {
          // Cas « tout déjà fait » : message encore plus direct
          lines[0] =
            total === 1
              ? 'Rien à convertir : le .gkd existe déjà.'
              : 'Rien à convertir : tous les .gkd existent déjà.';
        }

        await showConfirm({
          title: 'DXFIN',
          message: lines.join('\n'),
          buttons: [{ id: 'ok', label: 'Ok', primary: true }],
        });
      } catch (e) {
        ctx.feedback(
          e instanceof Error ? e.message : String(e),
          'err',
        );
      }
    },
  },
  {
    name: 'dxfout',
    aliases: ['dxfexport', 'exportdxf'],
    summary:
      'Export .GKD → DXF : choisir fichier(s) ou répertoire .gkd, puis dossier de destination',
    run: async (ctx) => {
      try {
        ctx.tools.cancel(false);
        const src = await pickSourceFiles(
          'Export DXF — choisir fichier(s) .gkd ou un répertoire',
          ['.gkd'],
        );
        if (!src) {
          ctx.feedback('Export DXF annulé.', 'warn');
          return;
        }
        const destDir = await pickDestinationDir(
          'Export DXF — dossier de destination des .dxf',
          src.directory,
        );
        if (!destDir) {
          ctx.feedback('Export DXF annulé (pas de destination).', 'warn');
          return;
        }

        let ok = 0;
        let fail = 0;
        const warnings: string[] = [];

        for (const filePath of src.files) {
          try {
            const { content, name } = await fsRead(filePath);
            const doc = parseGkd(content);
            // Précharger les objets library pour explosion à l’export
            await ensureObjectDefs(doc);
            const base = stripExt(name);
            const { text, warnings: w, entityCount } = serializeDxf(doc, {
              title: base,
            });
            warnings.push(...w);
            if (entityCount === 0) {
              warnings.push(`${name} : aucune entité exportable`);
            }
            const outName = ensureDxfName(base);
            const outPath = joinPath(destDir, outName);
            await fsWrite(outPath, text);
            ok += 1;
          } catch (e) {
            fail += 1;
            warnings.push(
              `${basename(filePath)} : ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        const wHint =
          warnings.length > 0
            ? ` · ${warnings.length} avertissement(s)`
            : '';
        ctx.feedback(
          `DXFOUT : ${ok} fichier(s) → ${destDir}${fail ? ` · ${fail} échec(s)` : ''}${wHint}`,
          fail && !ok ? 'err' : ok ? 'ok' : 'warn',
        );
        if (warnings.length > 0 && warnings.length <= 5) {
          for (const w of warnings) ctx.feedback(w, 'warn');
        }
      } catch (e) {
        ctx.feedback(
          e instanceof Error ? e.message : String(e),
          'err',
        );
      }
    },
  },
  {
    name: 'export',
    aliases: ['exporter'],
    summary:
      'Exporte le dessin courant en .DXF (tout le fichier ou la sélection) via l’explorateur',
    run: async (ctx) => {
      try {
        ctx.tools.cancel(false);
        const selected = ctx.selection.selectedEntities(ctx.doc.entities);
        let entities: readonly Entity[];

        if (selected.length === 0) {
          const ans = await showConfirm({
            title: 'Export DXF',
            message:
              'Aucun éléments selectionné. Le fichier au complet sera exporté',
            buttons: [
              { id: 'ok', label: 'Ok', primary: true },
              { id: 'cancel', label: 'Cancel' },
            ],
          });
          if (ans !== 'ok') {
            ctx.feedback('Export annulé.', 'warn');
            return;
          }
          entities = ctx.doc.entities;
        } else {
          const ans = await showConfirm({
            title: 'Export DXF',
            message: `${selected.length} élément(s) sélectionné(s).\nExporter la sélection uniquement, ou tout le fichier ?`,
            buttons: [
              { id: 'selection', label: 'Sélection', primary: true },
              { id: 'all', label: 'Tout le fichier' },
              { id: 'cancel', label: 'Cancel' },
            ],
          });
          if (!ans || ans === 'cancel') {
            ctx.feedback('Export annulé.', 'warn');
            return;
          }
          entities = ans === 'selection' ? selected : ctx.doc.entities;
        }

        // Précharger objets library présents dans l’export
        await ensureObjectDefs({ entities } as GkdDocument);

        const snap = ctx.doc.snapshot(ctx.viewport.getCameraState());
        const baseName = ensureDxfName(stripExt(ctx.doc.filename) || 'export');
        const startDir = guessStartDir(ctx.doc.filename);

        const dest = await pickSaveFilePath(
          'Export DXF — emplacement et nom du fichier',
          baseName,
          ['.dxf'],
          startDir,
        );
        if (!dest) {
          ctx.feedback('Export annulé.', 'warn');
          return;
        }

        const { text, warnings, entityCount } = serializeDxf(snap, {
          entities,
          title: stripExt(dest.fileName),
        });
        await fsWrite(dest.path, text);

        for (const w of warnings.slice(0, 5)) ctx.feedback(w, 'warn');
        ctx.feedback(
          `Exporté : ${dest.path} (${entityCount} entité(s) DXF)`,
          entityCount > 0 ? 'ok' : 'warn',
        );
      } catch (e) {
        ctx.feedback(
          e instanceof Error ? e.message : String(e),
          'err',
        );
      }
    },
  },

  // —— Lignes d'aide (L.AIDES ARC+) ——
  {
    name: 'axes',
    aliases: ['xyz'],
    summary: "Axes d'aide XYZ passant par un point (défaut 0 0 0)",
    usage: '[x y z | . | @]',
    run: (ctx, args) => {
      let origin: Vec3 = [0, 0, 0];
      if (args.length > 0) {
        const pt = parsePoint(args, ctx);
        if (!pt) {
          ctx.feedback(
            'Usage : /axes  |  /axes 0 0 0  |  /axes .  (souris)  |  /axes @  (dernier snap)',
            'err',
          );
          return;
        }
        origin = pt;
      }
      const axes = createAxesHelpers(origin);
      ctx.doc.addHelpers(axes);
      ctx.feedback(
        `Axes XYZ d'aide en (${r3(origin[0])}, ${r3(origin[1])}, ${r3(origin[2])}) — 3 lignes infinies`,
        'ok',
      );
    },
  },
  {
    name: 'hx',
    summary:
      "Aide // X : clic (boucle) ou /hx 0,1.7,0 — Y et Z comptent (X ignoré)",
    usage: 'interactif  ·  x,y,z  ·  y [z]  ·  @  ·  .',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startHelperAxis('x');
        return;
      }
      const pt = parseHelperAxisPoint(args, ctx, 'x');
      if (!pt) return;
      ctx.tools.cancel(false);
      ctx.tools.placeHelperAxis('x', pt);
    },
  },
  {
    name: 'hy',
    summary:
      "Aide // Y : clic (boucle) ou /hy 3,0,5 — X et Z comptent (Y ignoré)",
    usage: 'interactif  ·  x,y,z  ·  x [z]  ·  @  ·  .',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startHelperAxis('y');
        return;
      }
      const pt = parseHelperAxisPoint(args, ctx, 'y');
      if (!pt) return;
      ctx.tools.cancel(false);
      ctx.tools.placeHelperAxis('y', pt);
    },
  },
  {
    name: 'hz',
    summary:
      "Aide // Z : clic (boucle) ou /hz 4,7.2,0 — X et Y comptent (Z ignoré ; point en vue de dessus)",
    usage: 'interactif  ·  x,y,z  ·  x y  ·  @  ·  .',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startHelperAxis('z');
        return;
      }
      const pt = parseHelperAxisPoint(args, ctx, 'z');
      if (!pt) return;
      ctx.tools.cancel(false);
      ctx.tools.placeHelperAxis('z', pt);
    },
  },
  {
    name: 'paral',
    aliases: ['parallele', 'parallel', 'par'],
    summary:
      'Copie parallèle d’un élément désigné. /paral 1.2 = distance fixe, clic = côté, enchaîne jusqu’à Échap',
    usage: '[distance]  ·  [dx|dy|…]  ·  sans arg = emplacement libre',
    run: (ctx, args) => {
      // Compat : ancien /paral x|y|z <d> sans préfixe D → helper d’axe
      if (args.length >= 2) {
        const a0 = args[0]!.toLowerCase();
        if (a0 === 'x' || a0 === 'y' || a0 === 'z') {
          const d = Number(args[1]);
          if (Number.isFinite(d)) {
            if (a0 === 'x') {
              ctx.doc.addHelper(helperParallelX(d));
              ctx.feedback(`Aide // X  à Y=${r3(d)}`, 'ok');
            } else if (a0 === 'y') {
              ctx.doc.addHelper(helperParallelY(d));
              ctx.feedback(`Aide // Y  à X=${r3(d)}`, 'ok');
            } else {
              ctx.doc.addHelper(helperParallelZ(d, 0));
              ctx.feedback(`Aide // Z  en X=${r3(d)} Y=0`, 'ok');
            }
            return;
          }
        }
      }
      // /paral 1.2 — désigner un objet, clic = côté, enchaîner à 1.2 u.
      if (args.length === 1 && !/^d/i.test(args[0]!)) {
        const dist = Number(args[0]!.replace(',', '.'));
        if (Number.isFinite(dist) && dist > 0) {
          ctx.tools.startParal([], dist);
          return;
        }
      }

      const parsed = parseParalDeltas(args);
      if (!parsed.ok) {
        ctx.feedback(parsed.error, 'err');
        return;
      }
      ctx.tools.startParal(parsed.deltas);
    },
  },
  {
    name: 'perp',
    aliases: ['perpendiculaire', 'orthogonal'],
    summary: "Perpendiculaire d'aide à la dernière aide, par un point",
    usage: '[x y z]  —  . = souris, @ = snap',
    run: (ctx, args) => {
      const ref = ctx.doc.lastHelper;
      if (!ref) {
        ctx.feedback("Aucune ligne d'aide de référence. Créez d'abord une aide.", 'err');
        return;
      }
      const through =
        parsePoint(args.length ? args : ['.'], ctx) ??
        (ctx.viewport.getMouseWorld()
          ? ([
              ctx.viewport.getMouseWorld()!.x,
              ctx.viewport.getMouseWorld()!.y,
              ctx.viewport.getMouseWorld()!.z,
            ] as Vec3)
          : null);
      if (!through) {
        ctx.feedback('Indiquez un point : /perp .  |  /perp @  |  /perp x y z', 'err');
        return;
      }
      ctx.doc.addHelper(helperPerpendicularTo(ref, through));
      ctx.feedback(
        `Perpendiculaire à la dernière aide par (${r3(through[0])}, ${r3(through[1])}, ${r3(through[2])})`,
        'ok',
      );
    },
  },
  {
    name: 'efface_aides',
    aliases: ['clear_helpers', 'ea', 'cls_aides', 'effaides'],
    summary: "Efface TOUTES les lignes d'aide d'un coup",
    run: (ctx) => {
      const n = ctx.doc.clearHelpers();
      if (n === 0) {
        ctx.feedback("Aucune ligne d'aide à effacer.", 'warn');
      } else {
        ctx.feedback(`${n} ligne(s) d'aide effacée(s).`, 'ok');
      }
    },
  },

  // —— Dessin (lignes / arcs) ——
  {
    name: 'ligne',
    aliases: ['l', 'line', 'li'],
    summary:
      'Ligne(s) : interactif, ou chemin 0,0,0 dx 1 dy 7 … (1 entité ligne par segment)',
    usage:
      'interactif  ·  0,0,0 dx 1 dy 7 0,38,0  ·  dxy 3,4  ·  @ .',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startLine();
        return;
      }

      const parsed = parseLinePath(args, (token) => parsePoint([token], ctx));
      if (!parsed.ok) {
        ctx.feedback(
          `${parsed.error}  —  Ex. /line 0,0,0 dx 1 dy 7  ·  /line 1,1,1 5,5,5  ·  /line 0,0,0 dxy 3.7,5.9`,
          'err',
        );
        return;
      }

      ctx.tools.cancel(false);
      let n = 0;
      for (let i = 0; i + 1 < parsed.points.length; i++) {
        const a = parsed.points[i]!;
        const b = parsed.points[i + 1]!;
        if (isDegenerateLine(a, b)) continue;
        ctx.doc.addEntity(createLineEntity(a, b, ctx.pen.strokeFields()));
        n += 1;
      }
      if (n === 0) {
        ctx.feedback('Aucun segment valide (points confondus ?).', 'warn');
        return;
      }
      const last = parsed.points[parsed.points.length - 1]!;
      ctx.feedback(
        n === 1
          ? `Ligne tracée → (${r3(last[0])}, ${r3(last[1])}, ${r3(last[2])}).`
          : `${n} segment(s) tracé(s) → fin (${r3(last[0])}, ${r3(last[1])}, ${r3(last[2])}).`,
        'ok',
      );
    },
  },
  {
    name: 'arcc',
    aliases: ['acentre', 'arccen'],
    summary: 'Arc depuis le centre : centre → rayon → (Échap=cercle | départ → fin)',
    usage: '[cx cy [cz] sx sy [sz] ex ey [ez]]  ou interactif',
    run: (ctx, args) => {
      const pts = parsePointList(args, ctx);
      if (pts && pts.length >= 3) {
        ctx.tools.cancel(false);
        const arc = arcFromCenterStartEnd(
          pts[0]!,
          pts[1]!,
          pts[2]!,
          ctx.pen.strokeFields(),
        );
        if (!arc) {
          ctx.feedback('Arc invalide (rayon nul ?).', 'err');
          return;
        }
        ctx.doc.addEntity(arc);
        ctx.feedback(`Arc (centre) r=${arc.radius.toFixed(3)} m créé.`, 'ok');
        return;
      }
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /arcc  (interactif)  ·  /arcc cx cy sx sy ex ey',
          'err',
        );
        return;
      }
      ctx.tools.startArcc();
    },
  },
  {
    name: 'arc',
    aliases: ['a'],
    summary: 'Arc 3 points : départ → passage → fin (plan XY)',
    usage: '[x1 y1 x2 y2 x3 y3]  ou interactif',
    run: (ctx, args) => {
      const pts = parsePointList(args, ctx);
      if (pts && pts.length >= 3) {
        ctx.tools.cancel(false);
        const arc = arcFrom3Points(pts[0]!, pts[1]!, pts[2]!, ctx.pen.strokeFields());
        if (!arc) {
          ctx.feedback('Arc invalide (points colinéaires ou rayon nul).', 'err');
          return;
        }
        ctx.doc.addEntity(arc);
        ctx.feedback(`Arc (3 pts) r=${arc.radius.toFixed(3)} m créé.`, 'ok');
        return;
      }
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /arc  (interactif)  ·  /arc x1 y1 x2 y2 x3 y3',
          'err',
        );
        return;
      }
      ctx.tools.startArc();
    },
  },
  {
    name: 'arccont',
    aliases: ['ac', 'arccontinu'],
    summary: 'Arcs continus (G1) : 1er arc 3 pts puis suite sans cassure',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /arccont  (interactif — clics uniquement)', 'err');
        return;
      }
      ctx.tools.startArcCont();
    },
  },
  {
    name: 'pline',
    aliases: ['polyligne', 'polyline', 'pl'],
    summary:
      'Polyligne (1 entité) : interactif, ou même chemin que /line (0,0,0 dx 1 dy 7 …)',
    usage:
      'interactif  ·  0,0,0 dx 1 dy 7 0,38,0  ·  [Shift]=H/45°/V  ·  Échap = fin',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startPline();
        return;
      }

      const parsed = parseLinePath(args, (token) => parsePoint([token], ctx));
      if (!parsed.ok) {
        ctx.feedback(
          `${parsed.error}  —  Ex. /pline 0,0,0 dx 1 dy 7  ·  /pline 1,1 5,5  ·  /pline 0,0,0 dxy 3,4`,
          'err',
        );
        return;
      }

      ctx.tools.cancel(false);
      const poly = createPolylineFromPoints(
        parsed.points,
        ctx.pen.strokeFields(),
      );
      if (!poly) {
        ctx.feedback('Aucun segment valide (points confondus ?).', 'warn');
        return;
      }
      ctx.doc.addEntity(poly);
      const last = parsed.points[parsed.points.length - 1]!;
      const n = poly.segments.length;
      ctx.feedback(
        `Polyligne ${n} segment(s) → fin (${r3(last[0])}, ${r3(last[1])}, ${r3(last[2])}).`,
        'ok',
      );
    },
  },
  {
    name: 'parc',
    aliases: ['polyarc', 'pa'],
    summary:
      'Polyligne d’arcs 3 pts (1 entité). /pline /parct pour basculer sans couper',
    usage: 'interactif  ·  Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /parc  (interactif). Échap termine.', 'err');
        return;
      }
      ctx.tools.startParc();
    },
  },
  {
    name: 'parct',
    aliases: ['polyarct', 'pat'],
    summary:
      'Polyligne d’arcs tangents G1 (1 entité). 1er arc 3 pts puis 1 clic. /pline /parc',
    usage: 'interactif  ·  Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /parct  (interactif). Échap termine.', 'err');
        return;
      }
      ctx.tools.startParct();
    },
  },
  {
    name: 'cercle',
    aliases: ['c', 'circle', 'cir'],
    summary: 'Cercle : centre → rayon',
    usage: '[cx cy [cz] rx ry [rz]]  ou interactif',
    run: (ctx, args) => {
      const pts = parsePointList(args, ctx);
      if (pts && pts.length >= 2) {
        ctx.tools.cancel(false);
        const center = pts[0]!;
        const edge = pts[1]!;
        if (isDegenerateRadius(center, edge)) {
          ctx.feedback('Rayon nul.', 'err');
          return;
        }
        const r = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
        ctx.doc.addEntity(createCircleEntity(center, r, ctx.pen.strokeFields()));
        ctx.feedback(`Cercle r=${r.toFixed(3)} m créé.`, 'ok');
        return;
      }
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /cercle  (interactif)  ·  /cercle cx cy rx ry',
          'err',
        );
        return;
      }
      ctx.tools.startCircle();
    },
  },
  {
    name: 'point',
    aliases: ['pt', 'dot', 'poi'],
    summary:
      'Place un point (couleur + épaisseur stylo ; taille écran fixe en px). Snap prioritaire',
    usage: '[x,y,z]  ou interactif (clics · Échap = fin)',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startPoint();
        return;
      }
      const pts = parsePointList(args, ctx);
      if (pts && pts.length >= 1) {
        ctx.tools.cancel(false);
        const r = ctx.pen.resolved;
        for (const p of pts) {
          ctx.doc.addEntity(
            createPointEntity(p, { color: r.color, lineWidth: r.lineWidth }),
          );
        }
        ctx.feedback(
          pts.length === 1
            ? `Point placé @ (${r3(pts[0]![0])}, ${r3(pts[0]![1])}, ${r3(pts[0]![2])})  [${r.colorLabel}, ${r.lineWidth}×${r.lineWidth} px].`
            : `${pts.length} points placés  [${r.colorLabel}, ${r.lineWidth}×${r.lineWidth} px].`,
          'ok',
        );
        return;
      }
      ctx.feedback(
        'Usage : /point  (interactif)  ·  /point 1,2,0  ·  /point 0,0,0 1,1,0',
        'err',
      );
    },
  },
  {
    name: 'cut',
    aliases: ['coupe', 'break', 'scinder'],
    summary: 'Coupe ligne/arc/cercle au plus près du clic (rayon snap px)',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          `Usage : /cut  (clic près d’un élément, ≤ ${ctx.viewport.snapRadiusPx()} px)`,
          'err',
        );
        return;
      }
      ctx.tools.startCut();
    },
  },
  {
    name: 'trim',
    aliases: ['ajuster', 'couper', 'tr'],
    summary:
      'Raccourcit un objet : 1) objet  2) endroit  3) côté à garder (ligne / arc / mur / polyligne ouverte)',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /trim  — clic objet, clic coupe, clic côté à garder. Échap = terminer.',
          'err',
        );
        return;
      }
      ctx.tools.startTrim();
    },
  },
  {
    name: 'extend',
    aliases: ['allonge', 'prolonger', 'ex'],
    summary:
      'Allonge une ligne/arc (ou bout de polyligne ouverte) jusqu’à une limite (ligne/arc/cercle)',
    usage: 'interactif : 1) objet à allonger  2) limite  ·  Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /extend  — clic objet à allonger, puis clic limite. Échap = terminer.',
          'err',
        );
        return;
      }
      ctx.tools.startExtend();
    },
  },
  {
    name: 'hatch',
    aliases: ['hachure', 'hachures', 'motif'],
    summary:
      'Bibliothèque de hachures (motifs 1 m × 1 m) : créer / choisir / échelle / rotation',
    usage: 'interactif (dialogue)',
    run: async (ctx) => {
      ctx.tools.cancel(false);
      await ctx.hatchLib.open();
      ctx.feedback(
        'Hachures — Choisissez un motif + échelle + rotation. /fill pour remplir une polyligne.',
        'info',
      );
    },
  },
  {
    name: 'fill',
    aliases: ['remplir', 'remplissage'],
    summary:
      'Remplit une polyligne avec la hachure courante (/hatch). Clic ou sélection.',
    usage: 'interactif · ou polyligne sélectionnée',
    run: async (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /fill  — sélectionnez une polyligne ou cliquez-la. Motif : /hatch.',
          'err',
        );
        return;
      }
      if (!ctx.hatch.currentName) {
        ctx.feedback(
          'Aucune hachure choisie. /hatch pour en sélectionner une, puis /fill.',
          'warn',
        );
        await ctx.hatchLib.open();
        return;
      }
      // Si une polyligne est sélectionnée → fill direct
      const sel = [...ctx.selection.selectedIds];
      const polys = ctx.doc.entities.filter(
        (e) => e.kind === 'polyline' && sel.includes(e.id),
      );
      if (polys.length === 1 && polys[0]!.kind === 'polyline') {
        await ctx.tools.fillPolyline(polys[0]!);
        return;
      }
      if (polys.length > 1) {
        ctx.feedback(
          'Plusieurs polylignes sélectionnées — n’en gardez qu’une, ou /fill sans sélection puis clic.',
          'warn',
        );
        return;
      }
      ctx.tools.startFill();
    },
  },
  {
    name: 'delh',
    aliases: ['delhatch', 'unhatch', 'effacehachure'],
    summary:
      'Enlève le hachurage d’une polyligne (clic). Sans effet si pas de hachure.',
    usage: 'interactif (clic polyligne) · Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /delh  — cliquez la polyligne dont retirer le hachurage.',
          'err',
        );
        return;
      }
      // Sélection d’une seule polyligne → action immédiate
      const sel = [...ctx.selection.selectedIds];
      const polys = ctx.doc.entities.filter(
        (e) => e.kind === 'polyline' && sel.includes(e.id),
      );
      if (polys.length === 1 && polys[0]!.kind === 'polyline') {
        const poly = polys[0]!;
        if (!poly.hatch) {
          // Rien à faire
          return;
        }
        ctx.doc.replaceEntity(poly.id, [clearHatchFromPolyline(poly)]);
        ctx.feedback('Hachurage retiré.', 'ok');
        return;
      }
      ctx.tools.startDelHatch();
    },
  },

  // —— Murs (WALLS.md) ——
  {
    name: 'murs',
    aliases: ['biblio', 'libmurs', 'walllib', 'walls'],
    summary: 'Ouvre la bibliothèque de murs (créer / choisir un style)',
    run: (ctx) => {
      ctx.tools.cancel(false);
      ctx.wallLib.open();
      ctx.feedback(
        'Bibliothèque de murs — créez un style, cliquez pour choisir. Échap = fermer.',
        'info',
      );
    },
  },
  {
    name: 'murligne',
    aliases: ['ml', 'wallline', 'wl'],
    summary: 'Tracer un mur linéaire (style courant de la biblio)',
    usage: 'interactif · [ALT] bascule le côté',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /ml ou /murligne  (interactif). Préalable : /murs', 'err');
        return;
      }
      // Sync biblio → document avant tracé
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.tools.startWallLine();
    },
  },
  {
    name: 'murarc',
    aliases: ['ma', 'wallarc', 'wa'],
    summary: 'Tracer un mur en arc 3 pts (style courant de la biblio)',
    usage: 'interactif · [ALT] bascule le côté',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /ma ou /murarc  (interactif). Préalable : /murs', 'err');
        return;
      }
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.tools.startWallArc();
    },
  },
  {
    name: 'pmur',
    aliases: ['polymur', 'pm'],
    summary:
      'Polymur linéaire (plusieurs segments = 1 entité). /pmarc /pmarct pour basculer',
    usage: 'interactif · [Shift]=H/45°/V · [ALT]=côté · Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /pmur  (interactif). Préalable : /murs', 'err');
        return;
      }
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.tools.startPmur();
    },
  },
  {
    name: 'pmarc',
    aliases: ['polyma', 'pma'],
    summary:
      'Polymur d’arcs 3 pts (1 entité). /pmur /pmarct pour basculer sans couper',
    usage: 'interactif · [ALT]=côté · Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /pmarc  (interactif). Préalable : /murs', 'err');
        return;
      }
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.tools.startPmarc();
    },
  },
  {
    name: 'pmarct',
    aliases: ['polymarct', 'pmat'],
    summary:
      'Polymur d’arcs tangents G1 (1 entité). 1er arc 3 pts puis 1 clic. /pmur /pmarc',
    usage: 'interactif · [ALT]=côté · Échap = fin',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback('Usage : /pmarct  (interactif). Préalable : /murs', 'err');
        return;
      }
      ctx.doc.setWallLibrary(ctx.walls.toDocumentLibrary());
      ctx.tools.startPmarct();
    },
  },

  // —— Sélection / édition ——
  {
    name: 'select',
    aliases: ['sl', 'sel'],
    summary: 'Sélection par cadre (2 clics). ALT = désélectionner',
    run: (ctx) => {
      ctx.tools.startSelect();
    },
  },
  {
    name: 'deselect',
    aliases: ['dsel', 'unsel', 'clear_sel'],
    summary: 'Vide la sélection',
    run: (ctx) => {
      ctx.selection.clear();
      ctx.feedback('Sélection vidée.', 'ok');
    },
  },
  {
    name: 'delete',
    aliases: ['del', 'effacer', 'erase'],
    summary: 'Efface les entités sélectionnées (touche Suppr)',
    run: (ctx) => {
      if (ctx.selection.size === 0) {
        ctx.feedback(
          'Rien de sélectionné. /select d’abord, ou Ctrl+D / /d pour effacer par désignation.',
          'warn',
        );
        return;
      }
      const n = ctx.doc.removeEntities(ctx.selection.selectedIds);
      ctx.selection.clear();
      ctx.feedback(`${n} élément(s) effacé(s).`, 'ok');
    },
  },
  {
    name: 'd',
    aliases: ['delpick', 'deletepick', 'effpick', 'designefface'],
    summary:
      'Efface l’élément désigné au clic (rayon snap). Enchaîne jusqu’à Échap. = Ctrl+D',
    usage: 'interactif (identique à Ctrl+D)',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /d  ou  Ctrl+D  — cliquez l’élément à effacer ; Échap = terminer.',
          'err',
        );
        return;
      }
      // Même entrée que le raccourci clavier Ctrl+D
      ctx.tools.startDeletePick();
    },
  },
  {
    name: 'copy',
    aliases: ['cp', 'copier'],
    summary:
      'Copie : sél. → base/arrivée ; sinon désigner (orange suit la souris) puis 1 clic coller. Échap = fin',
    run: (ctx) => {
      ctx.tools.startCopy();
    },
  },
  {
    name: 'move',
    aliases: ['mv', 'deplacer', 'déplacer'],
    summary: 'Déplace la sélection (clic base → clic destination)',
    run: (ctx) => {
      ctx.tools.startMove();
    },
  },
  {
    name: 'm1',
    aliases: ['move1', 'moveone', 'deplacer1', 'déplacer1'],
    summary:
      'Déplace UN objet désigné (base → dest). Cote : ligne=tout · texte=libellé seul. Polyligne/objet library = entier',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /m1  — désigner un objet, base, destination. Échap = annuler.',
          'err',
        );
        return;
      }
      ctx.tools.startMoveOne();
    },
  },
  {
    name: 'r1',
    aliases: ['rotate1', 'rot1', 'rotation1', 'tourner1'],
    summary:
      'Rotation d’UN objet désigné (pivot → réf. → angle). Cote : ligne=tout · texte=libellé seul',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /r1  — désigner, pivot, point de référence, point d’angle. Échap = annuler.',
          'err',
        );
        return;
      }
      ctx.tools.startRotateOne();
    },
  },
  {
    name: 'rotation',
    aliases: ['rotate', 'rot', 'tourner'],
    summary:
      'Alias de /r1 (rotation d’un seul objet désigné). Pas de rotation multi-sélection pour l’instant',
    run: (ctx) => {
      ctx.tools.startRotateOne();
    },
  },
  {
    name: 'stretch',
    aliases: ['etirer', 'étirer', 'str'],
    summary:
      'Étire les extrémités dans un cadre (cadre → base → dest). Objets entiers = move. Library : seulement si entièrement inclus',
    usage: 'interactif',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /stretch  — cadre 2 clics, puis base, puis destination. Échap = annuler.',
          'err',
        );
        return;
      }
      ctx.tools.startStretch();
    },
  },
  {
    name: 'dist',
    aliases: ['distance', 'mesure', 'measure', 'di'],
    summary: 'Mesure la distance entre 2 points (unité document courante)',
    usage: 'interactif (1er point → 2ᵉ point) ; enchaîne jusqu’à Échap',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /dist  — cliquez 2 points. Résultat dans l’unité courante (voir /param). Échap = fin.',
          'err',
        );
        return;
      }
      ctx.tools.startDist();
    },
  },
  {
    name: 'jonction',
    aliases: ['rejoin', 'raccord', 'joints', 'onglet'],
    summary:
      'Raccords de murs (snap + onglets) ; sur T/Y : cycle solutions Gauche=Oui / Droit=Non',
    usage: 'interactif (2 clics = cadre ; puis Y/N si T/Y)',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /jonction  — cadre 2 clics. Sur T/Y : Gauche=garder, Droit=solution suivante.',
          'err',
        );
        return;
      }
      ctx.tools.startRejoin();
    },
  },
  {
    name: 'join',
    aliases: ['joindre', 'coller-mur', 'walljoin'],
    summary:
      'Raccorde un mur à un autre (A prolongé → B) : T bout→flanc ou L coin, multi-couches par priorité',
    usage: 'interactif (1er mur à prolonger, 2e mur cible)',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /join  — 1) mur à prolonger (près du bout)  2) mur cible. Échap = fin.',
          'err',
        );
        return;
      }
      ctx.tools.startJoin();
    },
  },
  {
    name: 'corner',
    aliases: ['coin', 'cn', 'angle'],
    summary:
      'Coin L forcé entre 2 murs (jamais T). Clic = côté à garder si les murs se croisent.',
    usage: 'interactif : 1) 1er mur  2) 2ᵉ mur',
    run: (ctx, args) => {
      if (args.length > 0) {
        ctx.feedback(
          'Usage : /corner  — clic 1er mur (côté à garder), clic 2ᵉ mur. Échap = fin.',
          'err',
        );
        return;
      }
      ctx.tools.startCorner();
    },
  },

  // —— Bibliothèque d'objets ——
  {
    name: 'objets',
    aliases: ['libobj', 'biblioobj', 'objectlib'],
    summary: 'Ouvre la bibliothèque d’objets (library/)',
    run: async (ctx) => {
      ctx.tools.cancel(false);
      await ctx.objLib.open();
      ctx.feedback('Bibliothèque d’objets — Échap pour fermer.', 'info');
    },
  },
  {
    name: 'obj',
    aliases: ['objet', 'object'],
    summary: 'Crée un objet library/ à partir de la sélection (clic = origine 0,0,0)',
    run: (ctx) => {
      ctx.tools.startObj();
    },
  },
  {
    name: 'extract',
    aliases: ['ext', 'extraire'],
    summary: 'Extrait la sélection vers un fichier .gkd (dialogue d’emplacement)',
    run: (ctx) => {
      ctx.tools.startExtract();
    },
  },
  {
    name: 'explode',
    aliases: ['expld', 'disassociate', 'dissocier'],
    summary:
      'Explose objets library et polylignes sélectionnés en éléments basiques',
    run: (ctx) => {
      ctx.tools.explodeSelection();
    },
  },
  {
    name: 'closelib',
    aliases: ['fermerlib', 'libclose'],
    summary: 'Ferme l’édition d’un objet library et revient au dessin précédent',
    run: (ctx) => {
      if (ctx.closeLibraryEdit) {
        ctx.closeLibraryEdit();
      } else {
        ctx.feedback('Pas d’édition library en cours.', 'warn');
      }
    },
  },

  // —— Stylo ——
  {
    name: 'couleur',
    aliases: ['color', 'coul', 'co'],
    summary: 'Couleur du prochain trait',
    usage: '[nom|id|#hex|n°]  ou sans arg = liste / cycle',
    run: (ctx, args) => {
      if (args.length === 0) {
        const names = ctx.pen.file.colors.map((c) => c.label).join(', ');
        ctx.feedback(
          `Couleur courante : ${ctx.pen.resolved.colorLabel}. Disponibles : ${names}.  /couleur <nom>  ou clic sur Couleur dans la barre.`,
          'info',
        );
        return;
      }
      const tok = args[0]!.toLowerCase();
      const colors = ctx.pen.file.colors;
      const byId = colors.find((c) => c.id === tok || c.label.toLowerCase() === tok);
      if (byId) {
        ctx.pen.setColorId(byId.id);
        ctx.feedback(`Couleur → ${byId.label} (${byId.value})`, 'ok');
        return;
      }
      if (tok.startsWith('#')) {
        // couleur libre : on matche ou on bascule sur la plus proche id custom — simple: rejeter sauf catalogue
        const hex = colors.find((c) => c.value.toLowerCase() === tok);
        if (hex) {
          ctx.pen.setColorId(hex.id);
          ctx.feedback(`Couleur → ${hex.label}`, 'ok');
          return;
        }
      }
      const idx = Number(tok);
      if (Number.isInteger(idx) && idx >= 1 && idx <= colors.length) {
        const c = colors[idx - 1]!;
        ctx.pen.setColorId(c.id);
        ctx.feedback(`Couleur → ${c.label}`, 'ok');
        return;
      }
      ctx.feedback(
        `Couleur inconnue « ${args[0]} ». Essayez : ${colors.map((c) => c.id).join(', ')}`,
        'err',
      );
    },
  },
  {
    name: 'epaisseur',
    aliases: ['épaisseur', 'ep', 'width', 'lw', 'epaiss'],
    summary: 'Épaisseur du prochain trait (1–7 px)',
    usage: '[1-7|id]',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.feedback(
          `Épaisseur courante : ${ctx.pen.resolved.widthLabel}.  /epaisseur 1…7  ou clic sur Épaisseur.`,
          'info',
        );
        return;
      }
      const tok = args[0]!.toLowerCase();
      const widths = ctx.pen.file.widths;
      const n = Number(tok);
      if (Number.isFinite(n)) {
        const w = widths.find((x) => x.px === n) ?? widths.find((x) => x.id === `w${n}`);
        if (w) {
          ctx.pen.setWidthId(w.id);
          ctx.feedback(`Épaisseur → ${w.label}`, 'ok');
          return;
        }
      }
      const byId = widths.find((w) => w.id === tok || w.label.toLowerCase() === tok);
      if (byId) {
        ctx.pen.setWidthId(byId.id);
        ctx.feedback(`Épaisseur → ${byId.label}`, 'ok');
        return;
      }
      ctx.feedback('Usage : /epaisseur 1  …  /epaisseur 7', 'err');
    },
  },
  {
    name: 'style',
    aliases: ['st', 'linetype', 'trait'],
    summary: 'Style de trait du prochain dessin',
    usage: '[plein|pointille|tiret|…]',
    run: (ctx, args) => {
      const styles = ctx.pen.file.styles;
      if (args.length === 0) {
        ctx.feedback(
          `Style courant : ${ctx.pen.resolved.styleLabel}.  ${styles.map((s) => s.id).join(' · ')}`,
          'info',
        );
        return;
      }
      const tok = args[0]!.toLowerCase().replace(/-/g, '_');
      const aliases: Record<string, string> = {
        solid: 'plein',
        continuous: 'plein',
        dash: 'tiret',
        dashed: 'tiret',
        dot: 'pointille',
        dotted: 'pointille',
        dashdot: 'tiret_point',
        'dash_dot': 'tiret_point',
      };
      const id = aliases[tok] ?? tok;
      if (ctx.pen.setStyleId(id)) {
        ctx.feedback(`Style → ${ctx.pen.resolved.styleLabel}`, 'ok');
        return;
      }
      const idx = Number(tok);
      if (Number.isInteger(idx) && idx >= 1 && idx <= styles.length) {
        ctx.pen.setStyleId(styles[idx - 1]!.id);
        ctx.feedback(`Style → ${ctx.pen.resolved.styleLabel}`, 'ok');
        return;
      }
      ctx.feedback(
        `Style inconnu. Disponibles : ${styles.map((s) => s.id).join(', ')}`,
        'err',
      );
    },
  },
  {
    name: 'stylo',
    aliases: ['pen'],
    summary: 'Résumé du stylo courant (couleur, épaisseur, style)',
    run: (ctx) => {
      const r = ctx.pen.resolved;
      ctx.feedback(
        `Stylo : ${r.colorLabel} (${r.color}) · ${r.widthLabel} · ${r.styleLabel}  — stocké en localStorage (grokcad.pen)`,
        'info',
      );
    },
  },

  // —— Snap / paramètres ——
  {
    name: 'snap',
    aliases: ['accroche'],
    summary: 'Accroche clic droit (rayon en pixels, on/off)',
    usage: '[px | on | off | ?]',
    run: (ctx, args) => {
      const snap = ctx.app.snap;
      if (args.length === 0 || args[0] === '?' || args[0] === 'status') {
        const en = snap.enabled ? 'ON' : 'OFF';
        const world = ctx.viewport.snapToleranceMeters();
        ctx.feedback(
          `Snap ${en} · rayon ${snap.radiusPx} px (≈ ${world.toFixed(3)} m à ce zoom) · clic droit = accroche · hors rayon = clic gauche · /snap 20 · /param`,
          'info',
        );
        return;
      }
      const a0 = args[0]!.toLowerCase();
      if (a0 === 'on' || a0 === 'oui' || a0 === '1') {
        ctx.app.setSnapEnabled(true);
        ctx.feedback(`Snap activé (${ctx.app.snap.radiusPx} px).`, 'ok');
        return;
      }
      if (a0 === 'off' || a0 === 'non' || a0 === '0') {
        ctx.app.setSnapEnabled(false);
        ctx.feedback('Snap désactivé (clic droit = clic gauche).', 'ok');
        return;
      }
      if (a0 === 'toggle' || a0 === 'bascule') {
        const on = ctx.app.toggleSnap();
        ctx.feedback(on ? 'Snap activé.' : 'Snap désactivé.', 'ok');
        return;
      }
      const n = Number(a0);
      if (Number.isFinite(n) && n > 0) {
        ctx.app.setSnapRadiusPx(n);
        ctx.feedback(
          `Rayon d'accroche → ${ctx.app.snap.radiusPx} px (≈ ${ctx.viewport.snapToleranceMeters().toFixed(1)} cm à ce zoom).`,
          'ok',
        );
        return;
      }
      ctx.feedback('Usage : /snap  ·  /snap 20  ·  /snap on|off  ·  /param', 'err');
    },
  },
  {
    name: 'param',
    aliases: ['params', 'parametres', 'paramètres', 'settings', 'prefs', 'preferences'],
    summary: 'Ouvre la fenêtre Paramètres (unités, grille, snap, styles, textbox)',
    run: (ctx) => {
      ctx.settings.open();
      ctx.feedback('Paramètres ouverts (Échap pour fermer).', 'info');
    },
  },

  // —— Texte / rectangle / cotations ——
  {
    name: 'rect',
    aliases: ['rectangle', 'rec'],
    summary:
      'Rectangle (polyligne fermée). Shift = carré. Interactif ou 2 coins en ligne de commande.',
    usage: 'interactif  ·  0,0,0 dxy 7.3,3.7  ·  0,0,0 4.3,4.3',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startRect();
        return;
      }
      const parsed = parseLinePath(args, (token) => parsePoint([token], ctx));
      if (!parsed.ok) {
        ctx.feedback(
          `${parsed.error}  —  Ex. /rect 0,0,0 dxy 7.3,3.7  ·  /rect 0,0,0 4,3`,
          'err',
        );
        return;
      }
      if (parsed.points.length === 1) {
        // 1 coin connu → interactif pour le 2ᵉ
        ctx.tools.cancel(false);
        ctx.tools.startRect();
        ctx.tools.acceptPoint(parsed.points[0]!);
        ctx.feedback(
          `RECT — 1er coin (${r3(parsed.points[0]![0])}, ${r3(parsed.points[0]![1])}). 2ᵉ coin… [Shift]=carré`,
          'info',
        );
        return;
      }
      if (parsed.points.length >= 2) {
        ctx.tools.cancel(false);
        ctx.tools.commitRect(parsed.points[0]!, parsed.points[1]!, false);
        return;
      }
      ctx.feedback('Usage : /rect  ·  /rect 0,0,0 dxy 7.3,3.7', 'err');
    },
  },
  {
    name: 'text',
    aliases: ['txt', 'texte'],
    summary:
      'Texte simple. Style dans la barre du haut. Clic départ puis direction.',
    usage: 'interactif  ·  Cuisine  ·  Cuisine 0,0,0 dx 1',
    run: async (ctx, args) => {
      await runTextCommand(ctx, args, false);
    },
  },
  {
    name: 'textbox',
    aliases: ['txb', 'cartouche'],
    summary:
      'Texte + rectangle (décalage = Paramètres). Multiligne via fenêtre si pas de texte.',
    usage: 'interactif  ·  Cuisine  ·  Cuisine 0,0,0 dx 1',
    run: async (ctx, args) => {
      await runTextCommand(ctx, args, true);
    },
  },
  {
    name: 'cote',
    aliases: ['dim', 'dimension', 'cotation'],
    summary:
      'Cotation linéaire multi-segments. Style courant dans la barre du haut.',
    usage: 'interactif  ·  -1,0,0 dx 1  (passage + direction, puis clics)',
    run: (ctx, args) => {
      if (args.length === 0) {
        ctx.tools.startCote();
        return;
      }
      const parsed = parseLinePath(args, (token) => parsePoint([token], ctx));
      if (!parsed.ok || parsed.points.length < 1) {
        ctx.feedback(
          'Usage : /cote  (interactif)  ·  /cote -1,0,0 dx 1  puis clics de définition',
          'err',
        );
        return;
      }
      ctx.tools.cancel(false);
      ctx.tools.startCote();
      ctx.tools.acceptPoint(parsed.points[0]!);
      if (parsed.points.length >= 2) {
        ctx.tools.acceptPoint(parsed.points[1]!);
      }
    },
  },
  {
    name: 'cotations',
    aliases: ['dimstyles', 'stylescote', 'styles-cote'],
    summary: 'Ouvre la gestion des styles de cotation',
    run: (ctx) => {
      ctx.dimStyles.open();
      ctx.feedback('Styles de cotation ouverts.', 'info');
    },
  },
];

/**
 * /text · /textbox — parse texte + éventuel chemin, ou dialogue.
 */
async function runTextCommand(
  ctx: CommandContext,
  args: string[],
  boxed: boolean,
): Promise<void> {
  const label = boxed ? 'TEXTBOX' : 'TEXT';
  let text = '';
  let pathArgs: string[] = [];

  if (args.length === 0) {
    const entered = await showTextInputDialog({
      title: boxed ? 'Textbox' : 'Texte',
      placeholder: 'Saisissez le texte (plusieurs lignes possibles)…',
    });
    if (entered === null) {
      ctx.feedback(`${label} annulé.`, 'warn');
      return;
    }
    text = entered;
    if (!text.trim()) {
      ctx.feedback('Texte vide — commande annulée.', 'warn');
      return;
    }
  } else {
    const split = splitTextAndGeomArgs(args);
    text = split.text;
    pathArgs = split.pathArgs;
    if (!text.trim()) {
      const entered = await showTextInputDialog({
        title: boxed ? 'Textbox' : 'Texte',
      });
      if (entered === null || !entered.trim()) {
        ctx.feedback(`${label} annulé.`, 'warn');
        return;
      }
      text = entered;
    }
  }

  if (pathArgs.length === 0) {
    ctx.tools.cancel(false);
    ctx.tools.startText(text, boxed);
    return;
  }

  const parsed = parseLinePath(pathArgs, (token) => parsePoint([token], ctx));
  if (!parsed.ok) {
    ctx.feedback(
      `${parsed.error}  —  Ex. /${boxed ? 'textbox' : 'txt'} Cuisine 0,0,0 dx 1`,
      'err',
    );
    return;
  }

  if (parsed.points.length === 1) {
    ctx.tools.cancel(false);
    ctx.tools.startText(text, boxed);
    ctx.tools.acceptPoint(parsed.points[0]!);
    return;
  }

  if (parsed.points.length >= 2) {
    const a = parsed.points[0]!;
    const b = parsed.points[1]!;
    const dir: Vec3 = [b[0] - a[0], b[1] - a[1], 0];
    if (Math.hypot(dir[0], dir[1]) < 1e-12) {
      ctx.feedback('Direction nulle.', 'err');
      return;
    }
    ctx.tools.cancel(false);
    ctx.tools.commitText(text, a, dir, boxed);
    return;
  }
}

/** Sépare le texte libre des tokens de géométrie (coords, dx, …). */
function splitTextAndGeomArgs(args: string[]): {
  text: string;
  pathArgs: string[];
} {
  let i = 0;
  for (; i < args.length; i++) {
    if (looksLikeGeomToken(args[i]!)) break;
  }
  return {
    text: args.slice(0, i).join(' '),
    pathArgs: args.slice(i),
  };
}

function looksLikeGeomToken(raw: string): boolean {
  const t = raw.toLowerCase();
  if (
    t === '.' ||
    t === 'm' ||
    t === 'souris' ||
    t === 'mouse' ||
    t === '@' ||
    t === 'snap'
  ) {
    return true;
  }
  if (/^d[xyz]+$/i.test(raw)) return true;
  if (raw.includes(',')) return true;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return true;
  return false;
}

function r3(n: number): string {
  return (Math.abs(n) < 1e-9 ? 0 : n).toFixed(3);
}

function isPointToken(t: string): boolean {
  return ['.', 'm', 'souris', 'mouse', '@', 'snap'].includes(t.toLowerCase());
}

/** Point depuis args numériques, souris (.) ou dernier snap (@). */
function parsePoint(args: string[], ctx: CommandContext): Vec3 | null {
  if (args.length === 0) return null;
  const t = args[0]!.toLowerCase();

  if (t === '.' || t === 'm' || t === 'souris' || t === 'mouse') {
    const m = ctx.viewport.getMouseWorld();
    if (!m) return null;
    return [m.x, m.y, m.z];
  }

  if (t === '@' || t === 'snap') {
    const s = ctx.viewport.getLastSnap();
    if (!s) return null;
    return [...s.point] as Vec3;
  }

  if (args.length >= 3) {
    const x = Number(args[0]);
    const y = Number(args[1]);
    const z = Number(args[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }

  if (args.length >= 2) {
    const x = Number(args[0]);
    const y = Number(args[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y, 0];
    }
  }

  return null;
}

/**
 * Parse une suite de points : nombres (2 ou 3), `.`, `@`.
 * Ex. `0 0 8 0` → 2 points ; `@ . 1 2 3` → mixte.
 */
function parsePointList(args: string[], ctx: CommandContext): Vec3[] | null {
  if (args.length === 0) return null;
  const pts: Vec3[] = [];
  let i = 0;
  while (i < args.length) {
    const t = args[i]!.toLowerCase();
    if (t === '.' || t === 'm' || t === 'souris' || t === 'mouse' || t === '@' || t === 'snap') {
      const p = parsePoint([args[i]!], ctx);
      if (!p) return null;
      pts.push(p);
      i += 1;
      continue;
    }
    const x = Number(args[i]);
    const y = Number(args[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const zCand = Number(args[i + 2]);
    if (
      Number.isFinite(zCand) &&
      args[i + 2] !== undefined &&
      !Number.isNaN(zCand) &&
      // Si 3e token est un nombre et qu'il reste assez pour un point, préférer xyz
      // Heuristique : 3 nombres d'affilée = un point 3D
      (i + 2 < args.length && Number.isFinite(Number(args[i + 2])))
    ) {
      // Ambiguïté x y z vs x y + next x : si exactement 3 tokens restants ou
      // le 3e n'est pas suivi d'un 4e nombre formant un couple — prendre xyz
      // si le nombre de tokens restants (nombres) % 2 == 1 with z, or % 3 == 0
      const rest = args.slice(i).filter((a) => Number.isFinite(Number(a)));
      if (rest.length % 3 === 0) {
        pts.push([x, y, zCand]);
        i += 3;
        continue;
      }
    }
    pts.push([x, y, 0]);
    i += 2;
  }
  return pts.length > 0 ? pts : null;
}

/**
 * Point pour /hx · /hy · /hz :
 * - `0,1.7,0` / `1,4.5,7` (CSV x,y,z — axes non pertinents ignorés à la pose)
 * - `.` / `@` / snap / souris
 * - legacy : 1 ou 2 nombres (selon l’axe) ou 3 nombres espaces
 */
function parseHelperAxisPoint(
  args: string[],
  ctx: CommandContext,
  axis: 'x' | 'y' | 'z',
): Vec3 | null {
  if (args.length === 0) return null;

  if (isPointToken(args[0]!)) {
    const pt = parsePoint(args, ctx);
    if (!pt) {
      ctx.feedback(
        args[0] === '@' || args[0]!.toLowerCase() === 'snap'
          ? 'Pas de snap récent (@). Clic droit d’abord, ou /hx sans arg puis clic.'
          : 'Souris hors canevas. Utilisez un clic (/hx sans arg) ou des coordonnées.',
        'err',
      );
      return null;
    }
    return pt;
  }

  // CSV : x,y,z ou x,y
  if (args.length === 1 && args[0]!.includes(',')) {
    const parts = args[0]!.split(',').map((s) => s.trim()).filter(Boolean);
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n)) || nums.length < 2 || nums.length > 3) {
      ctx.feedback(
        `Coordonnées invalides « ${args[0]} ». Ex. /h${axis} 0,1.7,0`,
        'err',
      );
      return null;
    }
    return [nums[0]!, nums[1]!, nums[2] ?? 0];
  }

  // Nombres séparés par espaces
  const nums: number[] = [];
  for (const a of args) {
    if (a.includes(',')) {
      // mélange "0,1" "2" peu probable — traiter comme erreur
      ctx.feedback(
        `Utilisez soit « x,y,z » soit des nombres séparés. Ex. /h${axis} 0,1.7,0`,
        'err',
      );
      return null;
    }
    const n = Number(a);
    if (!Number.isFinite(n)) {
      ctx.feedback(
        `Nombre invalide « ${a} ». Ex. /h${axis} 0,1.7,0  ·  /h${axis} sans arg + clic`,
        'err',
      );
      return null;
    }
    nums.push(n);
  }

  if (nums.length === 3) {
    return [nums[0]!, nums[1]!, nums[2]!];
  }

  // Legacy raccourci selon l’axe
  if (axis === 'x') {
    // /hx <y> [z]
    if (nums.length === 1) return [0, nums[0]!, 0];
    if (nums.length === 2) return [0, nums[0]!, nums[1]!];
  } else if (axis === 'y') {
    // /hy <x> [z]
    if (nums.length === 1) return [nums[0]!, 0, 0];
    if (nums.length === 2) return [nums[0]!, 0, nums[1]!];
  } else {
    // /hz <x> [y]
    if (nums.length === 1) return [nums[0]!, 0, 0];
    if (nums.length === 2) return [nums[0]!, nums[1]!, 0];
  }

  ctx.feedback(
    `Usage : /h${axis}  (clics)  ·  /h${axis} 0,1.7,0  ·  /h${axis} @  ·  /h${axis} .`,
    'err',
  );
  return null;
}

/**
 * /save ou /saveas.
 * - forceDialog=false : si filePath connu → écrit direct (Ctrl+S) ; sinon dialogue.
 * - forceDialog=true  : toujours dialogue ; le chemin choisi devient le défaut.
 */
async function runSave(
  ctx: CommandContext,
  opts: { forceDialog: boolean; suggestedName?: string },
): Promise<void> {
  const libEdit = ctx.getLibraryEdit?.() ?? null;
  const snap = ctx.doc.snapshot(ctx.viewport.getCameraState());
  snap.wallLibrary = ctx.walls.toDocumentLibrary();
  ctx.doc.setWallLibrary(snap.wallLibrary);

  // Mode édition d’un objet library → écrit sur le disque library/
  if (libEdit) {
    const res = await saveLibraryObject(libEdit.tab, libEdit.name, snap);
    if (!res.ok) {
      ctx.feedback(`Échec save library : ${res.error ?? '?'}`, 'err');
      return;
    }
    objectDefCache.set(libEdit.tab, libEdit.name, snap);
    ctx.doc.markSaved();
    ctx.feedback(
      `Library mise à jour : library/${libEdit.tab}/${libEdit.name}.gkd — toutes les instances se rafraîchiront.`,
      'ok',
    );
    return;
  }

  try {
    // /save avec chemin déjà connu → écriture silencieuse
    if (!opts.forceDialog && ctx.doc.filePath) {
      if (!(await fsAvailable())) {
        ctx.feedback(
          'API disque indisponible. Relancez via lancer-GrokCad.sh.',
          'err',
        );
        return;
      }
      await fsWrite(ctx.doc.filePath, serializeGkd(snap));
      ctx.doc.markSaved();
      ctx.app.rememberFile(ctx.doc.filePath);
      ctx.setDocTitle(ctx.doc.filename);
      ctx.feedback(
        `Enregistré : ${ctx.doc.filePath} (${ctx.doc.helpers.length} aide(s), ${snap.wallLibrary.length} mur(s) biblio)`,
        'ok',
      );
      return;
    }

    // Première sauvegarde ou /saveas → dialogue
    let suggested = 'Sans titre.gkd';
    if (opts.suggestedName) {
      suggested = ensureGkdName(
        basename(opts.suggestedName) || opts.suggestedName,
      );
    } else if (ctx.doc.filename) {
      suggested = ensureGkdName(
        basename(ctx.doc.filename) || ctx.doc.filename,
      );
    }
    const startDir = ctx.doc.filePath
      ? dirname(ctx.doc.filePath)
      : guessStartDir(ctx.doc.filename);

    if (!(await fsAvailable())) {
      ctx.feedback(
        'API disque indisponible — bascule sur téléchargement navigateur. Relancez via lancer-GrokCad.sh pour choisir l’emplacement.',
        'warn',
      );
      downloadGkd(snap, suggested);
      ctx.doc.filename = suggested;
      ctx.doc.markSaved();
      ctx.setDocTitle(ctx.doc.filename);
      return;
    }

    const dest = await pickSaveFilePath(
      opts.forceDialog
        ? 'Enregistrer sous… — dossier et nom du .GKD'
        : 'Enregistrer le dessin .GKD — dossier et nom',
      suggested,
      ['.gkd'],
      startDir,
    );
    if (!dest) {
      ctx.feedback('Enregistrement annulé.', 'warn');
      return;
    }

    let path = dest.path;
    if (!path.toLowerCase().endsWith('.gkd')) path = `${path}.gkd`;
    const fileName = ensureGkdName(basename(path) || dest.fileName);

    // Écrasement : seulement si on change de fichier (pas le même path déjà ouvert)
    const sameAsCurrent =
      ctx.doc.filePath != null && ctx.doc.filePath === path;
    if (!sameAsCurrent && (await fsExists(path))) {
      const ans = await showConfirm({
        title: 'Écraser le fichier ?',
        message: `Le fichier existe déjà :\n${path}\n\nÉcraser ?`,
        buttons: [
          { id: 'ok', label: 'Écraser', primary: true },
          { id: 'cancel', label: 'Annuler' },
        ],
      });
      if (ans !== 'ok') {
        ctx.feedback('Enregistrement annulé.', 'warn');
        return;
      }
    }

    await fsWrite(path, serializeGkd(snap));
    ctx.doc.filePath = path;
    ctx.doc.filename = fileName;
    ctx.doc.markSaved();
    ctx.app.rememberFile(path);
    ctx.setDocTitle(fileName);
    ctx.feedback(
      `Enregistré : ${path} (${ctx.doc.helpers.length} aide(s), ${snap.wallLibrary.length} mur(s) biblio)`,
      'ok',
    );
  } catch (e) {
    ctx.feedback(e instanceof Error ? e.message : String(e), 'err');
  }
}

/** /openlast — premier fichier encore présent dans l’historique (7 max). */
async function runOpenLast(ctx: CommandContext): Promise<void> {
  const recents = [...ctx.app.recentFiles];
  if (recents.length === 0) {
    ctx.feedback(
      'Aucun fichier récent. Ouvrez ou enregistrez un .GKD d’abord.',
      'warn',
    );
    return;
  }
  if (!(await fsAvailable())) {
    ctx.feedback(
      'API disque indisponible. Relancez via lancer-GrokCad.sh.',
      'err',
    );
    return;
  }

  let chosen: (typeof recents)[number] | null = null;
  for (const f of recents) {
    if (await fsExists(f.path)) {
      chosen = f;
      break;
    }
    ctx.app.forgetFile(f.path);
    ctx.feedback(`Plus sur le disque : ${f.path}`, 'warn');
  }
  if (!chosen) {
    ctx.feedback('Aucun des 7 fichiers récents n’existe plus.', 'err');
    return;
  }

  try {
    ctx.tools.cancel(false);
    const { content } = await fsRead(chosen.path);
    const gkd = parseGkd(content);
    ctx.doc.load(gkd, chosen.name, chosen.path);
    ctx.walls.loadFromDocument(gkd.wallLibrary ?? []);
    ctx.viewport.applyCameraState(gkd.camera);
    ctx.setDocTitle(chosen.name);
    ctx.app.rememberFile(chosen.path);
    const objs = gkd.entities.filter((e) => e.kind === 'object');
    for (const o of objs) {
      if (o.kind === 'object') void objectDefCache.ensure(o.libTab, o.libName);
    }
    ctx.feedback(
      `Ouvert (dernier) : ${chosen.path}  (v${gkd.version}, ${gkd.entities.length} entité(s))`,
      'ok',
    );
  } catch (e) {
    ctx.feedback(e instanceof Error ? e.message : String(e), 'err');
  }
}

/**
 * Ouvre un .GKD via l’explorateur disque (chemin absolu mémorisé pour /save).
 * @param startDir dossier initial (dernier /open, stocké dans grokcad.app).
 * Fallback input file si API FS absente (sans chemin disque).
 */
async function pickGkdOpen(startDir?: string): Promise<{
  doc: ReturnType<typeof parseGkd>;
  name: string;
  path: string | null;
} | null> {
  if (await fsAvailable()) {
    const { getFileBrowser } = await import('../ui/FileBrowserDialog');
    const browser = getFileBrowser();
    const r = await browser.open({
      title: 'Ouvrir un dessin .GKD',
      mode: 'pickFiles',
      extensions: ['.gkd'],
      allowDirectoryAsSource: false,
      startPath: startDir,
    });
    if (!r || r.files.length === 0) return null;
    const filePath = r.files[0]!;
    const { content } = await fsRead(filePath);
    const doc = parseGkd(content);
    return {
      doc,
      name: basename(filePath),
      path: filePath,
    };
  }

  // Fallback navigateur (pas de chemin absolu → prochain /save = dialogue)
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gkd,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve({ doc: parseGkd(text), name: file.name, path: null });
      } catch (e) {
        reject(e);
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Précharge les définitions library des instances objet (pour explosion DXF). */
async function ensureObjectDefs(doc: {
  entities: readonly Entity[];
}): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const e of doc.entities) {
    if (e.kind === 'object') {
      jobs.push(objectDefCache.ensure(e.libTab, e.libName));
    }
  }
  if (jobs.length) await Promise.all(jobs);
}

/** Si le nom de doc ressemble à un chemin absolu, en déduit le dossier. */
function guessStartDir(filename: string): string | undefined {
  if (filename.includes('/') && filename.startsWith('/')) {
    return dirname(filename);
  }
  return undefined;
}

export function findCommand(token: string): CommandDef | undefined {
  const t = token.toLowerCase().replace(/^\//, '');
  return commands.find((c) => c.name === t || c.aliases?.includes(t));
}

export function listCommands(): CommandDef[] {
  return commands.slice();
}

export async function executeLine(line: string, ctx: CommandContext): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Pendant un outil : une entrée purement « point » place le point
  if (ctx.tools.isActive && !trimmed.startsWith('/') && !trimmed.startsWith('\\')) {
    const asPoint = parsePoint(trimmed.split(/\s+/).filter(Boolean), ctx);
    if (asPoint) {
      ctx.tools.acceptPoint(asPoint);
      return;
    }
  }

  const normalized = trimmed.replace(/^[/\\]/, '');
  const parts = normalized.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? '';
  const args = parts.slice(1);

  const cmd = findCommand(name);
  if (!cmd) {
    // Si outil actif et entrée non reconnue, tenter comme coordonnées
    if (ctx.tools.isActive) {
      const asPoint = parsePoint(parts, ctx);
      if (asPoint) {
        ctx.tools.acceptPoint(asPoint);
        return;
      }
    }
    ctx.feedback(`Commande inconnue : ${name}. Tapez /help`, 'err');
    return;
  }

  // Nouvelle commande → le gros cercle orange d’accroche disparaît
  ctx.viewport.clearSnap();
  await cmd.run(ctx, args);
}
