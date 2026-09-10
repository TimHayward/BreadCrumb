-- Authenticated validation upgrades (BC-040, invariant 6). A validation is
-- appended alongside the original conversion, never written over it, so the
-- earlier state and values stay visible. The newest row per conversion is
-- the one shown.
CREATE TABLE validations (
  id                  INTEGER PRIMARY KEY,
  conversion_id       INTEGER NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  validated_at        TEXT    NOT NULL,
  previous_state      TEXT    NOT NULL CHECK (previous_state IN ('Derived', 'Inferred', 'Unresolved')),
  graph_item_id       TEXT    NOT NULL,
  drive_id            TEXT,
  site_id             TEXT,
  list_item_unique_id TEXT,
  web_url             TEXT,
  path                TEXT    NOT NULL,
  folder_url          TEXT    NOT NULL,
  file_url            TEXT,
  file_name           TEXT,
  library             TEXT    NOT NULL,
  method_text         TEXT    NOT NULL,
  verified_json       TEXT    NOT NULL
);

CREATE INDEX validations_conversion ON validations (conversion_id, id DESC);
