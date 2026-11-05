'use client';

import { ApiRequestError } from '@mp/api-client';
import type { PlaylistSummary } from '@mp/contracts';
import {
  Button,
  cn,
  IconHeart,
  IconHeartFilled,
  IconPlus,
  IconX,
  Spinner,
  TextField,
} from '@mp/ui';
import { type SubmitEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { useAuth } from '../lib/auth-context';
import { countLabel } from '../lib/catalog';
import { apiErrorMessage } from '../lib/form-errors';
import { useI18n } from '../lib/i18n-context';
import { useLibrary, useSaved } from '../lib/library-context';

const ROUND =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40';

/** Heart of a track: in lists, in the player. */
export function HeartButton({
  trackId,
  title,
  className,
}: {
  trackId: string;
  title: string;
  className?: string;
}) {
  const { t } = useI18n();
  const { store } = useLibrary();
  const liked = useSaved('tracks', trackId) === true;
  const [sendFailed, setFailed] = useState(false);
  // Also a change made offline that the server refused later.
  const failed = sendFailed || store.hasFailed('tracks', trackId);
  const label = liked ? t('library.unlike', { title }) : t('library.like', { title });
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={failed ? `${label}. ${t('library.error')}` : label}
      title={failed ? t('library.error') : label}
      onClick={() => {
        setFailed(false);
        store.toggle('tracks', trackId).catch(() => {
          setFailed(true);
        });
      }}
      className={cn(ROUND, liked ? 'text-accent' : 'text-fg-muted hover:text-fg', className)}
    >
      {liked ? <IconHeartFilled className="size-4" /> : <IconHeart className="size-4" />}
    </button>
  );
}

/** «Save» an album or «Follow» an artist. */
export function SaveButton({ kind, id }: { kind: 'releases' | 'artists'; id: string }) {
  const { t } = useI18n();
  const { store } = useLibrary();
  const saved = useSaved(kind, id);
  const [busy, setBusy] = useState(false);
  const [sendFailed, setFailed] = useState(false);
  const failed = sendFailed || store.hasFailed(kind, id);
  const on = saved === true;
  const label =
    kind === 'releases'
      ? t(on ? 'library.saved' : 'library.save')
      : t(on ? 'library.following' : 'library.follow');
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant="secondary"
        aria-pressed={on}
        loading={busy}
        disabled={saved === undefined}
        icon={
          on ? <IconHeartFilled className="size-4 text-accent" /> : <IconHeart className="size-4" />
        }
        onClick={() => {
          setBusy(true);
          setFailed(false);
          store
            .toggle(kind, id)
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {label}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-danger">
          {t('library.error')}
        </span>
      ) : null}
    </span>
  );
}

/** Opens the playlist picker for one track. */
export function AddToPlaylistButton({ trackId, title }: { trackId: string; title: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t('playlist.add', { title })}
        title={t('playlist.pick')}
        onClick={() => {
          setOpen(true);
        }}
        className={cn(ROUND, 'text-fg-muted hover:text-fg')}
      >
        <IconPlus className="size-4" />
      </button>
      {open ? (
        <PlaylistPicker
          trackId={trackId}
          title={title}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

type PickerState =
  | { step: 'choose' }
  | { step: 'busy'; playlist: PlaylistSummary | null }
  | { step: 'duplicate'; playlist: PlaylistSummary }
  | { step: 'done'; playlist: PlaylistSummary }
  | { step: 'error'; error: unknown };

/** Modal list of my playlists (native <dialog>: focus stays inside, Esc closes). */
function PlaylistPicker({
  trackId,
  title,
  onClose,
}: {
  trackId: string;
  title: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { client } = useAuth();
  const { playlists, reloadPlaylists } = useLibrary();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<PickerState>({ step: 'choose' });
  const [name, setName] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);

  const add = async (playlist: PlaylistSummary, allowDuplicates: boolean) => {
    setState({ step: 'busy', playlist });
    try {
      await client.addToPlaylist(playlist.id, { trackIds: [trackId], allowDuplicates });
      reloadPlaylists();
      setState({ step: 'done', playlist });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'DUPLICATE_TRACKS') {
        setState({ step: 'duplicate', playlist });
        return;
      }
      setState({ step: 'error', error });
    }
  };

  const create = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') return;
    setState({ step: 'busy', playlist: null });
    try {
      const created = await client.createPlaylist({ name });
      setName('');
      await add(created.playlist, false);
    } catch (error) {
      setState({ step: 'error', error });
    }
  };

  const busy = state.step === 'busy';
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="playlist-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-elevated p-0 text-fg shadow-pop backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 id="playlist-picker-title" className="min-w-0 truncate font-semibold">
          {t('playlist.pick')}
        </h2>
        <button
          type="button"
          aria-label={t('playlist.close')}
          onClick={onClose}
          className={cn(ROUND, 'text-fg-muted hover:text-fg')}
        >
          <IconX className="size-4" />
        </button>
      </div>
      <div className="max-h-[60dvh] overflow-y-auto px-3 py-3">
        <p className="truncate px-2 pb-2 text-sm text-fg-muted">{title}</p>
        <p role="status" aria-live="polite" className="px-2 text-sm">
          {state.step === 'done' ? (
            <span className="text-accent">
              {t('playlist.added', { name: state.playlist.name })}
            </span>
          ) : null}
        </p>
        {state.step === 'duplicate' ? (
          <div role="alert" className="mx-2 my-2 rounded-xl bg-surface p-3 text-sm">
            <p>{t('playlist.duplicate', { title, name: state.playlist.name })}</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void add(state.playlist, true);
                }}
              >
                {t('playlist.addAgain')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setState({ step: 'choose' });
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
        {state.step === 'error' ? (
          <p role="alert" className="mx-2 my-2 text-sm text-danger">
            {apiErrorMessage(state.error, t)}
          </p>
        ) : null}
        {playlists === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5 text-fg-muted" label={t('common.loading')} />
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-2 py-3 text-sm text-fg-muted">{t('playlist.none')}</p>
        ) : (
          <ul className="flex flex-col">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void add(playlist, false);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface disabled:opacity-50"
                >
                  <span className="min-w-0 truncate font-medium">{playlist.name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {state.step === 'busy' && state.playlist?.id === playlist.id ? (
                      <Spinner className="size-4" />
                    ) : (
                      countLabel(t, locale, 'tracks', playlist.trackCount)
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        onSubmit={(event) => {
          void create(event);
        }}
        className="flex items-end gap-2 border-t border-border px-5 py-4"
      >
        <TextField
          label={t('playlist.new')}
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy || name.trim() === ''} className="h-11">
          {t('playlist.create')}
        </Button>
      </form>
    </dialog>
  );
}

/** Tracks of the library that cannot be played now: shown, marked, removable (ADR-018). */
export function UnavailableTracks({
  tracks,
  actions,
}: {
  tracks: readonly {
    key: string;
    id: string;
    title: string;
    artists: readonly { name: string }[];
  }[];
  actions: (key: string, title: string) => ReactNode;
}) {
  const { t } = useI18n();
  if (tracks.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold tracking-tight text-fg">
        {t('library.unavailable.title')}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t('library.unavailable.text')}</p>
      <ul className="mt-3 flex flex-col">
        {tracks.map((track) => (
          <li
            key={track.key}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 opacity-70 sm:px-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg">{track.title}</p>
              <p className="truncate text-sm text-fg-muted">
                {track.artists.map((artist) => artist.name).join(', ')}
              </p>
            </div>
            <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs text-fg-muted">
              {t('library.unavailable')}
            </span>
            {actions(track.key, track.title)}
          </li>
        ))}
      </ul>
    </section>
  );
}
