import { load } from 'cheerio';
import { z } from 'zod';
import type { Job, Source } from './types.js';

const common = { title: z.string().min(1), company_name: z.string(), description: z.string(), url: z.url() };
const arbeitnow = z.object({ ...common, slug: z.string().min(1), remote: z.boolean(),
    location: z.string(), created_at: z.number().nonnegative(),
    tags: z.array(z.string()), job_types: z.array(z.string()),
});
const remotive = z.object({ ...common, id: z.number().int(), job_type: z.string().optional(),
    publication_date: z.string(), candidate_required_location: z.string(), salary: z.string().optional(),
});

export function htmlText(html: string): string {
    // Some ATS descriptions arrive with an extra layer of entity encoding.
    const decoded = /&lt;\/?(?:p|div|ul|h[1-6])\b/i.test(html) ? load(html)('body').text() : html;
    const $ = load(decoded);
    $('script, style, noscript, svg').remove();
    $('p, div, li, br, h1, h2, h3, h4, section').after('\n');
    return $('body').text().replace(/\u00a0/g, ' ').replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function salary(text: string | null): Pick<Job, 'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period'> {
    const result: ReturnType<typeof salary> = { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
    if (!text) return result;
    // A bare dollar sign is ambiguous (USD/CAD/AUD). Do not invent its currency.
    result.salary_currency = /\bUSD\b|US\$/i.test(text) ? 'USD' : /€|\bEUR\b/i.test(text) ? 'EUR'
        : /£|\bGBP\b/i.test(text) ? 'GBP' : /\bPLN\b|zł/i.test(text) ? 'PLN' : null;
    result.salary_period = /hour|hourly|\/hr\b/i.test(text) ? 'HOUR' : /year|annual|\/yr\b/i.test(text) ? 'YEAR'
        : /month/i.test(text) ? 'MONTH' : /week/i.test(text) ? 'WEEK' : /day|daily/i.test(text) ? 'DAY' : null;
    // Parse only an isolated salary field, never arbitrary numbers in descriptions.
    const amounts = [...text.matchAll(/\d+(?:[,.]\d+)*(?:\s*k)?/gi)].map(m => {
        let value = m[0].replace(/\s/g, '');
        const multiplier = /k$/i.test(value) ? 1000 : 1;
        value = value.replace(/k$/i, '');
        if (/^\d{1,3}(?:[,.]\d{3})+$/.test(value)) value = value.replace(/[,.]/g, '');
        else if (value.includes(',') && value.includes('.')) value = value.lastIndexOf(',') > value.lastIndexOf('.')
            ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
        else value = value.replace(',', '.');
        return Number(value) * multiplier;
    });
    if (amounts.length >= 1 && amounts.length <= 2 && amounts.every(Number.isFinite)) {
        result.salary_min = /up to/i.test(text) ? null : amounts[0]!;
        result.salary_max = /from|starting|\+/i.test(text) && amounts.length === 1 ? null : amounts.at(-1)!;
    }
    return result;
}

function employment(text: string): Job['employment_types'] {
    const patterns = {
        'full-time': /full[ _-]?time|vollzeit/i, 'part-time': /part[ _-]?time|teilzeit/i,
        contract: /\bcontract(?:or)?\b|freelanc|self.employed/i,
        temporary: /\btemporary\b|befristet/i, internship: /\bintern(?:ship)?\b|praktikum/i,
    };
    return (Object.keys(patterns) as Array<keyof typeof patterns>).filter(k => patterns[k].test(text));
}
function seniority(title: string, types: string): Pick<Job, 'seniority' | 'seniority_evidence'> {
    for (const text of [title, types]) {
        const level = /\bsenior\b|\bsr\b|\bprincipal\b|\bstaff\b|\blead\b/i.test(text) ? 'senior'
            : /\bjunior\b|\bjr\b|\bentry\b|\bintern(?:ship)?\b|praktikum|no experience/i.test(text) ? 'entry'
            : /\bmid\b|\bintermediate\b/i.test(text) ? 'mid' : null;
        if (level) return { seniority: level, seniority_evidence: text };
    }
    return { seniority: 'unknown', seniority_evidence: null };
}

export function normalizeFeed(source: Source, raw: unknown, fetchedAt: string, now = new Date()): { jobs: Job[]; hasNext: boolean } {
    // A malformed response is an error, rather than a misleading successful empty run.
    const data = source === 'arbeitnow'
        ? z.object({ data: z.array(arbeitnow), links: z.object({ next: z.string().nullable() }) }).parse(raw)
        : z.object({ jobs: z.array(remotive) }).parse(raw);
    const rows = 'data' in data ? data.data : data.jobs;
    const jobs = rows.map(row => {
        const a = 'slug' in row ? row : null;
        const r = 'id' in row ? row : null;
        const url = new URL(row.url);
        const allowed = source === 'arbeitnow'
            ? ['arbeitnow.com', 'arbeitnow.co.uk', 'arbeitnow.fr', 'arbeitnow.ch', 'arbeitnow.nl'] : ['remotive.com'];
        if (url.protocol !== 'https:' || !allowed.includes(url.hostname.replace(/^www\./, ''))) {
            throw new Error('Unexpected ' + source + ' listing URL host');
        }
        const types = a?.job_types.join(' ') ?? r?.job_type ?? '';
        const location = (a?.location ?? r?.candidate_required_location ?? '').trim() || null;
        const evidence = [location, row.title, a?.job_types.join(' ')].filter(Boolean).join(' ');
        // false means non-remote; it does not distinguish hybrid from onsite.
        const workplace = r || a?.remote ? 'remote' : /\bhybrid\b/i.test(evidence) ? 'hybrid'
            : /on[ -]?site|in[ -]person/i.test(evidence) ? 'onsite' : 'unknown';
        const rawDate = r?.publication_date ?? '';
        // Remotive timestamps have no documented timezone: preserve date precision only.
        const day = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        const posted = a ? new Date(a.created_at * 1000).toISOString()
            : day && Number.isFinite(Date.parse(day)) ? day : null;
        const pay = salary(r?.salary?.trim() || null);
        const id = String(a?.slug ?? r?.id);
        const description = htmlText(row.description);
        const flags = ['source_feed_publication_date', 'application_link_not_provided'];
        if (workplace === 'unknown') flags.push('unknown_workplace');
        if (!description) flags.push('missing_description');
        if (description.length > 200000) flags.push('description_truncated');
        if (pay.salary_min != null && pay.salary_max != null && pay.salary_min > pay.salary_max) flags.push('salary_range_reversed');
        return {
            schema_version: 2 as const, source, source_name: source === 'arbeitnow' ? 'Arbeitnow' : 'Remotive',
            source_url: source === 'arbeitnow' ? 'https://www.arbeitnow.com' : 'https://remotive.com',
            source_job_id: id, listing_key: source + ':' + id, title: htmlText(row.title), company_name: htmlText(row.company_name),
            job_url: url.href, apply_url: null, application_method: 'source_listing' as const, easy_apply: null,
            location_text: location, workplace_type: workplace,
            workplace_evidence: workplace === 'unknown' ? null : r ? 'Remotive remote-only feed' : a?.remote ? 'Arbeitnow remote=true' : evidence,
            remote_restrictions_text: workplace === 'remote' ? location : null,
            employment_types: employment(types + ' ' + row.title), ...seniority(row.title, types),
            salary_text: r?.salary?.trim() || null, ...pay, description_text: description.slice(0, 200000),
            posted_at: posted, posted_at_precision: a ? 'datetime' as const : posted ? 'date' as const : 'unknown' as const,
            feed_fetched_at: fetchedAt, scraped_at: now.toISOString(), quality_flags: flags,
        } satisfies Job;
    });
    return { jobs, hasNext: 'links' in data && data.links.next !== null };
}
