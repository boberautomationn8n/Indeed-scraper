# Public Job Research — Apify Actor

Search jobs across employers without maintaining a company list. The repository and existing Actor URL retain their original Indeed name; version 0.2 uses documented public APIs, **not Indeed**.

## Run
Build from this GitHub repository in Apify, then use:

```json
{
  "sources": ["arbeitnow", "remotive"],
  "jobTitles": ["AI", "automation"],
  "locations": [],
  "maxResults": 50,
  "maxPages": 3
}
```

Each keyword entry is an alternative; every whole word inside an entry must match. By default only titles are searched. Enable `searchInDescription` to broaden matching. Location is a case-insensitive text filter, not a country/radius search or work-authorization check. Leave it empty for unrestricted location text; review remote geographic restrictions downstream.

Optional filters: remote/hybrid/onsite, job types, explicit experience levels, feed publication date and minimum salary. Multiple values within a filter are alternatives; different filters must all pass. Unknown metadata is excluded when its filter is active unless `includeUnknownMetadata` is enabled. Salary can only be compared when currency and period are explicit and equal to the selected values. `includeUnknownSalary` defaults to true. No currency conversion or annualization is performed.

## Simple architecture
`Input → public API feeds → normalize → filter → deduplicate → Apify dataset`

- `src/input.ts`: validate settings.
- `src/extract.ts`: map both feed formats to the same job fields and plain descriptions.
- `src/filter.ts`: apply preferences locally.
- `src/research.ts`: sequential bounded API requests, six-hour persistent cache, deduplication, newest-first output and summary.
- `src/main.ts`: Apify input/storage wiring.

No browser, scrolling, proxies, CAPTCHA handling, hidden endpoints or per-job detail requests. Cheerio only cleans descriptions already provided by the APIs; Node fetch retrieves JSON. Apify SDK handles datasets and storage.

Feeds are cached in the named key-value store `job-research-public-feed-cache` for six hours, including across runs. Avoid concurrent runs; one Actor instance is sufficient. Each run refilters cached data using its own settings. Provider errors stop that source without retries; available results and SUMMARY are saved, and the run fails visibly if coverage is incomplete. Zero matches on a successful run can mean restrictive filters or limited coverage.

## Coverage and source conditions
- [Arbeitnow official API announcement](https://www.arbeitnow.com/blog/job-board-api): free API across employers, primarily Germany/Europe. Pages contain recent postings; maxPages limits coverage. Its API has no structured salary field. Preserve source links and attribution, and follow [Arbeitnow terms](https://www.arbeitnow.com/terms). This Actor is for personal job research, not republishing the feed.
- [Remotive official API documentation and conditions](https://github.com/remotive-com/remote-jobs-api): a limited public remote-job feed delayed by 24 hours. Preserve Remotive attribution and original listing links. Do not repost its jobs to third-party job boards or gate access behind signup/email collection. Documentation advises at most four fetches a day; the six-hour cache reduces repeat requests. The API's free coverage is much smaller than its full service.
- These sources do not reproduce Indeed's inventory or guarantee every relevant vacancy. Onsite/hybrid are unknown unless explicitly labelled. Seniority is based on explicit title/feed labels. Dates refer to feed publication and may differ from the employer's original date. Remotive timestamps lack a documented timezone, so only the calendar date is retained.
- Apply links and Easy Apply are not supplied by these feeds. `apply_url` and `easy_apply` are null; `job_url` opens the original source listing. This Actor does not submit applications.

## n8n
Run this Actor (or a saved Task), retrieve its dataset items, then Merge / Append with the normalized LinkedIn and other results. Shared fields include `listing_key`, `title`, `company_name`, `location_text`, `description_text`, `job_url`, `source_name`, `employment_types`, `salary_*`, and `posted_at`. Keep attribution through later nodes. Deduplicate within this Actor by source ID and exact listing URL; n8n should persist already-seen keys across runs. Cross-board duplicates with different URLs still need downstream comparison.

## Development
Node.js 24 recommended.
```text
npm ci --ignore-scripts
npm run check
npm test
npm run build
node scripts/generate-schemas.mjs
```
GitHub Actions checks types, tests and compilation. GitHub commits trigger the connected Apify build. Replace old Indeed input with the JSON above before running version 0.2. The Apify dataset contains jobs; the default key-value store's SUMMARY contains counts, filtering reasons, cache hits and errors.

The previous direct Indeed crawler failed before parsing with connection errors/HTTP 403. Its browser/queue/proxy implementation was removed after the user selected public feeds instead of collecting Indeed data without permission.
