'use client';

import {
  Avatar,
  Button,
  cn,
  IconHome,
  IconLibrary,
  IconLogOut,
  type IconProps,
  IconSearch,
  IconUser,
  Logo,
} from '@mp/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ComponentType, type ReactNode, useState } from 'react';

import { useAuth, useSession } from '../lib/auth-context';
import { useI18n } from '../lib/i18n-context';
import { useLibrary } from '../lib/library-context';
import { usePlayerState } from '../lib/player-context';
import { PlayerBar } from './player/player-bar';

const NAV: readonly {
  href: string;
  label: 'nav.home' | 'nav.search' | 'nav.library' | 'nav.account';
  icon: ComponentType<IconProps>;
}[] = [
  { href: '/', label: 'nav.home', icon: IconHome },
  { href: '/search', label: 'nav.search', icon: IconSearch },
  { href: '/library', label: 'nav.library', icon: IconLibrary },
  { href: '/account', label: 'nav.account', icon: IconUser },
];

/** Most recently changed playlists shown in the sidebar. */
const SIDEBAR_PLAYLISTS = 15;

const isActive = (pathname: string, href: string) =>
  href === '/'
    ? pathname === '/'
    : pathname.startsWith(href) || (href === '/library' && pathname.startsWith('/playlist/'));

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const { user } = useSession();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const hasPlayer = usePlayerState().current !== null;
  const { playlists } = useLibrary();

  const signOut = () => {
    setSigningOut(true);
    // The session listener sends the user to the sign-in screen.
    void client.logout();
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh flex-col border-r border-border bg-bg-elevated px-3 py-5 md:flex',
          hasPlayer && 'pb-27',
        )}
      >
        <Link href="/" className="rounded-xl px-3 py-1.5">
          <Logo />
        </Link>
        <nav aria-label={t('nav.main')} className="mt-8 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200',
                  active ? 'bg-surface text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg',
                )}
              >
                <Icon className={cn('size-[18px]', active && 'text-accent')} />
                {t(label)}
              </Link>
            );
          })}
        </nav>
        {/* Playlists in the sidebar (reference 1); the full list is in the library. */}
        {playlists !== null && playlists.length > 0 ? (
          <nav aria-label={t('library.tab.playlists')} className="mt-6 flex min-h-0 flex-col">
            <Link
              href="/library?tab=playlists"
              className="px-3 pb-2 text-xs font-semibold tracking-wider text-fg-subtle uppercase hover:text-fg"
            >
              {t('library.tab.playlists')}
            </Link>
            <ul className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1 [scrollbar-width:thin]">
              {playlists.slice(0, SIDEBAR_PLAYLISTS).map((playlist) => {
                const href = `/playlist/${playlist.id}`;
                const active = pathname === href;
                return (
                  <li key={playlist.id}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block truncate rounded-lg px-3 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-surface text-fg'
                          : 'text-fg-muted hover:bg-surface hover:text-fg',
                      )}
                    >
                      {playlist.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {playlists.length > SIDEBAR_PLAYLISTS ? (
              <Link
                href="/library?tab=playlists"
                className="mt-1 px-3 py-1.5 text-sm text-fg-subtle hover:text-fg"
              >
                {t('library.more')}
              </Link>
            ) : null}
          </nav>
        ) : null}
        <div className="mt-auto flex items-center gap-3 rounded-2xl border border-border p-3">
          <Avatar name={user.displayName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{user.displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            loading={signingOut}
            aria-label={t('nav.signOut')}
            title={t('nav.signOut')}
            icon={signingOut ? undefined : <IconLogOut className="size-[18px]" />}
          />
        </div>
      </aside>

      <div
        className={cn(
          'flex min-h-dvh min-w-0 flex-col',
          hasPlayer ? 'pb-40 md:pb-24' : 'pb-20 md:pb-0',
        )}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg/85 px-5 py-3 backdrop-blur-md md:hidden">
          <Link href="/">
            <Logo />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            loading={signingOut}
            aria-label={t('nav.signOut')}
            icon={signingOut ? undefined : <IconLogOut className="size-[18px]" />}
          />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-8 md:py-12">
          {children}
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-border bg-bg-elevated/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium',
                active ? 'text-accent' : 'text-fg-muted',
              )}
            >
              <Icon className="size-[22px]" />
              {t(label)}
            </Link>
          );
        })}
      </nav>

      <PlayerBar />
    </div>
  );
}
