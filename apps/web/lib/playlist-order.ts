// Moving a playlist item: the API wants the item it should follow (`after`).

/**
 * Where the item at `from` lands when it ends up at position `to` of the new order, as the
 * API's `after` (null = to the start). Undefined when nothing moves.
 */
export function moveTargetTo(
  items: readonly { itemId: string }[],
  from: number,
  to: number,
): string | null | undefined {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return undefined;
  }
  const rest = items.filter((_, index) => index !== from);
  return to === 0 ? null : (rest[to - 1]?.itemId ?? null);
}

/** The same move on the local list. */
export function moveLocallyTo<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** One step up (-1) or down (1). */
export function moveTarget(
  items: readonly { itemId: string }[],
  index: number,
  direction: -1 | 1,
): string | null | undefined {
  return moveTargetTo(items, index, index + direction);
}

export function moveLocally<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  return moveLocallyTo(items, index, index + direction);
}
