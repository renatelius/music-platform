'use client';

import { SEARCH_QUERY_MAX_LENGTH, SUGGEST_LIMIT_DEFAULT, type Suggestion } from '@mp/contracts';
import { Button, cn, IconSearch } from '@mp/ui';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';

import { useAuth } from '../lib/auth-context';
import { moveActive, normalizeQuery, suggestionHref } from '../lib/catalog';
import { useI18n } from '../lib/i18n-context';
import { Cover } from './catalog-ui';

/** Waiting time after the last key press before asking for suggestions. */
const SUGGEST_DEBOUNCE_MS = 200;

/**
 * Search field with suggestions (WAI-ARIA combobox): arrows move through the list, Enter opens
 * the selected item or submits the search, Escape closes the list. Answers to an older query are
 * dropped, so a slow response never replaces fresher suggestions.
 */
export function SearchBox({
  initialQuery = '',
  onSubmit,
  autoFocus = false,
}: {
  initialQuery?: string;
  onSubmit: (query: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const { client } = useAuth();
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const [value, setValue] = useState(initialQuery);
  const [items, setItems] = useState<{ query: string; list: Suggestion[] }>({
    query: '',
    list: [],
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = normalizeQuery(value);

  useEffect(() => {
    if (query === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.suggest(query, SUGGEST_LIMIT_DEFAULT).then(
        (result) => {
          if (cancelled) return;
          setItems({ query, list: result.items });
          setActive(-1);
        },
        () => {
          // Suggestions are optional: the search itself still works.
          if (!cancelled) setItems({ query, list: [] });
        },
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, client]);

  const list = items.query === query ? items.list : [];
  const expanded = open && query !== '' && list.length > 0;

  const go = (item: Suggestion) => {
    setOpen(false);
    router.push(suggestionHref(item));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => moveActive(current, list.length, delta));
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === 'Enter' && expanded && active >= 0) {
      const item = list[active];
      if (item !== undefined) {
        event.preventDefault();
        go(item);
      }
    }
  };

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
        onSubmit(value);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t('search.label')}
      </label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-subtle" />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && active >= 0 ? `${listId}-${String(active)}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          autoFocus={autoFocus}
          value={value}
          placeholder={t('search.placeholder')}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'h-13 w-full appearance-none rounded-2xl border border-border bg-surface pr-24 pl-12 text-base text-fg',
            'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-200 outline-none',
            'hover:border-border-strong focus:border-accent focus:ring-4 focus:ring-focus',
            '[&::-webkit-search-cancel-button]:hidden',
          )}
        />
        <Button type="submit" size="sm" className="absolute top-1/2 right-2.5 -translate-y-1/2">
          {t('search.submit')}
        </Button>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={t('search.suggestions')}
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-20 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-bg-elevated p-1.5 shadow-pop"
      >
        {list.map((item, index) => (
          <li
            key={`${item.kind}-${item.id}`}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              // Keep focus in the input so the list does not close before the click.
              event.preventDefault();
            }}
            onMouseEnter={() => {
              setActive(index);
            }}
            onClick={() => {
              go(item);
            }}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2',
              index === active && 'bg-surface',
            )}
          >
            <Cover
              id={item.id}
              title={item.title}
              round={item.kind === 'artist'}
              className="size-9 shadow-none"
              letterClassName="text-sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{item.title}</p>
              <p className="truncate text-xs text-fg-muted">
                {t(`search.kind.${item.kind}`)}
                {item.subtitle !== null ? ` · ${item.subtitle}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </form>
  );
}
