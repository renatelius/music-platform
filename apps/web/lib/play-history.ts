import { countsAsPlay, type PlayEvent } from '@mp/contracts';

/** Shorter plays are not reported at all (a click through the queue). */
export const MIN_REPORT_MS = 1000;
/** Ending this close to the end counts as listened to the end. */
const COMPLETE_MARGIN_MS = 2000;

interface TrackedState {
  readonly status: string;
  readonly current: {
    readonly uid: string;
    readonly track: { readonly id: string; readonly durationMs: number };
  } | null;
}

interface Play {
  readonly uid: string;
  readonly trackId: string;
  readonly durationMs: number;
  startedAt: number | null;
  playedMs: number;
  /** When the current stretch of playing began; null while paused. */
  since: number | null;
}

/**
 * Turns player states into listening reports: one per queue entry played, with the time it
 * actually sounded (pauses do not count). `flush` ends the current one (page closed).
 */
export class PlayTracker {
  private play: Play | null = null;

  constructor(
    private readonly report: (event: PlayEvent) => void,
    private readonly now: () => number,
    private readonly newId: () => string,
  ) {}

  update(state: TrackedState): void {
    const time = this.now();
    this.accumulate(time);
    const uid = state.current?.uid ?? null;
    if (this.play !== null && this.play.uid !== uid) this.finish();
    if (this.play === null && state.current !== null) {
      this.play = {
        uid: state.current.uid,
        trackId: state.current.track.id,
        durationMs: state.current.track.durationMs,
        startedAt: null,
        playedMs: 0,
        since: null,
      };
    }
    if (this.play === null) return;
    const playing = state.status === 'playing';
    if (playing) this.play.startedAt ??= time;
    this.play.since = playing ? time : null;
  }

  flush(): void {
    this.accumulate(this.now());
    this.finish();
  }

  private accumulate(time: number): void {
    const play = this.play;
    if (play === null || play.since === null) return;
    play.playedMs += Math.max(0, time - play.since);
    play.since = time;
  }

  private finish(): void {
    const play = this.play;
    this.play = null;
    if (play === null || play.startedAt === null || play.playedMs < MIN_REPORT_MS) return;
    const playedMs = Math.min(Math.round(play.playedMs), 86_400_000);
    this.report({
      clientEventId: this.newId(),
      trackId: play.trackId,
      startedAt: new Date(play.startedAt).toISOString(),
      playedMs,
      completed: play.durationMs > 0 && playedMs >= play.durationMs - COMPLETE_MARGIN_MS,
      skipped: !countsAsPlay(playedMs, play.durationMs),
      context: null,
    });
  }
}
