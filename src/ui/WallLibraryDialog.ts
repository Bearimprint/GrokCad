/**
 * Bibliothèque de murs (WALLS.md) :
 * - grille 5 colonnes, onglets, créer / supprimer / déplacer
 * - 1ʳᵉ face = clic dans le carré (offset 0, stylo + type/priorité)
 * - suivantes = **épaisseur de couche** (ajoutée après la dernière ligne)
 * - priorités depuis library/walls/layer-priorities.json (pas le style de trait)
 * - clic sur un mur → sélection + fermeture ; Échap = fermer sans changer
 */

import type { PenManager } from '../core/penPrefs';
import type { WallLibraryManager } from '../core/wallPrefs';
import type { WallLineDef, WallStyle } from '../core/types';
import {
  formatLayerTypeLabel,
  getWallLayerCatalog,
  type WallLayerCatalogManager,
  type WallLayerTypeDef,
} from '../core/wallLayerCatalog';
import { emptyWallStyle, paintWallCell } from '../core/walls';

const CELL = 72;
const COLS = 5;

export type WallLibFeedback = (msg: string, level?: 'ok' | 'err' | 'warn' | 'info') => void;

export class WallLibraryDialog {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private tabsEl: HTMLElement;
  private gridEl: HTMLElement;
  private distInput: HTMLInputElement;
  private layerSelect: HTMLSelectElement;
  private activeTab: string;
  /** Style en cours de construction (carré vide). */
  private draftId: string | null = null;
  /** Sélection dans la grille (pour supprimer / déplacer). */
  private selectedId: string | null = null;
  private feedback: WallLibFeedback = () => undefined;
  private resizing = false;
  private resizeStart = { x: 0, y: 0, w: 0, h: 0 };
  private catalog: WallLayerCatalogManager;

  constructor(
    private walls: WallLibraryManager,
    private pen: PenManager,
  ) {
    this.catalog = getWallLayerCatalog();
    this.activeTab = walls.tabs[0] ?? 'Général';
    this.selectedId = walls.currentId;

    this.overlay = document.createElement('div');
    this.overlay.id = 'walls-overlay';
    this.overlay.className = 'walls-overlay hidden';
    this.overlay.innerHTML = `
      <div class="walls-dialog" role="dialog" aria-labelledby="walls-title">
        <header class="walls-header">
          <h2 id="walls-title">Bibliothèque de murs</h2>
          <button type="button" class="walls-close" data-close title="Fermer (Échap)">×</button>
        </header>
        <div class="walls-tabs" id="walls-tabs"></div>
        <div class="walls-grid" id="walls-grid"></div>
        <div class="walls-toolbar">
          <label class="walls-dist" title="Épaisseur de la couche suivante (ajoutée après la dernière ligne)">
            <span>Épaisseur couche</span>
            <input type="text" id="walls-dist" inputmode="decimal" placeholder="ex. 0.16" autocomplete="off" />
          </label>
          <label class="walls-layer-type" title="Priorité de raccord (fichier library/walls/layer-priorities.json). Apparence = stylo courant.">
            <span>Couche / priorité</span>
            <select id="walls-layer-type"></select>
          </label>
          <div class="walls-actions">
            <button type="button" class="walls-btn" data-act="add" title="Nouveau mur vide">Ajouter</button>
            <button type="button" class="walls-btn" data-act="del" title="Supprimer le mur sélectionné">Supprimer</button>
            <button type="button" class="walls-btn" data-act="move" title="Déplacer vers un onglet">Déplacer</button>
            <button type="button" class="walls-btn walls-btn-primary" data-act="pick" title="Utiliser le mur sélectionné">Choisir</button>
          </div>
        </div>
        <p class="walls-hint">
          <strong>Ajouter</strong> → <strong>clic dans le carré</strong> = 1ʳᵉ face (sans type).
          Puis type + <strong>épaisseur</strong> = une bande de matériau (le type s’applique à la bande,
          les traits partagés appartiennent à 2 couches). Ex. 0.02 enduit puis 0.16 béton →
          traits à 0, 0.02, 0.18 ; le trait 0.02 = fin enduit + début béton.
          Prio <strong>1</strong> = structure. <strong>Choisir</strong> = défaut. <kbd>Échap</kbd> ferme.
        </p>
        <div class="walls-resize" title="Redimensionner"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.panel = this.overlay.querySelector('.walls-dialog')!;
    this.tabsEl = this.overlay.querySelector('#walls-tabs')!;
    this.gridEl = this.overlay.querySelector('#walls-grid')!;
    this.distInput = this.overlay.querySelector('#walls-dist')!;
    this.layerSelect = this.overlay.querySelector('#walls-layer-type')!;
    this.fillLayerSelect();

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) {
        this.close(false);
      }
    });

    this.overlay.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'add') this.onAdd();
        else if (act === 'del') this.onDelete();
        else if (act === 'move') this.onMove();
        else if (act === 'pick') this.onPick();
      });
    });

    this.distInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.onDistanceEnter();
      }
      // Empêcher lettres
      if (e.key.length === 1 && !/[0-9.,+\-]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        this.close(false);
      }
    });

    // Resize coin bas-droit
    const grip = this.overlay.querySelector('.walls-resize') as HTMLElement;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.resizing = true;
      const rect = this.panel.getBoundingClientRect();
      this.resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!this.resizing) return;
      const dw = e.clientX - this.resizeStart.x;
      const dh = e.clientY - this.resizeStart.y;
      const w = Math.max(360, Math.min(window.innerWidth - 40, this.resizeStart.w + dw));
      const h = Math.max(320, Math.min(window.innerHeight - 40, this.resizeStart.h + dh));
      this.panel.style.width = `${w}px`;
      this.panel.style.height = `${h}px`;
    });
    grip.addEventListener('pointerup', () => {
      this.resizing = false;
    });

    this.walls.onChange(() => {
      if (this.isOpen()) this.render();
    });
    this.catalog.onChange(() => {
      this.fillLayerSelect();
    });
    this.pen.onChange(() => {
      // stylo change pendant création — rien à redessiner sauf feedback
    });
  }

  setFeedback(fn: WallLibFeedback): void {
    this.feedback = fn;
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    if (!this.walls.tabs.includes(this.activeTab)) {
      this.activeTab = this.walls.tabs[0] ?? 'Général';
    }
    this.selectedId = this.walls.currentId;
    this.draftId = null;
    this.overlay.classList.remove('hidden');
    void this.catalog.reloadFromDisk().then((r) => {
      this.fillLayerSelect();
      if (r.ok && this.isOpen()) {
        this.feedback(
          `Catalogue couches chargé (${this.catalog.types.length} types) — ${r.source}`,
          'info',
        );
      }
    });
    this.fillLayerSelect();
    this.render();
    this.distInput.focus();
  }

  private fillLayerSelect(): void {
    const prev = this.layerSelect.value;
    this.layerSelect.innerHTML = '';
    for (const t of this.catalog.types) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = formatLayerTypeLabel(t);
      this.layerSelect.appendChild(opt);
    }
    if (prev && this.catalog.findById(prev)) {
      this.layerSelect.value = prev;
    } else {
      this.layerSelect.value = this.catalog.defaultType().id;
    }
  }

  /** Type de couche sélectionné pour la prochaine ligne posée. */
  private selectedLayerType(): WallLayerTypeDef {
    return (
      this.catalog.findById(this.layerSelect.value) ?? this.catalog.defaultType()
    );
  }

  /**
   * Construit une WallLineDef :
   * - apparence = stylo courant
   * - type/prio = matériau de la **bande** fermée par ce trait (sauf 1ʳᵉ face)
   *
   * Modèle : matériaux = bandes entre traits. Trait 0 = 1ʳᵉ face (pas de type).
   * Chaque épaisseur ajoute un trait dont type = le matériau de la bande.
   * Un trait intermédiaire est partagé par 2 matériaux (ex. fin béton = début isolant).
   */
  private makeLineDef(
    offset: number,
    opts?: { firstFace?: boolean },
  ): WallLineDef {
    const stroke = this.pen.strokeFields();
    if (opts?.firstFace) {
      return {
        offset,
        color: stroke.color,
        lineWidth: stroke.lineWidth,
        lineStyle: stroke.lineStyle,
        // Pas de priority / layerTypeId : géométrie pure
      };
    }
    const t = this.selectedLayerType();
    return {
      offset,
      color: stroke.color,
      lineWidth: stroke.lineWidth,
      lineStyle: stroke.lineStyle,
      priority: t.priority,
      layerTypeId: t.id,
    };
  }

  /**
   * @param applySelection si true, fixe le mur courant sur la sélection
   */
  close(applySelection: boolean): void {
    if (applySelection && this.selectedId) {
      const s = this.walls.styles.find((x) => x.id === this.selectedId);
      if (s && s.lines.length > 0) {
        this.walls.setCurrent(this.selectedId);
        this.feedback(`Mur par défaut : « ${s.name} » (${s.lines.length} trait(s))`, 'ok');
      } else if (s && s.lines.length === 0) {
        this.feedback('Ce mur n’a aucun trait — sélection annulée.', 'warn');
      }
    }
    this.cleanupEmptyDrafts();
    this.draftId = null;
    this.overlay.classList.add('hidden');
  }

  private render(): void {
    this.renderTabs();
    this.renderGrid();
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = '';
    for (const tab of this.walls.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'walls-tab' + (tab === this.activeTab ? ' active' : '');
      b.textContent = tab;
      b.addEventListener('click', () => {
        this.activeTab = tab;
        this.render();
      });
      this.tabsEl.appendChild(b);
    }
    const addTab = document.createElement('button');
    addTab.type = 'button';
    addTab.className = 'walls-tab walls-tab-add';
    addTab.textContent = '+';
    addTab.title = 'Nouvel onglet';
    addTab.addEventListener('click', () => {
      const name = window.prompt('Nom du nouvel onglet :', 'Intérieurs');
      if (!name?.trim()) return;
      this.walls.addTab(name.trim());
      this.activeTab = name.trim();
      this.render();
    });
    this.tabsEl.appendChild(addTab);
  }

  private renderGrid(): void {
    this.gridEl.innerHTML = '';
    const list = this.walls.stylesInTab(this.activeTab);

    for (const style of list) {
      this.gridEl.appendChild(this.makeCell(style, false));
    }

    // Placeholder pour indiquer l'ajout (optionnel si draft déjà dans list)
    const cols = Math.max(COLS, 1);
    const remainder = list.length % cols;
    // pas de filler obligatoire
    void remainder;
  }

  private makeCell(style: WallStyle, _emptySlot: boolean): HTMLElement {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className =
      'walls-cell' +
      (style.id === this.selectedId ? ' selected' : '') +
      (style.id === this.draftId ? ' draft' : '') +
      (style.lines.length === 0 ? ' empty' : '');
    cell.title =
      style.lines.length === 0
        ? 'Cliquez pour poser la 1ʳᵉ ligne (stylo + couche/priorité sélectionnés)'
        : `${style.name} — ${style.lines.length} trait(s) · ${layerSummary(style.lines)} · clic = sélectionner`;

    const canvas = document.createElement('canvas');
    canvas.width = CELL;
    canvas.height = CELL;
    canvas.className = 'walls-cell-canvas';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintWallCell(ctx, CELL, style.lines, {
        empty: style.lines.length === 0,
        selected: style.id === this.selectedId,
      });
    }

    const label = document.createElement('span');
    label.className = 'walls-cell-label';
    label.textContent =
      style.lines.length === 0
        ? 'vide'
        : `${style.lines.length}t · ${wallWidthLabel(style.lines)} · p${minPriority(style.lines)}`;

    cell.appendChild(canvas);
    cell.appendChild(label);

    cell.addEventListener('click', () => this.onCellClick(style));
    return cell;
  }

  private onCellClick(style: WallStyle): void {
    // Carré en construction vide → 1ʳᵉ ligne
    if (style.lines.length === 0) {
      this.selectedId = style.id;
      this.draftId = style.id;
      this.addFirstLine(style.id);
      return;
    }

    // Mur existant : sélection + fermeture (devient mur par défaut)
    this.selectedId = style.id;
    this.walls.setCurrent(style.id);
    this.feedback(`Mur par défaut : « ${style.name} »`, 'ok');
    this.cleanupEmptyDrafts();
    this.draftId = null;
    this.overlay.classList.add('hidden');
  }

  private cleanupEmptyDrafts(): void {
    for (const s of [...this.walls.styles]) {
      if (s.lines.length === 0) this.walls.removeStyle(s.id);
    }
  }

  private addFirstLine(styleId: string): void {
    // 1ʳᵉ face = géométrie seule (pas de type/prio : la 1ʳᵉ bande sera
    // définie par le type choisi pour la 1ʳᵉ épaisseur).
    const line = this.makeLineDef(0, { firstFace: true });
    const style = this.walls.styles.find((s) => s.id === styleId);
    if (!style) return;
    this.walls.updateStyle(styleId, {
      lines: [line],
      name: style.name === 'Nouveau mur' ? `Mur ${style.lines.length + 1}` : style.name,
    });
    const n = this.walls.styles.filter((s) => s.lines.length > 0).length;
    this.walls.updateStyle(styleId, {
      lines: [line],
      name: `Mur ${n}`,
    });
    this.draftId = styleId;
    this.selectedId = styleId;
    this.feedback(
      `1ʳᵉ face (offset 0) — sans type. Choisissez le type de la 1ʳᵉ couche, ` +
        `puis entrez son épaisseur (ex. 0.02).`,
      'ok',
    );
    this.render();
    this.distInput.focus();
  }

  private onDistanceEnter(): void {
    const raw = this.distInput.value.trim().replace(',', '.');
    if (!raw) return;
    const thickness = Number(raw);
    if (!Number.isFinite(thickness) || thickness <= 0) {
      this.feedback('Épaisseur invalide (nombre > 0, unité monde).', 'err');
      return;
    }

    const id = this.draftId ?? this.selectedId;
    if (!id) {
      this.feedback('Sélectionnez un mur en construction (Ajouter puis clic dans le carré).', 'warn');
      return;
    }
    const style = this.walls.styles.find((s) => s.id === id);
    if (!style || style.lines.length === 0) {
      this.feedback('Posez d’abord la 1ʳᵉ face (clic dans le carré vide).', 'warn');
      return;
    }

    // Épaisseur de couche = écart depuis la dernière ligne (max offset), pas depuis la 1ʳᵉ.
    // Ex. faces à 0 puis ép. 0.02 → 0.02 ; puis ép. 0.16 → 0.18.
    const lastOff = Math.max(...style.lines.map((l) => l.offset));
    const offset = lastOff + thickness;
    if (style.lines.some((l) => Math.abs(l.offset - offset) < 1e-9)) {
      this.feedback('Une ligne existe déjà à cet offset.', 'warn');
      return;
    }

    // Type/prio sur le nouveau trait = matériau de la bande qu’on ferme
    // (entre lastOff et offset). Le trait précédent devient aussi face de ce matériau.
    const line = this.makeLineDef(offset);
    const lines = [...style.lines, line].sort((a, b) => a.offset - b.offset);

    this.walls.updateStyle(id, { lines });
    this.draftId = id;
    this.selectedId = id;
    this.distInput.value = '';
    const t = this.selectedLayerType();
    this.feedback(
      `Bande « ${t.name} » (prio ${t.priority}) ép. ${thickness} → trait à ${formatOff(offset)}. ` +
        `Encore une épaisseur ou Choisir.`,
      'ok',
    );
    this.render();
  }

  private onAdd(): void {
    const style = emptyWallStyle(this.activeTab);
    this.walls.addStyle(style);
    // addStyle set current — on garde draft
    this.draftId = style.id;
    this.selectedId = style.id;
    this.feedback('Nouveau mur vide — cliquez dans le carré pour la 1ʳᵉ ligne (stylo).', 'info');
    this.render();
  }

  private onDelete(): void {
    const id = this.selectedId;
    if (!id) {
      this.feedback('Aucun mur sélectionné.', 'warn');
      return;
    }
    const s = this.walls.styles.find((x) => x.id === id);
    if (!s) return;
    if (!window.confirm(`Supprimer « ${s.name} » ?`)) return;
    this.walls.removeStyle(id);
    if (this.draftId === id) this.draftId = null;
    this.selectedId = this.walls.currentId;
    this.feedback('Mur supprimé.', 'ok');
    this.render();
  }

  private onMove(): void {
    const id = this.selectedId;
    if (!id) {
      this.feedback('Sélectionnez un mur à déplacer.', 'warn');
      return;
    }
    const tabs = this.walls.tabs;
    const choice = window.prompt(
      `Onglet de destination (existant ou nouveau) :\n${tabs.join(', ')}`,
      this.activeTab,
    );
    if (!choice?.trim()) return;
    const tab = choice.trim();
    if (!this.walls.tabs.includes(tab)) {
      this.walls.addTab(tab);
    }
    this.walls.moveStyle(id, tab);
    this.activeTab = tab;
    this.feedback(`Mur déplacé vers « ${tab} ».`, 'ok');
    this.render();
  }

  private onPick(): void {
    if (!this.selectedId) {
      this.feedback('Sélectionnez un mur.', 'warn');
      return;
    }
    const s = this.walls.styles.find((x) => x.id === this.selectedId);
    if (!s || s.lines.length === 0) {
      this.feedback('Le mur doit avoir au moins un trait.', 'warn');
      return;
    }
    this.close(true);
  }
}

function formatOff(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a < 1e-9) return '0';
  if (a < 1) return v.toFixed(3).replace(/\.?0+$/, '') || '0';
  if (a < 10) return v.toFixed(2).replace(/\.?0+$/, '');
  return v.toFixed(1).replace(/\.?0+$/, '');
}

function wallWidthLabel(lines: WallLineDef[]): string {
  if (lines.length === 0) return '0';
  const min = Math.min(...lines.map((l) => l.offset));
  const max = Math.max(...lines.map((l) => l.offset));
  const w = max - min;
  return w < 1e-6 ? '0' : formatOff(w);
}

function minPriority(lines: WallLineDef[]): number {
  if (lines.length === 0) return 3;
  return Math.min(...lines.map((l) => (typeof l.priority === 'number' ? l.priority : 3)));
}

function layerSummary(lines: WallLineDef[]): string {
  const parts = lines.map((l) => {
    const p = typeof l.priority === 'number' ? l.priority : 3;
    return `p${p}`;
  });
  return parts.join('/');
}
