'use client';

import { cn, IconChevronDown } from '@mp/ui';
import { useEffect, useRef } from 'react';

import { artistNames, coverColors } from '../../lib/catalog';
import { useI18n } from '../../lib/i18n-context';
import { usePlayerState, usePosition } from '../../lib/player-context';
import { Cover } from '../catalog-ui';
import {
  ControlButton,
  PlayerError,
  ProgressBar,
  QualityTag,
  TransportControls,
  VolumeControl,
} from './controls';
import { QueueList } from './queue-list';

export type FullPlayerView = 'now' | 'queue';

const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Round cover inside a progress ring (reference 2 in docs/references). */
function CoverRing({ releaseId, title }: { releaseId: string; title: string }) {
  const { current } = usePlayerState();
  const position = usePosition();
  const duration = current?.track.durationMs ?? 0;
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-72">
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="1.5"
          className="stroke-border"
        />
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - progress)}
          className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <Cover
        id={releaseId}
        title={title}
        round
        className="absolute inset-[9%]"
        letterClassName="text-7xl"
      />
    </div>
  );
}

export function FullPlayer({
  view,
  onView,
  onClose,
}: {
  view: FullPlayerView;
  onView: (view: FullPlayerView) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { current } = usePlayerState();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (current === null) onClose();
  }, [current, onClose]);

  if (current === null) return null;
  const { track } = current;
  const { from, to } = coverColors(track.release.id);
  const tab = (value: FullPlayerView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => {
        onView(value);
      }}
      className={cn(
        'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
        view === value ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('player.nowPlaying')}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg animate-rise"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 blur-3xl"
        style={{
          backgroundImage: `radial-gradient(circle at 30% 20%, ${from}, transparent 60%), radial-gradient(circle at 75% 80%, ${to}, transparent 60%)`,
        }}
      />
      <div className="relative mx-auto flex h-full w-full max-w-lg flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between gap-2">
          <ControlButton
            ref={closeRef}
            label={t('player.close')}
            onClick={onClose}
            className="size-10"
          >
            <IconChevronDown className="size-6" />
          </ControlButton>
          <div className="flex gap-1 rounded-full bg-bg-elevated/70 p-1 backdrop-blur">
            {tab('now', t('player.nowPlaying'))}
            {tab('queue', t('player.queue'))}
          </div>
          <span className="size-10" aria-hidden="true" />
        </header>

        {view === 'now' ? (
          <div className="flex flex-1 flex-col justify-center gap-6 overflow-y-auto py-6">
            <CoverRing releaseId={track.release.id} title={track.release.title} />
            <div className="min-w-0 text-center">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-fg">
                {track.title}
              </h2>
              <p className="mt-1 truncate text-fg-muted">
                {artistNames(track.artists)} · {track.release.title}
              </p>
              <div className="mt-2 flex justify-center">
                <QualityTag />
              </div>
              <div className="mt-1 flex justify-center">
                <PlayerError />
              </div>
            </div>
            <ProgressBar />
            <div className="flex justify-center">
              <TransportControls large />
            </div>
            <div className="flex justify-center">
              <VolumeControl />
            </div>
          </div>
        ) : (
          <div className="mt-4 flex-1 overflow-y-auto pb-4">
            <h2 className="mb-2 px-3 text-sm font-semibold tracking-wider text-fg-muted uppercase">
              {t('player.queue')}
            </h2>
            <QueueList />
          </div>
        )}
      </div>
    </div>
  );
}
