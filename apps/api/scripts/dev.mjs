// Dev mode: recompile on change (tsc keeps decorator metadata) and restart the server.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

const children = [
  spawn(
    process.execPath,
    [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
    {
      stdio: 'inherit',
    },
  ),
  spawn(
    process.execPath,
    ['--watch-path=dist', '--env-file-if-exists=../../.env', 'dist/main.js'],
    {
      stdio: 'inherit',
    },
  ),
];

const stop = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.exitCode = code;
      stop();
    }
  });
}
