/**
 * Dialogue « bloc-notes » pour saisie de texte multiligne (/text, /textbox).
 */

export interface TextInputOptions {
  title?: string;
  initial?: string;
  placeholder?: string;
}

/**
 * Ouvre une fenêtre de saisie. Résout le texte (trim non forcé sur lignes
 * internes) ou null si annulation.
 */
export function showTextInputDialog(
  opts: TextInputOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fs-overlay';
    overlay.innerHTML = `
      <div class="fs-dialog text-input-dialog" role="dialog" aria-modal="true">
        <header class="fs-header">
          <h2>${escapeHtml(opts.title ?? 'Texte')}</h2>
          <button type="button" class="fs-close" aria-label="Fermer">×</button>
        </header>
        <div class="fs-body text-input-body">
          <textarea
            class="text-input-area"
            rows="6"
            spellcheck="false"
            placeholder="${escapeHtml(opts.placeholder ?? 'Saisissez le texte…')}"
          ></textarea>
        </div>
        <footer class="fs-footer">
          <button type="button" class="fs-btn" data-act="cancel">Annuler</button>
          <button type="button" class="fs-btn fs-btn-primary" data-act="ok">OK</button>
        </footer>
      </div>
    `;

    const ta = overlay.querySelector('.text-input-area') as HTMLTextAreaElement;
    ta.value = opts.initial ?? '';

    const finish = (value: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(ta.value);
      }
    };

    overlay.querySelector('.fs-close')!.addEventListener('click', () => finish(null));
    overlay.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(null));
    overlay.querySelector('[data-act="ok"]')!.addEventListener('click', () => finish(ta.value));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    window.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    queueMicrotask(() => {
      ta.focus();
      ta.select();
    });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
