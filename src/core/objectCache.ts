/**
 * Cache des définitions d'objets library/ (références live).
 * Invalider après /obj save ou édition library → re-rendu des instances.
 */

import { loadLibraryObject } from './objectLibrary';
import type { GkdDocument } from './types';

export function objectKey(tab: string, name: string): string {
  return `${tab}/${name}`;
}

type Listener = () => void;

class ObjectDefCache {
  private map = new Map<string, GkdDocument>();
  private listeners = new Set<Listener>();
  private inflight = new Map<string, Promise<GkdDocument | null>>();

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get(tab: string, name: string): GkdDocument | null {
    return this.map.get(objectKey(tab, name)) ?? null;
  }

  set(tab: string, name: string, doc: GkdDocument): void {
    this.map.set(objectKey(tab, name), doc);
    this.emit();
  }

  invalidate(tab: string, name: string): void {
    this.map.delete(objectKey(tab, name));
    this.emit();
  }

  invalidateAll(): void {
    this.map.clear();
    this.emit();
  }

  /** Charge depuis l'API si absent du cache. */
  async ensure(tab: string, name: string): Promise<GkdDocument | null> {
    const key = objectKey(tab, name);
    const hit = this.map.get(key);
    if (hit) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = loadLibraryObject(tab, name).then((doc) => {
      this.inflight.delete(key);
      if (doc) {
        this.map.set(key, doc);
        this.emit();
      }
      return doc;
    });
    this.inflight.set(key, p);
    return p;
  }
}

export const objectDefCache = new ObjectDefCache();
