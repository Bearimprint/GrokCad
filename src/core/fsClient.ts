/**
 * Client filesystem (API Vite /api/fs) pour les dialogues GrokCAD.
 */

export interface FsRoot {
  path: string;
  label: string;
}

export interface FsDirEntry {
  name: string;
  path: string;
}

export interface FsFileEntry {
  name: string;
  path: string;
  size: number;
}

export interface FsListResult {
  path: string;
  parent: string | null;
  dirs: FsDirEntry[];
  files: FsFileEntry[];
}

export async function fsRoots(): Promise<FsRoot[]> {
  const r = await fetch('/api/fs/roots');
  if (!r.ok) throw new Error(await errMsg(r));
  const data = (await r.json()) as { roots: FsRoot[] };
  return data.roots ?? [];
}

export async function fsList(
  dirPath: string,
  ext?: string | string[],
): Promise<FsListResult> {
  const params = new URLSearchParams({ path: dirPath });
  if (ext) {
    const e = Array.isArray(ext) ? ext.join(',') : ext;
    if (e) params.set('ext', e);
  }
  const r = await fetch(`/api/fs/list?${params}`);
  if (!r.ok) throw new Error(await errMsg(r));
  return (await r.json()) as FsListResult;
}

export interface FsFindResult {
  path: string;
  files: FsFileEntry[];
  truncated?: boolean;
}

/**
 * Recherche récursive de fichiers sous un répertoire (tous sous-dossiers).
 * Filtre d’extension optionnel (ex. '.dxf' ou ['.dxf', '.gkd']).
 */
export async function fsFind(
  dirPath: string,
  ext?: string | string[],
): Promise<FsFindResult> {
  const params = new URLSearchParams({ path: dirPath });
  if (ext) {
    const e = Array.isArray(ext) ? ext.join(',') : ext;
    if (e) params.set('ext', e);
  }
  const r = await fetch(`/api/fs/find?${params}`);
  if (!r.ok) throw new Error(await errMsg(r));
  return (await r.json()) as FsFindResult;
}

export async function fsExists(filePath: string): Promise<boolean> {
  const params = new URLSearchParams({ path: filePath });
  const r = await fetch(`/api/fs/exists?${params}`);
  if (!r.ok) throw new Error(await errMsg(r));
  const data = (await r.json()) as { exists?: boolean };
  return Boolean(data.exists);
}

export async function fsRead(
  filePath: string,
): Promise<{ path: string; name: string; content: string }> {
  const params = new URLSearchParams({ path: filePath });
  const r = await fetch(`/api/fs/read?${params}`);
  if (!r.ok) throw new Error(await errMsg(r));
  return (await r.json()) as { path: string; name: string; content: string };
}

export async function fsWrite(
  filePath: string,
  content: string,
): Promise<{ ok: boolean; path: string }> {
  const r = await fetch('/api/fs/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  const data = (await r.json()) as { ok?: boolean; path?: string; error?: string };
  if (!r.ok || !data.ok) {
    throw new Error(data.error ?? r.statusText);
  }
  return { ok: true, path: data.path ?? filePath };
}

export async function fsMkdir(dirPath: string): Promise<string> {
  const r = await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  const data = (await r.json()) as { ok?: boolean; path?: string; error?: string };
  if (!r.ok || !data.ok) {
    throw new Error(data.error ?? r.statusText);
  }
  return data.path ?? dirPath;
}

/** true si l’API /api/fs répond (mode serveur dev). */
export async function fsAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/fs/roots');
    return r.ok;
  } catch {
    return false;
  }
}

async function errMsg(r: Response): Promise<string> {
  try {
    const data = (await r.json()) as { error?: string };
    return data.error ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

/** Joint un répertoire et un nom de fichier (côté client, style POSIX). */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  if (dir.endsWith('/')) return dir + name;
  return `${dir}/${name}`;
}

export function basename(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function dirname(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  if (i <= 0) return s === '/' ? '/' : '.';
  return s.slice(0, i) || '/';
}
