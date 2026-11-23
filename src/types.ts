import type { Country, JOB_TYPES, LEVELS, PERIODS, WORKPLACES } from './input.js';

export interface JobSeed {
    id: string;
    url: string;
    title: string | null;
    company: string | null;
    location: string | null;
    postedText: string | null;
    query: string;
    searchLocation: string;
}
export interface Job {
    schema_version: 1;
    source: 'indeed';
    source_job_id: string;
    listing_key: string;
    country: Country;
    title: string;
    company_name: string | null;
    job_url: string;
    apply_url: string | null;
    application_method: 'indeed' | 'external' | 'unknown';
    apply_url_is_redirect: boolean;
    easy_apply: boolean | null;
    location_text: string | null;
    workplace_type: typeof WORKPLACES[number] | 'unknown';
    workplace_evidence: string | null;
    remote_restrictions_text: string | null;
    employment_types: Array<typeof JOB_TYPES[number]>;
    seniority: typeof LEVELS[number] | 'unknown';
    seniority_evidence: string | null;
    salary_text: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    salary_period: typeof PERIODS[number] | null;
    description_text: string;
    posted_at: string | null;
    posted_at_precision: 'date' | 'datetime' | 'relative_day' | 'unknown';
    posted_text: string | null;
    scraped_at: string;
    search_query: string;
    search_location: string;
    quality_flags: string[];
}
