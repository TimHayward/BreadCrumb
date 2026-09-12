-- Which document a history entry points at (see documentKey in the parser):
-- id:<hex>, path:<host><path> or url:<link>. A derived lookup key used to find
-- a citation's entry; it does not change the recorded lookup (invariant 19).
-- Rows from before this migration are filled in at startup from result_json.
ALTER TABLE conversions ADD COLUMN doc_key TEXT;

CREATE INDEX conversions_doc_key ON conversions (doc_key);
