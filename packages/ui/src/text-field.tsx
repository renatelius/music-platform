'use client';

import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';

import { cn } from './cn.js';
import { IconEye, IconEyeOff } from './icons.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Element inside the input on the right (e.g. a visibility toggle). */
  trailing?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  trailing,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hasError = error !== undefined && error !== '';
  const showHint = !hasError && hint !== undefined && hint !== null;
  const describedBy = hasError ? `${inputId}-error` : showHint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-fg placeholder:text-fg-subtle',
            'transition-[border-color,box-shadow] duration-200 outline-none focus-visible:outline-none',
            'focus:border-accent focus:ring-4 focus:ring-focus',
            hasError ? 'border-danger' : 'border-border hover:border-border-strong',
            trailing !== undefined && 'pr-12',
          )}
          {...rest}
        />
        {trailing !== undefined ? (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        ) : null}
      </div>
      {hasError ? (
        <p id={`${inputId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : showHint ? (
        <p id={`${inputId}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'trailing'> {
  showLabel: string;
  hideLabel: string;
}

/** Password input with a show/hide toggle. */
export function PasswordField({ showLabel, hideLabel, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...rest}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => {
            setVisible((v) => !v);
          }}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {visible ? <IconEyeOff className="size-[18px]" /> : <IconEye className="size-[18px]" />}
        </button>
      }
    />
  );
}
