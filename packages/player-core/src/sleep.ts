import type { PlayerState } from './player.js';

/** Sleep timer modes (ТЗ v3 §6.2): after some minutes, or when the current track ends. */
export type SleepMode =
  { readonly kind: 'minutes'; readonly minutes: number } | { readonly kind: 'endOfTrack' };

export const SLEEP_MINUTES = [15, 30, 45, 60, 90] as const;
/** The volume fades out over the last ten seconds before the pause. */
export const SLEEP_FADE_MS = 10_000;
/** End of track: pause this close to the end, before the engine starts the next track. */
const END_OF_TRACK_MARGIN_MS = 350;
/** A track change this close to the end (plus any crossfade) was automatic, not a skip. */
const AUTO_ADVANCE_WINDOW_MS = 2500;

export interface SleepTimerState {
  readonly mode: SleepMode | null;
  /** Minutes mode: when playback stops (epoch ms). */
  readonly endsAt: number | null;
}

/** What the timer needs from the player (a fake in tests). */
export interface SleepTarget {
  getState(): Pick<PlayerState, 'status' | 'current'>;
  positionMs(): number;
  durationMs(): number;
  /** Crossfade length if the next track will crossfade in, else 0 (Player.transitionLeadMs). */
  transitionLeadMs(): number;
  pause(): void;
  seek(positionMs: number): void;
}

export interface SleepTimerOptions {
  readonly player: SleepTarget;
  /** 1 = full volume, 0 = silent; applied on top of the user's volume (engine `setFade`). */
  readonly fade: (gain: number) => void;
  readonly now?: () => number;
}

/**
 * Platform-free sleep timer. The host calls `tick()` a few times a second (and on wake-up); the
 * timer fades the sound out, then pauses. Pausing never changes the user's volume setting.
 */
export class SleepTimer {
  private mode: SleepMode | null = null;
  private endsAt: number | null = null;
  /** End of track: the queue entry the timer waits for, and its last known remaining time. */
  private entryUid: string | null = null;
  private lastRemainingMs = Number.POSITIVE_INFINITY;
  /** Crossfade lead seen at the last tick: the next track starts that much before the end. */
  private lastLeadMs = 0;
  private faded = false;
  /**
   * Same object until something changes: React's useSyncExternalStore requires a stable
   * snapshot (a fresh object per read loops forever — found in the browser check, 05.11).
   */
  private state: SleepTimerState = { mode: null, endsAt: null };
  private readonly listeners = new Set<(state: SleepTimerState) => void>();
  private readonly player: SleepTarget;
  private readonly fade: (gain: number) => void;
  private readonly now: () => number;

  constructor(options: SleepTimerOptions) {
    this.player = options.player;
    this.fade = options.fade;
    this.now = options.now ?? Date.now;
  }

  getState(): SleepTimerState {
    return this.state;
  }

  subscribe(listener: (state: SleepTimerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(mode: SleepMode): void {
    if (mode.kind === 'minutes' && !(mode.minutes > 0 && mode.minutes <= 24 * 60)) return;
    this.mode = mode;
    this.endsAt = mode.kind === 'minutes' ? this.now() + mode.minutes * 60_000 : null;
    this.entryUid = this.player.getState().current?.uid ?? null;
    this.lastRemainingMs = Number.POSITIVE_INFINITY;
    this.lastLeadMs = 0;
    this.setFade(1);
    this.emit();
  }

  cancel(): void {
    if (this.mode === null) return;
    this.reset();
    this.emit();
  }

  /**
   * Time left in ms, or null when off. End of track: until the next track would take over —
   * with a crossfade that is `crossfade` ms before the end, so the next track never starts.
   */
  remainingMs(): number | null {
    if (this.mode === null) return null;
    if (this.mode.kind === 'minutes') return Math.max(0, (this.endsAt ?? 0) - this.now());
    const lead = this.player.transitionLeadMs();
    return Math.max(0, this.player.durationMs() - this.player.positionMs() - lead);
  }

  tick(): void {
    const mode = this.mode;
    if (mode === null) return;
    const state = this.player.getState();
    const playing = state.status === 'playing';

    if (mode.kind === 'endOfTrack') {
      const uid = state.current?.uid ?? null;
      if (uid !== this.entryUid) {
        if (this.lastRemainingMs <= AUTO_ADVANCE_WINDOW_MS + this.lastLeadMs) {
          // The track ended between two ticks (background tabs tick slowly): stop at the start
          // of the next one instead of letting it play.
          this.player.pause();
          this.player.seek(0);
          this.finish();
          return;
        }
        // The user skipped: the timer now waits for the end of the new track.
        this.entryUid = uid;
        this.lastRemainingMs = Number.POSITIVE_INFINITY;
      }
      this.lastLeadMs = this.player.transitionLeadMs();
    }

    const remaining = this.remainingMs() ?? 0;
    if (mode.kind === 'endOfTrack' && playing) this.lastRemainingMs = remaining;
    const margin = mode.kind === 'endOfTrack' ? END_OF_TRACK_MARGIN_MS : 0;
    if (remaining <= margin && (playing || mode.kind === 'minutes')) {
      if (playing) this.player.pause();
      this.finish();
      return;
    }
    const counting = mode.kind === 'minutes' || playing;
    this.setFade(counting && remaining < SLEEP_FADE_MS ? fadeGain(remaining) : 1);
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  private finish(): void {
    this.reset();
    this.emit();
  }

  private reset(): void {
    this.mode = null;
    this.endsAt = null;
    this.entryUid = null;
    this.lastRemainingMs = Number.POSITIVE_INFINITY;
    this.lastLeadMs = 0;
    this.setFade(1);
  }

  private setFade(gain: number): void {
    if (gain === 1 && !this.faded) return;
    this.faded = gain !== 1;
    this.fade(gain);
  }

  private emit(): void {
    const state: SleepTimerState = { mode: this.mode, endsAt: this.endsAt };
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

/** Linear fade over the last SLEEP_FADE_MS; the engine applies its own volume curve on top. */
export function fadeGain(remainingMs: number): number {
  return Math.min(Math.max(remainingMs / SLEEP_FADE_MS, 0), 1);
}
