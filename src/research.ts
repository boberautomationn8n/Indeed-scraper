import type { Input } from './input.js';
import type { Job, Source } from './types.js';
import { normalizeFeed } from './extract.js';
import { evaluateJob } from './filter.js';

export interface CachedFeed { fetchedAt: string; data: unknown }
export interface Cache {
    getValue<T>(key: string): Promise<T | null>;
    setValue(key: string, value: unknown): Promise<unknown>;
}
const CACHE_MS = 6 * 60 * 60 * 1000;
export async function getFeed(source: Source, page: number, cache: Cache, now: Date, request = fetch) {
    const key = source + '-' + page;
    const cached = await cache.getValue<CachedFeed>(key);
    const age = cached ? now.getTime() - Date.parse(cached.fetchedAt) : Infinity;
    if (age >= 0 && age < CACHE_MS) return { ...cached!, cached: true };
    const url = source === 'arbeitnow' ? 'https://www.arbeitnow.com/api/job-board-api?page=' + page
        : 'https://remotive.com/api/remote-jobs';
    const response = await request(url, { headers: { Accept: 'application/json', 'User-Agent': 'JobResearchActor/0.2' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error(source + ': HTTP ' + response.status + '. No browser/proxy fallback is attempted.');
    const data: unknown = await response.json();
    const feed = { fetchedAt: now.toISOString(), data };
    normalizeFeed(source, data, feed.fetchedAt, now);
    await cache.setValue(key, feed);
    return { ...feed, cached: false };
}

export async function runResearch(input: Input, dependencies: {
    cache: Cache;
    saveJobs: (jobs: Job[]) => Promise<unknown>;
    saveSummary: (summary: unknown) => Promise<unknown>;
    request?: typeof fetch;
    now?: Date;
}) {
    const now = dependencies.now ?? new Date();
    const collected: Job[] = [];
    const seen = new Set<string>();
    const summary = {
        status: 'succeeded', sources: input.sources, successful_pages: 0, cached_pages: 0,
        inspected: 0, duplicates: 0, matched: 0, saved: 0, errors: [] as string[],
        filtered_out: {} as Record<string, number>,
        coverage: 'Bounded public feeds across employers, not Indeed or the entire job market. Location is a text filter, not an eligibility check.',
        cache_hours: 6,
    };
    for (const source of input.sources) {
        for (let page = 1; page <= (source === 'remotive' ? 1 : input.maxPages); page++) {
            try {
                const feed = await getFeed(source, page, dependencies.cache, now, dependencies.request);
                const result = normalizeFeed(source, feed.data, feed.fetchedAt, now);
                summary.successful_pages++;
                if (feed.cached) summary.cached_pages++;
                for (const job of result.jobs) {
                    if (seen.has(job.listing_key) || seen.has(job.job_url)) { summary.duplicates++; continue; }
                    seen.add(job.listing_key); seen.add(job.job_url); summary.inspected++;
                    const reasons = evaluateJob(job, input, now);
                    for (const reason of reasons) summary.filtered_out[reason] = (summary.filtered_out[reason] ?? 0) + 1;
                    if (!reasons.length) collected.push(job);
                }
                if (!result.hasNext) break;
            } catch (error) {
                summary.errors.push(error instanceof Error ? error.message : String(error));
                break;
            }
        }
    }
    collected.sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
    summary.matched = collected.length;
    const jobs = collected.slice(0, input.maxResults);
    summary.status = summary.errors.length ? summary.successful_pages ? 'partial' : 'failed' : 'succeeded';
    if (jobs.length) await dependencies.saveJobs(jobs);
    summary.saved = jobs.length;
    await dependencies.saveSummary(summary);
    // Incomplete coverage must not look complete, even when some jobs were saved.
    if (summary.errors.length) throw new Error(summary.status.toUpperCase() + ': ' + summary.errors.join('; ') + '. See SUMMARY.');
    return summary;
}
