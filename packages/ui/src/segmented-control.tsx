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

/**
 * Accessible single choice built on native radio inputs (arrow keys work out of the box).
 * On phones the options share the full width equally and icons are hidden, so three long
 * labels (e.g. «Как в системе / Светлая / Тёмная») stay on one row instead of wrapping.
 */
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
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface p-1 sm:inline-flex sm:flex-wrap">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-center text-sm leading-tight font-medium transition-colors duration-200',
                'sm:h-8 sm:px-3 sm:py-0',
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
              {option.icon !== undefined ? (
                <span className="hidden shrink-0 sm:inline-flex">{option.icon}</span>
              ) : null}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
