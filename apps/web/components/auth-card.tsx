import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="animate-rise">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
      {subtitle !== undefined ? <p className="mt-2 text-fg-muted">{subtitle}</p> : null}
      <div className="mt-8">{children}</div>
      {footer !== undefined ? <div className="mt-8 text-sm text-fg-muted">{footer}</div> : null}
    </div>
  );
}

export const linkClasses = 'font-medium text-accent underline-offset-4 hover:underline';
