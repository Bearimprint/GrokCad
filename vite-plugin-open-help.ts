/**
 * API dev : ouvre HELP.md avec le visualiseur par défaut de l’OS.
 * Route : POST /api/help/open  → { ok: true } | { error }
 *
 * Linux  : xdg-open
 * macOS  : open
 * Windows: cmd /c start "" <path>
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

function openWithDefaultApp(filePath: string): void {
  const plat = platform();
  if (plat === 'win32') {
    // start requires an empty title arg when the path may contain spaces
    spawn('cmd', ['/c', 'start', '', filePath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }
  if (plat === 'darwin') {
    spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  // Linux Mint / desktop Linux
  spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
}

export function openHelpPlugin(helpFilePath: string): Plugin {
  const resolved = path.resolve(helpFilePath);

  return {
    name: 'grokcad-open-help',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url.split('?')[0] !== '/api/help/open') {
          next();
          return;
        }

        if (req.method !== 'POST' && req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Méthode non autorisée' }));
          return;
        }

        try {
          if (!fs.existsSync(resolved)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `HELP.md introuvable : ${resolved}`,
              }),
            );
            return;
          }

          openWithDefaultApp(resolved);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              path: resolved,
              platform: platform(),
            }),
          );
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
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
