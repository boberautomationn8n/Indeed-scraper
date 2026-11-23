# Indeed Job Research Actor

An Apify Actor prototype written in TypeScript. Search multiple job keywords and locations, read full job descriptions, apply explicit preferences, deduplicate Indeed job IDs within the run, and save one standard record per matching job. It does not submit applications.

## Current verification status

- US Indeed search filters and four job detail panels were inspected in a normal browser on 2026-11-23.
- TypeScript compilation and fixture-based extraction/filtering tests pass.
- A fresh direct HTTP request received **403 Security Check**.
- A fresh isolated Playwright browser also received **403 Blocked** with zero job cards.
- Therefore, **live job collection is not yet validated**. A successful build is not proof of successful scraping. Run a small test in your Apify environment and inspect its log and SUMMARY. The Actor deliberately fails on security blocks and unknown layouts instead of reporting a successful empty result. It does not solve challenges or reuse your logged-in browser profile.
- US is the inspected market. UK and Poland are selectable **experimental adapters**, not verified country support. Local terminology and metadata may require parser updates.

## Architecture

```text
Apify input form / saved Task
  -> validate input and select country host
  -> separate search for each keyword x location
  -> discover job IDs and follow visible pagination links
  -> skip duplicate Indeed job IDs
  -> load full job detail pages
  -> read JobPosting JSON-LD and/or public HTML
  -> normalize fields and check preferences
  -> default dataset: matching jobs
  -> key-value store SUMMARY: counts, limits, failures
```

The code lives on GitHub. Apify pulls the repository and builds the Docker image. n8n can run the Actor with input JSON, or run a saved Apify Task without repeating its saved input.

| File | Responsibility |
| --- | --- |
| `src/input.ts` | Validated input and country configuration |
| `src/search.ts` | Search URLs, job discovery, safe pagination, blocked-page detection |
| `src/extract.ts` | JobPosting/HTML extraction and normalization |
| `src/filter.ts` | Preference checks, unknown-value handling |
| `src/crawler.ts` | Browser/HTTP retrieval, queues, limits, deduplication, run summary |
| `src/main.ts` | Apify lifecycle and dataset/storage integration |
| `.actor/` | Apify manifest and input/dataset/output schemas |
| `test/parser.test.ts` | Offline regression tests, not a live scraping certification |

## Input

```json
{
  "country": "us",
  "jobTitles": ["AI automation engineer", "AI automation intern"],
  "locations": ["New York, NY"],
  "radius": 25,
  "workplaceTypes": ["remote", "hybrid"],
  "jobTypes": ["full-time", "internship"],
  "experienceLevels": ["entry"],
  "easyApplyOnly": false,
  "datePosted": "any",
  "sortBy": "date",
  "minimumSalary": 25,
  "salaryCurrency": "USD",
  "salaryPeriod": "HOUR",
  "includeUnknownSalary": true,
  "includeUnknownMetadata": false,
  "maxResults": 20,
  "maxCandidates": 100,
  "maxPagesPerSearch": 3,
  "retrievalMode": "browser"
}
```

For the first live test, use only one keyword, `maxResults: 2`, `maxCandidates: 2`, `maxPagesPerSearch: 1`, and leave preference arrays empty. This separates access/extraction problems from restrictive filters.

- Country selects a market: `www.indeed.com`, `uk.indeed.com`, or `pl.indeed.com`. It is not a translation switch. Radius units are miles in US/UK and km in Poland; the site may adjust its supported distance values.
- Leave `locations` empty to omit the city restriction, within the selected market. This is not a worldwide job search.
- A keyword entry is an Indeed keyword search, not a guaranteed exact-title match. Titles are independent searches; selected values within one preference category mean OR, and separate categories mean AND.
- Empty preference arrays and `datePosted: "any"` mean no restriction in that category.
- **Version 0.1 applies work arrangement, job type, experience, salary, application-method, and posting-date preferences after fetching job details.** It does not guess undocumented native filter codes. This can inspect more candidates and miss matches beyond the configured page/candidate budgets. Date sorting and location/radius are sent to search. Native prefilters can be added after validation.
- Unknown work arrangement, job types, experience, and dates fail their selected filters unless `includeUnknownMetadata` is true. Easy Apply only always requires positive evidence.
- Seniority is a conservative classification from the title/structured experience, with the evidence returned. It is not a claim that Indeed assigned that experience category. Unlabelled roles are not assumed mid-level.
- Onsite requires explicit wording; a missing remote label is not onsite evidence. Remote does not establish eligibility to work from a different country. Keep full descriptions and `remote_restrictions_text` for the later CV matcher.
- Minimum salary compares the upper bound of the advertised range, or the single stated amount. Only matching currency AND period are compared; no exchange-rate or hourly/yearly conversion is performed. Unknown/non-comparable salaries follow `includeUnknownSalary`.
- Original salary text is retained. Questionable yearly amounts are flagged, not silently reinterpreted as hourly amounts.
- Dates use metadata when available. Calendar dates and rounded relative labels carry a precision field. No extra day is silently added to the chosen time window; date-only values may conservatively exclude boundary cases.
- Browser mode is the default because the HTTP probe was blocked; it is **not** a promise to bypass a block. HTTP/Cheerio remains available for accessible environments.
- Proxy use is off by default. You may supply `proxyConfiguration` through Apify, including authorized proxy URLs or Apify proxy settings. Enabling paid proxy services may incur separate charges. Never put credentials in the repository.

## Output

Each dataset item contains:

- `source`, `source_job_id`, `listing_key`, `country`, `schema_version`
- `title`, `company_name`, `job_url`
- `apply_url`, `application_method`, `easy_apply`, `apply_url_is_redirect`
- `location_text`, `workplace_type`, `workplace_evidence`, `remote_restrictions_text`
- `employment_types` (array), `seniority`, `seniority_evidence`
- `salary_text`, `salary_min`, `salary_max`, `salary_currency`, `salary_period`
- `description_text`, `posted_at`, `posted_at_precision`, `posted_text`, `scraped_at`
- `search_query`, `search_location`, `quality_flags`

Missing scalar information is `null` or an explicit `unknown` category, not an invented value. Missing lists are `[]`. Description text is capped at 200,000 characters, with a flag if truncated.

Application links may be redirects or require login/onboarding and may include transient tracking parameters. They are never used for deduplication. `JobPosting.directApply` alone is not treated as proof of Indeed Easy Apply. This Actor does not open application forms.

Read `SUMMARY` after each run. `limited` means a configured cap was reached, not that all jobs were exhausted. Any failed search/detail request makes the run fail, even if partial dataset items were already written. Rejection-reason counts may exceed the rejected-job count because a job can fail several preferences. Limits bound volume; they do not guarantee complete recall.

Deduplication is within one run by stable Indeed job key. Store `listing_key` and application status in an n8n Data Table or database for history across runs. Cross-board deduplication needs separate employer/requisition matching.

## Develop and test

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
```

The Docker image supplies Chromium. Local runs need an installed Playwright browser. Put input in `storage/key_value_stores/default/INPUT.json` (not committed), then run `npm start`. Local Crawlee storage is scratch space; use a fresh storage directory for independent test runs.

`scripts/probe.mjs` and `scripts/browser-probe.mjs` make one public search request to diagnose access. Their HTML outputs go to ignored `tmp/`. They do not use user browser cookies. To regenerate the committed Actor schemas after editing their generator, run `node scripts/generate-schemas.mjs`.

The lockfile and npm overrides pin patched `basic-ftp` and `minimatch` transitive releases. The production dependency audit was clean on 2026-11-23. Recheck it when updating packages.

## Deploy from GitHub to Apify

1. Create an Actor using **Git repository** as its source.
2. Set the repository URL to `https://github.com/boberautomationn8n/Indeed-scraper.git` and use the `main` branch.
3. Apify reads `.actor/actor.json` and the Dockerfile, installs the locked dependencies, and compiles TypeScript.
4. Build, then run the small access test described above. Check the dataset AND SUMMARY; a security block is a failed access test.
5. When retrieval is verified, set your preferences and **Save as a new task**.
6. In n8n select Apify -> **Run task and get dataset** and choose that task. Keep one job per n8n item and merge it with other normalized sources using Append.

Source changes require a new Apify build. Task input changes do not require rebuilding the code. Automatic rebuilds on GitHub push require the separate Apify GitHub integration to be configured.

## References

- [Indeed country/language directory](https://uk.indeed.com/countries)
- [Indeed search filters](https://www.indeed.com/help/job-seekers/articles/204488950-improving-your-job-searches-tips-and-help?co=US&hl=en)
- [Apify Git source deployment](https://docs.apify.com/actors/development/deployment/source-types)
- [Crawlee CheerioCrawler](https://crawlee.dev/js/api/cheerio-crawler/class/CheerioCrawler)
- [Schema.org JobPosting](https://schema.org/JobPosting)
