/**
 * Liste verticale des calques spéciaux (−1…−127) collée au canvas
 * en création / modification d’un objet d’insertion.
 * Source de vérité unique : DrawLayerManager.insertLayer (sync barre).
 */

import type { DrawLayerManager } from '../core/drawLayers';

export class InsertLayerRail {
  readonly el: HTMLElement;

  constructor(root: HTMLElement, private layers: DrawLayerManager) {
    this.el = root;
    this.el.className = 'insert-layer-rail hidden';
    this.el.setAttribute('aria-label', 'Calques spéciaux d’insertion');
    this.layers.onChange(() => {
      if (!this.el.classList.contains('hidden')) this.render();
    });
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.removeAttribute('hidden');
    this.render();
    this.scrollToCurrent();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('hidden', '');
    this.el.innerHTML = '';
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private render(): void {
    const rows = this.layers.listSpecial();
    const cur = this.layers.insertLayer;
    this.el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'insert-rail-title';
    title.textContent = 'Calques spéciaux';
    this.el.appendChild(title);

    for (const row of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'insert-rail-item' + (row.id === cur ? ' current' : '');
      b.dataset.layer = String(row.id);
      b.title = `${row.id}  ${row.label}`;
      const id = document.createElement('span');
      id.className = 'insert-rail-id';
      id.textContent = String(row.id);
      const lab = document.createElement('span');
      lab.className = 'insert-rail-label';
      lab.textContent = row.label;
      b.appendChild(id);
      b.appendChild(lab);
      b.addEventListener('click', () => {
        this.layers.setInsertLayer(row.id);
      });
      this.el.appendChild(b);
    }
  }

  private scrollToCurrent(): void {
    const cur = this.el.querySelector<HTMLElement>(
      `[data-layer="${this.layers.insertLayer}"]`,
    );
    cur?.scrollIntoView({ block: 'nearest' });
  }
}
