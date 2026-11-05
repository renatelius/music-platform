-- Custom migration (no schema.ts change): catalog search, ADR-018.
-- mp_search_norm: lower case without accents (é -> e, ё -> е). unaccent() itself is not IMMUTABLE
-- (it depends on search_path), so it is wrapped with an explicit dictionary to be usable in indexes.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE OR REPLACE FUNCTION mp_search_norm(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artists_name_search_idx" ON "artists" USING gin (mp_search_norm("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_title_search_idx" ON "releases" USING gin (mp_search_norm("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_title_search_idx" ON "tracks" USING gin (mp_search_norm("title") gin_trgm_ops);
