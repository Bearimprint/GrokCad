/**
 * Dialogue `/calques` : liste 1–127 (et −1…−127 en mode insertions),
 * libellés éditables (255 car.), clic = calque courant.
 */

import type { DrawLayerManager } from '../core/drawLayers';
import { isInsertLayer } from '../core/drawLayers';

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
    const rows = this.layers.listForUi();
    let sepDone = false;
    for (const row of rows) {
      if (!sepDone && isInsertLayer(row.id)) {
        const sep = document.createElement('div');
        sep.className = 'layers-sep';
        sep.textContent = 'Insertion (murs / lignes / arcs)';
        this.listEl.appendChild(sep);
        sepDone = true;
      }
      const item = document.createElement('div');
      item.className =
        'layers-row' + (row.id === this.layers.current ? ' current' : '');
      item.dataset.layer = String(row.id);

      const idBtn = document.createElement('button');
      idBtn.type = 'button';
      idBtn.className = 'layers-id';
      idBtn.textContent = String(row.id);
      idBtn.title = 'Définir comme calque courant';
      idBtn.addEventListener('click', () => {
        this.layers.setCurrent(row.id);
      });

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

      item.appendChild(idBtn);
      item.appendChild(input);
      this.listEl.appendChild(item);
    }
  }
}
