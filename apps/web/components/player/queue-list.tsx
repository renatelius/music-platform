'use client';

import { cn, IconBars, IconX } from '@mp/ui';

import { artistNames, formatDuration } from '../../lib/catalog';
import { useI18n } from '../../lib/i18n-context';
import { usePlayer, usePlayerState } from '../../lib/player-context';
import { ControlButton } from './controls';

/** The play order: the current track, then what follows. Click to play, × to remove. */
export function QueueList() {
  const { t } = useI18n();
  const { player, jumpTo } = usePlayer();
  const { queue, index } = usePlayerState();
  const upcoming = queue.length - index - 1;
  return (
    <div>
      <ol className="flex flex-col gap-0.5">
        {queue.map((entry, position) => {
          const current = position === index;
          return (
            <li
              key={entry.uid}
              aria-current={current ? 'true' : undefined}
              className={cn(
                'group flex items-center gap-2 rounded-xl pr-1 transition-colors',
                current ? 'bg-surface' : 'hover:bg-surface',
                position < index && 'opacity-60',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  jumpTo(position);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              >
                <span className="w-6 shrink-0 text-right text-xs text-fg-subtle tabular-nums">
                  {current ? <IconBars className="ml-auto size-4 text-accent" /> : position + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      current ? 'text-accent' : 'text-fg',
                    )}
                  >
                    {entry.track.title}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {artistNames(entry.track.artists)}
                  </span>
                </span>
                <span className="text-xs text-fg-muted tabular-nums">
                  {formatDuration(entry.track.durationMs)}
                </span>
              </button>
              {current ? (
                <span className="size-9 shrink-0" />
              ) : (
                <ControlButton
                  label={t('player.remove')}
                  onClick={() => player?.remove(entry.uid)}
                  className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <IconX className="size-4" />
                </ControlButton>
              )}
            </li>
          );
        })}
      </ol>
      {upcoming <= 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t('player.queueEmpty')}</p>
      ) : null}
    </div>
  );
}
