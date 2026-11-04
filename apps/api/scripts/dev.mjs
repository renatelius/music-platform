// Dev mode: recompile on change (tsc keeps decorator metadata) and restart the server.
//
// The server is restarted only after tsc reports a successful compilation. We do not use
// `node --watch-path=dist`: on Windows it also reacted to files outside dist (the Next.js
// dev log, turbo.exe in node_modules), so every page load in the web app restarted the API.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const SERVER_ARGS = ['--env-file-if-exists=../../.env', 'dist/main.js'];
// tsc prints this after every compilation in watch mode, e.g. "Found 0 errors. Watching for file changes."
const COMPILED = /Found (\d+) errors?\b/;

let server = null;
let stopping = false;
let restartQueued = false;
let initialBuildSeen = false;

function startServer() {
  server = spawn(process.execPath, SERVER_ARGS, { stdio: 'inherit' });
  server.on('exit', (code, signal) => {
    server = null;
    if (stopping) return;
    if (restartQueued) {
      restartQueued = false;
      startServer();
      return;
    }
    if (signal === null && code !== 0) {
      console.error(
        `[dev] API exited with code ${String(code)}; waiting for the next successful build.`,
      );
    }
  });
}

function restartServer() {
  if (server === null) {
    startServer();
    return;
  }
  console.log('[dev] Build succeeded, restarting API...');
  restartQueued = true;
  server.kill();
}

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
    if (match[1] === '0') restartServer();
  }
});

const stop = () => {
  stopping = true;
  tsc.kill();
  server?.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tsc.on('exit', (code) => {
  if (!stopping && code !== null && code !== 0) {
    process.exitCode = code;
    stop();
  }
});

startServer();
