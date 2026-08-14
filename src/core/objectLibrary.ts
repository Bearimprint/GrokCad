/**
 * Client bibliothèque d'objets (dossier library/ via API Vite en dev).
 */

import { entitiesBounds2d } from './entityOps';
import { defaultCamera, parseGkd, serializeGkd } from './gkd';
import {
  APP_VERSION,
  GKD_MAGIC,
  type Entity,
  type GkdDocument,
  type Vec3,
} from './types';
import { wallEntityStrokes } from './walls';

export interface LibraryFileInfo {
  name: string;
  file: string;
  tab: string;
}

const DEFAULT_TABS = ['sanitaire', 'electrique', 'salon', 'chambre'];

export async function listLibraryTabs(): Promise<string[]> {
  try {
    const r = await fetch('/api/library');
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { tabs: string[] };
    return data.tabs?.length ? data.tabs : [...DEFAULT_TABS];
  } catch {
    return [...DEFAULT_TABS];
  }
}

export async function listLibraryFiles(tab: string): Promise<LibraryFileInfo[]> {
  try {
    const r = await fetch(`/api/library/${encodeURIComponent(tab)}`);
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { files: { name: string; file: string }[] };
    return (data.files ?? []).map((f) => ({ ...f, tab }));
  } catch {
    return [];
  }
}

export async function loadLibraryObject(
  tab: string,
  name: string,
): Promise<GkdDocument | null> {
  try {
    const r = await fetch(
      `/api/library/${encodeURIComponent(tab)}/${encodeURIComponent(name)}`,
    );
    if (!r.ok) return null;
    return parseGkd(await r.text());
  } catch {
    return null;
  }
}

export async function saveLibraryObject(
  tab: string,
  name: string,
  doc: GkdDocument,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const r = await fetch(
      `/api/library/${encodeURIComponent(tab)}/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: serializeGkd(doc),
      },
    );
    const data = (await r.json()) as { ok?: boolean; path?: string; error?: string };
    if (!r.ok) return { ok: false, error: data.error ?? r.statusText };
    return { ok: true, path: data.path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createLibraryTab(tab: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/library/${encodeURIComponent(tab)}`, {
      method: 'POST',
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteLibraryObject(
  tab: string,
  name: string,
): Promise<boolean> {
  try {
    const r = await fetch(
      `/api/library/${encodeURIComponent(tab)}/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    return r.ok;
  } catch {
    return false;
  }
}

/** Construit un .GKD objet à partir d'entités (déjà ramenées à l'origine). */
export function buildObjectDocument(
  entities: Entity[],
  title: string,
): GkdDocument {
  const bounds = entitiesBounds2d(entities);
  const half =
    bounds != null
      ? Math.max(
          (bounds.maxX - bounds.minX) / 2,
          (bounds.maxY - bounds.minY) / 2,
          50,
        ) * 1.2
      : 200;
  const cam = defaultCamera();
  cam.orthoHalfHeight = half;
  cam.target = [0, 0, 0];
  cam.position = [0, 0, Math.max(half * 10, 1000)];

  return {
    magic: GKD_MAGIC,
    version: APP_VERSION,
    modified: new Date().toISOString(),
    camera: cam,
    entities,
    wallLibrary: [],
    objectLibrary: [],
    meta: { title, units: 'm' },
  };
}

export function downloadObjectGkd(doc: GkdDocument, filename: string): void {
  const blob = new Blob([serializeGkd(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.gkd') ? filename : `${filename}.gkd`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * showSaveFilePicker si dispo (Chrome), sinon download.
 */
export async function saveExtractDialog(
  doc: GkdDocument,
  suggestedName: string,
): Promise<{ ok: boolean; method: 'picker' | 'download' | 'cancel'; name?: string }> {
  const name = suggestedName.endsWith('.gkd') ? suggestedName : `${suggestedName}.gkd`;
  const json = serializeGkd(doc);

  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (d: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
      name: string;
    }>;
  };

  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: 'GrokCAD (.gkd)',
            accept: { 'application/json': ['.gkd'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return { ok: true, method: 'picker', name: handle.name };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { ok: false, method: 'cancel' };
      }
    }
  }

  downloadObjectGkd(doc, name);
  return { ok: true, method: 'download', name };
}

/** Dessine les entités d'un objet dans un canvas 2D (vignette biblio). */
export function paintObjectThumbnail(
  ctx: CanvasRenderingContext2D,
  size: number,
  entities: readonly Entity[],
  opts?: { selected?: boolean },
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#2a303c';
  ctx.fillRect(0, 0, size, size);

  if (opts?.selected) {
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  } else {
    ctx.strokeStyle = '#3a4250';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  const bounds = entitiesBounds2d(entities);
  if (!bounds) {
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('vide', size / 2, size / 2);
    return;
  }

  const pad = 6;
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const usable = size - 2 * pad;
  const scale = Math.min(usable / bw, usable / bh);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const toScreen = (x: number, y: number): [number, number] => {
    const sx = size / 2 + (x - cx) * scale;
    const sy = size / 2 - (y - cy) * scale;
    return [sx, sy];
  };

  const drawSeg = (a: Vec3, b: Vec3, color: string, lw: number) => {
    const [x0, y0] = toScreen(a[0], a[1]);
    const [x1, y1] = toScreen(b[0], b[1]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle =
      color === '#000000' || color === '#000' ? '#e0e0e0' : color;
    ctx.lineWidth = Math.max(1, Math.min(3, lw));
    ctx.stroke();
  };

  for (const e of entities) {
    if (e.kind === 'line') {
      drawSeg(e.start, e.end, e.color, e.lineWidth);
    } else if (e.kind === 'polyline') {
      for (const s of e.segments) {
        if (s.type === 'line') {
          drawSeg(s.start, s.end, s.color, s.lineWidth);
        } else {
          // Arc simplifié : corde + milieu
          const a0 = s.startAngle;
          const a1 = s.endAngle;
          const n = 16;
          let prev: Vec3 | null = null;
          for (let i = 0; i <= n; i++) {
            const t = a0 + ((a1 - a0) * i) / n;
            const p: Vec3 = [
              s.center[0] + s.radius * Math.cos(t),
              s.center[1] + s.radius * Math.sin(t),
              s.center[2],
            ];
            if (prev) drawSeg(prev, p, s.color, s.lineWidth);
            prev = p;
          }
        }
      }
    } else if (e.kind === 'circle') {
      const [cxp, cyp] = toScreen(e.center[0], e.center[1]);
      ctx.beginPath();
      ctx.arc(cxp, cyp, Math.max(1, e.radius * scale), 0, Math.PI * 2);
      ctx.strokeStyle =
        e.color === '#000000' || e.color === '#000' ? '#e0e0e0' : e.color;
      ctx.lineWidth = Math.max(1, Math.min(3, e.lineWidth));
      ctx.stroke();
    } else if (e.kind === 'arc') {
      let a0 = e.startAngle;
      let a1 = e.endAngle;
      while (a1 < a0) a1 += Math.PI * 2;
      const n = 24;
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n;
        const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
        const p0: Vec3 = [
          e.center[0] + e.radius * Math.cos(t0),
          e.center[1] + e.radius * Math.sin(t0),
          0,
        ];
        const p1: Vec3 = [
          e.center[0] + e.radius * Math.cos(t1),
          e.center[1] + e.radius * Math.sin(t1),
          0,
        ];
        drawSeg(p0, p1, e.color, e.lineWidth);
      }
    } else if (e.kind === 'wall') {
      for (const s of wallEntityStrokes(e, 12)) {
        for (let i = 0; i < s.points.length - 1; i++) {
          drawSeg(s.points[i]!, s.points[i + 1]!, s.color, s.lineWidth);
        }
      }
    }
  }
}
