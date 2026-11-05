/** Elements a keyboard user can reach with Tab. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should go inside a modal: wraps from the last element to the first and back (B2,
 * docs/qa/I6B_QA_2026-11-05.md). Returns null when the browser can move focus by itself.
 * `current` is -1 when focus is outside the dialog.
 */
export function wrapFocusIndex(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current === -1) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return null;
}

/** Keeps Tab and Shift+Tab inside `container`. Call from a keydown handler. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
  const active = document.activeElement;
  const current = items.findIndex((element) => element === active);
  const target = wrapFocusIndex(items.length, current, event.shiftKey);
  if (target === null) return;
  event.preventDefault();
  items[target]?.focus();
}
