import type { ReactNode } from 'react';

import { cn } from './cn.js';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-fg-muted',
  accent: 'bg-surface text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
