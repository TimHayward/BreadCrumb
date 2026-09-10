-- History is a log of lookups (invariant 19): rows are appended and deleted,
-- never edited. result_json is the authoritative stored result; the other
-- columns are denormalised copies for listing, search and filtering.
CREATE TABLE conversions (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT    NOT NULL,
  source         TEXT    NOT NULL CHECK (source IN ('web', 'extension')),
  input          TEXT    NOT NULL,
  state          TEXT    CHECK (state IN ('Verified', 'Derived', 'Inferred', 'Unresolved')),
  failure_reason TEXT,
  form           TEXT,
  method_text    TEXT,
  host           TEXT,
  tenant         TEXT,
  site_path      TEXT,
  library        TEXT,
  path           TEXT,
  folder_url     TEXT,
  file_url       TEXT,
  file_name      TEXT,
  result_json    TEXT    NOT NULL,
  parser_version TEXT    NOT NULL
);

CREATE INDEX conversions_created_at ON conversions (created_at DESC, id DESC);
