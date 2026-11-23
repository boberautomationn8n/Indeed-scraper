# Verification — 2026-11-23

## Passed

- `npm run build`: TypeScript compilation.
- `npm test`: 17 offline regression tests covering structured/HTML extraction, duplicate IDs, salary currency/period handling, missing data, unsafe application links, date windows, and filter combinations.
- `apify-cli validate-schema .actor/input_schema.json`: official Apify input-schema validator.
- Compiled Actor startup in a fresh local storage directory: initialized Apify and Crawlee, opened the browser, attempted the search, caught the security response, wrote SUMMARY with `status: failed`, and exited nonzero. This verifies failure reporting, not successful collection.

## Live access tests

1. Direct HTTP search: HTTP 403, `Security Check - Indeed.com`, no job markers.
2. Fresh isolated headless Playwright search: HTTP 403, `Blocked - Indeed.com`, zero job cards.
3. Compiled Actor browser run, one keyword/location and a two-job limit: HTTP 403; run failed explicitly with zero accepted jobs.

These browsers used fresh contexts, not the user's Chrome cookies/profile. No security challenge was solved and no paid proxy was enabled.

## Scope and remaining validation

- Browser UI audit covered the US AI automation and New York internship searches plus four job detail panels.
- UK and Poland adapters are experimental; do not advertise them as live-tested.
- A successful Apify cloud build and live cloud collection must be checked separately. Current local access results do not demonstrate working live retrieval.
- Fixture tests cannot guarantee complete recall, selectors surviving future layout changes, or correctness of employer-supplied salaries and dates.
- Authentication, application submission, cross-site deduplication, and CV matching belong to later workflow stages.
