'use client';

import { IconChevronUp, IconNext, IconQueue } from '@mp/ui';
import { useCallback, useState } from 'react';

import { artistNames } from '../../lib/catalog';
import { useI18n } from '../../lib/i18n-context';
import { usePlayer, usePlayerState, usePosition } from '../../lib/player-context';
import { Cover } from '../catalog-ui';
import {
  ControlButton,
  NowPlaying,
  PlayPauseButton,
  ProgressBar,
  QualityTag,
  TransportControls,
  VolumeControl,
} from './controls';
import { FullPlayer, type FullPlayerView } from './full-player';

function MiniProgress() {
  const { current } = usePlayerState();
  const position = usePosition();
  const duration = current?.track.durationMs ?? 0;
  const percent = duration > 0 ? Math.min((position / duration) * 100, 100) : 0;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-border"
    >
      <div className="h-full bg-accent" style={{ width: `${String(percent)}%` }} />
    </div>
  );
}

/**
 * Desktop: a bar along the bottom (reference 1). Phone: a mini player above the navigation
 * that opens the full-screen player (reference 2). Hidden until something is queued.
 */
export function PlayerBar() {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  const [view, setView] = useState<FullPlayerView | null>(null);
  const close = useCallback(() => {
    setView(null);
  }, []);
  const show = useCallback((next: FullPlayerView) => {
    setView(next);
  }, []);

  const current = state.current;
  if (current === null) return null;

  return (
    <>
      <section
        aria-label={t('player.label')}
        className="fixed inset-x-0 bottom-0 z-30 hidden h-22 grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-6 border-t border-border bg-bg-elevated/95 px-5 backdrop-blur-md md:grid"
      >
        <NowPlaying />
        <div className="flex min-w-0 flex-col items-center gap-1">
          <TransportControls />
          <ProgressBar className="max-w-xl" />
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <QualityTag className="hidden lg:inline" />
          <ControlButton
            label={t('player.queue')}
            pressed={view === 'queue'}
            onClick={() => {
              show('queue');
            }}
          >
            <IconQueue className="size-5" />
          </ControlButton>
          <VolumeControl className="hidden lg:flex" />
          <ControlButton
            label={t('player.open')}
            onClick={() => {
              show('now');
            }}
          >
            <IconChevronUp className="size-5" />
          </ControlButton>
        </div>
      </section>

      <section
        aria-label={t('player.label')}
        className="fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.375rem)] z-20 flex items-center gap-2 rounded-2xl border border-border bg-bg-elevated/95 py-2 pr-2 pl-2 shadow-pop backdrop-blur-md md:hidden"
      >
        <button
          type="button"
          onClick={() => {
            show('now');
          }}
          aria-label={t('player.open')}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Cover
            id={current.track.release.id}
            title={current.track.release.title}
            className="size-10 rounded-lg shadow-none"
            letterClassName="text-base"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">
              {current.track.title}
            </span>
            <span className="block truncate text-xs text-fg-muted">
              {artistNames(current.track.artists)}
            </span>
          </span>
        </button>
        <PlayPauseButton size="sm" />
        <ControlButton label={t('player.next')} onClick={() => player?.next()}>
          <IconNext className="size-5" />
        </ControlButton>
        <MiniProgress />
      </section>

      {view !== null ? <FullPlayer view={view} onView={show} onClose={close} /> : null}
    </>
  );
}
