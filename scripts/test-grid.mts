/**
 * Tests grille : prefs /grid /gridsnap + nœud le plus proche.
 */
import {
  AppPrefsManager,
  GRID_SNAP_HIDDEN_ERROR,
  defaultAppPrefs,
} from '../src/core/appPrefs.ts';
import { nearestGridPoint } from '../src/core/units.ts';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error('FAIL', msg);
  }
}

const d = defaultAppPrefs();
assert(d.gridVisible === true, 'défaut grille visible');
assert(d.gridSnap === false, 'défaut gridsnap off');
assert(d.gridOffDisablesSnap === true, 'défaut auto-off snap');

const app = new AppPrefsManager();
assert(app.gridVisible === true, 'manager grille visible');
assert(app.gridSnapEffective === false, 'snap effectif off au départ');

const denied = app.setGridSnap(true);
assert(denied.ok === true, 'gridsnap on ok si grille visible');
assert(app.gridSnapEffective === true, 'snap effectif après on');

app.setGridVisible(false);
assert(app.gridVisible === false, 'grid off');
assert(app.gridSnap === false, 'grid off + case cochée → snap écrit off');
assert(app.gridSnapEffective === false, 'snap effectif off si grille cachée');

const force = app.setGridSnap(true);
assert(force.ok === false, 'gridsnap on refusé si grille cachée');
if (!force.ok) {
  assert(force.error === GRID_SNAP_HIDDEN_ERROR, `message = ${force.error}`);
}

app.setGridVisible(true);
const ok2 = app.setGridSnap(true);
assert(ok2.ok === true, 'gridsnap on ok après grid on');

app.setGridOffDisablesSnap(false);
app.setGridVisible(false);
assert(app.gridSnap === true, 'case décochée : souhait snap conservé');
assert(app.gridSnapEffective === false, 'mais pas effectif tant que cachée');
const stillDenied = app.setGridSnap(true);
assert(stillDenied.ok === false, 'forcer on reste refusé si cachée');

app.setGridVisible(true);
assert(app.gridSnapEffective === true, 'grid on restaure le snap conservé');

const p = nearestGridPoint([1.4, 2.6, 0.5], 1, 'm');
assert(p[0] === 1 && p[1] === 3 && p[2] === 0.5, `nœud 1 m → ${p}`);

const p2 = nearestGridPoint([0.24, -0.26, 0], 0.5, 'm');
assert(p2[0] === 0 && p2[1] === -0.5 && p2[2] === 0, `nœud 0.5 m → ${p2}`);

if (failed > 0) {
  console.error(`${failed} échec(s)`);
  process.exit(1);
}
console.log('test-grid ok');
