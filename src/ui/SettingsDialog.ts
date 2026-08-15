import type { AppPrefsManager } from '../core/appPrefs';
import type { PenManager } from '../core/penPrefs';
import { resolvePen } from '../core/penPrefs';
import type { TextPrefsManager } from '../core/textPrefs';
import {
  DEFAULT_GRID_SPACING_METERS,
  UNIT_IDS,
  UNIT_LABELS,
  isUnitId,
  type UnitId,
} from '../core/units';

export type UnitsChangeHandler = (prev: UnitId, next: UnitId) => void;

/**
 * Fenêtre Paramètres :
 * - unités + écart de grille
 * - distance de snap (px)
 * - styles de ligne (catalogue + sélection stylo)
 * - décalage /textbox
 */
export class SettingsDialog {
  private overlay: HTMLElement;
  private radiusInput: HTMLInputElement;
  private enabledInput: HTMLInputElement;
  private unitsSelect: HTMLSelectElement;
  private gridInput: HTMLInputElement;
  private gridOffDisablesSnapInput: HTMLInputElement;
  private stylesList: HTMLElement;
  private textboxPadInput: HTMLInputElement;
  private onUnitsChange: UnitsChangeHandler | null = null;

  constructor(
    private app: AppPrefsManager,
    private pen: PenManager,
    private textPrefs?: TextPrefsManager,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'settings-overlay';
    this.overlay.className = 'settings-overlay hidden';
    this.overlay.innerHTML = `
      <div class="settings-dialog" role="dialog" aria-labelledby="settings-title">
        <header class="settings-header">
          <h2 id="settings-title">Paramètres</h2>
          <button type="button" class="settings-close" data-close title="Fermer">×</button>
        </header>
        <div class="settings-body">
          <section class="settings-section">
            <h3>Unités &amp; grille</h3>
            <p class="settings-hint">
              Unité de dessin (saisie et affichage). La grille reste toujours
              en <strong>mètres réels</strong> (un carré = l’écart indiqué),
              quel que soit le choix d’unité.
            </p>
            <label class="settings-row">
              <span>Unité</span>
              <select id="set-units"></select>
            </label>
            <label class="settings-row">
              <span>Écart de la grille</span>
              <span class="settings-inline">
                <input type="number" id="set-grid-spacing" min="0.001" step="0.1" />
                <span class="settings-unit-hint">mètre(s)</span>
              </span>
            </label>
            <label class="settings-row">
              <span>Grid Off désactive automatiquement le snap de la grille</span>
              <input type="checkbox" id="set-grid-off-disables-snap" />
            </label>
          </section>
          <section class="settings-section">
            <h3>Accroche (snap)</h3>
            <p class="settings-hint">
              Clic droit uniquement. Priorité : croisement, puis courbe la plus proche,
              dans un rayon en <strong>pixels écran</strong> (indépendant du zoom).
              Hors rayon → comme un clic gauche (pas d’accroche).
            </p>
            <label class="settings-row">
              <span>Activer l’accroche</span>
              <input type="checkbox" id="set-snap-enabled" />
            </label>
            <label class="settings-row">
              <span>Rayon (pixels)</span>
              <input type="number" id="set-snap-radius" min="1" max="64" step="1" />
            </label>
          </section>
          <section class="settings-section">
            <h3>Texte &amp; textbox</h3>
            <p class="settings-hint">
              Décalage entre le texte et le rectangle de <code>/textbox</code>
              (unités monde courantes ; défaut 0,03).
            </p>
            <label class="settings-row">
              <span>Décalage textbox</span>
              <input type="number" id="set-textbox-pad" min="0" step="0.01" />
            </label>
          </section>
          <section class="settings-section">
            <h3>Styles de ligne</h3>
            <p class="settings-hint">
              Style du prochain trait. Clic pour sélectionner (même effet que /style).
            </p>
            <ul id="set-styles-list" class="settings-styles"></ul>
          </section>
        </div>
        <footer class="settings-footer">
          <button type="button" class="settings-btn" data-close>Fermer</button>
        </footer>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.radiusInput = this.overlay.querySelector('#set-snap-radius')!;
    this.enabledInput = this.overlay.querySelector('#set-snap-enabled')!;
    this.unitsSelect = this.overlay.querySelector('#set-units')!;
    this.gridInput = this.overlay.querySelector('#set-grid-spacing')!;
    this.gridOffDisablesSnapInput = this.overlay.querySelector(
      '#set-grid-off-disables-snap',
    )!;
    this.stylesList = this.overlay.querySelector('#set-styles-list')!;
    this.textboxPadInput = this.overlay.querySelector('#set-textbox-pad')!;

    for (const id of UNIT_IDS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = UNIT_LABELS[id];
      this.unitsSelect.appendChild(opt);
    }

    this.overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.overlay || t.closest('[data-close]')) {
        this.close();
      }
    });

    this.enabledInput.addEventListener('change', () => {
      this.app.setSnapEnabled(this.enabledInput.checked);
    });

    this.radiusInput.addEventListener('change', () => {
      const n = Number(this.radiusInput.value);
      if (Number.isFinite(n)) {
        this.app.setSnapRadiusPx(n);
        this.radiusInput.value = String(this.app.snap.radiusPx);
      }
    });

    this.unitsSelect.addEventListener('change', () => {
      const next = this.unitsSelect.value;
      if (!isUnitId(next)) return;
      const prev = this.app.units;
      if (prev === next) return;
      this.app.setUnits(next);
      this.onUnitsChange?.(prev, next);
    });

    this.gridInput.addEventListener('change', () => {
      const n = Number(this.gridInput.value);
      if (Number.isFinite(n) && n > 0) {
        this.app.setGridSpacingMeters(n);
        this.gridInput.value = String(this.app.gridSpacingMeters);
      } else {
        this.gridInput.value = String(
          this.app.gridSpacingMeters || DEFAULT_GRID_SPACING_METERS,
        );
      }
    });

    this.gridOffDisablesSnapInput.addEventListener('change', () => {
      this.app.setGridOffDisablesSnap(this.gridOffDisablesSnapInput.checked);
    });

    this.textboxPadInput.addEventListener('change', () => {
      const n = Number(this.textboxPadInput.value);
      if (this.textPrefs && Number.isFinite(n) && n >= 0) {
        this.textPrefs.setTextboxPadding(n);
        this.textboxPadInput.value = String(this.textPrefs.textboxPadding);
      } else if (this.textPrefs) {
        this.textboxPadInput.value = String(this.textPrefs.textboxPadding);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.stopPropagation();
        this.close();
      }
    });

    this.app.onChange(() => {
      if (this.isOpen()) this.syncFromPrefs();
    });
    this.pen.onChange(() => {
      if (this.isOpen()) this.renderStyles();
    });
    this.textPrefs?.onChange(() => {
      if (this.isOpen()) this.syncFromPrefs();
    });
  }

  setUnitsChangeHandler(fn: UnitsChangeHandler | null): void {
    this.onUnitsChange = fn;
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    this.syncFromPrefs();
    this.renderStyles();
    this.overlay.classList.remove('hidden');
    this.unitsSelect.focus();
  }

  close(): void {
    this.overlay.classList.add('hidden');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private syncFromPrefs(): void {
    this.enabledInput.checked = this.app.snap.enabled;
    this.radiusInput.value = String(this.app.snap.radiusPx);
    this.unitsSelect.value = this.app.units;
    this.gridInput.value = String(
      this.app.gridSpacingMeters || DEFAULT_GRID_SPACING_METERS,
    );
    this.gridOffDisablesSnapInput.checked = this.app.gridOffDisablesSnap;
    this.textboxPadInput.value = String(
      this.textPrefs?.textboxPadding ?? 0.03,
    );
  }

  private renderStyles(): void {
    const current = this.pen.file.current.styleId;
    this.stylesList.innerHTML = '';
    for (const s of this.pen.file.styles) {
      const li = document.createElement('li');
      li.className = 'settings-style-item' + (s.id === current ? ' active' : '');
      li.innerHTML = `
        <span class="settings-style-preview" data-dashed="${s.dashed ? '1' : '0'}"></span>
        <span class="settings-style-label">${s.label}</span>
        <span class="settings-style-id">${s.id}</span>
      `;
      const prev = li.querySelector('.settings-style-preview') as HTMLElement;
      prev.style.borderTopStyle = s.dashed ? 'dashed' : 'solid';
      prev.style.borderTopColor = resolvePen(this.pen.file).color;
      li.addEventListener('click', () => {
        this.pen.setStyleId(s.id);
        this.renderStyles();
      });
      this.stylesList.appendChild(li);
    }
  }
}
