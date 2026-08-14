/**
 * Bibliothèque d'objets (library/<onglet>/*.gkd).
 * Grille 5 colonnes, vignettes = dessin complet (fit min/max).
 * Choisir → pose instance · Modifier → ouvre le .gkd library.
 */

import { objectDefCache } from '../core/objectCache';
import {
  createLibraryTab,
  deleteLibraryObject,
  listLibraryFiles,
  listLibraryTabs,
  loadLibraryObject,
  paintObjectThumbnail,
  type LibraryFileInfo,
} from '../core/objectLibrary';
import type { GkdDocument } from '../core/types';

const CELL = 88;

export type ObjLibFeedback = (
  msg: string,
  level?: 'ok' | 'err' | 'warn' | 'info',
) => void;

export type PlaceObjectHandler = (tab: string, name: string, doc: GkdDocument) => void;
export type EditObjectHandler = (tab: string, name: string, doc: GkdDocument) => void;

export class ObjectLibraryDialog {
  private overlay: HTMLElement;
  private tabsEl: HTMLElement;
  private gridEl: HTMLElement;
  private activeTab = 'sanitaire';
  private files: LibraryFileInfo[] = [];
  private selected: LibraryFileInfo | null = null;
  private cache = new Map<string, GkdDocument>();
  private feedback: ObjLibFeedback = () => undefined;
  private onPlace: PlaceObjectHandler | null = null;
  private onEdit: EditObjectHandler | null = null;
  private resizing = false;
  private resizeStart = { x: 0, y: 0, w: 0, h: 0 };
  private panel: HTMLElement;

  /** Dernier objet choisi (réf. pour pose). */
  current: { tab: string; name: string; doc: GkdDocument } | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'objlib-overlay';
    this.overlay.className = 'walls-overlay hidden';
    this.overlay.innerHTML = `
      <div class="walls-dialog objlib-dialog" role="dialog" aria-labelledby="objlib-title">
        <header class="walls-header">
          <h2 id="objlib-title">Bibliothèque d’objets</h2>
          <button type="button" class="walls-close" data-close title="Fermer">×</button>
        </header>
        <div class="walls-tabs" id="objlib-tabs"></div>
        <div class="walls-grid" id="objlib-grid"></div>
        <div class="walls-toolbar">
          <div class="walls-actions">
            <button type="button" class="walls-btn" data-act="refresh">Actualiser</button>
            <button type="button" class="walls-btn" data-act="edit" title="Ouvrir pour modification">Modifier</button>
            <button type="button" class="walls-btn" data-act="del">Supprimer</button>
            <button type="button" class="walls-btn walls-btn-primary" data-act="pick">Choisir / Poser</button>
          </div>
        </div>
        <p class="walls-hint">
          <strong>Choisir</strong> : objet collé à la souris (origine 0,0,0) jusqu’au clic.
          <strong>Modifier</strong> : ouvre le .gkd library dans le canvas (sauvegarder = maj de toutes les instances).
          Créer : <strong>/obj</strong> · Exploser une instance : <strong>/explode</strong>.
        </p>
        <div class="walls-resize" title="Redimensionner"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.panel = this.overlay.querySelector('.walls-dialog')!;
    this.tabsEl = this.overlay.querySelector('#objlib-tabs')!;
    this.gridEl = this.overlay.querySelector('#objlib-grid')!;

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) this.close();
    });

    this.overlay.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'refresh') void this.reload();
        else if (act === 'del') void this.onDelete();
        else if (act === 'pick') void this.onPick();
        else if (act === 'edit') void this.onEditClick();
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    const grip = this.overlay.querySelector('.walls-resize') as HTMLElement;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.resizing = true;
      const rect = this.panel.getBoundingClientRect();
      this.resizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!this.resizing) return;
      const w = Math.max(360, Math.min(window.innerWidth - 40, this.resizeStart.w + e.clientX - this.resizeStart.x));
      const h = Math.max(320, Math.min(window.innerHeight - 40, this.resizeStart.h + e.clientY - this.resizeStart.y));
      this.panel.style.width = `${w}px`;
      this.panel.style.height = `${h}px`;
    });
    grip.addEventListener('pointerup', () => {
      this.resizing = false;
    });
  }

  setFeedback(fn: ObjLibFeedback): void {
    this.feedback = fn;
  }

  setPlaceHandler(fn: PlaceObjectHandler): void {
    this.onPlace = fn;
  }

  setEditHandler(fn: EditObjectHandler): void {
    this.onEdit = fn;
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  async open(): Promise<void> {
    this.overlay.classList.remove('hidden');
    await this.reload();
  }

  close(): void {
    this.overlay.classList.add('hidden');
  }

  async promptSave(suggestedName: string): Promise<{ tab: string; name: string } | null> {
    const tabs = await listLibraryTabs();
    const tabList = tabs.join(', ');
    const tab = window.prompt(
      `Onglet library (${tabList}) :\n(+ pour créer un nouvel onglet, tapez le nom)`,
      this.activeTab || tabs[0] || 'sanitaire',
    );
    if (!tab?.trim()) return null;
    const t = tab.trim();
    if (!tabs.includes(t)) {
      await createLibraryTab(t);
    }
    const name = window.prompt('Nom de l’objet :', suggestedName);
    if (!name?.trim()) return null;
    this.activeTab = t;
    return { tab: t, name: name.trim() };
  }

  private async reload(): Promise<void> {
    const tabs = await listLibraryTabs();
    if (!tabs.includes(this.activeTab) && tabs[0]) this.activeTab = tabs[0];
    this.renderTabs(tabs);
    this.files = await listLibraryFiles(this.activeTab);
    await this.renderGrid();
  }

  private renderTabs(tabs: string[]): void {
    this.tabsEl.innerHTML = '';
    for (const tab of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'walls-tab' + (tab === this.activeTab ? ' active' : '');
      b.textContent = tab;
      b.addEventListener('click', () => {
        this.activeTab = tab;
        void this.reload();
      });
      this.tabsEl.appendChild(b);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'walls-tab walls-tab-add';
    add.textContent = '+';
    add.title = 'Nouvel onglet (= sous-dossier library/)';
    add.addEventListener('click', async () => {
      const name = window.prompt('Nom du nouvel onglet / dossier :', 'divers');
      if (!name?.trim()) return;
      await createLibraryTab(name.trim());
      this.activeTab = name.trim();
      await this.reload();
    });
    this.tabsEl.appendChild(add);
  }

  private async renderGrid(): Promise<void> {
    this.gridEl.innerHTML = '';
    if (this.files.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'walls-hint';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'Aucun objet dans cet onglet. /select puis /obj pour en créer.';
      this.gridEl.appendChild(empty);
      return;
    }

    for (const f of this.files) {
      const key = `${f.tab}/${f.name}`;
      let doc = this.cache.get(key);
      if (!doc) {
        doc = (await loadLibraryObject(f.tab, f.name)) ?? undefined;
        if (doc) {
          this.cache.set(key, doc);
          objectDefCache.set(f.tab, f.name, doc);
        }
      }

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className =
        'walls-cell' +
        (this.selected?.name === f.name && this.selected.tab === f.tab
          ? ' selected'
          : '');
      cell.title = `library/${f.tab}/${f.name}.gkd`;

      const canvas = document.createElement('canvas');
      canvas.width = CELL;
      canvas.height = CELL;
      canvas.className = 'walls-cell-canvas';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        paintObjectThumbnail(ctx, CELL, doc?.entities ?? [], {
          selected:
            this.selected?.name === f.name && this.selected.tab === f.tab,
        });
      }

      const label = document.createElement('span');
      label.className = 'walls-cell-label';
      label.textContent = f.name;

      cell.appendChild(canvas);
      cell.appendChild(label);
      cell.addEventListener('click', () => {
        this.selected = f;
        void this.renderGrid();
      });
      cell.addEventListener('dblclick', () => void this.onPick());
      this.gridEl.appendChild(cell);
    }
  }

  private async loadSelected(): Promise<{
    tab: string;
    name: string;
    doc: GkdDocument;
  } | null> {
    if (!this.selected) {
      this.feedback('Choisissez un objet.', 'warn');
      return null;
    }
    const key = `${this.selected.tab}/${this.selected.name}`;
    let doc = this.cache.get(key);
    if (!doc) {
      doc = (await loadLibraryObject(this.selected.tab, this.selected.name)) ?? undefined;
      if (doc) {
        this.cache.set(key, doc);
        objectDefCache.set(this.selected.tab, this.selected.name, doc);
      }
    }
    if (!doc) {
      this.feedback('Impossible de charger l’objet.', 'err');
      return null;
    }
    return { tab: this.selected.tab, name: this.selected.name, doc };
  }

  private async onDelete(): Promise<void> {
    if (!this.selected) {
      this.feedback('Aucun objet sélectionné.', 'warn');
      return;
    }
    if (
      !window.confirm(
        `Supprimer « ${this.selected.name} » de library/${this.selected.tab}/ ?\nLes instances déjà placées resteront mais sans définition.`,
      )
    ) {
      return;
    }
    const ok = await deleteLibraryObject(this.selected.tab, this.selected.name);
    this.cache.delete(`${this.selected.tab}/${this.selected.name}`);
    objectDefCache.invalidate(this.selected.tab, this.selected.name);
    this.selected = null;
    this.feedback(ok ? 'Objet supprimé.' : 'Échec suppression.', ok ? 'ok' : 'err');
    await this.reload();
  }

  private async onPick(): Promise<void> {
    const loaded = await this.loadSelected();
    if (!loaded) return;
    this.current = loaded;
    objectDefCache.set(loaded.tab, loaded.name, loaded.doc);
    this.close();
    if (this.onPlace) {
      this.onPlace(loaded.tab, loaded.name, loaded.doc);
    } else {
      this.feedback(`Objet « ${loaded.name} » prêt (pas de handler de pose).`, 'warn');
    }
  }

  private async onEditClick(): Promise<void> {
    const loaded = await this.loadSelected();
    if (!loaded) return;
    objectDefCache.set(loaded.tab, loaded.name, loaded.doc);
    this.close();
    if (this.onEdit) {
      this.onEdit(loaded.tab, loaded.name, loaded.doc);
    } else {
      this.feedback('Édition library non branchée.', 'err');
    }
  }
}
