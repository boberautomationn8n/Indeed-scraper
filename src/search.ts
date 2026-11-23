import { load } from 'cheerio';
import { MARKETS, type Input, type Country } from './input.js';
import type { JobSeed } from './types.js';

export function searchRequests(input: Input) {
    return input.jobTitles.flatMap(query => (input.locations.length ? input.locations : ['']).map(location => {
        const url = new URL('/jobs', `https://${MARKETS[input.country].host}`);
        url.searchParams.set('q', query);
        url.searchParams.set('l', location);
        if (location) url.searchParams.set('radius', String(input.radius));
        if (input.sortBy === 'date') url.searchParams.set('sort', 'date');
        // Other preferences are checked against extracted details, not guessed private filter codes.
        return { url: url.href, uniqueKey: `search:${url.href}`, userData: { label: 'SEARCH', query, location, page: 1 } };
    }));
}

export function jobUrl(country: Country, id: string) {
    if (!/^[a-f0-9]{16}$/i.test(id)) throw new Error('Invalid Indeed job key');
    return `https://${MARKETS[country].host}/viewjob?jk=${id}`;
}

export function assertPageAccessible(html: string, status = 200) {
    const $ = load(html);
    const title = $('title').text();
    if ([401, 403, 429].includes(status) || /security check|just a moment|access denied|additional verification|^blocked\b/i.test(title)
        || $('#challenge-form, #px-captcha, #captcha-container, #challenge-running').length > 0) {
        throw new Error(`ACCESS_BLOCKED: Indeed returned a security/rate-limit page (HTTP ${status}). No jobs inferred from this page.`);
    }
    if (status >= 400) throw new Error(`HTTP_ERROR: Indeed returned HTTP ${status}`);
}

const clean = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim() || null;

export function extractSearch(html: string, url: string, country: Country, query: string, location: string) {
    const $ = load(html);
    const seeds = new Map<string, JobSeed>();
    $('a[data-jk], .jobTitle a, a[id^="job_"]').each((_, el) => {
        const link = $(el);
        let id = link.attr('data-jk') || link.attr('id')?.replace(/^job_/, '');
        if (!id) {
            try { id = new URL(link.attr('href') || '', url).searchParams.get('jk') || undefined; } catch { /* unusable link */ }
        }
        if (!id || !/^[a-f0-9]{16}$/i.test(id)) return;
        if (seeds.has(id)) return;
        const card = link.closest('li').length ? link.closest('li') : link.closest('.cardOutline');
        seeds.set(id, {
            id, url: jobUrl(country, id), title: clean(link.text()),
            company: clean(card.find('[data-testid="company-name"], .companyName').first().text()),
            location: clean(card.find('[data-testid="text-location"], .companyLocation').first().text()),
            postedText: clean(card.find('.date, [data-testid="job-date"]').first().text()),
            query, searchLocation: location,
        });
    });
    let next: string | null = null;
    const href = $('a[aria-label="Next Page"], a[data-testid="pagination-page-next"], a[rel="next"]').first().attr('href');
    if (href) {
        const candidate = new URL(href, url);
        const current = new URL(url);
        if (candidate.origin === current.origin && candidate.protocol === 'https:'
            && candidate.searchParams.get('q') === current.searchParams.get('q')
            && (candidate.searchParams.get('l') || '') === (current.searchParams.get('l') || '')
            && candidate.href !== current.href) next = candidate.href;
    }
    $('script, style, noscript').remove();
    const body = $('body').text().replace(/\s+/g, ' ');
    const explicitEmpty = /no jobs found|did not match any jobs|could not find any jobs|no results found|nie znaleziono|brak ofert/i.test(body);
    if (!seeds.size && !explicitEmpty) {
        throw new Error('SEARCH_LAYOUT_CHANGED: No job cards or explicit empty-results message. Refusing to report a successful empty search.');
    }
    return { seeds: [...seeds.values()], next, explicitEmpty };
}
