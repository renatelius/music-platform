import { cn } from './cn.js';

/** Initials on the brand gradient. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white',
        'bg-linear-to-br from-(--mp-brand-violet) to-(--mp-brand-coral)',
        className,
      )}
    >
      {initials}
    </span>
  );
}
