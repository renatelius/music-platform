import { describe, expect, it } from 'vitest';

import { audioOf, columnSpan } from './hf.js';
import { nextLink } from './http.js';
import { audioExtension } from './importer.js';

const chunk = (column: string, data: bigint, size: bigint, dictionary?: bigint) => ({
  meta_data: {
    path_in_schema: [column, 'x'],
    data_page_offset: data,
    dictionary_page_offset: dictionary,
    total_compressed_size: size,
    num_values: 10n,
  },
});

describe('columnSpan', () => {
  const columns = [
    chunk('audio', 4n, 1_000_000n),
    chunk('title', 1_000_104n, 50n, 1_000_004n),
    chunk('license', 1_000_154n, 20n),
  ];

  it('spans the chosen column chunks, dictionary pages included', () => {
    expect(columnSpan(columns, (c) => c !== 'audio')).toEqual({ start: 1_000_004, end: 1_000_174 });
    expect(columnSpan(columns, (c) => c === 'audio')).toEqual({ start: 4, end: 1_000_004 });
  });

  it('returns null when nothing matches or the metadata is not understood', () => {
    expect(columnSpan(columns, () => false)).toBeNull();
    expect(columnSpan('nonsense', () => true)).toBeNull();
    expect(columnSpan([{ meta_data: null }], () => true)).toBeNull();
  });
});

describe('audioOf', () => {
  it('reads the bytes and file name of the audio struct', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(audioOf({ audio: { bytes, path: '012345.mp3' } })).toEqual({
      bytes,
      path: '012345.mp3',
    });
    expect(
      audioOf({ audio: { bytes: bytes.buffer, path: new TextEncoder().encode('a.mp3') } }),
    ).toEqual({ bytes, path: 'a.mp3' });
    expect(audioOf({ audio: null })).toEqual({ bytes: null, path: null });
    expect(audioOf(undefined)).toEqual({ bytes: null, path: null });
  });
});

describe('helpers', () => {
  it('follows the next page of a Link header', () => {
    expect(nextLink('<https://huggingface.co/api/x?cursor=abc>; rel="next"')).toBe(
      'https://huggingface.co/api/x?cursor=abc',
    );
    expect(nextLink(null)).toBeNull();
    expect(nextLink('<https://a>; rel="prev"')).toBeNull();
  });

  it('keeps known audio extensions and falls back to MP3', () => {
    expect(audioExtension('000123.MP3')).toBe('.mp3');
    expect(audioExtension('a.flac')).toBe('.flac');
    expect(audioExtension('noext')).toBe('.mp3');
    expect(audioExtension(null)).toBe('.mp3');
  });
});
