/**
 * API dev : lecture / écriture du dossier library/ sur le disque.
 * Routes :
 *   GET  /api/library                         → { tabs: string[] }
 *   GET  /api/library/:tab                    → { files, subtabs? }
 *   GET  /api/library/:tab/:sub/:file         → contenu .gkd (chemins imbriqués)
 *   PUT / DELETE idem
 *
 * Les onglets peuvent être imbriqués (ex. insertions/doors).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

const DEFAULT_TABS = [
  'sanitaire',
  'electrique',
  'salon',
  'chambre',
  'hatch',
  'walls',
  'insertions',
];

const INSERTION_SUBS = ['doors', 'windows', 'others'];

/** Extensions de fichiers library servis en plus de .gkd (ex. catalogue couches). */
const EXTRA_EXTS = ['.json'];

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeName(name: string): string | null {
  const n = name.replace(/[/\\?%*:|"<>]/g, '').trim();
  if (!n || n === '.' || n === '..') return null;
  return n;
}

function safeSegs(parts: string[]): string[] | null {
  const segs: string[] = [];
  for (const p of parts) {
    const s = safeName(p);
    if (!s) return null;
    segs.push(s);
  }
  return segs;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isExtraFile(name: string): boolean {
  const lower = name.toLowerCase();
  return EXTRA_EXTS.some((ext) => lower.endsWith(ext));
}

export function libraryApiPlugin(libraryRoot: string): Plugin {
  return {
    name: 'grokcad-library-api',
    configureServer(server) {
      ensureDir(libraryRoot);
      for (const t of DEFAULT_TABS) ensureDir(path.join(libraryRoot, t));
      for (const sub of INSERTION_SUBS) {
        ensureDir(path.join(libraryRoot, 'insertions', sub));
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/library')) {
          next();
          return;
        }

        try {
          const rawPath = url.split('?')[0] ?? '';
          const parts = rawPath
            .replace(/^\/api\/library\/?/, '')
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent);

          // GET /api/library
          if (parts.length === 0 && req.method === 'GET') {
            const entries = fs.readdirSync(libraryRoot, { withFileTypes: true });
            const tabs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
              .map((e) => e.name)
              .sort((a, b) => a.localeCompare(b, 'fr'));
            for (const t of DEFAULT_TABS) {
              if (!tabs.includes(t)) {
                ensureDir(path.join(libraryRoot, t));
                tabs.push(t);
              }
            }
            tabs.sort((a, b) => a.localeCompare(b, 'fr'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ tabs }));
            return;
          }

          const segs = safeSegs(parts);
          if (!segs || segs.length === 0) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Chemin invalide' }));
            return;
          }

          const absDirAll = path.join(libraryRoot, ...segs);
          const last = segs[segs.length - 1]!;
          const parentSegs = segs.slice(0, -1);
          const parentDir = path.join(libraryRoot, ...parentSegs);

          const asDir =
            fs.existsSync(absDirAll) && fs.statSync(absDirAll).isDirectory();

          // GET / POST répertoire
          if (asDir && (req.method === 'GET' || req.method === 'POST')) {
            ensureDir(absDirAll);
            if (req.method === 'POST') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, tab: segs.join('/') }));
              return;
            }
            const entries = fs.readdirSync(absDirAll, { withFileTypes: true });
            const files = entries
              .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gkd'))
              .map((e) => ({
                name: e.name.replace(/\.gkd$/i, ''),
                file: e.name,
              }))
              .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
            const subtabs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
              .map((e) => e.name)
              .sort((a, b) => a.localeCompare(b, 'fr'));
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                tab: segs.join('/'),
                files,
                subtabs,
              }),
            );
            return;
          }

          // POST crée le dossier (même s’il n’existe pas encore)
          if (req.method === 'POST') {
            ensureDir(absDirAll);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, tab: segs.join('/') }));
            return;
          }

          // Fichier : dernier segment = nom
          const hasExtraExt = isExtraFile(last);
          const fileName =
            last.toLowerCase().endsWith('.gkd') || hasExtraExt
              ? last
              : `${last}.gkd`;
          const filePath = path.join(parentDir, fileName);

          if (req.method === 'GET') {
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Fichier introuvable' }));
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath, 'utf8'));
            return;
          }

          if (req.method === 'PUT') {
            ensureDir(parentDir);
            const body = await readBody(req);
            JSON.parse(body);
            fs.writeFileSync(filePath, body, 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                path: `library/${[...parentSegs, fileName].join('/')}`,
              }),
            );
            return;
          }

          if (req.method === 'DELETE') {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Route inconnue' }));
        } catch (e) {
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      });
    },
  };
}
