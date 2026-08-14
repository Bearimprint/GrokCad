/**
 * Explorateur de fichiers / répertoires (disques locaux via /api/fs).
 *
 * Modes :
 *  - pickFiles   : un ou plusieurs fichiers (filtre extension)
 *  - pickDir     : un répertoire (traiter tous les fichiers filtrés dedans)
 *  - pickSaveDir : répertoire de destination
 *  - pickSaveFile: répertoire + nom de fichier
 */

import {
  basename,
  fsAvailable,
  fsFind,
  fsList,
  fsRoots,
  joinPath,
  type FsFileEntry,
  type FsRoot,
} from '../core/fsClient';

export type FileBrowserMode =
  | 'pickFiles'
  | 'pickDir'
  | 'pickSaveDir'
  | 'pickSaveFile';

export interface FileBrowserOptions {
  title: string;
  mode: FileBrowserMode;
  /** Extensions acceptées, ex. ['.dxf'] ou ['.gkd']. Vide = tous. */
  extensions?: string[];
  /** Répertoire initial. */
  startPath?: string;
  /** Nom de fichier proposé (pickSaveFile). */
  suggestedName?: string;
  /**
   * Si true (pickFiles), l’utilisateur peut aussi valider un répertoire
   * pour traiter tous les fichiers filtrés qu’il contient.
   */
  allowDirectoryAsSource?: boolean;
}

export interface FileBrowserResult {
  /** Chemins fichiers sélectionnés (pickFiles). */
  files: string[];
  /** Répertoire courant / choisi. */
  directory: string;
  /** Nom de fichier (pickSaveFile). */
  fileName?: string;
  /** Chemin complet de sauvegarde (pickSaveFile). */
  savePath?: string;
  /**
   * true si l’utilisateur a validé le répertoire entier comme source
   * (tous les fichiers filtrés).
   */
  wholeDirectory: boolean;
}

export class FileBrowserDialog {
  private overlay: HTMLElement;
  private titleEl: HTMLElement;
  private rootsEl: HTMLElement;
  private pathEl: HTMLInputElement;
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private nameRow: HTMLElement;
  private nameInput: HTMLInputElement;
  private btnOk: HTMLButtonElement;
  private btnCancel: HTMLButtonElement;
  private btnUp: HTMLButtonElement;
  private btnDirMode: HTMLButtonElement;

  private mode: FileBrowserMode = 'pickFiles';
  private extensions: string[] = [];
  private allowDirectoryAsSource = false;
  private currentPath = '';
  private roots: FsRoot[] = [];
  private files: FsFileEntry[] = [];
  private selected = new Set<string>();
  private resolveFn: ((r: FileBrowserResult | null) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'fs-overlay hidden';
    this.overlay.innerHTML = `
      <div class="fs-dialog" role="dialog" aria-modal="true" aria-labelledby="fs-title">
        <header class="fs-header">
          <h2 id="fs-title">Fichiers</h2>
          <button type="button" class="fs-close" aria-label="Fermer">×</button>
        </header>
        <div class="fs-toolbar">
          <label class="fs-roots-label">Racines
            <select class="fs-roots"></select>
          </label>
          <button type="button" class="fs-btn fs-btn-up" title="Répertoire parent">↑ Parent</button>
          <input type="text" class="fs-path" spellcheck="false" />
          <button type="button" class="fs-btn fs-btn-go">Aller</button>
        </div>
        <div class="fs-list" tabindex="0"></div>
        <div class="fs-name-row hidden">
          <label>Nom du fichier
            <input type="text" class="fs-name" spellcheck="false" />
          </label>
        </div>
        <div class="fs-status"></div>
        <footer class="fs-footer">
          <button type="button" class="fs-btn fs-btn-dirmode hidden">Utiliser ce répertoire (tous les fichiers)</button>
          <span class="fs-footer-spacer"></span>
          <button type="button" class="fs-btn fs-btn-cancel">Cancel</button>
          <button type="button" class="fs-btn fs-btn-primary fs-btn-ok">Ok</button>
        </footer>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.titleEl = this.overlay.querySelector('#fs-title')!;
    this.rootsEl = this.overlay.querySelector('.fs-roots')!;
    this.pathEl = this.overlay.querySelector('.fs-path')!;
    this.listEl = this.overlay.querySelector('.fs-list')!;
    this.statusEl = this.overlay.querySelector('.fs-status')!;
    this.nameRow = this.overlay.querySelector('.fs-name-row')!;
    this.nameInput = this.overlay.querySelector('.fs-name')!;
    this.btnOk = this.overlay.querySelector('.fs-btn-ok')!;
    this.btnCancel = this.overlay.querySelector('.fs-btn-cancel')!;
    this.btnUp = this.overlay.querySelector('.fs-btn-up')!;
    this.btnDirMode = this.overlay.querySelector('.fs-btn-dirmode')!;

    this.overlay.querySelector('.fs-close')!.addEventListener('click', () => this.cancel());
    this.btnCancel.addEventListener('click', () => this.cancel());
    this.btnOk.addEventListener('click', () => void this.confirm());
    this.btnUp.addEventListener('click', () => void this.goParent());
    this.btnDirMode.addEventListener('click', () => void this.confirmWholeDir());
    this.overlay.querySelector('.fs-btn-go')!.addEventListener('click', () => {
      void this.navigate(this.pathEl.value.trim());
    });
    this.pathEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void this.navigate(this.pathEl.value.trim());
      }
    });
    // Enter dans le champ nom (enregistrement) → Ok
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this.canConfirmWithEnter()) void this.confirm();
      }
    });
    this.rootsEl.addEventListener('change', () => {
      const v = (this.rootsEl as HTMLSelectElement).value;
      if (v) void this.navigate(v);
    });
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel();
    });
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  /**
   * Ouvre le dialogue. Résout null si annulation.
   * Lève si l’API filesystem n’est pas disponible.
   */
  async open(opts: FileBrowserOptions): Promise<FileBrowserResult | null> {
    if (!(await fsAvailable())) {
      throw new Error(
        'Explorateur disque indisponible (lancez GrokCAD via npm run dev / lancer-GrokCad.sh).',
      );
    }
    if (this.resolveFn) {
      this.resolveFn(null);
      this.resolveFn = null;
    }

    this.mode = opts.mode;
    this.extensions = (opts.extensions ?? []).map((e) =>
      e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`,
    );
    this.allowDirectoryAsSource = Boolean(opts.allowDirectoryAsSource);
    this.selected.clear();
    this.titleEl.textContent = opts.title;

    this.nameRow.classList.toggle('hidden', this.mode !== 'pickSaveFile');
    this.btnDirMode.classList.toggle(
      'hidden',
      !(this.allowDirectoryAsSource && (this.mode === 'pickFiles' || this.mode === 'pickDir')),
    );
    this.btnDirMode.textContent =
      this.extensions.length > 0
        ? `Utiliser ce répertoire + sous-dossiers (tous les ${this.extensions.join(', ')})`
        : 'Utiliser ce répertoire + sous-dossiers (tous les fichiers)';

    if (opts.suggestedName) {
      this.nameInput.value = opts.suggestedName;
    } else {
      this.nameInput.value = '';
    }

    this.updateOkLabel();
    this.overlay.classList.remove('hidden');

    try {
      this.roots = await fsRoots();
    } catch {
      this.roots = [];
    }
    this.renderRoots();

    const fallback = this.roots[0]?.path || '/';
    const start = opts.startPath || fallback;
    this.currentPath = '';
    await this.navigate(start);
    // Dossier mémorisé introuvable (supprimé, autre machine…) → racine
    if (!this.currentPath && fallback && fallback !== start) {
      await this.navigate(fallback);
    }

    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
        return;
      }
      // Enter = Ok (fichier sélectionné, ou mode répertoire / enregistrement)
      if (e.key === 'Enter') {
        // Laisser le champ chemin gérer Enter (navigation « Aller »)
        if (e.target === this.pathEl) return;
        // En enregistrement, Enter dans le nom de fichier valide aussi
        e.preventDefault();
        e.stopPropagation();
        if (this.canConfirmWithEnter()) {
          void this.confirm();
        }
      }
    };
    window.addEventListener('keydown', this.keyHandler, true);

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  private updateOkLabel(): void {
    switch (this.mode) {
      case 'pickDir':
      case 'pickSaveDir':
        this.btnOk.textContent = 'Choisir ce répertoire';
        break;
      case 'pickSaveFile':
        this.btnOk.textContent = 'Enregistrer';
        break;
      default:
        this.btnOk.textContent = 'Ok';
    }
  }

  /** True si Enter doit déclencher le même effet que le bouton Ok. */
  private canConfirmWithEnter(): boolean {
    if (this.mode === 'pickDir' || this.mode === 'pickSaveDir') {
      return Boolean(this.currentPath);
    }
    if (this.mode === 'pickSaveFile') {
      return Boolean(this.nameInput.value.trim() || this.selected.size > 0);
    }
    // pickFiles : un fichier doit être sélectionné
    // (sans sélection, confirm() peut proposer le dossier entier — on évite ça au clavier)
    return this.selected.size > 0;
  }

  private renderRoots(): void {
    const sel = this.rootsEl as HTMLSelectElement;
    sel.innerHTML = '';
    for (const r of this.roots) {
      const opt = document.createElement('option');
      opt.value = r.path;
      opt.textContent = r.label;
      sel.appendChild(opt);
    }
  }

  private async navigate(dirPath: string): Promise<void> {
    if (!dirPath) return;
    this.statusEl.textContent = 'Chargement…';
    this.selected.clear();
    try {
      const list = await fsList(
        dirPath,
        this.extensions.length ? this.extensions : undefined,
      );
      this.currentPath = list.path;
      this.pathEl.value = list.path;
      this.files = list.files;
      this.renderList(list.dirs, list.files);

      // Mettre à jour racine sélectionnée si un préfixe matche
      const sel = this.rootsEl as HTMLSelectElement;
      let best = '';
      for (const r of this.roots) {
        if (
          list.path === r.path ||
          list.path.startsWith(r.path.endsWith('/') ? r.path : r.path + '/')
        ) {
          if (r.path.length > best.length) best = r.path;
        }
      }
      if (best) sel.value = best;

      const nFiles = list.files.length;
      const nDirs = list.dirs.length;
      const filt =
        this.extensions.length > 0
          ? ` · filtre ${this.extensions.join(', ')}`
          : '';
      this.statusEl.textContent = `${nDirs} dossier(s), ${nFiles} fichier(s)${filt}`;
    } catch (e) {
      this.statusEl.textContent =
        e instanceof Error ? e.message : String(e);
      this.listEl.innerHTML = `<div class="fs-empty">Impossible de lister ce répertoire.</div>`;
    }
  }

  private renderList(
    dirs: { name: string; path: string }[],
    files: FsFileEntry[],
  ): void {
    this.listEl.innerHTML = '';
    if (dirs.length === 0 && files.length === 0) {
      this.listEl.innerHTML = `<div class="fs-empty">Répertoire vide (ou aucun fichier correspondant).</div>`;
      return;
    }

    for (const d of dirs) {
      const row = document.createElement('div');
      row.className = 'fs-row fs-row-dir';
      row.innerHTML = `<span class="fs-icon">📁</span><span class="fs-row-name"></span>`;
      (row.querySelector('.fs-row-name') as HTMLElement).textContent = d.name;
      row.title = d.path;
      row.addEventListener('dblclick', () => void this.navigate(d.path));
      row.addEventListener('click', () => {
        // En mode répertoire, un clic simple ne sélectionne pas de fichier
        this.selected.clear();
        this.highlightSelection();
      });
      this.listEl.appendChild(row);
    }

    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'fs-row fs-row-file';
      row.dataset.path = f.path;
      row.innerHTML = `<span class="fs-icon">📄</span><span class="fs-row-name"></span><span class="fs-row-size"></span>`;
      (row.querySelector('.fs-row-name') as HTMLElement).textContent = f.name;
      (row.querySelector('.fs-row-size') as HTMLElement).textContent =
        formatSize(f.size);
      row.title = f.path;
      row.addEventListener('click', (e) => {
        if (this.mode === 'pickFiles') {
          if (e.ctrlKey || e.metaKey) {
            if (this.selected.has(f.path)) this.selected.delete(f.path);
            else this.selected.add(f.path);
          } else if (e.shiftKey && this.selected.size > 0) {
            // Plage simple : tous entre le premier sélectionné et celui-ci
            this.selectRange(f.path);
          } else {
            this.selected.clear();
            this.selected.add(f.path);
          }
          this.highlightSelection();
          // Focus liste pour que Enter valide sans recliquer
          this.listEl.focus();
        } else if (this.mode === 'pickSaveFile') {
          this.selected.clear();
          this.selected.add(f.path);
          this.nameInput.value = f.name;
          this.highlightSelection();
          this.nameInput.focus();
        } else {
          this.selected.clear();
          this.selected.add(f.path);
          this.highlightSelection();
          this.listEl.focus();
        }
      });
      row.addEventListener('dblclick', () => {
        if (this.mode === 'pickFiles') {
          this.selected.clear();
          this.selected.add(f.path);
          void this.confirm();
        } else if (this.mode === 'pickSaveFile') {
          this.nameInput.value = f.name;
          void this.confirm();
        }
      });
      this.listEl.appendChild(row);
    }
  }

  private selectRange(toPath: string): void {
    const paths = this.files.map((f) => f.path);
    const selectedList = [...this.selected];
    const from = selectedList[selectedList.length - 1] ?? toPath;
    const i0 = paths.indexOf(from);
    const i1 = paths.indexOf(toPath);
    if (i0 < 0 || i1 < 0) {
      this.selected.add(toPath);
      return;
    }
    const a = Math.min(i0, i1);
    const b = Math.max(i0, i1);
    for (let i = a; i <= b; i++) this.selected.add(paths[i]!);
  }

  private highlightSelection(): void {
    this.listEl.querySelectorAll('.fs-row-file').forEach((row) => {
      const el = row as HTMLElement;
      const p = el.dataset.path ?? '';
      el.classList.toggle('selected', this.selected.has(p));
    });
  }

  private async goParent(): Promise<void> {
    if (!this.currentPath || this.currentPath === '/') return;
    const parent = this.currentPath.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/';
    await this.navigate(parent);
  }

  private async confirmWholeDir(): Promise<void> {
    if (!this.currentPath) return;
    this.statusEl.textContent =
      'Recherche récursive dans les sous-dossiers…';
    try {
      const found = await fsFind(
        this.currentPath,
        this.extensions.length ? this.extensions : undefined,
      );
      if (found.files.length === 0) {
        this.statusEl.textContent =
          this.extensions.length > 0
            ? `Aucun fichier ${this.extensions.join(', ')} dans ce répertoire ni ses sous-dossiers.`
            : 'Aucun fichier dans ce répertoire ni ses sous-dossiers.';
        return;
      }
      if (found.truncated) {
        this.statusEl.textContent = `Trop de fichiers (limite atteinte) : ${found.files.length} listés. Affinez le répertoire.`;
        return;
      }
      this.finish({
        files: found.files.map((f) => f.path),
        directory: this.currentPath,
        wholeDirectory: true,
      });
    } catch (e) {
      this.statusEl.textContent =
        e instanceof Error ? e.message : String(e);
    }
  }

  private async confirm(): Promise<void> {
    if (this.mode === 'pickDir' || this.mode === 'pickSaveDir') {
      this.finish({
        files: [],
        directory: this.currentPath,
        wholeDirectory: true,
      });
      return;
    }

    if (this.mode === 'pickSaveFile') {
      let name = this.nameInput.value.trim();
      if (!name) {
        this.statusEl.textContent = 'Indiquez un nom de fichier.';
        this.nameInput.focus();
        return;
      }
      // Extension par défaut si filtre unique
      if (this.extensions.length === 1) {
        const ext = this.extensions[0]!;
        if (!name.toLowerCase().endsWith(ext)) name += ext;
      }
      const savePath = joinPath(this.currentPath, name);
      this.finish({
        files: [],
        directory: this.currentPath,
        fileName: name,
        savePath,
        wholeDirectory: false,
      });
      return;
    }

    // pickFiles
    if (this.selected.size === 0) {
      if (this.allowDirectoryAsSource) {
        // Recherche récursive même s’il n’y a aucun fichier au niveau courant
        void this.confirmWholeDir();
        return;
      }
      this.statusEl.textContent =
        'Sélectionnez un ou plusieurs fichiers (Ctrl+clic), ou utilisez « ce répertoire ».';
      return;
    }
    this.finish({
      files: [...this.selected],
      directory: this.currentPath,
      wholeDirectory: false,
    });
  }

  private cancel(): void {
    this.finish(null);
  }

  private finish(result: FileBrowserResult | null): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.overlay.classList.add('hidden');
    const fn = this.resolveFn;
    this.resolveFn = null;
    fn?.(result);
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Instance unique (lazy). */
let _browser: FileBrowserDialog | null = null;

export function getFileBrowser(): FileBrowserDialog {
  if (!_browser) _browser = new FileBrowserDialog();
  return _browser;
}

/**
 * Raccourci : choisir source (fichiers et/ou dossier) avec filtre.
 * Si wholeDirectory : fichiers trouvés récursivement sous le répertoire.
 */
export async function pickSourceFiles(
  title: string,
  extensions: string[],
  startPath?: string,
): Promise<{
  files: string[];
  directory: string;
  wholeDirectory: boolean;
} | null> {
  const browser = getFileBrowser();
  const r = await browser.open({
    title,
    mode: 'pickFiles',
    extensions,
    startPath,
    allowDirectoryAsSource: true,
  });
  if (!r) return null;
  if (r.files.length === 0) return null;
  return {
    files: r.files,
    directory: r.directory,
    wholeDirectory: r.wholeDirectory,
  };
}

export async function pickDestinationDir(
  title: string,
  startPath?: string,
): Promise<string | null> {
  const browser = getFileBrowser();
  const r = await browser.open({
    title,
    mode: 'pickSaveDir',
    startPath,
  });
  return r?.directory ?? null;
}

export async function pickSaveFilePath(
  title: string,
  suggestedName: string,
  extensions: string[],
  startPath?: string,
): Promise<{ path: string; directory: string; fileName: string } | null> {
  const browser = getFileBrowser();
  const r = await browser.open({
    title,
    mode: 'pickSaveFile',
    extensions,
    suggestedName,
    startPath,
  });
  if (!r?.savePath || !r.fileName) return null;
  return { path: r.savePath, directory: r.directory, fileName: r.fileName };
}

export { basename };
