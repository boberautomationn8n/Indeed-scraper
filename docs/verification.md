# Verification — public API replacement
Date: 2026-11-23

## Diagnosis
The supplied Apify run log failed at page.goto with ERR_EMPTY_RESPONSE before HTML parsing. Prior direct probes also received 403. Altering scrolling or selectors cannot repair denied page access. The user selected authorized feeds rather than direct Indeed collection without permission.

## Research
Reviewed the public data-scrape/apify-indeed-scraper Python implementation and Eben001/IndeedJobScraper Selenium utilities. Both depend on access to Indeed pages; copying those architectures would not resolve the underlying access/permission issue. No third-party code was copied.

Official sources:
- https://www.indeed.com/legal?co=US&hl=en
- https://www.indeed.com/robots.txt
- https://www.arbeitnow.com/blog/job-board-api
- https://www.arbeitnow.com/terms
- https://github.com/remotive-com/remote-jobs-api
- https://docs.apify.com/actors/development/actor-definition/dockerfile

## Checks
Both documented public API endpoints returned HTTP 200 in live local probes. The first Arbeitnow page returned 300 jobs; the Remotive public feed returned 15 jobs. These counts describe the probe, not fixed provider coverage. The feed payloads are kept locally under ignored tmp/feed-probe for inspection, not committed.

Automated tests cover normalization, attribution, escaped HTML, unknown metadata, keywords/location, salary comparison, date windows, six-hour caching, HTTP/malformed responses, bounded pagination/deduplication and visible partial failures. Cloud verification is recorded after deployment.

Local compiled Actor: succeeded, four feed pages, 915 unique jobs inspected, 67 title matches for AI OR automation, ten saved, zero source errors. The initial local storage environment setting was corrected to CRAWLEE_STORAGE_DIR. Live data revealed Arbeitnow country-domain links; the adapter and regression test now support those documented domains.

## Deployment result
14 automated tests passed; TypeScript checks and build passed; Apify official input-schema validation passed; npm production audit reported zero vulnerabilities. Removed 166 installed packages.

Implementation commit: 529b408, pushed to GitHub main. Apify automatic build 0.0.4 succeeded in 15 seconds. Cloud run JTVfU6L8ymKWjwALq saved ten results in six seconds. Follow-up run VvipZWYL0doFQbUuE succeeded in two seconds: 915 inspected, 67 keyword matches, 50 saved, four cached pages, zero source errors. The second run confirmed persistent caching without additional feed requests.

Actor display name is now Public Job Research; its unique name and GitHub repository retain Indeed-scraper for continuity. Saved input searches AI OR automation in titles, across both feeds, without company or location restrictions, with three Arbeitnow pages and a fifty-result limit.

Results are keyword matches, not CV-based recommendations. Salary metadata is sparse, source-specific duplicates with different IDs/URLs can remain, and remote eligibility requires downstream review.
