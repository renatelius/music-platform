'use client';

import type { PlaylistItem, PlaylistSummary } from '@mp/contracts';
import { Button, cn, IconChevronDown, IconChevronUp, IconX, TextField } from '@mp/ui';
import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';

import { Cover, LoadState, PlayActions, TrackList } from '../../../../components/catalog-ui';
import { UnavailableTracks } from '../../../../components/library-ui';
import { useAuth } from '../../../../lib/auth-context';
import { countLabel, formatTotalDuration } from '../../../../lib/catalog';
import { apiErrorMessage } from '../../../../lib/form-errors';
import { useI18n } from '../../../../lib/i18n-context';
import { useLibrary } from '../../../../lib/library-context';
import { useSyncEvents } from '../../../../lib/sync-context';
import { useApi, useDocumentTitle } from '../../../../lib/use-api';
import { moveLocallyTo, moveTargetTo } from '../../../../lib/playlist-order';
import { usePaged } from '../../../../lib/use-paged';
import { PagedState, playable, unplayable } from '../../library/library-view';

const ACTION =
  'inline-flex size-8 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30';

function EditForm({
  playlist,
  onDone,
}: {
  playlist: PlaylistSummary;
  onDone: (updated: PlaylistSummary | null) => void;
}) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await client.updatePlaylist(playlist.id, {
        name,
        description: description.trim() === '' ? null : description,
      });
      onDone(updated.playlist);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="mt-4 flex max-w-md flex-col gap-3"
    >
      <TextField
        label={t('playlist.name')}
        value={name}
        maxLength={100}
        required
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <TextField
        label={t('playlist.description')}
        value={description}
        maxLength={300}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        error={error === null ? undefined : apiErrorMessage(error, t)}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={name.trim() === ''}>
          {t('common.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onDone(null);
          }}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Playlist({ initial }: { initial: PlaylistSummary }) {
  const { t, locale } = useI18n();
  const { client } = useAuth();
  const { reloadPlaylists } = useLibrary();
  const router = useRouter();
  const [playlist, setPlaylist] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  useDocumentTitle(playlist.name);

  const paged = usePaged(`playlist:${initial.id}`, (cursor) =>
    client.playlistItems(initial.id, cursor, 500),
  );

  /** After a change: fresh counts here and in the menus; the list itself is already updated. */
  const refreshSummary = () => {
    reloadPlaylists();
    client.playlist(initial.id).then(setPlaylist, () => undefined);
  };

  // Changed on another device or tab (I7b): show the new order, name, or leave if deleted.
  useSyncEvents((event) => {
    if (event.kind === 'reset') {
      paged.reload();
      client.playlist(initial.id).then(setPlaylist, () => undefined);
      return;
    }
    if (event.kind !== 'changes') return;
    let touched = false;
    for (const change of event.changes) {
      if (change.entity === 'playlist' && change.entityId === initial.id) {
        if (change.op === 'delete') {
          router.push('/library?tab=playlists');
          return;
        }
        touched = true;
      }
      if (change.entity === 'playlist_item' && change.payload?.playlistId === initial.id) {
        touched = true;
      }
    }
    if (touched) {
      paged.reload();
      client.playlist(initial.id).then(setPlaylist, () => undefined);
    }
  });

  const failed = (caught: unknown) => {
    setError(caught);
    paged.reload();
  };

  /** Moves the item at `from` to position `to` (indexes in the whole list). */
  const moveTo = (items: readonly PlaylistItem[], from: number, to: number) => {
    const item = items[from];
    const after = moveTargetTo(items, from, to);
    if (item === undefined || after === undefined) return;
    setError(null);
    paged.setItems((current) => moveLocallyTo(current, from, to));
    client.movePlaylistItem(initial.id, item.itemId, after).catch(failed);
  };

  const move = (items: readonly PlaylistItem[], index: number, direction: -1 | 1) => {
    moveTo(items, index, index + direction);
  };

  const remove = (items: readonly PlaylistItem[], index: number) => {
    const item = items[index];
    if (item === undefined) return;
    const previous = index > 0 ? (items[index - 1]?.itemId ?? null) : null;
    setError(null);
    paged.setItems((current) => current.filter((entry) => entry.itemId !== item.itemId));
    client.removePlaylistItem(initial.id, item.itemId).then(() => {
      refreshSummary();
      setNotice({
        text: t('playlist.removed', { title: item.track.title }),
        undo: () => {
          setNotice(null);
          client
            .addToPlaylist(initial.id, {
              trackIds: [item.track.id],
              after: previous,
              allowDuplicates: true,
            })
            .then(() => {
              paged.reload();
              refreshSummary();
            }, failed);
        },
      });
    }, failed);
  };

  const deletePlaylist = async () => {
    setBusy(true);
    try {
      await client.deletePlaylist(initial.id);
      reloadPlaylists();
      router.push('/library?tab=playlists');
    } catch (caught) {
      setError(caught);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const items = paged.items;
  const playableItems = items.filter((item) => item.track.available);
  const tracks = playable(items.map((item) => item.track));
  const meta = [countLabel(t, locale, 'tracks', playlist.trackCount)];
  if (playlist.trackCount > 0) meta.push(formatTotalDuration(playlist.durationMs, t));

  const rowButtons = (itemId: string, title: string) => {
    const index = items.findIndex((item) => item.itemId === itemId);
    return (
      <>
        <button
          type="button"
          disabled={index <= 0}
          aria-label={t('playlist.moveUp', { title })}
          title={t('playlist.moveUp', { title })}
          onClick={() => {
            move(items, index, -1);
          }}
          className={ACTION}
        >
          <IconChevronUp className="size-4" />
        </button>
        <button
          type="button"
          disabled={index < 0 || index >= items.length - 1}
          aria-label={t('playlist.moveDown', { title })}
          title={t('playlist.moveDown', { title })}
          onClick={() => {
            move(items, index, 1);
          }}
          className={ACTION}
        >
          <IconChevronDown className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t('playlist.remove', { title })}
          title={t('playlist.remove', { title })}
          onClick={() => {
            remove(items, index);
          }}
          className={ACTION}
        >
          <IconX className="size-4" />
        </button>
      </>
    );
  };

  return (
    <div className="animate-rise">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Cover
          id={playlist.id}
          title={playlist.name}
          className="size-44 sm:size-52"
          letterClassName="text-6xl"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
            {t('playlist.label')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight break-words text-fg sm:text-5xl">
            {playlist.name}
          </h1>
          {playlist.description !== null ? (
            <p className="mt-3 text-fg-muted">{playlist.description}</p>
          ) : null}
          <p className="mt-1 text-sm text-fg-muted">{meta.join(' · ')}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PlayActions tracks={tracks} />
            <Button
              variant="secondary"
              onClick={() => {
                setEditing((value) => !value);
              }}
            >
              {t('playlist.edit')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              {t('playlist.delete')}
            </Button>
          </div>
          {editing ? (
            <EditForm
              playlist={playlist}
              onDone={(updated) => {
                setEditing(false);
                if (updated !== null) {
                  setPlaylist(updated);
                  reloadPlaylists();
                }
              }}
            />
          ) : null}
          {confirmDelete ? (
            <div role="alert" className="mt-4 max-w-md rounded-xl bg-surface p-4 text-sm">
              <p>{t('playlist.deleteConfirm', { name: playlist.name })}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    void deletePlaylist();
                  }}
                >
                  {t('playlist.delete')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-6 text-sm', notice === null && 'sr-only')}
      >
        {notice?.text}
        {notice?.undo !== undefined ? (
          <Button variant="ghost" size="sm" className="ml-2" onClick={notice.undo}>
            {t('playlist.undo')}
          </Button>
        ) : null}
      </p>
      {error !== null ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {apiErrorMessage(error, t)}
        </p>
      ) : null}

      <section className="mt-8">
        <PagedState paged={paged} empty={<p className="text-fg-muted">{t('playlist.empty')}</p>}>
          {() => (
            <>
              <TrackList
                tracks={tracks}
                rowKey={(_track, index) => playableItems[index]?.itemId ?? String(index)}
                rowActions={(track, index) =>
                  rowButtons(playableItems[index]?.itemId ?? '', track.title)
                }
                onReorder={(from, to) => {
                  // TrackList shows playable items only: map its rows to the whole list.
                  const source = playableItems[from];
                  const target = playableItems[to];
                  if (source === undefined || target === undefined) return;
                  moveTo(items, items.indexOf(source), items.indexOf(target));
                }}
              />
              <UnavailableTracks
                tracks={unplayable(items.map((item) => ({ key: item.itemId, track: item.track })))}
                actions={(itemId, title) => rowButtons(itemId, title)}
              />
            </>
          )}
        </PagedState>
      </section>
    </div>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const { client } = useAuth();
  const playlist = useApi(`playlist:${id}`, () => client.playlist(id));
  return <LoadState state={playlist}>{(data) => <Playlist initial={data} />}</LoadState>;
}
