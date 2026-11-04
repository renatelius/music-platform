'use client';

import { useId } from 'react';

import { cn } from './cn.js';

export function LogoMark({ className, title = 'ReMusic' }: { className?: string; title?: string }) {
  const gradientId = `mp-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      viewBox="0 0 32 32"
      role={title === '' ? undefined : 'img'}
      aria-label={title === '' ? undefined : title}
      aria-hidden={title === '' ? true : undefined}
      className={cn('size-8 shrink-0', className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="2"
          x2="30"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#9B85FF" />
          <stop offset="1" stopColor="#FF6B57" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M9 18.5v-3M13 22.5v-11M17 19.5v-6M21 23v-14"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface LogoProps {
  className?: string;
  wordmarkClassName?: string;
  withWordmark?: boolean;
}

export function Logo({ className, wordmarkClassName, withWordmark = true }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark title={withWordmark ? '' : 'ReMusic'} />
      {withWordmark ? (
        <span className={cn('text-[19px] font-semibold tracking-tight text-fg', wordmarkClassName)}>
          <span className="bg-linear-to-r from-(--mp-brand-violet-light) to-(--mp-brand-coral) bg-clip-text text-transparent">
            Re
          </span>
          Music
        </span>
      ) : null}
    </span>
  );
}
