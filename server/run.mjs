// Creates server/.venv on first run (and whenever requirements.txt changes), then
// starts uvicorn on 127.0.0.1:8000, or runs pytest when called with "test".
//   node server/run.mjs              -> API on port 8000
//   node server/run.mjs --port 8001  -> API on another port
//   node server/run.mjs test         -> pytest
// Set STITCHPRO_PYTHON to choose the Python used to create the venv.

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const venvDir = join(serverDir, '.venv');
const isWin = process.platform === 'win32';
const venvPython = join(venvDir, isWin ? 'Scripts/python.exe' : 'bin/python');
const requirements = join(serverDir, 'requirements.txt');
const stampFile = join(venvDir, '.requirements.sha1');

function findPython() {
  const candidates = [];
  if (process.env.STITCHPRO_PYTHON) candidates.push([process.env.STITCHPRO_PYTHON]);
  if (isWin) candidates.push(['py', '-3']);
  candidates.push(['python'], ['python3']);
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8' });
    if (r.status === 0) return [cmd, ...args];
  }
  return null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: serverDir });
  if (r.status !== 0) {
    console.error(`[server] command failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

function ensureVenv() {
  if (!existsSync(venvPython)) {
    const python = findPython();
    if (!python) {
      console.error('[server] Python 3 was not found. Install it from https://www.python.org/ or set STITCHPRO_PYTHON.');
      process.exit(2);
    }
    console.log('[server] creating server/.venv ...');
    run(python[0], [...python.slice(1), '-m', 'venv', venvDir]);
  }
  const hash = createHash('sha1').update(readFileSync(requirements)).digest('hex');
  const stamp = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : '';
  if (stamp !== hash) {
    console.log('[server] installing Python requirements ...');
    run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', requirements]);
    writeFileSync(stampFile, hash);
  }
}

const argv = process.argv.slice(2);
ensureVenv();

let child;
if (argv[0] === 'test') {
  child = spawn(venvPython, ['-m', 'pytest', ...argv.slice(1)], { stdio: 'inherit', cwd: serverDir });
} else {
  const i = argv.indexOf('--port');
  const port = i >= 0 ? argv[i + 1] : (process.env.STITCHPRO_API_PORT ?? '8000');
  child = spawn(
    venvPython,
    ['-m', 'uvicorn', 'stitchpro_server.main:app', '--host', '127.0.0.1', '--port', String(port)],
    { stdio: 'inherit', cwd: serverDir },
  );
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
child.on('exit', (code) => process.exit(code ?? 0));
