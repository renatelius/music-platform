import { cn } from './cn.js';

export interface SpinnerProps {
  className?: string;
  /** Accessible label. Without it the spinner is decorative. */
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  const labelled = label !== undefined && label !== '';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-5 animate-spin', className)}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
