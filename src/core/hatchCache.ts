/**
 * Cache des motifs hachure (library/hatch/*.gkd) pour le rendu /fill.
 */

import { defaultHatchPatternEntities } from './fill';
import { loadLibraryObject } from './objectLibrary';
import { HATCH_LIBRARY_TAB } from './hatchPrefs';
import type { Entity } from './types';

const cache = new Map<string, Entity[]>();
const inflight = new Map<string, Promise<Entity[] | null>>();
const listeners = new Set<() => void>();

export function onHatchCacheChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** Sync : null si pas encore chargé. */
export function getHatchPattern(name: string): Entity[] | null {
  return cache.get(name) ?? null;
}

export function setHatchPattern(name: string, entities: Entity[]): void {
  cache.set(name, entities);
  emit();
}

/** Charge le motif (ou motif par défaut pour lignes45). */
export async function ensureHatchPattern(
  name: string,
): Promise<Entity[] | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  let p = inflight.get(name);
  if (!p) {
    p = (async () => {
      try {
        const doc = await loadLibraryObject(HATCH_LIBRARY_TAB, name);
        if (doc?.entities?.length) {
          cache.set(name, doc.entities);
          emit();
          return doc.entities;
        }
        if (name === 'lignes45') {
          const ents = defaultHatchPatternEntities();
          cache.set(name, ents);
          emit();
          return ents;
        }
        return null;
      } finally {
        inflight.delete(name);
      }
    })();
    inflight.set(name, p);
  }
  return p;
}

/** Précharge tous les motifs référencés par les entités. */
export function preloadHatchFromEntities(entities: readonly { kind: string; hatch?: { hatchName: string } }[]): void {
  for (const e of entities) {
    if (e.kind === 'polyline' && e.hatch?.hatchName) {
      void ensureHatchPattern(e.hatch.hatchName);
    }
  }
}
