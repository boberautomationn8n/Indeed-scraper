import { load } from 'cheerio';
import { MARKETS, type Country, type JOB_TYPES, type PERIODS } from './input.js';
import type { Job, JobSeed } from './types.js';

// JSON-LD is parsed as data only. Never evaluate page scripts or embedded JavaScript.
type Data = Record<string, any>;
const array = <T>(value: T | T[] | undefined | null): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const clean = (value: unknown): string | null => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null;
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function htmlText(html: string): string {
    const $ = load(html);
    $('script, style, noscript, svg').remove();
    $('p, div, li, br, h1, h2, h3, h4, h5, h6, section').after('\n');
    return $('body').text().replace(/\u00a0/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function postings(html: string): Data[] {
    const $ = load(html);
    const found: Data[] = [];
    function visit(value: unknown) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const node = value as Data;
        if (array(node['@type']).includes('JobPosting')) found.push(node);
        visit(node['@graph']);
        visit(node.mainEntity);
        visit(node.itemListElement);
        visit(node.item);
    }
    $('script[type="application/ld+json"]').each((_, element) => {
        const content = $(element).text();
        if (content.length > 1_000_000) return;
        try { visit(JSON.parse(content)); } catch { /* optional malformed metadata is ignored */ }
    });
    return found;
}

function numberText(value: string): number | null {
    let text = value.replace(/\s/g, '');
    const multiplier = /k$/i.test(text) ? 1000 : 1;
    text = text.replace(/k$/i, '');
    if (text.includes(',') && text.includes('.')) {
        text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, '');
    else if (text.includes(',')) text = text.replace(',', '.');
    const valueNumber = Number(text) * multiplier;
    return Number.isFinite(valueNumber) && valueNumber >= 0 ? valueNumber : null;
}

function period(value: unknown): Job['salary_period'] {
    const text = String(value || '').toUpperCase();
    if (/HOUR|HOURLY|GODZ/.test(text)) return 'HOUR';
    if (/YEAR|ANNU|ROCZN/.test(text)) return 'YEAR';
    if (/MONTH|MIES/.test(text)) return 'MONTH';
    if (/WEEK|TYG/.test(text)) return 'WEEK';
    if (/DAY|DAILY|DZIEN|DZIENN/.test(text)) return 'DAY';
    return null;
}

export function parseSalary(text: string | null, metadata: Data | undefined, country: Country) {
    let min: number | null = null;
    let max: number | null = null;
    let currency: string | null = clean(metadata?.currency)?.toUpperCase() || null;
    let payPeriod: typeof PERIODS[number] | null = period(metadata?.value?.unitText ?? metadata?.unitText);
    const quantity = metadata?.value;
    if (typeof quantity === 'number') min = max = numeric(quantity);
    else if (quantity && typeof quantity === 'object') {
        min = numeric(quantity.minValue) ?? numeric(quantity.value);
        max = numeric(quantity.maxValue) ?? numeric(quantity.value);
    }
    if (text) {
        const money = '(?:US\\$|\\$|£|€|USD|GBP|EUR|PLN|zł)';
        const amount = '(\\d[\\d ,.]*\\d|\\d)(k)?';
        const prefix = new RegExp(`${money}\\s*${amount}(?:\\s*(?:–|—|-|to)\\s*(?:${money}\\s*)?${amount})?`, 'i');
        const suffix = new RegExp(`${amount}(?:\\s*(?:–|—|-|to)\\s*${amount})?\\s*${money}`, 'i');
        const match = text.match(prefix) || text.match(suffix);
        if (match && min == null && max == null) {
            min = numberText(`${match[1]}${match[2] || ''}`);
            max = match[3] ? numberText(`${match[3]}${match[4] || ''}`) : min;
            if (/\bup to\b/i.test(text)) min = null;
            if (/\bfrom\b|\bstarting at\b|\+/i.test(text) && !match[3]) max = null;
        }
        if (!currency) {
            if (/PLN|zł/i.test(text)) currency = 'PLN';
            else if (/GBP|£/i.test(text)) currency = 'GBP';
            else if (/EUR|€/i.test(text)) currency = 'EUR';
            else if (/USD|US\$/i.test(text)) currency = 'USD';
            else if (/\$/.test(text) && country === 'us') currency = 'USD';
        }
        payPeriod ??= period(text);
    }
    const flags: string[] = [];
    if (min != null && max != null && min > max) flags.push('salary_range_reversed');
    if (payPeriod === 'YEAR' && (max ?? min ?? Infinity) < 1000) flags.push('salary_unusually_low_for_year');
    return { salary_min: min, salary_max: max, salary_currency: currency, salary_period: payPeriod, flags };
}

export function classifyWorkplace(location: string | null, summary: string, description: string, metadata: Data) {
    const locationLine = description.match(/(?:^|\n)(?:work location|work arrangement|location policy|location)\s*:\s*([^\n]{1,180})/i)?.[0]
        || description.match(/(?:^|\n)[^\n]{0,50}\b(?:US|UK|Poland|United States|United Kingdom)\s*\(remote\)[^\n]*/i)?.[0];
    const sources = [location, locationLine, ...summary.split('\n').filter(line => /^(?:remote|hybrid|on.?site|in.person|work location)/i.test(line.trim()))];
    for (const source of sources) {
        if (!source) continue;
        if (/hybrid|hybryd/i.test(source)) return { type: 'hybrid' as const, evidence: source };
        if (/in.person|on.?site|stacjonarn|not remote|no remote/i.test(source)) return { type: 'onsite' as const, evidence: source };
        if (/\bremote\b|zdaln/i.test(source)) return { type: 'remote' as const, evidence: source };
    }
    if (/TELECOMMUTE/i.test(String(metadata.jobLocationType || ''))) return { type: 'remote' as const, evidence: 'JobPosting.jobLocationType=TELECOMMUTE' };
    return { type: 'unknown' as const, evidence: null };
}

function jobTypes(text: string): Array<typeof JOB_TYPES[number]> {
    const patterns = {
        'full-time': /full[ _-]?time|pełny etat/i,
        'part-time': /part[ _-]?time|część etatu|niepełny etat/i,
        contract: /\bcontract(?:or)?\b|kontrakt/i,
        temporary: /\btemporary\b|tymczasow/i,
        internship: /\bintern(?:ship)?\b|\bstaż/i,
    };
    return (Object.keys(patterns) as Array<keyof typeof patterns>).filter(key => patterns[key].test(text));
}

function classifySeniority(title: string, experience: string | null): Pick<Job, 'seniority' | 'seniority_evidence'> {
    for (const text of [title, experience]) {
        if (!text) continue;
        if (/\bsenior\b|\bsr\.?\b|\bprincipal\b|\bstaff\b|\blead\b/i.test(text)) return { seniority: 'senior', seniority_evidence: text };
        if (/\bjunior\b|\bjr\.?\b|\bentry[ -]level\b|\bintern(?:ship)?\b/i.test(text)) return { seniority: 'entry', seniority_evidence: text };
        if (/\bmid[ -]?(?:level)?\b|\bintermediate\b/i.test(text)) return { seniority: 'mid', seniority_evidence: text };
    }
    return { seniority: 'unknown', seniority_evidence: null };
}

function postedDate(raw: unknown, relative: string | null, now: Date): Pick<Job, 'posted_at' | 'posted_at_precision'> {
    if (typeof raw === 'string' && /^\d{4}-\d\d-\d\d(?:T.*)?$/.test(raw) && Number.isFinite(Date.parse(raw))) {
        return { posted_at: raw, posted_at_precision: raw.length === 10 ? 'date' : 'datetime' };
    }
    if (relative && !/\d+\s*\+/.test(relative)) {
        const days = relative.match(/\b(\d+)\s*days? ago/i);
        const hours = relative.match(/\b(\d+)\s*hours? ago/i);
        const age = days ? Number(days[1]) * 86400000 : hours ? Number(hours[1]) * 3600000
            : /just posted|today/i.test(relative) ? 0 : /yesterday/i.test(relative) ? 86400000 : null;
        if (age != null) return { posted_at: new Date(now.getTime() - age).toISOString(), posted_at_precision: 'relative_day' };
    }
    return { posted_at: null, posted_at_precision: 'unknown' };
}

export function extractJob(html: string, seed: JobSeed, country: Country, now = new Date()): Job {
    const $ = load(html);
    const candidates = postings(html);
    const only = candidates.length === 1 ? candidates[0] : undefined;
    let onlyMatches = true;
    if (only?.url) {
        try {
            const metadataId = new URL(only.url, seed.url).searchParams.get('jk');
            onlyMatches = !metadataId || metadataId === seed.id;
        } catch { onlyMatches = false; }
    }
    const data = candidates.find(value => String(value.url || '').includes(seed.id)) || (onlyMatches ? only : undefined) || {};
    const detail = $('[data-testid="viewjob-main-content"]').first();
    const scope = detail.length ? detail : $('body');
    const title = clean(scope.find('[data-testid="vj-job-title"], .jobsearch-JobInfoHeader-title').first().text()) || clean(data.title) || seed.title;
    const descriptionHtml = scope.find('.simple-job-description-html, #jobDescriptionText').first().html() || data.description || '';
    const description = htmlText(String(descriptionHtml));
    if (!title || !description) throw new Error(`DETAIL_LAYOUT_CHANGED: Missing title or full description for ${seed.id}`);
    const company = clean(data.hiringOrganization?.name) || clean(scope.find('[data-testid="company-info-metadata"] a, [data-testid="inlineHeader-companyName"]').first().text()) || seed.company;
    const locations = array<Data>(data.jobLocation).map(value => {
        const address = value.address;
        return typeof address === 'string' ? address : [address?.addressLocality, address?.addressRegion, address?.postalCode].filter(Boolean).join(', ');
    }).filter(Boolean).join('; ');
    const location = clean(locations) || seed.location || clean(scope.find('[data-testid="job-location"], [data-testid="inlineHeader-companyLocation"]').first().text());
    const summary = htmlText(scope.find('[data-testid="structured-job-summary"], #salaryInfoAndJobType').first().html() || '');
    const salaryText = summary.split('\n').map(line => line.trim()).find(line => /(?:\$|£|€|USD|GBP|PLN|zł|EUR)\s*\d|\d.*(?:PLN|zł)/i.test(line)) || null;
    const salary = parseSalary(salaryText, data.baseSalary, country);
    const workplace = classifyWorkplace(location, summary, description, data);
    const experience = typeof data.experienceRequirements === 'string' ? data.experienceRequirements : clean(data.experienceRequirements?.name);
    const apply = scope.find('[data-testid="viewjob-apply"]').first();
    let applicationMethod: Job['application_method'] = 'unknown';
    let easyApply: boolean | null = null;
    let applyUrl: string | null = null;
    const applyLabel = clean(apply.text()) || '';
    try {
        const href = apply.attr('href');
        if (href) {
            const parsed = new URL(href, seed.url);
            if (['https:', 'http:'].includes(parsed.protocol)) applyUrl = parsed.href;
            if (parsed.hostname === 'smartapply.indeed.com') { applicationMethod = 'indeed'; easyApply = true; }
        }
    } catch { /* no safe application link */ }
    if (/apply with indeed|easily apply on indeed/i.test(applyLabel)) { applicationMethod = 'indeed'; easyApply = true; }
    if (/apply on company site/i.test(applyLabel)) { applicationMethod = 'external'; easyApply = false; }
    const redirect = !!applyUrl && /\/(?:onboarding|rc\/clk|pagead\/clk|thirdpartysignin)|[?&](?:continue|redirect)=/i.test(applyUrl);
    const postedRaw = data.datePosted || scope.find('time[datetime]').first().attr('datetime');
    const postedText = seed.postedText || clean(scope.find('.date, [data-testid="job-date"]').first().text());
    const metadataTypes = array<string>(data.employmentType).join(' ');
    const employmentLine = description.match(/(?:^|\n)(?:job type|employment type)\s*:\s*([^\n]+)/i)?.[1] || '';
    const employmentTypes = jobTypes(`${metadataTypes}\n${summary}\n${employmentLine}`);
    if (/\bintern(?:ship)?\b/i.test(title) && !employmentTypes.includes('internship')) employmentTypes.push('internship');
    const flags = [...salary.flags];
    if (!company) flags.push('missing_company');
    if (workplace.type === 'unknown') flags.push('unknown_workplace');
    if (!applyUrl) flags.push('missing_apply_url');
    if (redirect) flags.push('apply_url_requires_redirect_or_onboarding');
    if (description.length > 200000) flags.push('description_truncated');
    if (data.validThrough && Date.parse(data.validThrough) < now.getTime()) flags.push('expired');
    const restrictions = array<Data>(data.applicantLocationRequirements).map(value => typeof value === 'string' ? value : value.name).filter(Boolean).join('; ')
        || description.match(/(?:^|\n)(?:US|UK|Poland|United States|United Kingdom)\s*\(remote\)[^\n]*/i)?.[0]?.trim() || null;
    return {
        schema_version: 1, source: 'indeed', source_job_id: seed.id, listing_key: `indeed:${seed.id}`,
        country, title, company_name: company, job_url: seed.url, apply_url: applyUrl,
        application_method: applicationMethod, apply_url_is_redirect: redirect, easy_apply: easyApply,
        location_text: location, workplace_type: workplace.type, workplace_evidence: workplace.evidence,
        remote_restrictions_text: restrictions, employment_types: employmentTypes,
        ...classifySeniority(title, experience), salary_text: salaryText,
        salary_min: salary.salary_min, salary_max: salary.salary_max,
        salary_currency: salary.salary_currency, salary_period: salary.salary_period,
        description_text: description.slice(0, 200000), ...postedDate(postedRaw, postedText, now),
        posted_text: postedText, scraped_at: now.toISOString(), search_query: seed.query,
        search_location: seed.searchLocation, quality_flags: flags,
    };
}
