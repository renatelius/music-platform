import { z } from 'zod';

/** Entity identifier. All ids are UUIDs (v7 on the server: time-ordered, index-friendly). */
export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO-8601 timestamp with explicit offset, e.g. 2026-11-04T18:00:00+03:00. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

/** Cursor pagination query. `limit` is coerced from query-string values. */
export const PageQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Builds a page schema for a given item schema. */
export function pageOf<T extends z.ZodType>(
  item: T,
): z.ZodObject<{ items: z.ZodArray<T>; nextCursor: z.ZodNullable<z.ZodString> }> {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
