-- Runs once, on first start with an empty data volume.
-- Extensions for the main database.
CREATE EXTENSION IF NOT EXISTS vector;   -- embeddings (recommendations, Phase 5)
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- fuzzy search, typos
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS unaccent; -- accent-insensitive search

-- Separate database for integration tests.
CREATE DATABASE mp_test;
\connect mp_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
