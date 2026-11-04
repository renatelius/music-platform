import type { ReactNode } from 'react';

import { cn } from './cn.js';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<AlertTone, string> = {
  info: 'border-border bg-surface text-fg',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  error: 'border-transparent bg-danger-soft text-danger',
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Errors are announced immediately (role=alert), other tones politely (role=status). */
export function Alert({ tone = 'info', title, children, action, icon, className }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        TONES[tone],
        className,
      )}
    >
      {icon !== undefined ? <span className="mt-0.5">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {title !== undefined ? <p className="font-semibold">{title}</p> : null}
        {children !== undefined ? (
          <div className={cn(title !== undefined && 'mt-0.5 opacity-90')}>{children}</div>
        ) : null}
      </div>
      {action !== undefined ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
