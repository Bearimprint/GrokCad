/**
 * Bibliothèque de hachures (/hatch) — library/hatch/*.gkd (1 m × 1 m).
 * Créer / Choisir / Supprimer · échelle · rotation.
 */

import {
  createLibraryTab,
  deleteLibraryObject,
  listLibraryFiles,
  loadLibraryObject,
  paintObjectThumbnail,
  saveLibraryObject,
  type LibraryFileInfo,
} from '../core/objectLibrary';
import {
  DEFAULT_HATCH_SCALES,
  HATCH_LIBRARY_TAB,
  type HatchPrefsManager,
} from '../core/hatchPrefs';
import { defaultCamera } from '../core/gkd';
import {
  APP_VERSION,
  GKD_MAGIC,
  type GkdDocument,
} from '../core/types';
import { defaultHatchPatternEntities } from '../core/fill';

const CELL = 88;

export type HatchLibFeedback = (
  msg: string,
  level?: 'ok' | 'err' | 'warn' | 'info',
) => void;

export type HatchEditHandler = (name: string, doc: GkdDocument) => void;

export class HatchLibraryDialog {
  private overlay: HTMLElement;
  private panel: HTMLElement;
  private gridEl: HTMLElement;
  private scaleSel: HTMLSelectElement;
  private rotInput: HTMLInputElement;
  private files: LibraryFileInfo[] = [];
  private selected: LibraryFileInfo | null = null;
  private cache = new Map<string, GkdDocument>();
  private feedback: HatchLibFeedback = () => undefined;
  private onEdit: HatchEditHandler | null = null;
  private resizing = false;
  private resizeStart = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private hatch: HatchPrefsManager) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'hatch-overlay';
    this.overlay.className = 'walls-overlay hidden';
    this.overlay.innerHTML = `
      <div class="walls-dialog hatch-dialog" role="dialog" aria-labelledby="hatch-title">
        <header class="walls-header">
          <h2 id="hatch-title">Bibliothèque de hachures</h2>
          <button type="button" class="walls-close" data-close title="Fermer (Échap)">×</button>
        </header>
        <div class="walls-grid" id="hatch-grid"></div>
        <div class="walls-toolbar hatch-toolbar">
          <label class="walls-dist">
            <span>Échelle</span>
            <select id="hatch-scale"></select>
          </label>
          <label class="walls-dist">
            <span>Rotation (°)</span>
            <input type="number" id="hatch-rot" min="0" max="360" step="1" value="0" />
          </label>
          <div class="walls-actions">
            <button type="button" class="walls-btn" data-act="add" title="Nouveau motif 1 m × 1 m">Créer</button>
            <button type="button" class="walls-btn" data-act="edit" title="Modifier le motif">Modifier</button>
            <button type="button" class="walls-btn" data-act="del">Supprimer</button>
            <button type="button" class="walls-btn walls-btn-primary" data-act="pick">Choisir</button>
          </div>
        </div>
        <p class="walls-hint">
          Motifs <strong>.gkd</strong> dans un carré de <strong>1 m × 1 m</strong> (library/hatch/).
          <strong>Choisir</strong> mémorise le motif + échelle + rotation pour <strong>/fill</strong>.
          <kbd>Échap</kbd> ferme.
        </p>
        <div class="walls-resize" title="Redimensionner"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.panel = this.overlay.querySelector('.walls-dialog')!;
    this.gridEl = this.overlay.querySelector('#hatch-grid')!;
    this.scaleSel = this.overlay.querySelector('#hatch-scale')!;
    this.rotInput = this.overlay.querySelector('#hatch-rot')!;

    for (const s of DEFAULT_HATCH_SCALES) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = s >= 1 ? `1/${1 / s === 1 ? '1' : formatScale(s)}` : `1/${Math.round(1 / s)}`;
      if (s === 1) opt.textContent = '1/1';
      else if (s > 1) opt.textContent = `${s}/1`;
      else opt.textContent = `1/${Math.round(1 / s)}`;
      this.scaleSel.appendChild(opt);
    }
    // valeur libre
    const custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = 'Personnalisé…';
    this.scaleSel.appendChild(custom);

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) this.close();
    });

    this.overlay.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'add') void this.onCreate();
        else if (act === 'del') void this.onDelete();
        else if (act === 'pick') void this.onPick();
        else if (act === 'edit') void this.onEditClick();
      });
    });

    this.scaleSel.addEventListener('change', () => {
      if (this.scaleSel.value === '__custom__') {
        const raw = window.prompt('Échelle (ex. 0.25 = 1/4) :', String(this.hatch.scale));
        const n = raw != null ? Number(raw.replace(',', '.')) : NaN;
        if (Number.isFinite(n) && n > 0) {
          this.hatch.setScale(n);
          this.syncControls();
        } else {
          this.syncControls();
        }
        return;
      }
      const n = Number(this.scaleSel.value);
      if (Number.isFinite(n) && n > 0) this.hatch.setScale(n);
    });

    this.rotInput.addEventListener('change', () => {
      const n = Number(this.rotInput.value);
      if (Number.isFinite(n)) this.hatch.setRotationDeg(n);
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
      this.resizeStart = {
        x: e.clientX,
        y: e.clientY,
        w: rect.width,
        h: rect.height,
      };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!this.resizing) return;
      const w = Math.max(
        360,
        Math.min(window.innerWidth - 40, this.resizeStart.w + e.clientX - this.resizeStart.x),
      );
      const h = Math.max(
        320,
        Math.min(window.innerHeight - 40, this.resizeStart.h + e.clientY - this.resizeStart.y),
      );
      this.panel.style.width = `${w}px`;
      this.panel.style.height = `${h}px`;
    });
    grip.addEventListener('pointerup', () => {
      this.resizing = false;
    });
  }

  setFeedback(fn: HatchLibFeedback): void {
    this.feedback = fn;
  }

  setEditHandler(fn: HatchEditHandler): void {
    this.onEdit = fn;
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  async open(): Promise<void> {
    this.syncControls();
    this.overlay.classList.remove('hidden');
    await this.reload();
  }

  close(): void {
    this.overlay.classList.add('hidden');
  }

  private syncControls(): void {
    const s = this.hatch.scale;
    const match = [...this.scaleSel.options].find(
      (o) => o.value !== '__custom__' && Math.abs(Number(o.value) - s) < 1e-9,
    );
    if (match) this.scaleSel.value = match.value;
    else {
      // inject custom value
      let opt = [...this.scaleSel.options].find((o) => o.dataset.custom === '1');
      if (!opt) {
        opt = document.createElement('option');
        opt.dataset.custom = '1';
        this.scaleSel.insertBefore(opt, this.scaleSel.lastElementChild);
      }
      opt.value = String(s);
      opt.textContent = s >= 1 ? `${s}/1` : `1/${Math.round(1 / s)}`;
      this.scaleSel.value = opt.value;
    }
    this.rotInput.value = String(Math.round(this.hatch.rotationDeg));
  }

  private async reload(): Promise<void> {
    await createLibraryTab(HATCH_LIBRARY_TAB);
    this.files = await listLibraryFiles(HATCH_LIBRARY_TAB);
    // Si vide : créer le motif par défaut lignes45
    if (this.files.length === 0) {
      const doc = emptyHatchDoc('lignes45', defaultHatchPatternEntities());
      await saveLibraryObject(HATCH_LIBRARY_TAB, 'lignes45', doc);
      this.files = await listLibraryFiles(HATCH_LIBRARY_TAB);
      if (!this.hatch.currentName) this.hatch.setCurrent('lignes45');
    }
    this.cache.clear();
    this.renderGrid();
  }

  private renderGrid(): void {
    this.gridEl.innerHTML = '';
    for (const f of this.files) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'walls-cell';
      if (this.selected?.name === f.name) cell.classList.add('selected');
      if (this.hatch.currentName === f.name) cell.classList.add('hatch-current');
      cell.title = f.name;

      const canvas = document.createElement('canvas');
      canvas.className = 'walls-cell-canvas';
      canvas.width = CELL;
      canvas.height = CELL;
      cell.appendChild(canvas);

      const label = document.createElement('span');
      label.className = 'walls-cell-label';
      label.textContent = f.name;
      cell.appendChild(label);

      cell.addEventListener('click', () => {
        this.selected = f;
        this.renderGrid();
      });
      cell.addEventListener('dblclick', () => void this.onPick());

      this.gridEl.appendChild(cell);
      void this.paintThumb(f, canvas);
    }
    if (this.files.length === 0) {
      this.gridEl.innerHTML =
        '<div class="fs-empty" style="padding:1rem;grid-column:1/-1">Aucun motif — cliquez Créer.</div>';
    }
  }

  private async paintThumb(f: LibraryFileInfo, canvas: HTMLCanvasElement): Promise<void> {
    let doc = this.cache.get(f.name);
    if (!doc) {
      doc = (await loadLibraryObject(HATCH_LIBRARY_TAB, f.name)) ?? undefined;
      if (doc) this.cache.set(f.name, doc);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintObjectThumbnail(ctx, CELL, doc?.entities ?? [], {
      selected: this.selected?.name === f.name,
    });
  }

  private async onCreate(): Promise<void> {
    const raw = window.prompt('Nom du nouveau motif hachure :', 'motif');
    if (!raw?.trim()) return;
    const name = raw.trim().replace(/[/\\?%*:|"<>]/g, '');
    if (!name) {
      this.feedback('Nom invalide.', 'err');
      return;
    }
    const existing = this.files.some((f) => f.name === name);
    if (existing) {
      this.feedback(`« ${name} » existe déjà.`, 'warn');
      return;
    }
    const doc = emptyHatchDoc(name, []);
    const res = await saveLibraryObject(HATCH_LIBRARY_TAB, name, doc);
    if (!res.ok) {
      this.feedback(`Création impossible : ${res.error ?? '?'}`, 'err');
      return;
    }
    this.feedback(
      `Motif « ${name} » créé — dessinez dans le carré 1 m × 1 m puis /save.`,
      'ok',
    );
    this.close();
    this.onEdit?.(name, doc);
  }

  private async onDelete(): Promise<void> {
    if (!this.selected) {
      this.feedback('Sélectionnez un motif à supprimer.', 'warn');
      return;
    }
    const name = this.selected.name;
    if (!window.confirm(`Supprimer le motif « ${name} » ?`)) return;
    const ok = await deleteLibraryObject(HATCH_LIBRARY_TAB, name);
    if (!ok) {
      this.feedback('Suppression impossible.', 'err');
      return;
    }
    if (this.hatch.currentName === name) this.hatch.setCurrent(null);
    this.selected = null;
    this.feedback(`Motif « ${name} » supprimé.`, 'ok');
    await this.reload();
  }

  private async onPick(): Promise<void> {
    if (!this.selected) {
      this.feedback('Sélectionnez un motif, ou double-cliquez une vignette.', 'warn');
      return;
    }
    // Appliquer échelle / rotation des contrôles
    const rot = Number(this.rotInput.value);
    if (Number.isFinite(rot)) this.hatch.setRotationDeg(rot);
    if (this.scaleSel.value !== '__custom__') {
      const sc = Number(this.scaleSel.value);
      if (Number.isFinite(sc) && sc > 0) this.hatch.setScale(sc);
    }
    this.hatch.setCurrent(this.selected.name);
    this.feedback(
      `Hachure « ${this.selected.name} » · échelle ${this.hatch.scale} · rot. ${Math.round(this.hatch.rotationDeg)}° — prête pour /fill.`,
      'ok',
    );
    this.close();
  }

  private async onEditClick(): Promise<void> {
    if (!this.selected) {
      this.feedback('Sélectionnez un motif à modifier.', 'warn');
      return;
    }
    const doc =
      this.cache.get(this.selected.name) ??
      (await loadLibraryObject(HATCH_LIBRARY_TAB, this.selected.name));
    if (!doc) {
      this.feedback('Impossible de charger le motif.', 'err');
      return;
    }
    this.close();
    this.onEdit?.(this.selected.name, doc);
  }
}

function formatScale(s: number): string {
  if (Math.abs(s - Math.round(s)) < 1e-9) return String(Math.round(s));
  return s.toFixed(2);
}

function emptyHatchDoc(title: string, entities: GkdDocument['entities']): GkdDocument {
  const cam = defaultCamera();
  cam.target = [0.5, 0.5, 0];
  cam.position = [0.5, 0.5, 10];
  cam.orthoHalfHeight = 0.7;
  return {
    magic: GKD_MAGIC,
    version: APP_VERSION,
    modified: new Date().toISOString(),
    camera: cam,
    entities,
    wallLibrary: [],
    objectLibrary: [],
    meta: { title, units: 'm' },
  };
}
