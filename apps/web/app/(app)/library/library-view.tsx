'use client';

import { NetworkError } from '@mp/api-client';
import type { LibraryTrack, RecentPlay, TrackDto } from '@mp/contracts';
import { Alert, Button, buttonClasses, SegmentedControl, Spinner, TextField } from '@mp/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type SubmitEvent, type ReactNode, useEffect, useId, useState } from 'react';

import {
  ArtistGrid,
  Cover,
  PlayActions,
  ReleaseGrid,
  TrackList,
} from '../../../components/catalog-ui';
import { HeartButton, UnavailableTracks } from '../../../components/library-ui';
import { useAuth } from '../../../lib/auth-context';
import { countLabel, formatTotalDuration } from '../../../lib/catalog';
import { apiErrorMessage } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';
import { useLibrary } from '../../../lib/library-context';
import { useSync, useSyncEvents } from '../../../lib/sync-context';
import { type Paged, usePaged } from '../../../lib/use-paged';
import { useDocumentTitle } from '../../../lib/use-api';

export type LibraryTab = 'tracks' | 'playlists' | 'releases' | 'artists' | 'recent';

/** Playable tracks of a library list, for TrackList and «Play». */
export function playable(tracks: readonly LibraryTrack[]): TrackDto[] {
  return tracks.flatMap((track) => (track.available ? [track] : []));
}

export function unplayable(tracks: readonly { key: string; track: LibraryTrack }[]) {
  return tracks.flatMap(({ key, track }) =>
    track.available ? [] : [{ key, id: track.id, title: track.title, artists: track.artists }],
  );
}

function Empty({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <p className="max-w-sm text-fg-muted">{text}</p>
      <Link href="/search" className={buttonClasses('secondary', 'md')}>
        {t('library.findMusic')}
      </Link>
    </div>
  );
}

/** Loading, error, empty and «Show more» around a paged list. */
export function PagedState<T>({
  paged,
  empty,
  children,
}: {
  paged: Paged<T>;
  empty: ReactNode;
  children: (items: readonly T[]) => ReactNode;
}) {
  const { t } = useI18n();
  if (paged.status === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-fg-muted" label={t('common.loading')} />
      </div>
    );
  }
  if (paged.status === 'error') {
    return (
      <Alert
        tone="error"
        className="my-8"
        action={
          <Button variant="secondary" size="sm" onClick={paged.reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {apiErrorMessage(paged.error, t)}
      </Alert>
    );
  }
  if (paged.items.length === 0) return <>{empty}</>;
  return (
    <>
      {children(paged.items)}
      {paged.hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" loading={paged.loadingMore} onClick={paged.loadMore}>
            {t('library.more')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function LikedTracks() {
  const { t } = useI18n();
  const { client } = useAuth();
  const paged = usePaged('liked', (cursor) => client.likedTracks(cursor, 50));
  useSyncEvents((event) => {
    if (
      event.kind === 'reset' ||
      (event.kind === 'changes' && event.changes.some((c) => c.entity === 'track_like'))
    ) {
      paged.reload();
    }
  });
  return (
    <PagedState paged={paged} empty={<Empty text={t('library.empty.tracks')} />}>
      {(items) => {
        const tracks = playable(items.map((item) => item.track));
        return (
          <>
            <div className="mb-6">
              <PlayActions tracks={tracks} />
            </div>
            <TrackList tracks={tracks} showRelease />
            <UnavailableTracks
              tracks={unplayable(items.map((item) => ({ key: item.track.id, track: item.track })))}
              actions={(id, title) => <HeartButton trackId={id} title={title} />}
            />
          </>
        );
      }}
    </PagedState>
  );
}

function SavedReleases() {
  const { t } = useI18n();
  const { client } = useAuth();
  const paged = usePaged('saved-releases', (cursor) => client.savedReleases(cursor, 48));
  useSyncEvents((event) => {
    if (
      event.kind === 'reset' ||
      (event.kind === 'changes' && event.changes.some((c) => c.entity === 'release_save'))
    ) {
      paged.reload();
    }
  });
  return (
    <PagedState paged={paged} empty={<Empty text={t('library.empty.releases')} />}>
      {(items) => <ReleaseGrid releases={items.map((item) => item.release)} />}
    </PagedState>
  );
}

function FollowedArtists() {
  const { t } = useI18n();
  const { client } = useAuth();
  const paged = usePaged('followed-artists', (cursor) => client.followedArtists(cursor, 48));
  useSyncEvents((event) => {
    if (
      event.kind === 'reset' ||
      (event.kind === 'changes' && event.changes.some((c) => c.entity === 'artist_follow'))
    ) {
      paged.reload();
    }
  });
  return (
    <PagedState paged={paged} empty={<Empty text={t('library.empty.artists')} />}>
      {(items) => <ArtistGrid artists={items.map((item) => item.artist)} />}
    </PagedState>
  );
}

function NewPlaylistForm() {
  const { t } = useI18n();
  const { client } = useAuth();
  const { reloadPlaylists } = useLibrary();
  const { engine } = useSync();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [queued, setQueued] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    setQueued(false);
    // The same key online and in the queue: if the first try did reach the server, the queued
    // one returns the same playlist instead of a second one.
    const key = crypto.randomUUID();
    try {
      const created = await client.createPlaylist({ name }, key);
      reloadPlaylists();
      router.push(`/playlist/${created.playlist.id}`);
    } catch (caught) {
      if (caught instanceof NetworkError && engine !== null) {
        await engine.enqueue({ type: 'playlist.create', name, description: null }, key);
        setName('');
        setQueued(true);
      } else {
        setError(caught);
      }
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="mb-8 flex flex-wrap items-end gap-3"
    >
      <TextField
        label={t('playlist.new')}
        value={name}
        maxLength={100}
        onChange={(event) => {
          setName(event.target.value);
        }}
        error={error === null ? undefined : apiErrorMessage(error, t)}
        className="min-w-0 flex-1 sm:max-w-sm"
      />
      <Button type="submit" loading={busy} disabled={name.trim() === ''} className="h-11">
        {t('playlist.create')}
      </Button>
      {queued ? (
        <p role="status" className="w-full text-sm text-fg-muted">
          {t('sync.queuedPlaylist')}
        </p>
      ) : null}
    </form>
  );
}

function Playlists() {
  const { t, locale } = useI18n();
  const { playlists, pendingPlaylists } = useLibrary();
  return (
    <>
      <NewPlaylistForm />
      {pendingPlaylists.length > 0 ? (
        <ul className="mb-6 flex flex-col gap-2">
          {pendingPlaylists.map((playlist) => (
            <li
              key={playlist.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3"
            >
              <span className="min-w-0 truncate font-medium text-fg">{playlist.name}</span>
              <span className="shrink-0 text-xs text-fg-muted">{t('sync.pendingPlaylist')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {playlists === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-fg-muted" label={t('common.loading')} />
        </div>
      ) : playlists.length === 0 ? (
        <p className="text-fg-muted">{t('library.empty.playlists')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {playlists.map((playlist) => (
            <li key={playlist.id} className="min-w-0">
              <Link
                href={`/playlist/${playlist.id}`}
                className="group -m-2 flex flex-col gap-3 rounded-2xl p-2 transition-colors hover:bg-surface"
              >
                <Cover
                  id={playlist.id}
                  title={playlist.name}
                  className="aspect-square w-full transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{playlist.name}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {countLabel(t, locale, 'tracks', playlist.trackCount)}
                    {playlist.trackCount > 0
                      ? ` · ${formatTotalDuration(playlist.durationMs, t)}`
                      : ''}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type RecentState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly RecentPlay[] }
  | { readonly status: 'error'; readonly error: unknown };

/** «Record listening history»: an account setting, the same on every device. */
export function HistoryToggle() {
  const { t } = useI18n();
  const { settings, setHistoryEnabled, engine } = useSync();
  const id = useId();
  const enabled = settings?.historyEnabled ?? true;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={enabled}
        disabled={settings === null || engine === null}
        onChange={(event) => {
          setHistoryEnabled(event.target.checked);
        }}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-default"
      />
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg">
          {t('history.record')}
        </label>
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {enabled ? t('history.recordHint') : t('history.off')}
        </p>
      </div>
    </div>
  );
}

function Recent() {
  const { t } = useI18n();
  const { client } = useAuth();
  const [state, setState] = useState<RecentState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.recentPlays(50).then(
      (recent) => {
        if (active) setState({ status: 'ready', items: recent.items });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', error });
      },
    );
    return () => {
      active = false;
    };
  }, [client, attempt]);

  const clear = async () => {
    setClearing(true);
    try {
      await client.clearHistory();
      setState({ status: 'ready', items: [] });
      setNotice(t('history.cleared'));
    } catch (error) {
      setNotice(apiErrorMessage(error, t));
    } finally {
      setClearing(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
        <HistoryToggle />
        {confirm ? (
          <div role="alert" className="flex flex-col gap-2 text-sm sm:max-w-xs">
            <p>{t('history.clearConfirm')}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                loading={clearing}
                onClick={() => {
                  void clear();
                }}
              >
                {t('history.clear')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirm(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={state.status !== 'ready' || state.items.length === 0}
            onClick={() => {
              setNotice(null);
              setConfirm(true);
            }}
          >
            {t('history.clear')}
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className="mb-4 text-sm text-fg-muted empty:hidden">
        {notice}
      </p>
      {state.status === 'loading' ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-fg-muted" label={t('common.loading')} />
        </div>
      ) : state.status === 'error' ? (
        <Alert
          tone="error"
          className="my-8"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAttempt((n) => n + 1);
              }}
            >
              {t('common.retry')}
            </Button>
          }
        >
          {apiErrorMessage(state.error, t)}
        </Alert>
      ) : state.items.length === 0 ? (
        <p className="text-fg-muted">{t('library.empty.recent')}</p>
      ) : (
        <>
          <TrackList
            tracks={playable(state.items.map((item) => item.track))}
            showRelease
            rowKey={(track, index) => `${track.id}:${String(index)}`}
          />
          <UnavailableTracks
            tracks={unplayable(
              state.items.map((item, index) => ({
                key: `${item.track.id}:${String(index)}`,
                track: item.track,
              })),
            )}
            actions={() => null}
          />
        </>
      )}
    </>
  );
}

export function LibraryView({ initialTab }: { initialTab: LibraryTab }) {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  useDocumentTitle(t('library.page'));
  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {t('library.page')}
      </h1>
      <SegmentedControl
        label={t('library.tabs')}
        value={tab}
        onChange={(value) => {
          setTab(value);
          router.replace(value === 'tracks' ? '/library' : `/library?tab=${value}`, {
            scroll: false,
          });
        }}
        options={[
          { value: 'tracks', label: t('library.tab.tracks') },
          { value: 'playlists', label: t('library.tab.playlists') },
          { value: 'releases', label: t('library.tab.releases') },
          { value: 'artists', label: t('library.tab.artists') },
          { value: 'recent', label: t('library.tab.recent') },
        ]}
        className="mt-6 mb-8"
      />
      {tab === 'tracks' ? <LikedTracks /> : null}
      {tab === 'playlists' ? <Playlists /> : null}
      {tab === 'releases' ? <SavedReleases /> : null}
      {tab === 'artists' ? <FollowedArtists /> : null}
      {tab === 'recent' ? <Recent /> : null}
    </div>
  );
}
