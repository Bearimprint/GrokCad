/**
 * Barre en haut du canevas : stylo (couleur, épaisseur, style)
 * + style texte (police, couleur, fond, taille, Bold, Italic)
 * + style de cotation courant.
 */

import type { DimPrefsManager } from '../core/dimPrefs';
import type { DrawLayerManager } from '../core/drawLayers';
import type { PenManager, PenPrefsFile } from '../core/penPrefs';
import { resolvePen } from '../core/penPrefs';
import {
  DEFAULT_FONTS,
  TEXT_FONT_BY_LAYER,
  type TextPrefsFile,
  type TextPrefsManager,
} from '../core/textPrefs';
import type { DimStyleDialog } from './DimStyleDialog';
import type { LayersDialog } from './LayersDialog';

export class StyleBar {
  private root: HTMLElement;
  private dropEl: HTMLElement | null = null;
  private specWrap: HTMLElement | null = null;
  private specDropEl: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private pen: PenManager,
    private text: TextPrefsManager,
    private dims: DimPrefsManager,
    private dimDialog: DimStyleDialog,
    private layers: DrawLayerManager,
    private layersDialog: LayersDialog,
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
      <div class="style-group style-layer-group" title="Calque courant — clic = liste">
        <span class="style-group-label">Calque</span>
        <div class="layer-wrap" id="sb-layer-wrap">
          <button type="button" class="style-chip" id="sb-layer" title="Calque courant (clic = liste)">
            <span id="sb-layer-id">1</span>
            <span id="sb-layer-label" class="layer-chip-label">Bedrock layer</span>
          </button>
          <div class="layer-dropdown hidden" id="sb-layer-drop" role="listbox"></div>
        </div>
        <div class="layer-wrap hidden" id="sb-spec-wrap">
          <button type="button" class="style-chip" id="sb-spec-layer" title="Calque spécial d’insertion (clic = liste)">
            <span id="sb-spec-id">-1</span>
            <span id="sb-spec-label" class="layer-chip-label">Fixe (taille inchangée)</span>
          </button>
          <div class="layer-dropdown hidden" id="sb-spec-drop" role="listbox"></div>
        </div>
        <button type="button" class="style-chip" id="sb-layer-edit" title="Gérer les calques (/calques)">⋯</button>
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
    const byLayerOpt = document.createElement('option');
    byLayerOpt.value = TEXT_FONT_BY_LAYER;
    byLayerOpt.textContent = 'DuCalque';
    fontSel.appendChild(byLayerOpt);
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
      else if (el.dataset.text === 'bold') this.toggleTextBold();
      else if (el.dataset.text === 'italic') this.toggleTextItalic();
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

    const layerBtn = this.root.querySelector('#sb-layer') as HTMLButtonElement;
    this.dropEl = this.root.querySelector('#sb-layer-drop');
    this.specWrap = this.root.querySelector('#sb-spec-wrap');
    this.specDropEl = this.root.querySelector('#sb-spec-drop');
    layerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeSpecDrop();
      this.toggleLayerDrop();
    });
    const specBtn = this.root.querySelector('#sb-spec-layer') as HTMLButtonElement;
    specBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLayerDrop();
      this.toggleSpecDrop();
    });
    this.root.querySelector('#sb-layer-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLayerDrop();
      this.closeSpecDrop();
      this.layersDialog.toggle();
    });
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target as Node)) {
        this.closeLayerDrop();
        this.closeSpecDrop();
      }
    });

    this.pen.onChange((p) => this.renderPen(p));
    this.text.onChange((p) => this.renderText(p));
    this.dims.onChange(() => this.renderDim());
    this.layers.onChange(() => {
      this.renderLayer();
      this.renderPen(this.pen.file);
      this.renderText(this.text.file);
    });

    this.renderPen(this.pen.file);
    this.renderText(this.text.file);
    this.renderDim();
    this.renderLayer();
  }

  private toggleLayerDrop(): void {
    if (!this.dropEl) return;
    if (this.dropEl.classList.contains('hidden')) this.openLayerDrop();
    else this.closeLayerDrop();
  }

  private openLayerDrop(): void {
    if (!this.dropEl) return;
    this.dropEl.classList.remove('hidden');
    this.fillLayerDrop();
    const cur = this.dropEl.querySelector<HTMLElement>(
      `[data-layer="${this.layers.current}"]`,
    );
    cur?.scrollIntoView({ block: 'nearest' });
  }

  private closeLayerDrop(): void {
    this.dropEl?.classList.add('hidden');
  }

  private fillLayerDrop(): void {
    if (!this.dropEl) return;
    this.dropEl.innerHTML = '';
    const rows = this.layers.listStandard();
    const cur = this.layers.standardLayer;
    for (const row of rows) {
      this.dropEl.appendChild(
        this.makeDropItem(row.id, row.label, row.id === cur, (id) => {
          this.layers.setCurrent(id);
          this.closeLayerDrop();
        }),
      );
    }
  }

  private toggleSpecDrop(): void {
    if (!this.specDropEl) return;
    if (this.specDropEl.classList.contains('hidden')) this.openSpecDrop();
    else this.closeSpecDrop();
  }

  private openSpecDrop(): void {
    if (!this.specDropEl) return;
    this.specDropEl.classList.remove('hidden');
    this.fillSpecDrop();
    const cur = this.specDropEl.querySelector<HTMLElement>(
      `[data-layer="${this.layers.insertLayer}"]`,
    );
    cur?.scrollIntoView({ block: 'nearest' });
  }

  private closeSpecDrop(): void {
    this.specDropEl?.classList.add('hidden');
  }

  private fillSpecDrop(): void {
    if (!this.specDropEl) return;
    this.specDropEl.innerHTML = '';
    const rows = this.layers.listSpecial();
    const cur = this.layers.insertLayer;
    for (const row of rows) {
      this.specDropEl.appendChild(
        this.makeDropItem(row.id, row.label, row.id === cur, (id) => {
          this.layers.setInsertLayer(id);
          this.closeSpecDrop();
        }),
      );
    }
  }

  private makeDropItem(
    id: number,
    label: string,
    current: boolean,
    onPick: (id: number) => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-drop-item' + (current ? ' current' : '');
    b.dataset.layer = String(id);
    b.setAttribute('role', 'option');
    const idEl = document.createElement('span');
    idEl.className = 'layer-drop-id';
    idEl.textContent = String(id);
    const labEl = document.createElement('span');
    labEl.className = 'layer-drop-label';
    labEl.textContent = label;
    b.appendChild(idEl);
    b.appendChild(labEl);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(id);
    });
    return b;
  }

  private renderLayer(): void {
    const std = this.layers.standardLayer;
    (this.root.querySelector('#sb-layer-id') as HTMLElement).textContent =
      String(std);
    (this.root.querySelector('#sb-layer-label') as HTMLElement).textContent =
      this.layers.label(std);
    if (this.dropEl && !this.dropEl.classList.contains('hidden')) {
      this.fillLayerDrop();
    }

    const show = this.layers.showSpecialId;
    this.specWrap?.classList.toggle('hidden', !show);
    if (show) {
      const sid = this.layers.insertLayer;
      (this.root.querySelector('#sb-spec-id') as HTMLElement).textContent =
        String(sid);
      (this.root.querySelector('#sb-spec-label') as HTMLElement).textContent =
        this.layers.label(sid);
      if (this.specDropEl && !this.specDropEl.classList.contains('hidden')) {
        this.fillSpecDrop();
      }
    } else {
      this.closeSpecDrop();
    }
  }

  private cycleTextColor(dir: number): void {
    const colors = this.pen.file.colors;
    if (!colors.length) return;
    const ids = ['ducalque', ...colors.map((c) => c.id)];
    const cur = this.text.current.colorByLayer ? 'ducalque' : this.text.current.colorId;
    let i = ids.indexOf(cur);
    if (i < 0) i = 0;
    i = (i + dir + ids.length) % ids.length;
    this.text.setColorId(ids[i]!);
  }

  private toggleTextBold(): void {
    const layer = this.layers.resolved(this.layers.current);
    const shown = this.text.current.fontByLayer ? layer.fontBold : this.text.current.bold;
    this.text.setBold(!shown);
  }

  private toggleTextItalic(): void {
    const layer = this.layers.resolved(this.layers.current);
    const shown = this.text.current.fontByLayer ? layer.fontItalic : this.text.current.italic;
    this.text.setItalic(!shown);
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
    const layer = this.layers.resolved(this.layers.current);
    const color = r.colorByLayer ? layer.color : r.color;
    const width = r.widthByLayer ? layer.lineWidth : r.lineWidth;
    const dashed = r.styleByLayer ? layer.lineStyle !== 'plein' : r.style.dashed;
    const sw = this.root.querySelector('#sb-pen-swatch') as HTMLElement;
    sw.style.background = color;
    (this.root.querySelector('#sb-pen-color') as HTMLElement).textContent =
      r.colorLabel;
    (this.root.querySelector('#sb-pen-width') as HTMLElement).textContent =
      r.widthLabel;
    (this.root.querySelector('#sb-pen-style') as HTMLElement).textContent =
      r.styleLabel;
    const prev = this.root.querySelector(
      '#sb-pen-style-prev',
    ) as HTMLElement;
    prev.style.borderTopStyle = dashed ? 'dashed' : 'solid';
    prev.style.borderTopColor = color;
    prev.style.borderTopWidth = `${Math.min(4, Math.max(1, width))}px`;
  }

  private renderText(prefs: TextPrefsFile): void {
    const c = prefs.current;
    const layer = this.layers.resolved(this.layers.current);
    const fontSel = this.root.querySelector('#sb-font') as HTMLSelectElement;
    if (c.fontByLayer) {
      fontSel.value = TEXT_FONT_BY_LAYER;
    } else {
      if (![...fontSel.options].some((o) => o.value === c.fontFamily)) {
        const opt = document.createElement('option');
        opt.value = c.fontFamily;
        opt.textContent = c.fontFamily.split(',')[0] ?? c.fontFamily;
        fontSel.appendChild(opt);
      }
      fontSel.value = c.fontFamily;
    }

    const colors = this.pen.file.colors;
    const col = colors.find((x) => x.id === c.colorId) ?? colors[0];
    const sw = this.root.querySelector('#sb-text-swatch') as HTMLElement;
    sw.style.background = c.colorByLayer ? layer.color : (col?.value ?? '#000');
    (this.root.querySelector('#sb-text-color') as HTMLElement).textContent =
      c.colorByLayer ? 'DuCalque' : (col?.label ?? c.colorId);

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
    const boldOn = c.fontByLayer ? layer.fontBold : c.bold;
    const italicOn = c.fontByLayer ? layer.fontItalic : c.italic;
    this.root
      .querySelector('#sb-bold')
      ?.classList.toggle('active', boldOn);
    this.root
      .querySelector('#sb-italic')
      ?.classList.toggle('active', italicOn);
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
