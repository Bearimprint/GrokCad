/**
 * Barre en haut du canevas : stylo (couleur, épaisseur, style)
 * + style texte (police, couleur, fond, taille, Bold, Italic)
 * + style de cotation courant.
 */

import type { DimPrefsManager } from '../core/dimPrefs';
import type { PenManager, PenPrefsFile } from '../core/penPrefs';
import { resolvePen } from '../core/penPrefs';
import {
  DEFAULT_FONTS,
  type TextPrefsFile,
  type TextPrefsManager,
} from '../core/textPrefs';
import type { DimStyleDialog } from './DimStyleDialog';

export class StyleBar {
  private root: HTMLElement;

  constructor(
    root: HTMLElement,
    private pen: PenManager,
    private text: TextPrefsManager,
    private dims: DimPrefsManager,
    private dimDialog: DimStyleDialog,
  ) {
    this.root = root;
    this.root.className = 'style-bar';
    this.root.innerHTML = `
      <div class="style-group" title="Stylo — traits">
        <span class="style-group-label">Trait</span>
        <button type="button" class="style-chip" data-pen="color" title="Couleur (clic = suivante)">
          <span class="style-swatch" id="sb-pen-swatch"></span>
          <span id="sb-pen-color">Noir</span>
        </button>
        <button type="button" class="style-chip" data-pen="width" title="Épaisseur">
          <span id="sb-pen-width">1 px</span>
        </button>
        <button type="button" class="style-chip" data-pen="style" title="Style de trait">
          <span class="style-line-preview" id="sb-pen-style-prev"></span>
          <span id="sb-pen-style">Plein</span>
        </button>
      </div>
      <div class="style-sep"></div>
      <div class="style-group" title="Texte — /text /textbox">
        <span class="style-group-label">Texte</span>
        <select id="sb-font" class="style-select" title="Typographie"></select>
        <button type="button" class="style-chip" data-text="color" title="Couleur du texte">
          <span class="style-swatch" id="sb-text-swatch"></span>
          <span id="sb-text-color">Noir</span>
        </button>
        <button type="button" class="style-chip" data-text="bg" title="Fond (transparent = courant)">
          <span class="style-swatch style-swatch-bg" id="sb-bg-swatch"></span>
          <span id="sb-bg-label">Transp.</span>
        </button>
        <label class="style-height" title="Hauteur du texte (unités monde)">
          <input type="number" id="sb-height" min="0.01" step="0.01" />
        </label>
        <button type="button" class="style-toggle" data-text="bold" title="Gras" id="sb-bold">B</button>
        <button type="button" class="style-toggle" data-text="italic" title="Italique" id="sb-italic"><em>I</em></button>
      </div>
      <div class="style-sep"></div>
      <div class="style-group" title="Cotations — /cote">
        <span class="style-group-label">Cote</span>
        <select id="sb-dim" class="style-select style-select-dim" title="Style de cotation"></select>
        <button type="button" class="style-chip" data-dim="edit" title="Gérer les styles de cotation">⚙</button>
      </div>
    `;

    const fontSel = this.root.querySelector('#sb-font') as HTMLSelectElement;
    for (const f of DEFAULT_FONTS) {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.label;
      fontSel.appendChild(opt);
    }

    fontSel.addEventListener('change', () => {
      this.text.setFontFamily(fontSel.value);
    });

    const hIn = this.root.querySelector('#sb-height') as HTMLInputElement;
    hIn.addEventListener('change', () => {
      const n = Number(hIn.value);
      if (Number.isFinite(n) && n > 0) this.text.setHeight(n);
    });

    const dimSel = this.root.querySelector('#sb-dim') as HTMLSelectElement;
    dimSel.addEventListener('change', () => {
      this.dims.setCurrentId(dimSel.value);
    });

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-pen],[data-text],[data-dim]',
      );
      if (!el) return;
      if (el.dataset.pen === 'color') this.pen.cycleColor(1);
      else if (el.dataset.pen === 'width') this.pen.cycleWidth(1);
      else if (el.dataset.pen === 'style') this.pen.cycleStyle(1);
      else if (el.dataset.text === 'color') this.cycleTextColor(1);
      else if (el.dataset.text === 'bg') this.cycleTextBg(1);
      else if (el.dataset.text === 'bold') this.text.toggleBold();
      else if (el.dataset.text === 'italic') this.text.toggleItalic();
      else if (el.dataset.dim === 'edit') this.dimDialog.toggle();
    });

    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-pen],[data-text]',
      );
      if (!el) return;
      if (el.dataset.pen === 'color') this.pen.cycleColor(-1);
      else if (el.dataset.pen === 'width') this.pen.cycleWidth(-1);
      else if (el.dataset.pen === 'style') this.pen.cycleStyle(-1);
      else if (el.dataset.text === 'color') this.cycleTextColor(-1);
      else if (el.dataset.text === 'bg') this.cycleTextBg(-1);
    });

    this.pen.onChange((p) => this.renderPen(p));
    this.text.onChange((p) => this.renderText(p));
    this.dims.onChange(() => this.renderDim());

    this.renderPen(this.pen.file);
    this.renderText(this.text.file);
    this.renderDim();
  }

  private cycleTextColor(dir: number): void {
    const colors = this.pen.file.colors;
    if (!colors.length) return;
    const ids = colors.map((c) => c.id);
    let i = ids.indexOf(this.text.current.colorId);
    if (i < 0) i = 0;
    i = (i + dir + ids.length) % ids.length;
    this.text.setColorId(ids[i]!);
  }

  private cycleTextBg(dir: number): void {
    const ids = ['transparent', ...this.pen.file.colors.map((c) => c.id)];
    let i = ids.indexOf(this.text.current.backgroundId);
    if (i < 0) i = 0;
    i = (i + dir + ids.length) % ids.length;
    this.text.setBackgroundId(ids[i]!);
  }

  private renderPen(prefs: PenPrefsFile): void {
    const r = resolvePen(prefs);
    const sw = this.root.querySelector('#sb-pen-swatch') as HTMLElement;
    sw.style.background = r.color;
    (this.root.querySelector('#sb-pen-color') as HTMLElement).textContent =
      r.colorLabel;
    (this.root.querySelector('#sb-pen-width') as HTMLElement).textContent =
      r.widthLabel;
    (this.root.querySelector('#sb-pen-style') as HTMLElement).textContent =
      r.styleLabel;
    const prev = this.root.querySelector(
      '#sb-pen-style-prev',
    ) as HTMLElement;
    prev.style.borderTopStyle = r.style.dashed ? 'dashed' : 'solid';
    prev.style.borderTopColor = r.color;
    prev.style.borderTopWidth = `${Math.min(4, Math.max(1, r.lineWidth))}px`;
  }

  private renderText(prefs: TextPrefsFile): void {
    const c = prefs.current;
    const fontSel = this.root.querySelector('#sb-font') as HTMLSelectElement;
    // Si police hors liste, ajouter temporairement
    if (![...fontSel.options].some((o) => o.value === c.fontFamily)) {
      const opt = document.createElement('option');
      opt.value = c.fontFamily;
      opt.textContent = c.fontFamily.split(',')[0] ?? c.fontFamily;
      fontSel.appendChild(opt);
    }
    fontSel.value = c.fontFamily;

    const colors = this.pen.file.colors;
    const col = colors.find((x) => x.id === c.colorId) ?? colors[0];
    const sw = this.root.querySelector('#sb-text-swatch') as HTMLElement;
    sw.style.background = col?.value ?? '#000';
    (this.root.querySelector('#sb-text-color') as HTMLElement).textContent =
      col?.label ?? c.colorId;

    const bgSw = this.root.querySelector('#sb-bg-swatch') as HTMLElement;
    const bgLab = this.root.querySelector('#sb-bg-label') as HTMLElement;
    if (c.backgroundId === 'transparent') {
      bgSw.style.background =
        'repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 50% / 8px 8px';
      bgLab.textContent = 'Transp.';
    } else {
      const bg = colors.find((x) => x.id === c.backgroundId);
      bgSw.style.background = bg?.value ?? '#fff';
      bgLab.textContent = bg?.label ?? c.backgroundId;
    }

    (this.root.querySelector('#sb-height') as HTMLInputElement).value = String(
      c.height,
    );
    this.root
      .querySelector('#sb-bold')
      ?.classList.toggle('active', c.bold);
    this.root
      .querySelector('#sb-italic')
      ?.classList.toggle('active', c.italic);
  }

  private renderDim(): void {
    const sel = this.root.querySelector('#sb-dim') as HTMLSelectElement;
    sel.innerHTML = '';
    for (const s of this.dims.styles) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    }
    sel.value = this.dims.currentId;
  }
}
