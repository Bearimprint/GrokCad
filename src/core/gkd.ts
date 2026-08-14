import { computeDefaultLabelPositions } from './dimension';
import {
  APP_VERSION,
  GKD_MAGIC,
  type CameraState,
  type DimensionEntity,
  type GkdDocument,
  type JonctionStrategyId,
} from './types';
import { DEFAULT_UNIT, isUnitId } from './units';

const JONCTION_STRATEGY_IDS: readonly JonctionStrategyId[] = [
  'first-hit',
  'first-hit-cover',
  'l-pair-stem',
  'max-t',
];

function isJonctionStrategy(v: unknown): v is JonctionStrategyId {
  return (
    typeof v === 'string' &&
    (JONCTION_STRATEGY_IDS as readonly string[]).includes(v)
  );
}

export function defaultCamera(): CameraState {
  // Vue en plan : regarder XY depuis +Z (Z vers le haut). Unités = m.
  return {
    target: [0, 0, 0],
    position: [0, 0, 50],
    up: [0, 1, 0],
    mode: 'ortho',
    orthoHalfHeight: 5, // 10 m visibles en hauteur
    fov: 50,
    workplane: 'XY',
  };
}

export function createEmptyDocument(title = 'Sans titre'): GkdDocument {
  return {
    magic: GKD_MAGIC,
    version: APP_VERSION,
    modified: new Date().toISOString(),
    camera: defaultCamera(),
    entities: [],
    wallLibrary: [],
    objectLibrary: [],
    meta: { title, units: DEFAULT_UNIT },
  };
}

export function serializeGkd(doc: GkdDocument): string {
  const payload: GkdDocument = {
    ...doc,
    magic: GKD_MAGIC,
    version: doc.version || APP_VERSION,
    modified: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseGkd(text: string): GkdDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Fichier .GKD illisible (JSON invalide).');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Fichier .GKD invalide.');
  }

  const doc = data as Partial<GkdDocument>;

  if (doc.magic !== GKD_MAGIC) {
    throw new Error(
      `Numéro magique incorrect (attendu ${GKD_MAGIC}, reçu ${String(doc.magic)}).`,
    );
  }

  if (!doc.camera || typeof doc.camera !== 'object') {
    throw new Error('Caméra absente du fichier .GKD.');
  }

  const cam = doc.camera as CameraState;
  if (
    !Array.isArray(cam.target) ||
    !Array.isArray(cam.position) ||
    typeof cam.orthoHalfHeight !== 'number'
  ) {
    throw new Error('État caméra .GKD incomplet ou corrompu.');
  }

  const entities = Array.isArray(doc.entities)
    ? (doc.entities as GkdDocument['entities']).map((e, i) =>
        normalizeEntity(e, i),
      )
    : [];

  return {
    magic: GKD_MAGIC,
    version: typeof doc.version === 'string' ? doc.version : APP_VERSION,
    modified: typeof doc.modified === 'string' ? doc.modified : new Date().toISOString(),
    camera: {
      ...defaultCamera(),
      ...cam,
    },
    entities,
    wallLibrary: Array.isArray(doc.wallLibrary)
      ? normalizeWallLibrary(doc.wallLibrary)
      : [],
    objectLibrary: Array.isArray(doc.objectLibrary) ? doc.objectLibrary : [],
    meta: {
      ...doc.meta,
      units: isUnitId(doc.meta?.units) ? doc.meta.units : DEFAULT_UNIT,
    },
  };
}

function normalizeWallLibrary(raw: unknown[]): GkdDocument['wallLibrary'] {
  const out: GkdDocument['wallLibrary'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // Ancien format : offsets / colors / thicknesses
    if (Array.isArray(o.lines)) {
      out.push({
        id: typeof o.id === 'string' ? o.id : `w_${out.length}`,
        name: typeof o.name === 'string' ? o.name : 'Mur',
        tab: typeof o.tab === 'string' ? o.tab : 'Général',
        lines: (o.lines as unknown[]).map((ln) => {
          const l = (ln ?? {}) as Record<string, unknown>;
          const priority =
            typeof l.priority === 'number' && Number.isFinite(l.priority)
              ? Math.max(1, Math.min(99, Math.round(l.priority as number)))
              : 3;
          const line: import('./types').WallLineDef = {
            offset: typeof l.offset === 'number' ? l.offset : 0,
            color: typeof l.color === 'string' ? l.color : '#000000',
            lineWidth: typeof l.lineWidth === 'number' ? l.lineWidth : 1,
            lineStyle: (typeof l.lineStyle === 'string' ? l.lineStyle : 'plein') as import('./types').LineStyleId,
            priority,
          };
          if (typeof l.layerTypeId === 'string' && l.layerTypeId.trim()) {
            line.layerTypeId = l.layerTypeId.trim();
          }
          return line;
        }),
      });
      continue;
    }
    if (Array.isArray(o.offsets)) {
      const offsets = o.offsets as number[];
      const colors = Array.isArray(o.colors) ? (o.colors as string[]) : [];
      const thicknesses = Array.isArray(o.thicknesses) ? (o.thicknesses as number[]) : [];
      out.push({
        id: typeof o.id === 'string' ? o.id : `w_${out.length}`,
        name: typeof o.name === 'string' ? o.name : 'Mur',
        tab: typeof o.tab === 'string' ? o.tab : 'Général',
        lines: offsets.map((off, i) => ({
          offset: off,
          color: colors[i] ?? '#000000',
          lineWidth: thicknesses[i] ?? 1,
          lineStyle: 'plein' as const,
          priority: 3,
          layerTypeId: 'generique',
        })),
      });
    }
  }
  return out;
}

/** Garantit un id unique (chaque entité en a un dans le .GKD). */
function ensureEntityId(
  e: GkdDocument['entities'][number],
  index: number,
): string {
  if (typeof e.id === 'string' && e.id.length > 0) return e.id;
  const kind = typeof e.kind === 'string' ? e.kind : 'ent';
  return `${kind}_${index}_${Date.now().toString(36)}`;
}

/** Complète les champs de trait manquants (anciens .GKD). */
function normalizeEntity(
  e: GkdDocument['entities'][number],
  index = 0,
): GkdDocument['entities'][number] {
  const id = ensureEntityId(e, index);
  if (e.kind === 'line') {
    return {
      ...e,
      id,
      color: typeof e.color === 'string' ? e.color : '#000000',
      lineWidth: typeof e.lineWidth === 'number' ? e.lineWidth : 1,
      lineStyle: e.lineStyle ?? 'plein',
    };
  }
  if (e.kind === 'arc') {
    return {
      ...e,
      id,
      color: typeof e.color === 'string' ? e.color : '#000000',
      lineWidth: typeof e.lineWidth === 'number' ? e.lineWidth : 1,
      lineStyle: e.lineStyle ?? 'plein',
    };
  }
  if (e.kind === 'circle') {
    return {
      ...e,
      id,
      color: typeof e.color === 'string' ? e.color : '#000000',
      lineWidth: typeof e.lineWidth === 'number' ? e.lineWidth : 1,
      lineStyle: e.lineStyle ?? 'plein',
      normal: Array.isArray(e.normal) ? e.normal : ([0, 0, 1] as [number, number, number]),
      radius: typeof e.radius === 'number' ? Math.abs(e.radius) : 0,
    };
  }
  if (e.kind === 'text') {
    return {
      ...e,
      id,
      position: Array.isArray(e.position)
        ? e.position
        : ([0, 0, 0] as [number, number, number]),
      height: typeof e.height === 'number' ? Math.abs(e.height) : 1,
      content: typeof e.content === 'string' ? e.content : '',
      rotation: typeof e.rotation === 'number' ? e.rotation : 0,
      color: typeof e.color === 'string' ? e.color : '#e0e0e0',
      hAlign: typeof e.hAlign === 'number' ? e.hAlign : 0,
      vAlign: typeof e.vAlign === 'number' ? e.vAlign : 0,
      layer: typeof e.layer === 'string' ? e.layer : '0',
      fontFamily: typeof e.fontFamily === 'string' ? e.fontFamily : undefined,
      bold: typeof e.bold === 'boolean' ? e.bold : undefined,
      italic: typeof e.italic === 'boolean' ? e.italic : undefined,
      background:
        e.background === null
          ? null
          : typeof e.background === 'string'
            ? e.background
            : undefined,
      boxed: typeof e.boxed === 'boolean' ? e.boxed : undefined,
      boxPadding:
        typeof e.boxPadding === 'number' && e.boxPadding >= 0
          ? e.boxPadding
          : undefined,
      dimId: typeof e.dimId === 'string' ? e.dimId : undefined,
    };
  }
  if (e.kind === 'dimension') {
    const styleRaw = (e as { style?: unknown }).style;
    const styleIn =
      styleRaw && typeof styleRaw === 'object'
        ? (styleRaw as import('./types').DimensionStyle)
        : null;
    const style: import('./types').DimensionStyle = styleIn
      ? {
          id: typeof styleIn.id === 'string' ? styleIn.id : 'std',
          name: typeof styleIn.name === 'string' ? styleIn.name : 'Standard',
          fontFamily:
            typeof styleIn.fontFamily === 'string'
              ? styleIn.fontFamily
              : 'Arial, Helvetica, sans-serif',
          textColor:
            typeof styleIn.textColor === 'string'
              ? styleIn.textColor
              : '#000000',
          textBackground:
            styleIn.textBackground === null
              ? null
              : typeof styleIn.textBackground === 'string'
                ? styleIn.textBackground
                : null,
          textHeight:
            typeof styleIn.textHeight === 'number' && styleIn.textHeight > 0
              ? styleIn.textHeight
              : 0.18,
          bold: !!styleIn.bold,
          italic: !!styleIn.italic,
          lineColor:
            typeof styleIn.lineColor === 'string'
              ? styleIn.lineColor
              : '#000000',
          lineWidth:
            typeof styleIn.lineWidth === 'number' && styleIn.lineWidth > 0
              ? styleIn.lineWidth
              : 1,
          lineStyle: styleIn.lineStyle ?? 'plein',
          extensionOffset:
            typeof styleIn.extensionOffset === 'number'
              ? Math.max(0, styleIn.extensionOffset)
              : 0.05,
          extensionOverhang:
            typeof styleIn.extensionOverhang === 'number'
              ? Math.max(0, styleIn.extensionOverhang)
              : 0.05,
          tickSize:
            typeof styleIn.tickSize === 'number'
              ? Math.max(0, styleIn.tickSize)
              : 0.08,
          textOffset:
            typeof styleIn.textOffset === 'number'
              ? Math.max(0, styleIn.textOffset)
              : 0.05,
        }
      : {
          id: 'std',
          name: 'Standard',
          fontFamily: 'Arial, Helvetica, sans-serif',
          textColor: '#000000',
          textBackground: null,
          textHeight: 0.18,
          bold: false,
          italic: false,
          lineColor: '#000000',
          lineWidth: 1,
          lineStyle: 'plein' as const,
          extensionOffset: 0.05,
          extensionOverhang: 0.05,
          tickSize: 0.08,
          textOffset: 0.05,
        };
    const lineAnchor = Array.isArray(e.lineAnchor)
      ? (e.lineAnchor as [number, number, number])
      : ([0, 0, 0] as [number, number, number]);
    const direction = Array.isArray(e.direction)
      ? (e.direction as [number, number, number])
      : ([1, 0, 0] as [number, number, number]);
    const defPoints = Array.isArray(e.defPoints)
      ? e.defPoints.filter(
          (p): p is [number, number, number] =>
            Array.isArray(p) && p.length >= 2,
        )
      : [];
    const labelId =
      typeof e.labelId === 'string' && e.labelId.trim()
        ? e.labelId.trim()
        : undefined;
    const mode =
      e.mode === 'chain' ? 'chain' : e.mode === 'single' ? 'single' : undefined;

    // Legacy : multi-libellés virtuels sans TextEntity
    let labelPositions: [number, number, number][] | undefined;
    let labelRotations: number[] | undefined;
    if (!labelId && Array.isArray(e.labelPositions)) {
      labelPositions = e.labelPositions.filter(
        (p): p is [number, number, number] =>
          Array.isArray(p) && p.length >= 2,
      );
      if (
        defPoints.length >= 2 &&
        labelPositions.length !== defPoints.length - 1
      ) {
        labelPositions = computeDefaultLabelPositions(
          style,
          lineAnchor,
          direction,
          defPoints,
        ) as [number, number, number][];
      }
      if (Array.isArray(e.labelRotations)) {
        labelRotations = e.labelRotations.filter(
          (a): a is number => typeof a === 'number' && Number.isFinite(a),
        );
      }
    }

    const dim: DimensionEntity = {
      id,
      kind: 'dimension',
      layer: typeof e.layer === 'string' ? e.layer : '0',
      style,
      lineAnchor,
      direction,
      defPoints,
      labelId,
      mode: mode ?? (defPoints.length === 2 ? 'single' : 'chain'),
      labelPositions,
      labelRotations,
    };
    return dim;
  }
  if (e.kind === 'wall') {
    const lines = Array.isArray(e.lines)
      ? e.lines.map((ln) => {
          const priority =
            typeof ln.priority === 'number' && Number.isFinite(ln.priority)
              ? Math.max(1, Math.min(99, Math.round(ln.priority)))
              : 3;
          const line: import('./types').WallLineDef = {
            offset: typeof ln.offset === 'number' ? ln.offset : 0,
            color: typeof ln.color === 'string' ? ln.color : '#000000',
            lineWidth: typeof ln.lineWidth === 'number' ? ln.lineWidth : 1,
            lineStyle: ln.lineStyle ?? 'plein',
            priority,
          };
          if (typeof ln.layerTypeId === 'string' && ln.layerTypeId.trim()) {
            line.layerTypeId = ln.layerTypeId.trim();
          }
          return line;
        })
      : [];
    const path =
      e.path === 'arc' ? 'arc' : e.path === 'poly' ? 'poly' : 'line';
    const segs = Array.isArray(e.segments)
      ? e.segments.map((s) => {
          const r = (s ?? {}) as unknown as Record<string, unknown>;
          if (r.type === 'arc') {
            return {
              type: 'arc' as const,
              center: Array.isArray(r.center)
                ? (r.center as [number, number, number])
                : ([0, 0, 0] as [number, number, number]),
              radius: typeof r.radius === 'number' ? Math.abs(r.radius) : 0,
              startAngle: typeof r.startAngle === 'number' ? r.startAngle : 0,
              endAngle: typeof r.endAngle === 'number' ? r.endAngle : 0,
              normal: Array.isArray(r.normal)
                ? (r.normal as [number, number, number])
                : ([0, 0, 1] as [number, number, number]),
            };
          }
          return {
            type: 'line' as const,
            start: Array.isArray(r.start)
              ? (r.start as [number, number, number])
              : ([0, 0, 0] as [number, number, number]),
            end: Array.isArray(r.end)
              ? (r.end as [number, number, number])
              : ([0, 0, 0] as [number, number, number]),
          };
        })
      : undefined;
    return {
      ...e,
      id,
      styleId: typeof e.styleId === 'string' ? e.styleId : '',
      path,
      flip: Boolean(e.flip),
      lines,
      start: Array.isArray(e.start) ? e.start : ([0, 0, 0] as [number, number, number]),
      end: Array.isArray(e.end) ? e.end : ([0, 0, 0] as [number, number, number]),
      strokeGeom: Array.isArray(e.strokeGeom) ? e.strokeGeom : undefined,
      segments: path === 'poly' ? segs ?? [] : segs,
      closed: Boolean(e.closed),
      joinStrategy: isJonctionStrategy(e.joinStrategy)
        ? e.joinStrategy
        : undefined,
    };
  }
  if (e.kind === 'object') {
    return {
      ...e,
      id,
      libTab: typeof e.libTab === 'string' ? e.libTab : 'sanitaire',
      libName: typeof e.libName === 'string' ? e.libName : 'objet',
      origin: Array.isArray(e.origin) ? e.origin : ([0, 0, 0] as [number, number, number]),
      rotation: typeof e.rotation === 'number' ? e.rotation : 0,
      layer: typeof e.layer === 'string' ? e.layer : 'OBJETS',
    };
  }
  if (e.kind === 'point') {
    return {
      ...e,
      id,
      kind: 'point' as const,
      layer: typeof e.layer === 'string' ? e.layer : 'DESSIN',
      position: Array.isArray(e.position)
        ? e.position
        : ([0, 0, 0] as [number, number, number]),
      color: typeof e.color === 'string' ? e.color : '#000000',
      lineWidth:
        typeof e.lineWidth === 'number'
          ? Math.max(1, Math.min(7, Math.round(e.lineWidth)))
          : 1,
    };
  }
  if (e.kind === 'polyline') {
    const rawSegs = Array.isArray(e.segments) ? e.segments : [];
    const segs = rawSegs.map((s) => {
      const r = (s ?? {}) as unknown as Record<string, unknown>;
      if (r.type === 'arc') {
        return {
          type: 'arc' as const,
          center: Array.isArray(r.center)
            ? (r.center as [number, number, number])
            : ([0, 0, 0] as [number, number, number]),
          radius: typeof r.radius === 'number' ? Math.abs(r.radius) : 0,
          startAngle: typeof r.startAngle === 'number' ? r.startAngle : 0,
          endAngle: typeof r.endAngle === 'number' ? r.endAngle : 0,
          normal: Array.isArray(r.normal)
            ? (r.normal as [number, number, number])
            : ([0, 0, 1] as [number, number, number]),
          color: typeof r.color === 'string' ? r.color : '#000000',
          lineWidth: typeof r.lineWidth === 'number' ? r.lineWidth : 1,
          lineStyle: (typeof r.lineStyle === 'string'
            ? r.lineStyle
            : 'plein') as import('./types').LineStyleId,
        };
      }
      return {
        type: 'line' as const,
        start: Array.isArray(r.start)
          ? (r.start as [number, number, number])
          : ([0, 0, 0] as [number, number, number]),
        end: Array.isArray(r.end)
          ? (r.end as [number, number, number])
          : ([0, 0, 0] as [number, number, number]),
        color: typeof r.color === 'string' ? r.color : '#000000',
        lineWidth: typeof r.lineWidth === 'number' ? r.lineWidth : 1,
        lineStyle: (typeof r.lineStyle === 'string'
          ? r.lineStyle
          : 'plein') as import('./types').LineStyleId,
      };
    });
    return {
      ...e,
      id,
      kind: 'polyline' as const,
      layer: typeof e.layer === 'string' ? e.layer : 'DESSIN',
      segments: segs,
      closed: Boolean(e.closed),
    };
  }
  // helper (et fallback)
  return { ...e, id } as GkdDocument['entities'][number];
}

export function downloadGkd(doc: GkdDocument, filename: string): void {
  const blob = new Blob([serializeGkd(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.gkd') ? filename : `${filename}.gkd`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function openGkdFile(): Promise<{ doc: GkdDocument; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gkd,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const doc = parseGkd(text);
        resolve({ doc, name: file.name });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(msg);
      }
    });
    input.click();
  });
}
