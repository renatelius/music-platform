'use client';

import { type ReactNode, useId } from 'react';

import { cn } from './cn.js';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** Accessible single choice built on native radio inputs (arrow keys work out of the box). */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-surface p-1">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-200',
                'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent',
                checked ? 'bg-bg-elevated text-fg shadow-card' : 'text-fg-muted hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              {option.icon}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
