# M2 boundary evidence

Collected 2026-09-10 from the local Docker Compose stack (`docker compose up`), standing in for the Portainer deployment until BC-003 is rehearsed there.

| Item | File or figure |
|---|---|
| Fixture corpus report: one pass per link form matrix row (20 rows, 44 fixtures) | `fixture-corpus-report.txt` (`vitest run --reporter=verbose test/fixtures.test.ts`) |
| Export from the running stack, filtered by host `contoso` | `export-sample.csv` (`GET /history/export.csv?host=contoso`) |
| Search timing at 5,000 rows (BC-032) | 16 to 35 ms for the first page of four searches; 39 ms with search plus state and source filters (`node scripts/seed-history.mjs`) |
| Search timing at 20,000 rows | 83 to 171 ms; combined filters 158 ms |
| Backup and restore rehearsal (BC-048) | `scripts/backup.sh` while running: copy held 2 conversions. A third conversion was made, the volume destroyed (`docker compose down -v`), the stack restarted empty (0 entries), `scripts/restore.sh` run: history showed 2 entries with the original states. `scripts/restore.sh --check` reported `{"conversions":2,"schemaVersion":1}`. |
| Container image size | 59 MB (`breadcrumb:local`) |
