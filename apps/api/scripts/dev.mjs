// Dev mode: recompile on change (tsc keeps decorator metadata) and restart the API and the
// worker (ADR-017: two processes from the same build).
//
// Processes are restarted only after tsc reports a successful compilation. We do not use
// `node --watch-path=dist`: on Windows it also reacted to files outside dist (the Next.js
// dev log, turbo.exe in node_modules), so every page load in the web app restarted the API.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const ENV_ARG = '--env-file-if-exists=../../.env';
// tsc prints this after every compilation in watch mode, e.g. "Found 0 errors. Watching for file changes."
const COMPILED = /Found (\d+) errors?\b/;

let stopping = false;
let initialBuildSeen = false;

/** A node process that is (re)started from dist/ after each successful build. */
function managed(name, entry) {
  const state = { child: null, restartQueued: false };

  const start = () => {
    state.child = spawn(process.execPath, [ENV_ARG, entry], { stdio: 'inherit' });
    state.child.on('exit', (code, signal) => {
      state.child = null;
      if (stopping) return;
      if (state.restartQueued) {
        state.restartQueued = false;
        start();
        return;
      }
      if (signal === null && code !== 0) {
        console.error(
          `[dev] ${name} exited with code ${String(code)}; waiting for the next successful build.`,
        );
      }
    });
  };

  return {
    start,
    restart() {
      if (state.child === null) {
        start();
        return;
      }
      state.restartQueued = true;
      state.child.kill();
    },
    stop() {
      state.child?.kill();
    },
  };
}

const processes = [managed('API', 'dist/main.js'), managed('worker', 'dist/worker/main.js')];

const tsc = spawn(
  process.execPath,
  [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);

let buffer = '';
tsc.stdout.setEncoding('utf8');
tsc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const match = COMPILED.exec(line);
    if (match === null) continue;
    // The first watch build only re-emits what `pnpm dev` already compiled before starting us.
    if (!initialBuildSeen) {
      initialBuildSeen = true;
      continue;
    }
    if (match[1] === '0') {
      console.log('[dev] Build succeeded, restarting API and worker...');
      for (const p of processes) p.restart();
    }
  }
});

const stop = () => {
  stopping = true;
  tsc.kill();
  for (const p of processes) p.stop();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tsc.on('exit', (code) => {
  if (!stopping && code !== null && code !== 0) {
    process.exitCode = code;
    stop();
  }
});

for (const p of processes) p.start();
