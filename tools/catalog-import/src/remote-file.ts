import type { AsyncBuffer } from 'hyparquet';

import type { HttpClient } from './http.js';

/**
 * A remote Parquet file read through HTTP byte ranges. `prefetch` loads one span (all metadata
 * columns of a row group) in a single request; slices inside it are served from memory, so a
 * part costs a handful of requests instead of one per column chunk.
 */
export class RemoteFile implements AsyncBuffer {
  private blocks: { start: number; data: ArrayBuffer }[] = [];

  constructor(
    private readonly http: HttpClient,
    readonly url: string,
    readonly byteLength: number,
  ) {}

  async prefetch(start: number, end: number): Promise<void> {
    const data = await this.http.range(this.url, start, Math.min(end, this.byteLength));
    this.blocks.push({ start, data });
  }

  clear(): void {
    this.blocks = [];
  }

  slice(start: number, end?: number): Promise<ArrayBuffer> {
    const from = start < 0 ? Math.max(0, this.byteLength + start) : start;
    const to = Math.min(end ?? this.byteLength, this.byteLength);
    for (const block of this.blocks) {
      if (from >= block.start && to <= block.start + block.data.byteLength) {
        return Promise.resolve(block.data.slice(from - block.start, to - block.start));
      }
    }
    return this.http.range(this.url, from, to);
  }
}
