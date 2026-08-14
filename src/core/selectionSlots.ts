/**
 * Emplacements de sélection (session) :
 *   Shift+F1…F12 → mémoriser la sélection courante (liste d’ids)
 *   Alt+F1…F12   → rappeler la sélection (ids encore présents dans le doc)
 */

const SLOT_MIN = 1;
const SLOT_MAX = 12;

export function isSlotIndex(n: number): boolean {
  return Number.isInteger(n) && n >= SLOT_MIN && n <= SLOT_MAX;
}

/** Parse F1…F12 → 1…12, sinon null. */
export function fKeyToSlot(key: string): number | null {
  const m = /^F(\d{1,2})$/i.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  return isSlotIndex(n) ? n : null;
}

export class SelectionSlots {
  /** slot 1..12 → ids mémorisés */
  private slots = new Map<number, string[]>();

  /** Mémorise les ids dans le slot (remplace le précédent). */
  save(slot: number, ids: Iterable<string>): number {
    if (!isSlotIndex(slot)) return 0;
    const list = [...new Set(ids)];
    this.slots.set(slot, list);
    return list.length;
  }

  /**
   * Rappelle les ids du slot filtrés par `existing` (entités encore dans le doc).
   * Renvoie [] si slot vide ou aucun id vivant.
   */
  restore(slot: number, existing: ReadonlySet<string> | Iterable<string>): string[] {
    if (!isSlotIndex(slot)) return [];
    const saved = this.slots.get(slot);
    if (!saved || saved.length === 0) return [];
    const live = existing instanceof Set ? existing : new Set(existing);
    return saved.filter((id) => live.has(id));
  }

  has(slot: number): boolean {
    const s = this.slots.get(slot);
    return !!s && s.length > 0;
  }

  count(slot: number): number {
    return this.slots.get(slot)?.length ?? 0;
  }
}
