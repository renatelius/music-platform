'use client';

import type { ReactNode } from 'react';

import { AppShell } from '../../components/app-shell';
import { RequireAuth } from '../../components/guards';
import { LibraryProvider } from '../../lib/library-context';
import { PlayerProvider } from '../../lib/player-context';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <PlayerProvider>
        <LibraryProvider>
          <AppShell>{children}</AppShell>
        </LibraryProvider>
      </PlayerProvider>
    </RequireAuth>
  );
}
