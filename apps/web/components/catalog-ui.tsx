'use client';

import {
  type ArtistRef,
  type ArtistSummary,
  describeFormat,
  type ReleaseSummary,
  type TrackDto,
  type TrackLicense,
  type TrackQuality,
} from '@mp/contracts';
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  cn,
  IconBars,
  IconDisc,
  IconExternal,
  IconPause,
  IconPlay,
  IconShuffle,
  Spinner,
} from '@mp/ui';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { artistNames, countLabel, coverColors, formatDuration, releaseYear } from '../lib/catalog';
import { apiErrorMessage } from '../lib/form-errors';
import { useI18n } from '../lib/i18n-context';
import { isActive, usePlayer, usePlayerState } from '../lib/player-context';
import type { Loadable } from '../lib/use-api';

// ---------------------------------------------------------------- building blocks

/** Generated cover: the test catalog has no artwork. Decorative, hidden from screen readers. */
export function Cover({
  id,
  title,
  round = false,
  className,
  letterClassName = 'text-4xl',
}: {
  id: string;
  title: string;
  round?: boolean;
  className?: string;
  letterClassName?: string;
}) {
  const { from, to } = coverColors(id);
  const letter = Array.from(title.trim())[0]?.toUpperCase() ?? '♪';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden shadow-card select-none',
        round ? 'rounded-full' : 'rounded-2xl',
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className={cn('font-semibold text-white/90', letterClassName)}>{letter}</span>
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 underline-offset-2 hover:text-fg hover:underline',
        className,
      )}
    >
      {children}
      <IconExternal className="size-3" />
      <span className="sr-only">{t('common.newTab')}</span>
    </a>
  );
}

export function ArtistLinks({ artists }: { artists: readonly ArtistRef[] }) {
  return (
    <>
      {artists.map((artist, index) => (
        <Fragment key={artist.id}>
          {index > 0 ? ', ' : null}
          <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
            {artist.name}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

/** Honest quality: the best rendition, never more than the source has. */
export function QualityLabel({ quality }: { quality: TrackQuality }) {
  const { t } = useI18n();
  const label = describeFormat(quality.format);
  const tier = t(`quality.${quality.tier}`);
  if (quality.tier === 'lossy') {
    return (
      <span title={tier} className="hidden text-xs text-fg-subtle sm:inline">
        {label}
      </span>
    );
  }
  return (
    <Badge tone="accent" className="hidden sm:inline-flex">
      <span title={label}>{tier}</span>
    </Badge>
  );
}

export function LicenseLine({ license }: { license: TrackLicense }) {
  const { t } = useI18n();
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-subtle">
      {license.url !== null ? (
        <ExternalLink href={license.url}>{license.name}</ExternalLink>
      ) : (
        <span>{license.name}</span>
      )}
      {license.sourceUrl !== null ? (
        <ExternalLink href={license.sourceUrl}>{t('catalog.source')}</ExternalLink>
      ) : null}
    </p>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle !== undefined ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** «Play» and «Shuffle» for a release, an artist or a list of tracks. */
export function PlayActions({
  tracks,
  shuffle = true,
  size = 'md',
}: {
  tracks: readonly TrackDto[];
  shuffle?: boolean;
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const { player, playTracks } = usePlayer();
  if (tracks.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size={size}
        disabled={player === null}
        icon={<IconPlay className="size-4" />}
        onClick={() => {
          playTracks(tracks, 0, { shuffle: false });
        }}
      >
        {t('player.playAll')}
      </Button>
      {shuffle && tracks.length > 1 ? (
        <Button
          size={size}
          variant="secondary"
          disabled={player === null}
          icon={<IconShuffle className="size-4" />}
          onClick={() => {
            playTracks(tracks, undefined, { shuffle: true });
          }}
        >
          {t('player.shuffleAll')}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- lists

export function TrackList({
  tracks,
  numbered = false,
  showRelease = false,
}: {
  tracks: readonly TrackDto[];
  /** Release page: numbers from the release; elsewhere the position in the list. */
  numbered?: boolean;
  showRelease?: boolean;
}) {
  const { t } = useI18n();
  const { player, playTracks, togglePlay } = usePlayer();
  const state = usePlayerState();
  const currentId = state.current?.track.id ?? null;
  const active = isActive(state);
  return (
    <ol className="flex flex-col">
      {tracks.map((track, index) => {
        const isCurrent = track.id === currentId;
        const label =
          isCurrent && active ? t('player.pause') : t('player.playTrack', { title: track.title });
        return (
          <li
            key={track.id}
            id={`track-${track.id}`}
            aria-current={isCurrent ? 'true' : undefined}
            className={cn(
              'group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface sm:px-3',
              isCurrent && 'bg-surface',
            )}
          >
            <button
              type="button"
              disabled={player === null}
              onClick={() => {
                if (isCurrent) togglePlay();
                else playTracks(tracks, index);
              }}
              aria-label={label}
              title={label}
              className="relative inline-flex size-8 items-center justify-center rounded-full text-sm text-fg-subtle tabular-nums transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <span
                className={cn(
                  'group-focus-within:invisible group-hover:invisible',
                  isCurrent && 'invisible',
                )}
              >
                {numbered ? (track.trackNumber ?? index + 1) : index + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 items-center justify-center',
                  isCurrent
                    ? 'flex text-accent'
                    : 'hidden group-focus-within:flex group-hover:flex',
                )}
              >
                {isCurrent && active ? (
                  <>
                    <IconBars className="size-4 group-hover:hidden" />
                    <IconPause className="hidden size-4 group-hover:block" />
                  </>
                ) : (
                  <IconPlay className="size-4" />
                )}
              </span>
            </button>
            <div className="min-w-0">
              <p
                className={cn(
                  'flex items-center gap-2 font-medium',
                  isCurrent ? 'text-accent' : 'text-fg',
                )}
              >
                <span className="truncate">{track.title}</span>
                {track.explicit ? (
                  <span
                    title={t('catalog.explicit')}
                    className="rounded bg-surface px-1 text-[10px] font-semibold text-fg-muted"
                  >
                    E
                  </span>
                ) : null}
              </p>
              <p className="truncate text-sm text-fg-muted">
                <ArtistLinks artists={track.artists} />
                {showRelease ? (
                  <>
                    {' · '}
                    <Link
                      href={`/release/${track.release.id}`}
                      className="hover:text-fg hover:underline"
                    >
                      {track.release.title}
                    </Link>
                  </>
                ) : null}
              </p>
              <LicenseLine license={track.license} />
            </div>
            <div className="flex flex-col items-end gap-1 pt-0.5">
              <span className="text-sm text-fg-muted tabular-nums">
                {formatDuration(track.durationMs)}
              </span>
              <QualityLabel quality={track.quality} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4';

export function ReleaseGrid({ releases }: { releases: readonly ReleaseSummary[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className={GRID}>
      {releases.map((release) => {
        const year = releaseYear(release.releaseDate);
        const count = countLabel(t, locale, 'tracks', release.trackCount);
        return (
          <li key={release.id} className="min-w-0">
            <Link
              href={`/release/${release.id}`}
              className="group -m-2 flex flex-col gap-3 rounded-2xl p-2 transition-colors hover:bg-surface"
            >
              <Cover
                id={release.id}
                title={release.title}
                className="aspect-square w-full transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{release.title}</p>
                <p className="truncate text-sm text-fg-muted">{artistNames(release.artists)}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {year !== null ? `${year} · ${count}` : count}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ArtistGrid({ artists }: { artists: readonly ArtistSummary[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className={GRID}>
      {artists.map((artist) => (
        <li key={artist.id} className="min-w-0">
          <Link
            href={`/artist/${artist.id}`}
            className="group -m-2 flex flex-col items-center gap-3 rounded-2xl p-2 text-center transition-colors hover:bg-surface"
          >
            <Cover
              id={artist.id}
              title={artist.name}
              round
              className="aspect-square w-full max-w-40 transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <div className="w-full min-w-0">
              <p className="truncate font-medium text-fg">{artist.name}</p>
              <p className="truncate text-xs text-fg-subtle">
                {countLabel(t, locale, 'tracks', artist.trackCount)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Full credit lines: CC BY and BY-SA require them next to the work. */
export function Credits({ tracks }: { tracks: readonly TrackDto[] }) {
  const { t } = useI18n();
  if (tracks.length === 0) return null;
  return (
    <section className="mt-12 rounded-2xl border border-border p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight text-fg">
        {t('catalog.credits.title')}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t('catalog.credits.text')}</p>
      <ul className="mt-4 flex flex-col gap-3">
        {tracks.map((track) => (
          <li key={track.id} className="text-sm">
            <p className="text-fg">{track.license.attribution}</p>
            <LicenseLine license={track.license} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- page states

export function CatalogNotFound() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-surface text-fg-muted">
        <IconDisc className="size-7" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t('catalog.notFound.title')}
        </h1>
        <p className="mt-2 text-fg-muted">{t('catalog.notFound.text')}</p>
      </div>
      <Link href="/" className={buttonClasses('secondary', 'md')}>
        {t('notFound.home')}
      </Link>
    </div>
  );
}

/** Loading, not found and error states around a page's content. */
export function LoadState<T>({
  state,
  children,
}: {
  state: Loadable<T> & { retry: () => void };
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  switch (state.status) {
    case 'ready':
      return <>{children(state.data)}</>;
    case 'notFound':
      return <CatalogNotFound />;
    case 'error':
      return (
        <Alert
          tone="error"
          className="my-8"
          action={
            <Button variant="secondary" size="sm" onClick={state.retry}>
              {t('common.retry')}
            </Button>
          }
        >
          {apiErrorMessage(state.error, t)}
        </Alert>
      );
    case 'loading':
      return (
        <div className="flex justify-center py-20">
          <Spinner className="size-6 text-fg-muted" label={t('common.loading')} />
        </div>
      );
  }
}
