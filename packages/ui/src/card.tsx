import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from './cn.js';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-bg-elevated p-6 shadow-card', className)}
      {...rest}
    />
  );
}

export interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <Card className={className}>
      <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      {description !== undefined ? (
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </Card>
  );
}
