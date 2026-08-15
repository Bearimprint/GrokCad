import { executeLine, type CommandContext, type FeedbackLevel } from '../commands/registry';
import type { AppPrefsManager } from '../core/appPrefs';
import type { DimPrefsManager } from '../core/dimPrefs';
import type { CadDocument } from '../core/document';
import type { PenManager } from '../core/penPrefs';
import type { SelectionManager } from '../core/selection';
import { fKeyToSlot, type SelectionSlots } from '../core/selectionSlots';
import type { TextPrefsManager } from '../core/textPrefs';
import type { DrawingTools } from '../core/tools';
import type { HatchPrefsManager } from '../core/hatchPrefs';
import type { WallLibraryManager } from '../core/wallPrefs';
import type { DimStyleDialog } from './DimStyleDialog';
import { getFileBrowser } from './FileBrowserDialog';
import type { HatchLibraryDialog } from './HatchLibraryDialog';
import type { ObjectLibraryDialog } from './ObjectLibraryDialog';
import type { SettingsDialog } from './SettingsDialog';
import type { WallLibraryDialog } from './WallLibraryDialog';
import type { Viewport } from '../viewport/Viewport';

export class CommandBar {
  private input: HTMLInputElement;
  private feedbackEl: HTMLElement;
  private history: string[] = [];
  private histIdx = -1;
  private ctx: CommandContext;
  private tools: DrawingTools;

  constructor(
    input: HTMLInputElement,
    feedbackEl: HTMLElement,
    doc: CadDocument,
    viewport: Viewport,
    pen: PenManager,
    tools: DrawingTools,
    app: AppPrefsManager,
    settings: SettingsDialog,
    walls: WallLibraryManager,
    wallLib: WallLibraryDialog,
    objLib: ObjectLibraryDialog,
    hatch: HatchPrefsManager,
    hatchLib: HatchLibraryDialog,
    selection: SelectionManager,
    selectionSlots: SelectionSlots,
    textPrefs: TextPrefsManager,
    dimPrefs: DimPrefsManager,
    dimStyles: DimStyleDialog,
    setDocTitle: (name: string) => void,
  ) {
    this.input = input;
    this.feedbackEl = feedbackEl;
    this.tools = tools;

    this.ctx = {
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
      textPrefs,
      dimPrefs,
      dimStyles,
      feedback: (msg, level) => this.setFeedback(msg, level),
      setDocTitle,
      focusCommand: () => this.focus(),
    };

    tools.setFeedback((msg, level) => this.setFeedback(msg, level));
    wallLib.setFeedback((msg, level) => this.setFeedback(msg, level));
    hatchLib.setFeedback((msg, level) => this.setFeedback(msg, level));
    objLib.setFeedback((msg, level) => this.setFeedback(msg, level));
    tools.setObjSavePrompt((suggested) => objLib.promptSave(suggested));

    this.input.addEventListener('keydown', (e) => void this.onKey(e));

    /**
     * Échap en phase **capture** : prioritaire, fiable même si le focus est
     * sur le canvas / un bouton, et indépendant de l’interception navigateur
     * partielle sur bubble. Les dialogues ouverts (confirm, FS, murs…) passent
     * avant l’annulation d’outil.
     */
    window.addEventListener(
      'keydown',
      (e) => {
        if (!isEscapeKey(e)) return;

        // Dialogues modaux : les laisser (ou les fermer explicitement)
        try {
          if (getFileBrowser().isOpen()) return; // handler FS en capture aussi
        } catch {
          /* ignore */
        }
        // ConfirmDialog (Échap géré par son propre handler en capture)
        if (document.querySelector('.fs-overlay .confirm-dialog')) return;

        if (settings.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          settings.close();
          return;
        }
        if (dimStyles.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          dimStyles.close();
          return;
        }
        // Dialogue saisie texte (bloc-notes /text)
        if (document.querySelector('.fs-overlay .text-input-dialog')) return;
        if (wallLib.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          wallLib.close(false);
          return;
        }
        if (objLib.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          objLib.close();
          return;
        }
        if (hatchLib.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          hatchLib.close();
          return;
        }

        // Outil interactif actif → terminer / annuler
        if (this.tools.isActive) {
          e.preventDefault();
          e.stopPropagation();
          this.tools.handleEscape();
          viewport.clearSnap();
          this.input.value = '';
          this.focus();
          return;
        }

        // Rien d’actif : vider la CLI + masquer l’accroche orange
        e.preventDefault();
        viewport.clearSnap();
        this.input.value = '';
        this.focus();
      },
      true, // capture
    );

    window.addEventListener('keydown', (e) => {
      // Escape déjà traité en capture — ne pas re-traiter ici
      if (isEscapeKey(e)) return;

      // F10 seul = pivoter caméra +45° autour de Z (toute vue)
      // Shift+F1…F12 = mémoriser sélection · Alt+F1…F12 = rappeler
      const slot = fKeyToSlot(e.key);
      if (slot !== null && !e.ctrlKey && !e.metaKey) {
        if (
          slot === 10 &&
          !e.shiftKey &&
          !e.altKey &&
          !settings.isOpen() &&
          !wallLib.isOpen() &&
          !objLib.isOpen() &&
          !hatchLib.isOpen()
        ) {
          e.preventDefault();
          viewport.rotateCameraAroundWorldZ(45);
          doc.setCamera(viewport.getCameraState());
          this.setFeedback('Caméra +45° (axe Z vertical) · F10 = encore', 'ok');
          return;
        }
        if (e.shiftKey && !e.altKey) {
          e.preventDefault();
          const n = selectionSlots.save(slot, selection.selectedIds);
          this.setFeedback(
            n > 0
              ? `Sélection mémorisée dans F${slot} (${n} id). Alt+F${slot} pour rappeler.`
              : `F${slot} : sélection vide — rien mémorisé.`,
            n > 0 ? 'ok' : 'warn',
          );
          return;
        }
        if (e.altKey && !e.shiftKey) {
          e.preventDefault();
          const live = new Set(doc.entities.map((ent) => ent.id));
          const ids = selectionSlots.restore(slot, live);
          if (ids.length === 0) {
            this.setFeedback(
              selectionSlots.has(slot)
                ? `F${slot} : aucun des éléments mémorisés n’est encore dans le dessin.`
                : `F${slot} : aucune sélection mémorisée (Shift+F${slot} d’abord).`,
              'warn',
            );
            return;
          }
          selection.set(ids);
          this.setFeedback(
            `Sélection F${slot} rappelée : ${ids.length} élém.`,
            'ok',
          );
          return;
        }
      }

      // Delete / Suppr → /delete si sélection et pas dans un champ
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        tag !== 'INPUT' &&
        tag !== 'TEXTAREA' &&
        !this.tools.isActive &&
        selection.size > 0 &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        // Backspace seulement si pas focus input — déjà filtré
        if (e.key === 'Backspace') return; // éviter conflit navigation
        e.preventDefault();
        const n = doc.removeEntities(selection.selectedIds);
        selection.clear();
        this.setFeedback(`${n} élément(s) effacé(s).`, 'ok');
        return;
      }

      // Ctrl+S → /save (rapide si chemin connu, sinon dialogue)
      if (
        (e.key === 's' || e.key === 'S') &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (settings.isOpen() || wallLib.isOpen() || objLib.isOpen()) return;
        try {
          if (getFileBrowser().isOpen()) return;
        } catch {
          /* ignore */
        }
        void executeLine('/save', this.ctx);
        return;
      }

      // Ctrl+Shift+S → /saveas
      if (
        (e.key === 's' || e.key === 'S') &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (settings.isOpen() || wallLib.isOpen() || objLib.isOpen()) return;
        try {
          if (getFileBrowser().isOpen()) return;
        } catch {
          /* ignore */
        }
        void executeLine('/saveas', this.ctx);
        return;
      }

      // Ctrl+D → suppression par désignation (même effet que /d)
      // Actif même si le focus est dans la ligne de commande (évite le favori navigateur).
      if (
        (e.key === 'd' || e.key === 'D') &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (settings.isOpen() || wallLib.isOpen() || objLib.isOpen()) return;
        try {
          if (getFileBrowser().isOpen()) return;
        } catch {
          /* ignore */
        }
        this.tools.startDeletePick();
        this.input.value = '';
        return;
      }

      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.focus();
        if (!this.input.value.startsWith('/')) {
          this.input.value = '/';
        }
      }
    });

    viewport.setSnapHandler((snap, raw, meta) => {
      if (snap) {
        const tag =
          snap.kind === 'intersection'
            ? 'intersection'
            : snap.kind === 'endpoint'
              ? 'extrémité'
              : snap.kind === 'grid'
                ? 'grille'
                : 'courbe';
        const p = snap.point;
        this.setFeedback(
          `Accroche ${tag} → X=${p[0].toFixed(3)} Y=${p[1].toFixed(3)} Z=${p[2].toFixed(3)}  (@ pour réutiliser)  ·  rayon ${viewport.snapRadiusPx()} px`,
          'ok',
        );
      } else if (raw) {
        if (meta.placedAsLeftClick) {
          this.setFeedback(
            'Hors rayon snap — point placé comme un clic gauche (sans accroche).',
            'warn',
          );
        } else {
          this.setFeedback(
            `Pas d'accroche dans ${viewport.snapRadiusPx()} px. Dessinez des aides/lignes/arcs, ou /snap <px> /param.`,
            'warn',
          );
        }
      }
    });

    const canvas = viewport.canvas;
    canvas.addEventListener('pointermove', () => {
      if (this.tools.isActive) this.tools.updatePreview();
    });
  }

  get context(): CommandContext {
    return this.ctx;
  }

  focus(): void {
    this.input.focus();
  }

  setFeedback(msg: string, level: FeedbackLevel = 'info'): void {
    this.feedbackEl.textContent = msg;
    this.feedbackEl.classList.remove('ok', 'err', 'warn');
    if (level === 'ok' || level === 'err' || level === 'warn') {
      this.feedbackEl.classList.add(level);
    }
  }

  private async onKey(e: KeyboardEvent): Promise<void> {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = this.input.value;
      if (!line.trim()) return;
      this.history.push(line);
      this.histIdx = this.history.length;
      this.input.value = '';
      await executeLine(line, this.ctx);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.history.length === 0) return;
      this.histIdx = Math.max(0, this.histIdx - 1);
      this.input.value = this.history[this.histIdx] ?? '';
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.histIdx = Math.min(this.history.length, this.histIdx + 1);
      this.input.value = this.history[this.histIdx] ?? '';
      return;
    }

    // Escape : géré en capture sur window (évite double appel + fiabilité focus canvas)
  }
}

/** Échap — toutes les variantes clavier / navigateur. */
function isEscapeKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Escape' ||
    e.key === 'Esc' ||
    e.code === 'Escape' ||
    e.keyCode === 27
  );
}
