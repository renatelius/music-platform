import { describe, expect, it } from 'vitest';

import {
  AddPlaylistItemsRequest,
  CreatePlaylistRequest,
  LibraryContainsRequest,
  LibraryTrack,
  UpdatePlaylistRequest,
} from './library.js';
import { createProblem } from './problem.js';

const ID = '01a1a917-dc74-7cb7-9ab6-08f7f6b7e47c';

describe('library contracts', () => {
  it('normalizes playlist names and stores an empty description as null', () => {
    expect(CreatePlaylistRequest.parse({ name: '  Night\t drive ' })).toEqual({
      name: 'Night drive',
      description: null,
    });
    expect(CreatePlaylistRequest.parse({ name: 'A', description: '   ' }).description).toBeNull();
    expect(CreatePlaylistRequest.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreatePlaylistRequest.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(CreatePlaylistRequest.safeParse({ name: 'bad\u0007' }).success).toBe(false);
    expect(
      CreatePlaylistRequest.safeParse({ name: 'A', description: 'd'.repeat(301) }).success,
    ).toBe(false);
  });

  it('refuses an update that changes nothing', () => {
    expect(UpdatePlaylistRequest.safeParse({}).success).toBe(false);
    expect(UpdatePlaylistRequest.parse({ description: null })).toEqual({ description: null });
  });

  it('adds at the end by default, at the start with after: null, refuses duplicates by default', () => {
    expect(AddPlaylistItemsRequest.parse({ trackIds: [ID] })).toEqual({
      trackIds: [ID],
      allowDuplicates: false,
    });
    expect(AddPlaylistItemsRequest.parse({ trackIds: [ID], after: null }).after).toBeNull();
    expect(AddPlaylistItemsRequest.safeParse({ trackIds: [] }).success).toBe(false);
    expect(
      AddPlaylistItemsRequest.safeParse({ trackIds: Array.from({ length: 101 }, () => ID) })
        .success,
    ).toBe(false);
  });

  it('defaults empty id lists in contains', () => {
    expect(LibraryContainsRequest.parse({ tracks: [ID] })).toEqual({
      tracks: [ID],
      releases: [],
      artists: [],
    });
  });

  it('keeps an unavailable track as a stub without quality or license', () => {
    const stub = {
      available: false,
      id: ID,
      title: 'Gone',
      durationMs: 0,
      artists: [{ id: ID, name: 'Artist' }],
      release: { id: ID, title: 'Release' },
    };
    expect(LibraryTrack.parse(stub)).toEqual(stub);
    expect(LibraryTrack.safeParse({ ...stub, available: true }).success).toBe(false);
  });

  it('has problem codes for duplicates and limits', () => {
    expect(createProblem('DUPLICATE_TRACKS').status).toBe(409);
    expect(createProblem('LIMIT_EXCEEDED').status).toBe(409);
  });
});
