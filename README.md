# Indeed US input form preview

This branch is a form preview only. It does not scrape Indeed, use proxies, submit applications, or return job listings. Starting it writes SETUP_REQUIRED and fails explicitly with FORM_PREVIEW_ONLY.

The form contains the requested US query list, Work arrangement (remote/hybrid), multiple job types, experience labels, readable date windows, USD pay, pay period and result limit. There is no city, state, ZIP code or country input; the intended search market is the United States. An authorized Indeed data source is required before collection can be enabled.

The main branch remains the existing public-feed Actor. Do not treat its Remotive/Arbeitnow output as Indeed data.
