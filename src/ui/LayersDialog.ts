/**
 * Dialogue `/calques` : liste 1–127 (et −1…−127 en mode insertions),
 * libellés éditables (255 car.), clic = calque courant.
 */

import type { DrawLayerManager } from '../core/drawLayers';
import { isInsertLayer, LAYER_DEFAULT_FONT } from '../core/drawLayers';

export class LayersDialog {
  private overlay: HTMLElement;
  private listEl: HTMLElement;
  private hintEl: HTMLElement;

  constructor(private layers: DrawLayerManager) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay hidden';
    this.overlay.id = 'layers-overlay';
    this.overlay.innerHTML = `
      <div class="settings-dialog layers-dialog" role="dialog" aria-labelledby="layers-title">
        <header class="settings-header">
          <h2 id="layers-title">Calques</h2>
          <button type="button" class="settings-close" data-close title="Fermer">×</button>
        </header>
        <div class="settings-body layers-body">
          <p class="settings-hint" id="layers-hint"></p>
          <div class="layers-list" id="layers-list"></div>
        </div>
        <footer class="settings-footer">
          <button type="button" class="settings-btn" data-close>Fermer</button>
        </footer>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.listEl = this.overlay.querySelector('#layers-list')!;
    this.hintEl = this.overlay.querySelector('#layers-hint')!;

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) this.close();
    });

    this.layers.onChange(() => {
      if (this.isOpen()) this.render();
    });
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    this.overlay.classList.remove('hidden');
    this.render();
    const cur = this.listEl.querySelector<HTMLElement>(
      `[data-layer="${this.layers.current}"]`,
    );
    cur?.scrollIntoView({ block: 'nearest' });
  }

  close(): void {
    this.overlay.classList.add('hidden');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private render(): void {
    const insert = this.layers.insertMode;
    this.hintEl.textContent = insert
      ? 'Calques 1–127 (ordre de dessin) et −1…−127 (étirement / ancre). Clic = courant. Libellé : 255 caractères max.'
      : 'Calques 1–127 : 1 dessiné en premier, 127 en dernier. Clic = courant. Les calques d’insertion (−1…−127) s’affichent à l’édition d’un objet library/insertions/.';

    this.listEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'layers-row layers-head';
    head.innerHTML =
      '<span></span><span>N°</span><span>Couleur</span><span>px</span><span>Police</span><span>Libellé</span>';
    this.listEl.appendChild(head);

    const rows = this.layers.listForUi();
    let sepDone = false;
    for (const row of rows) {
      if (!sepDone && isInsertLayer(row.id)) {
        const sep = document.createElement('div');
        sep.className = 'layers-sep';
        sep.textContent = 'Insertion (murs / lignes / arcs) — étirement seulement';
        this.listEl.appendChild(sep);
        sepDone = true;
      }
      const style = this.layers.resolved(row.id);
      const insert = isInsertLayer(row.id);
      const item = document.createElement('div');
      item.className =
        'layers-row' +
        (insert ? '' : ' layers-row-full') +
        (row.id === this.layers.current ? ' current' : '') +
        (!style.visible ? ' is-hidden' : '');
      item.dataset.layer = String(row.id);

      if (!insert) {
        const vis = document.createElement('input');
        vis.type = 'checkbox';
        vis.className = 'layers-vis';
        vis.checked = style.visible;
        vis.title =
          row.id === this.layers.current
            ? 'Le calque courant ne peut pas être masqué'
            : 'Afficher ce calque';
        vis.disabled = row.id === this.layers.current;
        vis.addEventListener('change', () => {
          const res = this.layers.setVisible(row.id, vis.checked);
          if (!res.ok) {
            vis.checked = true;
            this.hintEl.textContent = res.message;
          }
        });
        item.appendChild(vis);
      }

      const idBtn = document.createElement('button');
      idBtn.type = 'button';
      idBtn.className = 'layers-id';
      idBtn.textContent = String(row.id);
      idBtn.title = 'Définir comme calque courant';
      idBtn.addEventListener('click', () => {
        this.layers.setCurrent(row.id);
      });

      item.appendChild(idBtn);

      if (!insert) {
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'layers-color';
        color.value = style.color;
        color.title = 'Couleur du calque';
        color.addEventListener('change', () => {
          this.layers.patch(row.id, { color: color.value });
        });

        const width = document.createElement('select');
        width.className = 'layers-width';
        width.title = 'Épaisseur (px)';
        for (let px = 1; px <= 7; px++) {
          const opt = document.createElement('option');
          opt.value = String(px);
          opt.textContent = String(px);
          width.appendChild(opt);
        }
        width.value = String(style.lineWidth);
        width.addEventListener('change', () => {
          this.layers.patch(row.id, { lineWidth: Number(width.value) });
        });

        const font = document.createElement('input');
        font.type = 'text';
        font.className = 'layers-font';
        font.maxLength = 80;
        font.value = style.fontFamily || LAYER_DEFAULT_FONT;
        font.title = 'Police des nouveaux textes DuCalque';
        font.addEventListener('change', () => {
          this.layers.patch(row.id, { fontFamily: font.value.trim() || LAYER_DEFAULT_FONT });
        });

        item.appendChild(color);
        item.appendChild(width);
        item.appendChild(font);
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 255;
      input.value = row.label;
      input.className = 'layers-label';
      input.title = 'Libellé (255 caractères max)';
      input.addEventListener('change', () => {
        this.layers.setLabel(row.id, input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.layers.setLabel(row.id, input.value);
          (e.target as HTMLInputElement).blur();
        }
      });

      item.appendChild(input);
      this.listEl.appendChild(item);
    }
  }
}
