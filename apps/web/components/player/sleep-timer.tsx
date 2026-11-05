'use client';

import { SLEEP_MINUTES } from '@mp/player-core';
import { cn, IconMoon } from '@mp/ui';
import { useEffect, useId, useRef, useState } from 'react';

import { formatDuration } from '../../lib/catalog';
import { useI18n } from '../../lib/i18n-context';
import { useSleepTimer } from '../../lib/player-context';
import { ControlButton } from './controls';

/** «Sleep timer: 14:59» / «Sleep timer: end of track» while the timer runs. */
export function SleepTimerStatus() {
  const { t } = useI18n();
  const { mode, remainingMs } = useSleepTimer();
  if (mode === null) return null;
  return (
    <p className="text-xs text-accent tabular-nums" aria-live="off">
      {mode.kind === 'endOfTrack'
        ? t('player.sleep.untilEnd')
        : t('player.sleep.remaining', { time: formatDuration(remainingMs ?? 0) })}
    </p>
  );
}

/** Moon button with a small menu: 15–90 minutes, end of track, off (ТЗ v3 §6.2). */
export function SleepTimerMenu() {
  const { t } = useI18n();
  const { mode, start, cancel } = useSleepTimer();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closes the menu only, not the full-screen player behind it.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const item = (key: string, label: string, checked: boolean, onSelect: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => {
        onSelect();
        setOpen(false);
      }}
      className={cn(
        'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface',
        checked ? 'font-medium text-accent' : 'text-fg',
      )}
    >
      {label}
    </button>
  );

  return (
    <div ref={box} className="relative">
      <ControlButton
        label={t('player.sleep')}
        pressed={mode !== null}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="size-10"
      >
        <IconMoon className="size-5" />
      </ControlButton>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t('player.sleep')}
          className="absolute top-full right-0 z-10 mt-2 w-48 rounded-xl border border-border bg-bg-elevated p-1 shadow-pop"
        >
          {SLEEP_MINUTES.map((minutes) =>
            item(
              String(minutes),
              t('player.sleep.minutes', { minutes }),
              mode?.kind === 'minutes' && mode.minutes === minutes,
              () => {
                start({ kind: 'minutes', minutes });
              },
            ),
          )}
          {item('end', t('player.sleep.endOfTrack'), mode?.kind === 'endOfTrack', () => {
            start({ kind: 'endOfTrack' });
          })}
          {mode !== null ? item('off', t('player.sleep.off'), false, cancel) : null}
        </div>
      ) : null}
    </div>
  );
}
