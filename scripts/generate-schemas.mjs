import { mkdir, writeFile } from 'node:fs/promises';
const choice = (title, description, values, labels, defaultValue) => ({ title, description, type: 'string', editor: 'select', enum: values, enumTitles: labels, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const multiple = (title, description, values, labels) => ({ title, description, type: 'array', editor: 'select', items: { type: 'string', enum: values, enumTitles: labels }, default: [] });
const integer = (title, description, defaultValue, minimum, maximum) => ({ title, description, type: 'integer', editor: 'number', default: defaultValue, minimum, maximum });
const boolean = (title, description, defaultValue) => ({ title, description, type: 'boolean', default: defaultValue });
const input = {
    title: 'Indeed Job Research', type: 'object', schemaVersion: 1,
    description: 'Search Indeed, read full job descriptions, apply your preferences, and return one standard record per job. Country selects the market, not just the language. UK and Poland adapters are experimental. Security challenges are reported as failures. No applications are submitted.',
    additionalProperties: false,
    properties: {
        country: { ...choice('Country / job market', 'US is the inspected market. UK and Poland are experimental and may expose different fields.', ['us', 'gb', 'pl'], ['United States', 'United Kingdom (experimental)', 'Poland (experimental)'], 'us'), sectionCaption: 'Search' },
        jobTitles: { title: 'Job titles or keywords', description: 'Enter each search as a separate entry. Entries are searched separately and their results combined. These are keyword searches, not guaranteed exact-title matches.', type: 'array', editor: 'stringList', items: { type: 'string' }, minItems: 1, maxItems: 20, prefill: ['AI automation engineer', 'AI automation intern'] },
        locations: { title: 'Locations', description: 'One city or region per entry. Leave empty to search without a city restriction inside the selected market. Remote does not mean worldwide eligibility.', type: 'array', editor: 'stringList', items: { type: 'string' }, default: [], maxItems: 10 },
        radius: integer('Search distance', 'Distance around each location. Miles for US/UK; kilometers for Poland. Zero means exact location. Indeed may adjust supported distances.', 25, 0, 100),
        workplaceTypes: multiple('Work arrangement', 'Choose any combination. Empty means all. Onsite requires explicit evidence; missing remote labels are not treated as onsite.', ['remote', 'hybrid', 'onsite'], ['Remote', 'Hybrid', 'Onsite / in person']),
        jobTypes: multiple('Job types', 'Choose any combination. Empty means all. Checked against full details; a listing can have multiple types.', ['full-time', 'part-time', 'contract', 'temporary', 'internship'], ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship']),
        experienceLevels: multiple('Experience level', 'Choose any combination. Empty means all. Uses explicit seniority in the title or structured experience data; unlabelled roles stay unknown.', ['entry', 'mid', 'senior'], ['Entry / junior / intern', 'Mid level', 'Senior / lead / staff']),
        easyApplyOnly: boolean('Easily apply on Indeed only', 'Require a verified Indeed application link or label. This does not submit an application.', false),
        datePosted: choice('Date posted', 'Checked against available posting dates. Missing dates follow Include unknown metadata. Date-only/relative labels are approximate, not exact timestamps.', ['any', '1', '3', '7', '14'], ['Any time', 'Last 24 hours', 'Last 3 days', 'Last 7 days', 'Last 14 days'], 'any'),
        sortBy: choice('Sort results', 'Newest is useful for recurring searches. This controls the search order; promoted listings may still be shown by Indeed.', ['date', 'relevance'], ['Newest', 'Relevance'], 'date'),
        minimumSalary: { title: 'Minimum salary', description: 'Optional minimum. Salary ranges match if their upper bound reaches this amount. No currency or pay-period conversion is performed.', type: 'integer', editor: 'number', minimum: 0, sectionCaption: 'Salary' },
        salaryCurrency: choice('Salary currency', 'Leave unset to use USD for US, GBP for UK, or PLN for Poland. Different currencies are treated as non-comparable.', ['USD', 'GBP', 'PLN', 'EUR'], ['USD', 'GBP', 'PLN', 'EUR']),
        salaryPeriod: choice('Salary period', 'Compare only salaries with this same period. For example, an hourly salary is not silently converted to yearly.', ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'], ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Yearly'], 'YEAR'),
        includeUnknownSalary: boolean('Keep undisclosed / non-comparable salaries', 'When a salary minimum is set, retain jobs whose salary cannot be compared. Otherwise exclude those jobs.', true),
        includeUnknownMetadata: boolean('Keep unknown filter values', 'When selecting work arrangement, experience, job types, or dates, keep jobs with missing values. Easy Apply only always requires evidence.', false),
        maxResults: { ...integer('Maximum matching jobs', 'Maximum jobs written to the dataset. Duplicate Indeed job IDs count once per run.', 50, 1, 1000), sectionCaption: 'Run limits' },
        maxCandidates: integer('Maximum jobs to inspect', 'Maximum unique job detail pages. Must be at least Maximum matching jobs. Restrictive filters may produce fewer matches before this limit.', 200, 1, 5000),
        maxPagesPerSearch: integer('Maximum pages per search', 'Maximum result pages for each title/location combination. A bounded search does not guarantee every matching Indeed job is collected.', 5, 1, 20),
        maxConcurrency: integer('Concurrent requests', 'Keep low to reduce load. A security block is reported as a failure.', 2, 1, 5),
        maxRequestsPerMinute: integer('Requests per minute', 'Rate cap shared by search and detail requests.', 10, 1, 60),
        retrievalMode: choice('Page retrieval', 'Browser runs JavaScript. HTTP uses Cheerio without a browser and is cheaper when accessible; our direct HTTP probe received 403.', ['browser', 'http'], ['Browser', 'HTTP / Cheerio'], 'browser'),
        proxyConfiguration: { title: 'Optional proxy', description: 'Off by default. Configure only if you have an authorized proxy service. Proxy charges, if enabled, are separate. Challenges are not solved automatically.', type: 'object', editor: 'proxy', default: { useApifyProxy: false } },
    },
    required: ['jobTitles'],
};
const stringFields = ['source', 'source_job_id', 'listing_key', 'country', 'title', 'job_url', 'application_method', 'workplace_type', 'seniority', 'description_text', 'posted_at_precision', 'scraped_at', 'search_query', 'search_location'];
const nullableFields = ['company_name', 'apply_url', 'location_text', 'workplace_evidence', 'remote_restrictions_text', 'seniority_evidence', 'salary_text', 'salary_currency', 'salary_period', 'posted_at', 'posted_text'];
const fields = {
    type: 'object', required: ['source_job_id', 'listing_key', 'title', 'job_url', 'description_text'],
    properties: {
        schema_version: { type: 'integer', const: 1 },
        ...Object.fromEntries(stringFields.map(key => [key, { type: 'string' }])),
        ...Object.fromEntries(nullableFields.map(key => [key, { type: ['string', 'null'] }])),
        salary_min: { type: ['number', 'null'] }, salary_max: { type: ['number', 'null'] },
        easy_apply: { type: ['boolean', 'null'] }, apply_url_is_redirect: { type: 'boolean' },
        employment_types: { type: 'array', items: { type: 'string' } },
        quality_flags: { type: 'array', items: { type: 'string' } },
    },
};
const columns = ['title', 'company_name', 'location_text', 'workplace_type', 'employment_types', 'seniority', 'salary_text', 'easy_apply', 'posted_at', 'job_url', 'quality_flags'];
const dataset = { actorSpecification: 1, fields, views: { jobs: { title: 'Matching jobs', transformation: { fields: columns }, display: { component: 'table', properties: Object.fromEntries(columns.map(key => [key, { label: key.replaceAll('_', ' '), format: key === 'job_url' ? 'link' : 'text' }])) } } } };
const actor = { actorSpecification: 1, name: 'indeed-job-research', title: 'Indeed Job Research', version: '0.1', dockerfile: '../Dockerfile', input: './input_schema.json', storages: { dataset: './dataset_schema.json' }, output: './output_schema.json' };
const output = { actorOutputSchemaVersion: 1, title: 'Indeed job research results', properties: { jobs: { type: 'string', title: 'Matching jobs', template: '{{links.apiDefaultDatasetUrl}}/items' }, summary: { type: 'string', title: 'Run summary', template: '{{links.apiDefaultKeyValueStoreUrl}}/records/SUMMARY' } } };
await mkdir('.actor', { recursive: true });
for (const [name, content] of Object.entries({ 'actor.json': actor, 'input_schema.json': input, 'dataset_schema.json': dataset, 'output_schema.json': output })) {
    await writeFile(`.actor/${name}`, `${JSON.stringify(content, null, 2)}\n`);
}
console.log('Generated Actor definition and input/dataset/output schemas.');
