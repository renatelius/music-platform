import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Alert } from './alert.js';
import { Avatar } from './avatar.js';
import { Button } from './button.js';
import { cn } from './cn.js';
import { LogoMark } from './logo.js';
import { SegmentedControl } from './segmented-control.js';
import { PasswordField, TextField } from './text-field.js';

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe('Button', () => {
  it('defaults to type=button so it never submits a form by accident', () => {
    expect(html(createElement(Button, null, 'Go'))).toContain('type="button"');
  });

  it('is disabled and busy while loading', () => {
    const markup = html(createElement(Button, { loading: true, type: 'submit' }, 'Save'));
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('animate-spin');
  });
});

describe('TextField', () => {
  it('links the label and announces errors', () => {
    const markup = html(
      createElement(TextField, {
        label: 'Email',
        id: 'email',
        error: 'Invalid',
        hint: 'We never share it',
      }),
    );
    expect(markup).toContain('for="email"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="email-error"');
    expect(markup).toContain('Invalid');
    expect(markup).not.toContain('We never share it');
  });

  it('shows the hint when there is no error', () => {
    const markup = html(createElement(TextField, { label: 'Email', id: 'e', hint: 'Hint' }));
    expect(markup).toContain('aria-describedby="e-hint"');
    expect(markup).not.toContain('aria-invalid');
  });

  it('password field starts hidden with an accessible toggle', () => {
    const markup = html(
      createElement(PasswordField, { label: 'Password', showLabel: 'Show', hideLabel: 'Hide' }),
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('aria-label="Show"');
    expect(markup).toContain('aria-pressed="false"');
  });
});

describe('Alert', () => {
  it('uses role=alert for errors and role=status otherwise', () => {
    expect(html(createElement(Alert, { tone: 'error' }, 'x'))).toContain('role="alert"');
    expect(html(createElement(Alert, { tone: 'success' }, 'x'))).toContain('role="status"');
  });
});

describe('SegmentedControl', () => {
  it('renders native radios with the current value checked', () => {
    const markup = html(
      createElement(SegmentedControl<'a' | 'b'>, {
        label: 'Pick',
        value: 'b',
        onChange: () => undefined,
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      }),
    );
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    const inputs = markup.match(/<input[^>]*>/g) ?? [];
    expect(
      inputs
        .filter((tag) => tag.includes('checked=""'))
        .map((tag) => /value="(\w+)"/.exec(tag)?.[1]),
    ).toEqual(['b']);
    expect(markup).toContain('<legend class="sr-only">Pick</legend>');
  });
});

describe('misc', () => {
  it('builds initials and joins class names', () => {
    expect(html(createElement(Avatar, { name: 'anna maria smith' }))).toContain('>AM<');
    expect(html(createElement(Avatar, { name: '  ' }))).toContain('>?<');
    expect(cn('a', false, undefined, 'b', '')).toBe('a b');
  });

  it('logo gradient ids are valid url() references', () => {
    const markup = html(createElement(LogoMark));
    const id = /id="([^"]+)"/.exec(markup)?.[1] ?? '';
    expect(id).toMatch(/^mp-logo-[a-zA-Z0-9_-]+$/);
    expect(markup).toContain(`url(#${id})`);
  });
});
