/**
 * Dialogue de confirmation simple (Ok / Cancel, ou choix multiples).
 */

export interface ConfirmButton {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  /** Boutons (défaut Ok + Cancel). id = 'ok' | 'cancel' ou libre. */
  buttons?: ConfirmButton[];
}

/**
 * Affiche un dialogue modal.
 * Résout avec l’id du bouton cliqué, ou null si fermeture (X / Échap / overlay).
 */
export function showConfirm(opts: ConfirmOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const buttons: ConfirmButton[] = opts.buttons ?? [
      { id: 'ok', label: 'Ok', primary: true },
      { id: 'cancel', label: 'Cancel' },
    ];

    const overlay = document.createElement('div');
    overlay.className = 'fs-overlay';
    overlay.innerHTML = `
      <div class="fs-dialog confirm-dialog" role="dialog" aria-modal="true">
        <header class="fs-header">
          <h2>${escapeHtml(opts.title ?? 'Confirmation')}</h2>
          <button type="button" class="fs-close" aria-label="Fermer">×</button>
        </header>
        <div class="fs-body confirm-body">
          <p class="confirm-message"></p>
        </div>
        <footer class="fs-footer confirm-footer"></footer>
      </div>
    `;

    const msgEl = overlay.querySelector('.confirm-message') as HTMLElement;
    msgEl.textContent = opts.message;

    const footer = overlay.querySelector('.confirm-footer') as HTMLElement;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.primary ? 'fs-btn fs-btn-primary' : 'fs-btn';
      btn.textContent = b.label;
      btn.dataset.id = b.id;
      btn.addEventListener('click', () => finish(b.id));
      footer.appendChild(btn);
    }

    const finish = (id: string | null) => {
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(id);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if (e.key === 'Enter') {
        const primary = buttons.find((b) => b.primary) ?? buttons[0];
        if (primary) {
          e.preventDefault();
          finish(primary.id);
        }
      }
    };

    overlay.querySelector('.fs-close')!.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });

    document.body.appendChild(overlay);
    window.addEventListener('keydown', onKey, true);
    const first = footer.querySelector('.fs-btn-primary') as HTMLButtonElement | null;
    first?.focus();
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
