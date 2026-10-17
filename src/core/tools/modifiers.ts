/**
 * État Shift / Alt / Ctrl. Un seul jeu d'écouteurs `window`, retiré par `dispose()`.
 */

export type ModifierKey = 'shift' | 'alt' | 'ctrl' | 'blur';

export class ModifierTracker {
  shiftDown = false;
  altDown = false;
  ctrlDown = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.onKey(e, false);
  private readonly onBlur = () => {
    this.shiftDown = false;
    this.altDown = false;
    this.ctrlDown = false;
    this.onChange('blur', false);
  };

  constructor(
    private readonly onChange: (key: ModifierKey, down: boolean, e?: KeyboardEvent) => void,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.key === 'Shift') {
      this.shiftDown = down;
      this.onChange('shift', down, e);
      return;
    }
    if (e.key === 'Alt') {
      if (down && e.repeat) return;
      this.altDown = down;
      this.onChange('alt', down, e);
      return;
    }
    if (e.key === 'Control') {
      this.ctrlDown = down;
      this.onChange('ctrl', down, e);
    }
  }
}
