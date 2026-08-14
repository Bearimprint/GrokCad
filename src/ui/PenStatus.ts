import type { PenManager, PenPrefsFile } from '../core/penPrefs';
import { resolvePen } from '../core/penPrefs';

/**
 * Affiche et pilote le stylo courant (couleur, épaisseur, style)
 * dans la barre d'état à droite de la ligne de commande.
 */
export class PenStatus {
  private root: HTMLElement;
  private colorSwatch: HTMLElement;
  private colorLabel: HTMLElement;
  private widthLabel: HTMLElement;
  private styleLabel: HTMLElement;
  private stylePreview: HTMLElement;

  constructor(
    root: HTMLElement,
    private pen: PenManager,
  ) {
    this.root = root;
    this.root.innerHTML = `
      <button type="button" class="pen-chip" data-pen="color" title="Couleur du prochain trait (clic = suivante)">
        <span class="stat-label">Couleur</span>
        <span class="pen-row">
          <span class="pen-swatch" id="pen-swatch"></span>
          <span id="pen-color-label">Noir</span>
        </span>
      </button>
      <button type="button" class="pen-chip" data-pen="width" title="Épaisseur en pixels (clic = suivante)">
        <span class="stat-label">Épaisseur</span>
        <span id="pen-width-label">1 px</span>
      </button>
      <button type="button" class="pen-chip" data-pen="style" title="Style de trait (clic = suivant)">
        <span class="stat-label">Style</span>
        <span class="pen-row">
          <span class="pen-style-preview" id="pen-style-preview"></span>
          <span id="pen-style-label">Plein</span>
        </span>
      </button>
    `;

    this.colorSwatch = this.root.querySelector('#pen-swatch')!;
    this.colorLabel = this.root.querySelector('#pen-color-label')!;
    this.widthLabel = this.root.querySelector('#pen-width-label')!;
    this.styleLabel = this.root.querySelector('#pen-style-label')!;
    this.stylePreview = this.root.querySelector('#pen-style-preview')!;

    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-pen]');
      if (!btn) return;
      const kind = btn.dataset.pen;
      if (kind === 'color') this.pen.cycleColor(1);
      else if (kind === 'width') this.pen.cycleWidth(1);
      else if (kind === 'style') this.pen.cycleStyle(1);
    });

    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-pen]');
      if (!btn) return;
      const kind = btn.dataset.pen;
      if (kind === 'color') this.pen.cycleColor(-1);
      else if (kind === 'width') this.pen.cycleWidth(-1);
      else if (kind === 'style') this.pen.cycleStyle(-1);
    });

    this.pen.onChange((prefs) => this.render(prefs));
    this.render(this.pen.file);
  }

  private render(prefs: PenPrefsFile): void {
    const r = resolvePen(prefs);
    this.colorSwatch.style.background = r.color;
    // Contour visible pour le noir sur fond sombre
    this.colorSwatch.style.boxShadow =
      r.color.toLowerCase() === '#000000' || r.color === '#000'
        ? 'inset 0 0 0 1px #666'
        : 'inset 0 0 0 1px rgba(255,255,255,0.15)';
    this.colorLabel.textContent = r.colorLabel;
    this.widthLabel.textContent = r.widthLabel;
    this.styleLabel.textContent = r.styleLabel;
    this.stylePreview.style.borderTopStyle = r.style.dashed ? 'dashed' : 'solid';
    this.stylePreview.style.borderTopWidth = `${Math.min(4, Math.max(1, r.lineWidth))}px`;
    this.stylePreview.style.borderTopColor = r.color;
  }
}
