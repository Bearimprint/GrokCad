/**
 * Gestion des styles de cotation : liste + éditeur (typo, lignes, distances).
 */

import {
  defaultDimensionStyle,
  type DimPrefsManager,
} from '../core/dimPrefs';
import type { PenManager } from '../core/penPrefs';
import type { DimensionStyle, LineStyleId } from '../core/types';

export class DimStyleDialog {
  private overlay: HTMLElement;
  private listEl: HTMLElement;
  private editing: DimensionStyle | null = null;

  constructor(
    private dims: DimPrefsManager,
    private pen: PenManager,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay hidden';
    this.overlay.id = 'dim-style-overlay';
    this.overlay.innerHTML = `
      <div class="settings-dialog dim-style-dialog" role="dialog" aria-labelledby="dim-title">
        <header class="settings-header">
          <h2 id="dim-title">Cotations</h2>
          <button type="button" class="settings-close" data-close title="Fermer">×</button>
        </header>
        <div class="settings-body dim-style-body">
          <div class="dim-list-panel">
            <p class="settings-hint">Styles de cotation. Clic = courant. Double-clic = modifier.</p>
            <ul class="dim-style-list" id="dim-style-list"></ul>
            <div class="dim-list-actions">
              <button type="button" class="settings-btn" data-act="add">+ Ajouter</button>
              <button type="button" class="settings-btn" data-act="edit">Modifier</button>
              <button type="button" class="settings-btn" data-act="up">↑</button>
              <button type="button" class="settings-btn" data-act="down">↓</button>
              <button type="button" class="settings-btn" data-act="del">Supprimer</button>
            </div>
          </div>
          <div class="dim-edit-panel hidden" id="dim-edit-panel">
            <h3 id="dim-edit-title">Nouveau style</h3>
            <label class="settings-row"><span>Nom</span><input type="text" id="dim-name" /></label>
            <label class="settings-row"><span>Police</span>
              <select id="dim-font">
                <option value="Arial, Helvetica, sans-serif">Sans-serif</option>
                <option value="Times New Roman, Times, serif">Serif</option>
                <option value="Consolas, Courier New, monospace">Mono</option>
                <option value="Verdana, Geneva, sans-serif">Verdana</option>
              </select>
            </label>
            <label class="settings-row"><span>Couleur texte</span><input type="color" id="dim-text-color" /></label>
            <label class="settings-row"><span>Fond texte</span>
              <select id="dim-text-bg">
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label class="settings-row"><span>Taille texte</span><input type="number" id="dim-text-h" min="0.01" step="0.01" /></label>
            <label class="settings-row"><span>Gras</span><input type="checkbox" id="dim-bold" /></label>
            <label class="settings-row"><span>Italique</span><input type="checkbox" id="dim-italic" /></label>
            <hr class="dim-sep" />
            <label class="settings-row"><span>Couleur lignes</span><input type="color" id="dim-line-color" /></label>
            <label class="settings-row"><span>Épaisseur</span><input type="number" id="dim-line-w" min="1" max="7" step="1" /></label>
            <label class="settings-row"><span>Type de ligne</span><select id="dim-line-style"></select></label>
            <label class="settings-row"><span>Écart attache</span><input type="number" id="dim-ext-off" min="0" step="0.01" /></label>
            <label class="settings-row"><span>Dépassement</span><input type="number" id="dim-ext-over" min="0" step="0.01" /></label>
            <label class="settings-row"><span>Tick 45°</span><input type="number" id="dim-tick" min="0" step="0.01" /></label>
            <label class="settings-row" title="Distance ligne de côte → baseline du texte">
              <span>Écart texte</span>
              <input type="number" id="dim-text-off" min="0" step="0.01" />
            </label>
            <div class="dim-edit-actions">
              <button type="button" class="settings-btn" data-act="cancel-edit">Annuler</button>
              <button type="button" class="settings-btn settings-btn-primary" data-act="save-edit">Sauvegarder</button>
            </div>
          </div>
        </div>
        <footer class="settings-footer">
          <button type="button" class="settings-btn" data-close>Fermer</button>
        </footer>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.listEl = this.overlay.querySelector('#dim-style-list')!;

    // Options fond + styles de ligne
    const bgSel = this.overlay.querySelector('#dim-text-bg') as HTMLSelectElement;
    for (const c of this.pen.file.colors) {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label;
      bgSel.appendChild(opt);
    }
    const ls = this.overlay.querySelector('#dim-line-style') as HTMLSelectElement;
    for (const s of this.pen.file.styles) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      ls.appendChild(opt);
    }

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) {
        this.close();
        return;
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'add') this.startEdit(defaultDimensionStyle({ name: 'Nouveau' }), true);
      else if (act === 'edit') {
        const cur = this.dims.current;
        this.startEdit({ ...cur }, false);
      } else if (act === 'up') this.dims.moveStyle(this.dims.currentId, -1);
      else if (act === 'down') this.dims.moveStyle(this.dims.currentId, 1);
      else if (act === 'del') {
        if (!this.dims.removeStyle(this.dims.currentId)) {
          /* dernier style */
        }
        this.renderList();
      } else if (act === 'cancel-edit') this.stopEdit();
      else if (act === 'save-edit') this.saveEdit();
    });

    this.dims.onChange(() => {
      if (this.isOpen()) this.renderList();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        if (this.editing) {
          e.stopPropagation();
          this.stopEdit();
        } else {
          e.stopPropagation();
          this.close();
        }
      }
    });
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    this.stopEdit();
    this.renderList();
    this.overlay.classList.remove('hidden');
  }

  close(): void {
    this.stopEdit();
    this.overlay.classList.add('hidden');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    for (const s of this.dims.styles) {
      const li = document.createElement('li');
      li.className =
        'dim-style-item' + (s.id === this.dims.currentId ? ' active' : '');
      li.innerHTML = `
        <span class="dim-swatch" style="background:${s.lineColor}"></span>
        <span class="dim-style-name">${escapeHtml(s.name)}</span>
        <span class="dim-style-meta">${s.textHeight} · ${s.lineStyle}</span>
      `;
      li.addEventListener('click', () => {
        this.dims.setCurrentId(s.id);
        this.renderList();
      });
      li.addEventListener('dblclick', () => {
        this.dims.setCurrentId(s.id);
        this.startEdit({ ...s }, false);
      });
      this.listEl.appendChild(li);
    }
  }

  private startEdit(style: DimensionStyle, isNew: boolean): void {
    this.editing = { ...style, _isNew: isNew } as DimensionStyle & {
      _isNew?: boolean;
    };
    (this.editing as { _isNew?: boolean })._isNew = isNew;
    const panel = this.overlay.querySelector('#dim-edit-panel')!;
    panel.classList.remove('hidden');
    (this.overlay.querySelector('#dim-edit-title') as HTMLElement).textContent =
      isNew ? 'Nouveau style' : `Modifier « ${style.name} »`;

    (this.overlay.querySelector('#dim-name') as HTMLInputElement).value =
      style.name;
    (this.overlay.querySelector('#dim-font') as HTMLSelectElement).value =
      style.fontFamily;
    (this.overlay.querySelector('#dim-text-color') as HTMLInputElement).value =
      toHex(style.textColor);
    const bg = this.overlay.querySelector('#dim-text-bg') as HTMLSelectElement;
    bg.value = style.textBackground ?? 'transparent';
    (this.overlay.querySelector('#dim-text-h') as HTMLInputElement).value =
      String(style.textHeight);
    (this.overlay.querySelector('#dim-bold') as HTMLInputElement).checked =
      style.bold;
    (this.overlay.querySelector('#dim-italic') as HTMLInputElement).checked =
      style.italic;
    (this.overlay.querySelector('#dim-line-color') as HTMLInputElement).value =
      toHex(style.lineColor);
    (this.overlay.querySelector('#dim-line-w') as HTMLInputElement).value =
      String(style.lineWidth);
    (this.overlay.querySelector('#dim-line-style') as HTMLSelectElement).value =
      style.lineStyle;
    (this.overlay.querySelector('#dim-ext-off') as HTMLInputElement).value =
      String(style.extensionOffset);
    (this.overlay.querySelector('#dim-ext-over') as HTMLInputElement).value =
      String(style.extensionOverhang);
    (this.overlay.querySelector('#dim-tick') as HTMLInputElement).value =
      String(style.tickSize);
    (this.overlay.querySelector('#dim-text-off') as HTMLInputElement).value =
      String(style.textOffset ?? 0.05);
  }

  private stopEdit(): void {
    this.editing = null;
    this.overlay.querySelector('#dim-edit-panel')?.classList.add('hidden');
  }

  private saveEdit(): void {
    if (!this.editing) return;
    const name = (
      this.overlay.querySelector('#dim-name') as HTMLInputElement
    ).value.trim();
    if (!name) return;

    const bgVal = (
      this.overlay.querySelector('#dim-text-bg') as HTMLSelectElement
    ).value;
    const style: DimensionStyle = {
      id: this.editing.id,
      name,
      fontFamily: (
        this.overlay.querySelector('#dim-font') as HTMLSelectElement
      ).value,
      textColor: (
        this.overlay.querySelector('#dim-text-color') as HTMLInputElement
      ).value,
      textBackground: bgVal === 'transparent' ? null : bgVal,
      textHeight: Math.max(
        0.01,
        Number(
          (this.overlay.querySelector('#dim-text-h') as HTMLInputElement).value,
        ) || 0.18,
      ),
      bold: (this.overlay.querySelector('#dim-bold') as HTMLInputElement)
        .checked,
      italic: (this.overlay.querySelector('#dim-italic') as HTMLInputElement)
        .checked,
      lineColor: (
        this.overlay.querySelector('#dim-line-color') as HTMLInputElement
      ).value,
      lineWidth: Math.max(
        1,
        Math.min(
          7,
          Math.round(
            Number(
              (this.overlay.querySelector('#dim-line-w') as HTMLInputElement)
                .value,
            ) || 1,
          ),
        ),
      ),
      lineStyle: (
        this.overlay.querySelector('#dim-line-style') as HTMLSelectElement
      ).value as LineStyleId,
      extensionOffset: Math.max(
        0,
        Number(
          (this.overlay.querySelector('#dim-ext-off') as HTMLInputElement)
            .value,
        ) || 0,
      ),
      extensionOverhang: Math.max(
        0,
        Number(
          (this.overlay.querySelector('#dim-ext-over') as HTMLInputElement)
            .value,
        ) || 0,
      ),
      tickSize: Math.max(
        0,
        Number(
          (this.overlay.querySelector('#dim-tick') as HTMLInputElement).value,
        ) || 0,
      ),
      textOffset: Math.max(
        0,
        Number(
          (this.overlay.querySelector('#dim-text-off') as HTMLInputElement)
            .value,
        ) || 0,
      ),
    };

    const isNew = !!(this.editing as { _isNew?: boolean })._isNew;
    if (isNew) this.dims.addStyle(style);
    else this.dims.updateStyle(style);
    this.dims.setCurrentId(style.id);
    this.stopEdit();
    this.renderList();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toHex(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1]!;
    const g = c[2]!;
    const b = c[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}
