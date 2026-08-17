-- Run once against the Neon database before the first `pnpm db:migrate`.
-- pg_trgm backs the fuzzy/autocomplete index on words.headword.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
