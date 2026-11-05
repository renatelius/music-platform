'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '../lib/i18n-context';
import { useSync, useSyncEvents, useSyncState } from '../lib/sync-context';

const REJECTED_NOTICE_MS = 8000;

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** «No network — changes will be sent later» and refusals of changes made offline. */
export function SyncBanner() {
  const { t } = useI18n();
  const { persistent } = useSync();
  const { pending, offline } = useSyncState();
  const online = useBrowserOnline();
  const [rejected, setRejected] = useState(false);

  useSyncEvents((event) => {
    if (event.kind === 'rejected' && event.entry.op.type !== 'plays') setRejected(true);
  });
  useEffect(() => {
    if (!rejected) return;
    const timer = window.setTimeout(() => {
      setRejected(false);
    }, REJECTED_NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [rejected]);

  const noNetwork = !online || (offline && pending > 0);
  if (!noNetwork && !rejected) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg"
    >
      {noNetwork ? (
        <p>
          {t('sync.offline')}
          {pending > 0 ? ` ${t('sync.pendingCount', { count: pending })}` : ''}
          {!persistent && pending > 0 ? ` ${t('sync.memoryOnly')}` : ''}
        </p>
      ) : null}
      {rejected ? <p className="text-danger">{t('sync.rejected')}</p> : null}
    </div>
  );
}
