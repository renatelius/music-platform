'use client';

import { describeFormat } from '@mp/contracts';
import {
  cn,
  IconBack10,
  IconForward10,
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconVolume,
  IconVolumeMute,
  Spinner,
} from '@mp/ui';
import Link from 'next/link';
import { Fragment, type ReactNode, type Ref, useState } from 'react';

import { formatDuration } from '../../lib/catalog';
import { useI18n } from '../../lib/i18n-context';
import { isActive, usePlayer, usePlayerState, usePosition } from '../../lib/player-context';
import { Cover } from '../catalog-ui';

export function ControlButton({
  label,
  onClick,
  children,
  pressed,
  disabled = false,
  className,
  ref,
}: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** Toggle buttons (shuffle, repeat) report their state to screen readers. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
        'disabled:pointer-events-none disabled:opacity-40',
        pressed === true
          ? 'text-accent hover:bg-surface'
          : 'text-fg-muted hover:bg-surface hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PlayPauseButton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n();
  const { togglePlay } = usePlayer();
  const state = usePlayerState();
  const active = isActive(state);
  const waiting = state.status === 'loading' || state.buffering;
  const box = { sm: 'size-10', md: 'size-11', lg: 'size-16' }[size];
  const icon = { sm: 'size-5', md: 'size-5', lg: 'size-7' }[size];
  const label = active ? t('player.pause') : t('player.play');
  return (
    <button
      type="button"
      onClick={togglePlay}
      disabled={state.current === null}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-card',
        'transition-[background-color,transform] duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-50',
        box,
      )}
    >
      {waiting && active ? (
        <Spinner className={icon} />
      ) : active ? (
        <IconPause className={icon} />
      ) : (
        <IconPlay className={cn(icon, 'translate-x-px')} />
      )}
    </button>
  );
}

export function ShuffleButton({
  className,
  icon = 'size-5',
}: {
  className?: string;
  icon?: string;
}) {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  return (
    <ControlButton
      label={t('player.shuffle')}
      pressed={state.shuffle}
      disabled={player === null || state.current === null}
      className={className}
      onClick={() => player?.setShuffle(!state.shuffle)}
    >
      <IconShuffle className={icon} />
    </ControlButton>
  );
}

export function RepeatButton({
  className,
  icon = 'size-5',
}: {
  className?: string;
  icon?: string;
}) {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  return (
    <ControlButton
      label={t(`player.repeat.${state.repeat}`)}
      pressed={state.repeat !== 'off'}
      disabled={player === null || state.current === null}
      className={className}
      onClick={() => player?.cycleRepeat()}
    >
      {state.repeat === 'one' ? (
        <IconRepeatOne className={icon} />
      ) : (
        <IconRepeat className={icon} />
      )}
    </ControlButton>
  );
}

/**
 * Bar: shuffle, previous, play, next, repeat. Full player (`large`): previous, −10 s, play,
 * +10 s, next — 272 px, fits a 320 px phone (B1); shuffle and repeat go to the row below.
 */
export function TransportControls({ large = false }: { large?: boolean }) {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  const none = player === null || state.current === null;
  const icon = large ? 'size-6' : 'size-5';
  const button = large ? 'size-11' : undefined;
  return (
    <div className={cn('flex items-center', large ? 'gap-2' : 'gap-1')}>
      {large ? null : <ShuffleButton />}
      <ControlButton
        label={t('player.previous')}
        disabled={none}
        className={button}
        onClick={() => player?.previous()}
      >
        <IconPrevious className={icon} />
      </ControlButton>
      {large ? (
        <ControlButton
          label={t('player.back10')}
          disabled={none}
          className={button}
          onClick={() => player?.seekBy(-10_000)}
        >
          <IconBack10 className={icon} />
        </ControlButton>
      ) : null}
      <PlayPauseButton size={large ? 'lg' : 'md'} />
      {large ? (
        <ControlButton
          label={t('player.forward10')}
          disabled={none}
          className={button}
          onClick={() => player?.seekBy(10_000)}
        >
          <IconForward10 className={icon} />
        </ControlButton>
      ) : null}
      <ControlButton
        label={t('player.next')}
        disabled={none}
        className={button}
        onClick={() => player?.next()}
      >
        <IconNext className={icon} />
      </ControlButton>
      {large ? null : <RepeatButton />}
    </div>
  );
}

/** Seek slider with elapsed and total time. The position is applied when the drag ends. */
export function ProgressBar({ className }: { className?: string }) {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  const position = usePosition();
  const [drag, setDrag] = useState<number | null>(null);
  const duration = state.current?.track.durationMs ?? 0;
  const value = Math.min(drag ?? position, duration);
  const commit = () => {
    if (drag === null) return;
    player?.seek(drag);
    setDrag(null);
  };
  return (
    <div className={cn('flex w-full items-center gap-3', className)}>
      <span className="w-11 shrink-0 text-right text-xs text-fg-muted tabular-nums">
        {formatDuration(value)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={1000}
        value={value}
        disabled={state.current === null}
        aria-label={t('player.seek')}
        aria-valuetext={t('player.position', {
          position: formatDuration(value),
          duration: formatDuration(duration),
        })}
        onChange={(event) => {
          setDrag(Number(event.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default"
      />
      <span className="w-11 shrink-0 text-xs text-fg-muted tabular-nums">
        {formatDuration(duration)}
      </span>
    </div>
  );
}

export function VolumeControl({ className }: { className?: string }) {
  const { t } = useI18n();
  const { player } = usePlayer();
  const state = usePlayerState();
  const silent = state.muted || state.volume === 0;
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <ControlButton
        label={state.muted ? t('player.unmute') : t('player.mute')}
        onClick={() => player?.setMuted(!state.muted)}
      >
        {silent ? <IconVolumeMute className="size-5" /> : <IconVolume className="size-5" />}
      </ControlButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={state.muted ? 0 : state.volume}
        aria-label={t('player.volume')}
        aria-valuetext={`${String(Math.round((state.muted ? 0 : state.volume) * 100))}%`}
        onChange={(event) => {
          const volume = Number(event.target.value);
          if (state.muted && volume > 0) player?.setMuted(false);
          player?.setVolume(volume);
        }}
        className="h-1.5 w-24 cursor-pointer accent-accent"
      />
    </div>
  );
}

/** Honest label of what is playing right now, e.g. «Opus 128 kbps». */
export function QualityTag({ className }: { className?: string }) {
  const { t } = useI18n();
  const { source } = usePlayerState();
  if (source === null) return null;
  return (
    <span
      title={t(`quality.${source.quality}`)}
      className={cn(
        'rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-fg-muted',
        source.quality !== 'lossy' && 'border-accent text-accent',
        className,
      )}
    >
      {describeFormat(source)}
    </span>
  );
}

export function PlayerError() {
  const { t } = useI18n();
  const { status, error } = usePlayerState();
  if (status !== 'error' || error === null) return null;
  return (
    <p role="alert" className="truncate text-xs text-danger">
      {error === 'unavailable' ? t('player.error.unavailable') : t('player.error.notPlayable')}
    </p>
  );
}

/** Cover, title and artists of the current track, with links. */
export function NowPlaying({ onNavigate }: { onNavigate?: () => void }) {
  const { current } = usePlayerState();
  if (current === null) return null;
  const { track } = current;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Cover
        id={track.release.id}
        title={track.release.title}
        className="size-12 rounded-xl shadow-none"
        letterClassName="text-lg"
      />
      <div className="min-w-0">
        <Link
          href={`/release/${track.release.id}`}
          onClick={onNavigate}
          className="block truncate text-sm font-medium text-fg hover:underline"
        >
          {track.title}
        </Link>
        <p className="truncate text-xs text-fg-muted">
          {track.artists.map((artist, index) => (
            <Fragment key={artist.id}>
              {index > 0 ? ', ' : null}
              <Link
                href={`/artist/${artist.id}`}
                onClick={onNavigate}
                className="hover:text-fg hover:underline"
              >
                {artist.name}
              </Link>
            </Fragment>
          ))}
        </p>
        <PlayerError />
      </div>
    </div>
  );
}
