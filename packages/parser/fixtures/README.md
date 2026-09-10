# Parser fixture corpus

One JSON file per case, grouped by link form matrix row (`BACKLOG.md` section 4). The corpus is data: `test/fixtures.test.ts` picks up every `*.json` file beneath this directory without registration.

Each fixture has:

- `title`: one line description.
- `row`: the matrix row it covers, or `failures`.
- `input`: the link exactly as pasted.
- `expected`: for successes, the full `ParseSuccess` minus `original` and `parserVersion` (both asserted separately). For failures, `ok: false`, the `reason` and any `detail`; the message is asserted non empty but not compared, so wording can improve without touching fixtures.

Anonymisation (section 8): every link uses `contoso`, `SiteA`/`SiteB`, `Lib`, neutral folder and file names and regenerated GUIDs. The single exception is `row1-library-view/worked-example.json`, which the brief publishes.

Adding a case: anonymise the link, write the expected result by hand, watch it fail, change the parser, watch the whole corpus pass, add or update the matrix row. A change to an existing fixture's expected output bumps `PARSER_VERSION`.
