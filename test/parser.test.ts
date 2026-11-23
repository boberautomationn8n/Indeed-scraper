import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJob, htmlText, parseSalary, classifyWorkplace } from '../src/extract.js';
import { extractSearch, assertPageAccessible, searchRequests } from '../src/search.js';
import { parseInput } from '../src/input.js';
import { evaluateJob } from '../src/filter.js';
import type { JobSeed } from '../src/types.js';

const now = new Date('2026-11-23T12:00:00Z');
const seed: JobSeed = { id: '1234567890abcdef', url: 'https://www.indeed.com/viewjob?jk=1234567890abcdef', title: 'AI Engineering Intern', company: 'Example Ltd', location: 'Remote in Boston, MA', postedText: null, query: 'AI intern', searchLocation: '' };
function page(overrides = {}, extra = '') {
    return `<html><head><script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'JobPosting', title: seed.title,
        url: seed.url, description: '<p>Build and test AI workflows.</p><p>Location: US (remote)</p>',
        hiringOrganization: { name: 'Example Ltd' }, employmentType: ['FULL_TIME', 'INTERN'],
        datePosted: '2026-11-23T08:00:00Z', jobLocationType: 'TELECOMMUTE',
        applicantLocationRequirements: [{ '@type': 'Country', name: 'United States' }],
        baseSalary: { currency: 'USD', value: { minValue: 25, maxValue: 35, unitText: 'HOUR' } },
        ...overrides,
    })}</script></head><body>${extra}</body></html>`;
}
const config = (overrides = {}) => parseInput({ jobTitles: ['AI intern'], ...overrides });

test('JobPosting metadata produces a standard job without fabricating Easy Apply', () => {
    const job = extractJob(page({ directApply: true }), seed, 'us', now);
    assert.equal(job.listing_key, 'indeed:1234567890abcdef');
    assert.equal(job.company_name, 'Example Ltd');
    assert.deepEqual(job.employment_types, ['full-time', 'internship']);
    assert.equal(job.seniority, 'entry');
    assert.equal(job.workplace_type, 'remote');
    assert.equal(job.remote_restrictions_text, 'United States');
    assert.equal(job.salary_min, 25);
    assert.equal(job.salary_max, 35);
    assert.equal(job.salary_period, 'HOUR');
    assert.equal(job.easy_apply, null);
    assert.equal(job.posted_at_precision, 'datetime');
    assert.match(job.description_text, /Build and test/);
});

test('current rendered layout supports explicit onsite and Indeed application links', () => {
    const html = `<div data-testid="viewjob-main-content">
      <h5 data-testid="vj-job-title">Software Developer Intern</h5>
      <div data-testid="company-info-metadata"><a>Example Ltd</a></div>
      <div data-testid="structured-job-summary"><div aria-label="$18 to $22 a year">$18 - $22 a year</div><div>Part-time, Full-time</div></div>
      <a data-testid="viewjob-apply" href="https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?id=example">Apply with Indeed</a>
      <div class="simple-job-description-html"><style>body { bad: data }</style><p>Learn programming.</p><p>Work Location: In person</p></div></div>`;
    const job = extractJob(html, { ...seed, location: 'New York, NY' }, 'us', now);
    assert.equal(job.workplace_type, 'onsite');
    assert.equal(job.easy_apply, true);
    assert.deepEqual(job.employment_types, ['full-time', 'part-time', 'internship']);
    assert.equal(job.salary_period, 'YEAR');
    assert.equal(job.salary_max, 22);
    assert.ok(job.quality_flags.includes('salary_unusually_low_for_year'));
    assert.doesNotMatch(job.description_text, /bad: data/);
});

test('company-site links remain redirects and do not trigger Easy Apply', () => {
    const job = extractJob(page({}, '<a data-testid="viewjob-apply" href="/onboarding?continue=example">Apply on company site</a>'), seed, 'us', now);
    assert.equal(job.easy_apply, false);
    assert.equal(job.application_method, 'external');
    assert.equal(job.apply_url_is_redirect, true);
});

test('unsafe application URLs are discarded', () => {
    assert.equal(extractJob(page({}, '<a data-testid="viewjob-apply" href="javascript:alert(1)">Apply</a>'), seed, 'us', now).apply_url, null);
});

test('unknown workplace and mid-level stay unknown without role-specific evidence', () => {
    const job = extractJob(page({ title: 'Software Engineer', jobLocationType: undefined, description: '<p>Work with senior developers and remote clients.</p>' }), { ...seed, title: 'Software Engineer', location: 'Boston, MA' }, 'us', now);
    assert.equal(job.workplace_type, 'unknown');
    assert.equal(job.seniority, 'unknown');
    assert.equal(classifyWorkplace('Hybrid work in Boston', '', '', {}).type, 'hybrid');
    assert.equal(classifyWorkplace(null, '', 'Work Location: Not remote', {}).type, 'onsite');
});

test('salary parser preserves period, currency, and Polish number formatting', () => {
    assert.deepEqual(parseSalary('$100,000 - $125,000 a year', undefined, 'us'), { salary_min: 100000, salary_max: 125000, salary_currency: 'USD', salary_period: 'YEAR', flags: [] });
    const polish = parseSalary('6 000 - 8 000 zł miesięcznie', undefined, 'pl');
    assert.equal(polish.salary_min, 6000);
    assert.equal(polish.salary_max, 8000);
    assert.equal(polish.salary_currency, 'PLN');
    assert.equal(polish.salary_period, 'MONTH');
    assert.equal(parseSalary('£70k a year', undefined, 'gb').salary_min, 70000);
});

test('filtering unions choices within a category and intersects categories', () => {
    const job = extractJob(page({}, '<a data-testid="viewjob-apply" href="https://smartapply.indeed.com/apply">Apply with Indeed</a>'), seed, 'us', now);
    assert.deepEqual(evaluateJob(job, config({ workplaceTypes: ['hybrid', 'remote'], jobTypes: ['internship'], experienceLevels: ['entry'], easyApplyOnly: true, datePosted: '1', minimumSalary: 30, salaryPeriod: 'HOUR' }), now), []);
    assert.deepEqual(evaluateJob(job, config({ workplaceTypes: ['onsite'], minimumSalary: 40, salaryPeriod: 'HOUR' }), now), ['workplace', 'salary_below_minimum']);
});

test('salary periods are not silently converted, and unknown policy is explicit', () => {
    const job = extractJob(page(), seed, 'us', now);
    assert.deepEqual(evaluateJob(job, config({ minimumSalary: 50000, salaryPeriod: 'YEAR', includeUnknownSalary: false }), now), ['salary_not_comparable']);
    assert.deepEqual(evaluateJob(job, config({ minimumSalary: 50000, salaryPeriod: 'YEAR', includeUnknownSalary: true }), now), []);
});

test('24-hour date filter does not silently become a 48-hour filter', () => {
    const job = extractJob(page({ datePosted: '2026-11-22T10:00:00Z' }), seed, 'us', now);
    assert.deepEqual(evaluateJob(job, config({ datePosted: '1' }), now), ['posted_date']);
});

test('missing dates differ from old dates and follow unknown policy', () => {
    const job = extractJob(page({ datePosted: undefined }), seed, 'us', now);
    assert.deepEqual(evaluateJob(job, config({ datePosted: '7' }), now), ['unknown_posted_date']);
    assert.deepEqual(evaluateJob(job, config({ datePosted: '7', includeUnknownMetadata: true }), now), []);
});

test('expired jobs are rejected even with no selected filters', () => {
    const job = extractJob(page({ validThrough: '2026-11-20' }), seed, 'us', now);
    assert.deepEqual(evaluateJob(job, config(), now), ['expired']);
});

test('relative dates with a plus sign remain unknown rather than fabricated', () => {
    const job = extractJob(page({ datePosted: undefined }), { ...seed, postedText: 'Posted 30+ days ago' }, 'us', now);
    assert.equal(job.posted_at, null);
});

test('search parsing deduplicates job IDs and follows a safe next-page link', () => {
    const html = `<ul><li><a data-jk="1234567890abcdef">AI Intern</a><span data-testid="company-name">Example Ltd</span><div data-testid="text-location">New York</div></li><li><a data-jk="1234567890abcdef">AI Intern</a></li></ul><a aria-label="Next Page" href="/jobs?q=AI+intern&amp;l=NY&amp;start=10">Next</a>`;
    const result = extractSearch(html, 'https://www.indeed.com/jobs?q=AI+intern&l=NY', 'us', 'AI intern', 'NY');
    assert.equal(result.seeds.length, 1);
    assert.equal(result.seeds[0]!.company, 'Example Ltd');
    assert.match(result.seeds[0]!.url, /viewjob\?jk=1234567890abcdef/);
    assert.match(result.next!, /start=10/);
    const bad = extractSearch(html.replace('/jobs?q=AI+intern&amp;l=NY&amp;start=10', 'https://example.com/jobs?q=AI+intern&amp;l=NY'), 'https://www.indeed.com/jobs?q=AI+intern&l=NY', 'us', 'AI intern', 'NY');
    assert.equal(bad.next, null);
});

test('security pages and layout changes never become successful empty results', () => {
    assert.throws(() => assertPageAccessible('<title>Security Check - Indeed.com</title>', 403), /ACCESS_BLOCKED/);
    assert.doesNotThrow(() => assertPageAccessible('<title>Jobs</title><footer>This site is protected by reCAPTCHA</footer>'));
    assert.throws(() => extractSearch('<body>Something changed</body>', seed.url, 'us', 'AI', ''), /SEARCH_LAYOUT_CHANGED/);
    assert.equal(extractSearch('<body>No jobs found</body>', seed.url, 'us', 'AI', '').explicitEmpty, true);
    assert.throws(() => extractJob('<body>No details</body>', seed, 'us', now), /DETAIL_LAYOUT_CHANGED/);
});

test('market selection changes the host, and searches form a title/location product', () => {
    const searches = searchRequests(config({ country: 'pl', jobTitles: ['AI engineer', 'AI intern'], locations: ['Warsaw', 'Krakow'] }));
    assert.equal(searches.length, 4);
    assert.ok(searches.every(value => new URL(value.url).hostname === 'pl.indeed.com'));
    assert.equal(new URL(searches[0]!.url).searchParams.get('q'), 'AI engineer');
});

test('invalid input and contradictory limits fail before any crawl', () => {
    assert.throws(() => config({ country: 'unknown' }));
    assert.throws(() => config({ jobTitles: [] }));
    assert.throws(() => config({ maxResults: 50, maxCandidates: 10 }), /maxCandidates/);
    assert.throws(() => config({ unexpectedField: true }));
});

test('HTML conversion keeps paragraph boundaries without executing content', () => {
    assert.equal(htmlText('<p>One</p><p>Two</p><script>throw Error()</script><style>p{}</style>'), 'One\nTwo');
});
