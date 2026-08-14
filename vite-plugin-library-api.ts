/**
 * API dev : lecture / écriture du dossier library/ sur le disque.
 * Routes :
 *   GET  /api/library              → { tabs: string[] }
 *   GET  /api/library/:tab         → { files: { name, path }[] }
 *   GET  /api/library/:tab/:file   → contenu .gkd (text)
 *   PUT  /api/library/:tab/:file   → body = JSON .gkd
 *   DELETE /api/library/:tab/:file
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

const DEFAULT_TABS = ['sanitaire', 'electrique', 'salon', 'chambre', 'hatch', 'walls'];

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

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function libraryApiPlugin(libraryRoot: string): Plugin {
  return {
    name: 'grokcad-library-api',
    configureServer(server) {
      // Créer les onglets par défaut s'ils manquent
      ensureDir(libraryRoot);
      for (const t of DEFAULT_TABS) ensureDir(path.join(libraryRoot, t));

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

          const tab = safeName(parts[0] ?? '');
          if (!tab) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Onglet invalide' }));
            return;
          }
          const tabDir = path.join(libraryRoot, tab);

          // GET /api/library/:tab
          if (parts.length === 1 && req.method === 'GET') {
            ensureDir(tabDir);
            const files = fs
              .readdirSync(tabDir, { withFileTypes: true })
              .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gkd'))
              .map((e) => ({
                name: e.name.replace(/\.gkd$/i, ''),
                file: e.name,
              }))
              .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ tab, files }));
            return;
          }

          const fileBase = safeName(parts[1] ?? '');
          if (!fileBase) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Nom de fichier invalide' }));
            return;
          }
          const lower = fileBase.toLowerCase();
          const hasExtraExt = EXTRA_EXTS.some((ext) => lower.endsWith(ext));
          const fileName =
            lower.endsWith('.gkd') || hasExtraExt ? fileBase : `${fileBase}.gkd`;
          const filePath = path.join(tabDir, fileName);

          // GET file
          if (parts.length === 2 && req.method === 'GET') {
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Fichier introuvable' }));
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath, 'utf8'));
            return;
          }

          // PUT file
          if (parts.length === 2 && req.method === 'PUT') {
            ensureDir(tabDir);
            const body = await readBody(req);
            // Valider JSON minimal
            JSON.parse(body);
            fs.writeFileSync(filePath, body, 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `library/${tab}/${fileName}` }));
            return;
          }

          // DELETE file
          if (parts.length === 2 && req.method === 'DELETE') {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          // POST /api/library/:tab  body { name } → create empty tab already exists; create tab
          if (parts.length === 1 && req.method === 'POST') {
            ensureDir(tabDir);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, tab }));
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
