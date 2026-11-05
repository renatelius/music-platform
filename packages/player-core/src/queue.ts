import type { QueueEntry, QueueTrack, RepeatMode } from './types.js';

export interface QueueSnapshot {
  /** Format of the snapshot; only 1 exists. */
  readonly version: number;
  /** Original (context) order. */
  readonly entries: readonly QueueEntry[];
  /** Play order: the original order, or a shuffled one. */
  readonly order: readonly string[];
  readonly position: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
}

const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one'];

/**
 * Play queue: an original order (album, playlist, search results) and a play order that is
 * either the same or shuffled. Shuffle keeps the current track first and turning it off returns
 * to the original order at the current track (ARCHITECTURE.md §6.3).
 */
export class PlayQueue {
  private base: string[] = [];
  private order: string[] = [];
  private readonly entries = new Map<string, QueueEntry>();
  private position = -1;
  private shuffled = false;
  private repeatMode: RepeatMode = 'off';
  private counter = 0;

  constructor(private readonly random: () => number = Math.random) {}

  get length(): number {
    return this.order.length;
  }

  /** Index of the current entry in play order, -1 when empty. */
  get index(): number {
    return this.position;
  }

  get shuffle(): boolean {
    return this.shuffled;
  }

  get repeat(): RepeatMode {
    return this.repeatMode;
  }

  current(): QueueEntry | null {
    return this.at(this.position);
  }

  at(index: number): QueueEntry | null {
    const uid = this.order[index];
    return uid === undefined ? null : (this.entries.get(uid) ?? null);
  }

  indexOf(uid: string): number {
    return this.order.indexOf(uid);
  }

  /** Entries in play order. */
  list(): QueueEntry[] {
    return this.order.map((uid) => this.entry(uid));
  }

  replace(tracks: readonly QueueTrack[], startIndex = 0): void {
    this.entries.clear();
    this.base = tracks.map((track) => this.add(track));
    if (this.base.length === 0) {
      this.order = [];
      this.position = -1;
      return;
    }
    const start = Math.min(Math.max(0, Math.trunc(startIndex)), this.base.length - 1);
    const first = this.base[start];
    if (this.shuffled && first !== undefined) {
      this.order = [first, ...this.shuffleList(this.base.filter((uid) => uid !== first))];
      this.position = 0;
    } else {
      this.order = [...this.base];
      this.position = start;
    }
  }

  clear(): void {
    this.replace([]);
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffled) return;
    this.shuffled = on;
    const current = this.order[this.position];
    if (current === undefined) {
      this.order = on ? this.shuffleList(this.base) : [...this.base];
      return;
    }
    if (on) {
      this.order = [current, ...this.shuffleList(this.base.filter((uid) => uid !== current))];
      this.position = 0;
    } else {
      this.order = [...this.base];
      this.position = this.base.indexOf(current);
    }
  }

  setRepeat(mode: RepeatMode): void {
    this.repeatMode = mode;
  }

  /**
   * Index of what plays next, or null to stop. `auto`: the current track finished by itself
   * (repeat one replays it); a manual "next" always moves on.
   */
  peekNext(auto: boolean): number | null {
    if (this.order.length === 0) return null;
    if (auto && this.repeatMode === 'one') return this.position;
    if (this.position + 1 < this.order.length) return this.position + 1;
    return this.repeatMode === 'off' ? null : 0;
  }

  /** Index for "previous": the one before, the last one with repeat all, else the current one. */
  peekPrevious(): number {
    if (this.position > 0) return this.position - 1;
    if (this.repeatMode === 'all' && this.order.length > 0) return this.order.length - 1;
    return this.position;
  }

  moveTo(index: number): QueueEntry | null {
    if (index < 0 || index >= this.order.length) return null;
    this.position = index;
    return this.current();
  }

  /** Plays right after the current entry, in both the play and the original order. */
  addNext(tracks: readonly QueueTrack[]): QueueEntry[] {
    const uids = tracks.map((track) => this.add(track));
    const current = this.order[this.position];
    this.order.splice(this.position + 1, 0, ...uids);
    const baseIndex = current === undefined ? this.base.length : this.base.indexOf(current) + 1;
    this.base.splice(baseIndex, 0, ...uids);
    return uids.map((uid) => this.entry(uid));
  }

  append(tracks: readonly QueueTrack[]): QueueEntry[] {
    const uids = tracks.map((track) => this.add(track));
    this.order.push(...uids);
    this.base.push(...uids);
    return uids.map((uid) => this.entry(uid));
  }

  /** The current entry cannot be removed (skip it instead). */
  remove(uid: string): boolean {
    const index = this.order.indexOf(uid);
    if (index === -1 || index === this.position) return false;
    this.order.splice(index, 1);
    if (index < this.position) this.position -= 1;
    this.base.splice(this.base.indexOf(uid), 1);
    this.entries.delete(uid);
    return true;
  }

  /** Moves an entry to another place in play order (the original order follows unless shuffled). */
  move(uid: string, toIndex: number): boolean {
    const from = this.order.indexOf(uid);
    if (from === -1) return false;
    const current = this.order[this.position];
    const to = Math.min(Math.max(0, Math.trunc(toIndex)), this.order.length - 1);
    this.order.splice(from, 1);
    this.order.splice(to, 0, uid);
    if (current !== undefined) this.position = this.order.indexOf(current);
    if (!this.shuffled) this.base = [...this.order];
    return true;
  }

  snapshot(): QueueSnapshot {
    return {
      version: 1,
      entries: this.base.map((uid) => this.entry(uid)),
      order: [...this.order],
      position: this.position,
      shuffle: this.shuffled,
      repeat: this.repeatMode,
    };
  }

  /** Restores a snapshot; returns false (and changes nothing) when it is inconsistent. */
  restore(snapshot: QueueSnapshot): boolean {
    const uids = snapshot.entries.map((entry) => entry.uid);
    const known = new Set(uids);
    const consistent =
      snapshot.version === 1 &&
      known.size === uids.length &&
      snapshot.order.length === uids.length &&
      new Set(snapshot.order).size === uids.length &&
      snapshot.order.every((uid) => known.has(uid)) &&
      REPEAT_MODES.includes(snapshot.repeat) &&
      Number.isInteger(snapshot.position) &&
      (uids.length === 0
        ? snapshot.position === -1
        : snapshot.position >= 0 && snapshot.position < uids.length);
    if (!consistent) return false;
    this.entries.clear();
    for (const entry of snapshot.entries) this.entries.set(entry.uid, entry);
    this.base = uids;
    this.order = [...snapshot.order];
    this.position = snapshot.position;
    this.shuffled = snapshot.shuffle;
    this.repeatMode = snapshot.repeat;
    this.counter = Math.max(
      this.counter,
      ...uids.map((uid) => Number(/^q(\d+)$/.exec(uid)?.[1] ?? 0)),
    );
    return true;
  }

  private add(track: QueueTrack): string {
    this.counter += 1;
    const uid = `q${String(this.counter)}`;
    this.entries.set(uid, { uid, track });
    return uid;
  }

  private entry(uid: string): QueueEntry {
    const entry = this.entries.get(uid);
    if (entry === undefined) throw new Error(`Queue entry ${uid} is missing`);
    return entry;
  }

  /** Fisher-Yates. */
  private shuffleList(uids: readonly string[]): string[] {
    const list = [...uids];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      const a = list[i];
      const b = list[j];
      if (a !== undefined && b !== undefined) {
        list[i] = b;
        list[j] = a;
      }
    }
    return list;
  }
}
