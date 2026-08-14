/**
 * API filesystem locale (serveur Vite) pour GrokCAD.
 *
 * Routes :
 *   GET  /api/fs/roots                          → { roots: { path, label }[] }
 *   GET  /api/fs/list?path=...&ext=.dxf,.gkd    → { path, parent, dirs, files }
 *   GET  /api/fs/find?path=...&ext=.dxf         → { path, files }  (récursif)
 *   GET  /api/fs/exists?path=...                → { path, exists, isFile?, isDirectory? }
 *   GET  /api/fs/read?path=...                  → { path, content }  (texte)
 *   POST /api/fs/write  JSON { path, content }  → { ok, path }
 *   POST /api/fs/mkdir  JSON { path }           → { ok, path }
 *
 * Usage local uniquement (outil CAO sur la machine de l’utilisateur).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: Connect.ServerResponse, code: number, data: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function resolveSafe(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  // Refuse les null bytes
  if (raw.includes('\0')) return null;
  const resolved = path.resolve(raw);
  return resolved;
}

function listRoots(): { path: string; label: string }[] {
  const roots: { path: string; label: string }[] = [];
  const home = os.homedir();
  roots.push({ path: home, label: `Domicile (${home})` });
  roots.push({ path: '/', label: 'Système (/)' });

  const candidates = [
    '/mnt',
    '/media',
    '/run/media',
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        if (!roots.some((r) => r.path === c)) {
          roots.push({ path: c, label: c });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Sous-dossiers de /mnt (ex. Raid4Tb)
  try {
    if (fs.existsSync('/mnt')) {
      for (const e of fs.readdirSync('/mnt', { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const p = path.join('/mnt', e.name);
        if (!roots.some((r) => r.path === p)) {
          roots.push({ path: p, label: p });
        }
      }
    }
  } catch {
    /* ignore */
  }

  return roots;
}

function parseExtFilter(raw: string | null): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('.') ? s : `.${s}`));
  return list.length ? list : null;
}

const FIND_MAX_FILES = 50_000;
const FIND_MAX_DEPTH = 64;

/** Parcours récursif : tous les fichiers correspondant au filtre d’extension. */
function findFilesRecursive(
  rootDir: string,
  extFilter: string[] | null,
): { name: string; path: string; size: number }[] {
  const out: { name: string; path: string; size: number }[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: rootDir, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > FIND_MAX_DEPTH) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      try {
        let isDir = e.isDirectory();
        let isFile = e.isFile();
        let size = 0;

        if (e.isSymbolicLink()) {
          try {
            const st = fs.statSync(full);
            isDir = st.isDirectory();
            isFile = st.isFile();
            size = st.size;
          } catch {
            continue;
          }
        } else if (isFile) {
          try {
            size = fs.statSync(full).size;
          } catch {
            /* ignore size */
          }
        }

        if (isDir) {
          stack.push({ dir: full, depth: depth + 1 });
        } else if (isFile) {
          const lower = e.name.toLowerCase();
          if (
            extFilter &&
            !extFilter.some((ext) => lower.endsWith(ext))
          ) {
            continue;
          }
          out.push({ name: e.name, path: full, size });
          if (out.length >= FIND_MAX_FILES) return out;
        }
      } catch {
        /* permission / lien cassé */
      }
    }
  }

  out.sort((a, b) => a.path.localeCompare(b.path, 'fr'));
  return out;
}

export function fsApiPlugin(): Plugin {
  return {
    name: 'grokcad-fs-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '';
        if (!rawUrl.startsWith('/api/fs')) {
          next();
          return;
        }

        try {
          const u = new URL(rawUrl, 'http://localhost');
          const route = u.pathname.replace(/\/$/, '') || '/api/fs';

          // GET /api/fs/roots
          if (route === '/api/fs/roots' && req.method === 'GET') {
            json(res, 200, { roots: listRoots() });
            return;
          }

          // GET /api/fs/list?path=&ext=
          if (route === '/api/fs/list' && req.method === 'GET') {
            const rawPath = u.searchParams.get('path') || os.homedir();
            const dir = resolveSafe(rawPath);
            if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
              json(res, 400, { error: `Répertoire introuvable : ${rawPath}` });
              return;
            }
            const extFilter = parseExtFilter(u.searchParams.get('ext'));
            const parent = path.dirname(dir);
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const dirs: { name: string; path: string }[] = [];
            const files: { name: string; path: string; size: number }[] = [];

            for (const e of entries) {
              if (e.name.startsWith('.')) continue;
              const full = path.join(dir, e.name);
              try {
                if (e.isDirectory()) {
                  dirs.push({ name: e.name, path: full });
                } else if (e.isFile()) {
                  const lower = e.name.toLowerCase();
                  if (
                    extFilter &&
                    !extFilter.some((ext) => lower.endsWith(ext))
                  ) {
                    continue;
                  }
                  let size = 0;
                  try {
                    size = fs.statSync(full).size;
                  } catch {
                    /* ignore */
                  }
                  files.push({ name: e.name, path: full, size });
                } else if (e.isSymbolicLink()) {
                  // Suivre les liens si dossier
                  try {
                    const st = fs.statSync(full);
                    if (st.isDirectory()) {
                      dirs.push({ name: e.name, path: full });
                    } else if (st.isFile()) {
                      const lower = e.name.toLowerCase();
                      if (
                        !extFilter ||
                        extFilter.some((ext) => lower.endsWith(ext))
                      ) {
                        files.push({ name: e.name, path: full, size: st.size });
                      }
                    }
                  } catch {
                    /* lien cassé */
                  }
                }
              } catch {
                /* permission */
              }
            }

            dirs.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
            files.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

            json(res, 200, {
              path: dir,
              parent: parent !== dir ? parent : null,
              dirs,
              files,
            });
            return;
          }

          // GET /api/fs/find?path=&ext=  (récursif, tous sous-dossiers)
          if (route === '/api/fs/find' && req.method === 'GET') {
            const rawPath = u.searchParams.get('path') || os.homedir();
            const dir = resolveSafe(rawPath);
            if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
              json(res, 400, { error: `Répertoire introuvable : ${rawPath}` });
              return;
            }
            const extFilter = parseExtFilter(u.searchParams.get('ext'));
            const files = findFilesRecursive(dir, extFilter);
            json(res, 200, {
              path: dir,
              files,
              truncated: files.length >= FIND_MAX_FILES,
            });
            return;
          }

          // GET /api/fs/exists?path=
          if (route === '/api/fs/exists' && req.method === 'GET') {
            const rawPath = u.searchParams.get('path');
            const filePath = rawPath ? resolveSafe(rawPath) : null;
            if (!filePath) {
              json(res, 400, { error: 'path requis' });
              return;
            }
            try {
              if (!fs.existsSync(filePath)) {
                json(res, 200, { path: filePath, exists: false });
                return;
              }
              const st = fs.statSync(filePath);
              json(res, 200, {
                path: filePath,
                exists: true,
                isFile: st.isFile(),
                isDirectory: st.isDirectory(),
              });
            } catch {
              json(res, 200, { path: filePath, exists: false });
            }
            return;
          }

          // GET /api/fs/read?path=
          if (route === '/api/fs/read' && req.method === 'GET') {
            const rawPath = u.searchParams.get('path');
            const filePath = rawPath ? resolveSafe(rawPath) : null;
            if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
              json(res, 404, { error: 'Fichier introuvable' });
              return;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            json(res, 200, {
              path: filePath,
              name: path.basename(filePath),
              content,
            });
            return;
          }

          // POST /api/fs/write { path, content }
          if (route === '/api/fs/write' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as {
              path?: string;
              content?: string;
            };
            const filePath = body.path ? resolveSafe(body.path) : null;
            if (!filePath || typeof body.content !== 'string') {
              json(res, 400, { error: 'path et content requis' });
              return;
            }
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, body.content, 'utf8');
            json(res, 200, { ok: true, path: filePath });
            return;
          }

          // POST /api/fs/mkdir { path }
          if (route === '/api/fs/mkdir' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as { path?: string };
            const dirPath = body.path ? resolveSafe(body.path) : null;
            if (!dirPath) {
              json(res, 400, { error: 'path requis' });
              return;
            }
            fs.mkdirSync(dirPath, { recursive: true });
            json(res, 200, { ok: true, path: dirPath });
            return;
          }

          json(res, 404, { error: 'Route /api/fs inconnue' });
        } catch (e) {
          json(res, 500, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    },
  };
}
