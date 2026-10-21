// Starts the API server (port 8000) and Vite (port 5173) together.
// If Python is missing or the server fails, the web app keeps running without it.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'web', 'package.json'));
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const children = [];
let shuttingDown = false;

function start(name, args, cwd, { critical }) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    if (critical) {
      shutdown(code ?? 0);
    } else if (code) {
      console.warn(`\n[dev] ${name} stopped (exit ${code}). The web app still runs; downloads and machine-file import need the server.\n`);
    }
  });
  return child;
}

// On Windows, kill() only ends the direct child; taskkill /T also ends uvicorn under it.
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function shutdown(code) {
  shuttingDown = true;
  for (const c of children) killTree(c);
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('server', [join(root, 'server', 'run.mjs')], root, { critical: false });
start('vite', [viteBin], join(root, 'web'), { critical: true });
