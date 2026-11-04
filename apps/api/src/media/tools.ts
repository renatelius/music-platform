import { spawn } from 'node:child_process';

/** Paths of the FFmpeg binaries (FFMPEG_PATH / FFPROBE_PATH, or looked up on PATH). */
export interface MediaTools {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
}

/**
 * Stable failure codes. The worker stores the code as the track's failure reason,
 * so the import report can group failures without parsing messages.
 */
export type MediaErrorCode =
  | 'tool_missing'
  | 'tool_failed'
  | 'timeout'
  | 'unreadable'
  | 'no_audio_stream'
  | 'unsupported_codec';

export class MediaError extends Error {
  override name = 'MediaError';

  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Output above this size is dropped (a runaway log must not exhaust memory). */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function toolName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Runs a binary without a shell, so file names are never interpreted as commands,
 * and collects its output. Rejects only when the tool cannot run or times out;
 * a non-zero exit code is returned to the caller.
 */
export function runTool(
  path: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => {
        reject(
          new MediaError('timeout', `${toolName(path)} did not finish in ${String(timeoutMs)} ms`),
        );
      });
    }, timeoutMs);

    const collect =
      (target: Buffer[]) =>
      (chunk: Buffer): void => {
        size += chunk.length;
        if (size <= MAX_OUTPUT_BYTES) target.push(chunk);
      };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        reject(
          error.code === 'ENOENT'
            ? new MediaError(
                'tool_missing',
                `${toolName(path)} not found. Install FFmpeg or set FFMPEG_PATH / FFPROBE_PATH.`,
              )
            : new MediaError('tool_failed', `${toolName(path)} could not start: ${error.message}`),
        );
      });
    });

    child.on('close', (code) => {
      finish(() => {
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
    });
  });
}

/** Encoders the rendition ladder needs (ARCHITECTURE.md §6.1). */
export const REQUIRED_ENCODERS = ['aac', 'libopus', 'flac'] as const;

export interface MediaToolsStatus {
  /** First line of `ffmpeg -version`, e.g. "ffmpeg version 9.0.2-full_build…". */
  readonly version: string;
  readonly missingEncoders: readonly string[];
}

/** Verifies that ffmpeg and ffprobe run and that every required encoder is available. */
export async function checkMediaTools(tools: MediaTools): Promise<MediaToolsStatus> {
  const probe = await runTool(tools.ffprobePath, ['-hide_banner', '-version'], 10_000);
  if (probe.exitCode !== 0) throw new MediaError('tool_failed', 'ffprobe -version failed');

  const version = await runTool(tools.ffmpegPath, ['-hide_banner', '-version'], 10_000);
  if (version.exitCode !== 0) throw new MediaError('tool_failed', 'ffmpeg -version failed');

  const encoders = await runTool(tools.ffmpegPath, ['-hide_banner', '-encoders'], 10_000);
  if (encoders.exitCode !== 0) throw new MediaError('tool_failed', 'ffmpeg -encoders failed');

  // Lines look like " A....D aac                  AAC (Advanced Audio Coding)".
  const available = new Set(
    encoders.stdout
      .split(/\r?\n/)
      .map((line) => /^\s*A\S*\s+(\S+)/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  return {
    version: version.stdout.split(/\r?\n/)[0]?.trim() ?? '',
    missingEncoders: REQUIRED_ENCODERS.filter((name) => !available.has(name)),
  };
}
