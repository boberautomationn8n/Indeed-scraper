import { CheerioCrawler, PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import type { CheerioCrawlingContext, PlaywrightCrawlingContext, ProxyConfiguration, Request } from 'crawlee';
import type { Input } from './input.js';
import { MARKETS } from './input.js';
import { assertPageAccessible, extractSearch, searchRequests } from './search.js';
import { extractJob } from './extract.js';
import { evaluateJob } from './filter.js';
import type { Job, JobSeed } from './types.js';

export interface Summary {
    status: 'running' | 'succeeded' | 'limited' | 'failed';
    country: string;
    retrieval_mode: string;
    search_pages: number;
    unique_candidates: number;
    duplicates_skipped: number;
    details_processed: number;
    accepted: number;
    rejected: number;
    rejection_reasons: Record<string, number>;
    limits_reached: string[];
    failures: Array<{ url: string; message: string }>;
    experimental_market: boolean;
    started_at: string;
    finished_at?: string;
}
export interface Sinks {
    saveJob: (job: Job) => Promise<void>;
    saveSummary: (summary: Summary) => Promise<void>;
}

export async function runResearch(input: Input, sinks: Sinks, proxyConfiguration?: ProxyConfiguration): Promise<Summary> {
    const queue = await RequestQueue.open();
    const seen = new Set<string>();
    const saved = new Set<string>();
    const summary: Summary = {
        status: 'running', country: input.country, retrieval_mode: input.retrievalMode,
        search_pages: 0, unique_candidates: 0, duplicates_skipped: 0, details_processed: 0,
        accepted: 0, rejected: 0, rejection_reasons: {}, limits_reached: [], failures: [],
        experimental_market: MARKETS[input.country].experimental, started_at: new Date().toISOString(),
    };
    function limit(reason: string) {
        if (!summary.limits_reached.includes(reason)) summary.limits_reached.push(reason);
    }
    let crawler: CheerioCrawler | PlaywrightCrawler;
    // Serialize saves so concurrent handlers can never exceed maxResults.
    let writeChain = Promise.resolve();
    async function save(job: Job) {
        const write = writeChain.then(async () => {
            if (saved.has(job.listing_key)) return;
            if (summary.accepted >= input.maxResults) { limit('maxResults'); return; }
            await sinks.saveJob(job);
            saved.add(job.listing_key);
            summary.accepted++;
            if (summary.accepted >= input.maxResults) limit('maxResults');
        });
        writeChain = write.catch(() => {});
        await write;
    }
    async function processHtml(request: Request, html: string, status: number) {
        assertPageAccessible(html, status);
        if (summary.accepted >= input.maxResults) { limit('maxResults'); await crawler.stop('Result limit reached'); return; }
        if (request.userData.label === 'SEARCH') {
            summary.search_pages++;
            const result = extractSearch(html, request.loadedUrl || request.url, input.country, request.userData.query, request.userData.location);
            for (const seed of result.seeds) {
                if (seen.has(seed.id)) { summary.duplicates_skipped++; continue; }
                if (seen.size >= input.maxCandidates) { limit('maxCandidates'); break; }
                seen.add(seed.id);
                await queue.addRequest({ url: seed.url, uniqueKey: `job:${seed.id}`, userData: { label: 'DETAIL', seed } }, { forefront: true });
            }
            summary.unique_candidates = seen.size;
            if (result.next) {
                if (request.userData.page >= input.maxPagesPerSearch) limit('maxPagesPerSearch');
                else if (seen.size >= input.maxCandidates) limit('maxCandidates');
                else await queue.addRequest({
                    url: result.next, uniqueKey: `search:${result.next}`,
                    userData: { ...request.userData, page: request.userData.page + 1 },
                });
            }
        } else {
            const seed = request.userData.seed as JobSeed;
            const job = extractJob(html, seed, input.country);
            summary.details_processed++;
            const reasons = evaluateJob(job, input);
            if (reasons.length) {
                summary.rejected++;
                for (const reason of reasons) summary.rejection_reasons[reason] = (summary.rejection_reasons[reason] || 0) + 1;
            } else await save(job);
        }
        log.info('Research progress', { candidates: seen.size, accepted: summary.accepted, rejected: summary.rejected });
    }
    const common = {
        requestQueue: queue,
        proxyConfiguration,
        maxConcurrency: input.maxConcurrency,
        maxRequestsPerMinute: input.maxRequestsPerMinute,
        maxRequestRetries: 1,
        useSessionPool: false,
        retryOnBlocked: false,
        requestHandlerTimeoutSecs: 60,
        async failedRequestHandler({ request }: { request: Request }, error: Error) {
            summary.failures.push({ url: request.url, message: error.message.slice(0, 500) });
            log.error('Request failed; the run will be marked failed even if partial results exist.', { url: request.url });
        },
    };
    if (input.retrievalMode === 'http') {
        crawler = new CheerioCrawler({
            ...common,
            async requestHandler({ request, body, response }: CheerioCrawlingContext) {
                await processHtml(request, String(body), response.statusCode ?? 200);
            },
        });
    } else {
        crawler = new PlaywrightCrawler({
            ...common,
            browserPoolOptions: { useFingerprints: false },
            launchContext: { launchOptions: { headless: true } },
            navigationTimeoutSecs: 30,
            async requestHandler({ request, page, response }: PlaywrightCrawlingContext) {
                assertPageAccessible(await page.content(), response?.status() ?? 200);
                const selector = request.userData.label === 'SEARCH'
                    ? 'a[data-jk], .jobTitle a'
                    : '.simple-job-description-html, #jobDescriptionText';
                try { await page.waitForSelector(selector, { timeout: 15000 }); }
                catch { /* Parsing below distinguishes explicit empty results, metadata, and layout failures. */ }
                await processHtml(request, await page.content(), response?.status() ?? 200);
            },
        });
    }
    if (MARKETS[input.country].experimental) log.warning('This market adapter is experimental; only the US UI has been inspected. Unknown fields remain unknown.');
    try {
        await crawler.run(searchRequests(input));
        await writeChain;
        if (summary.failures.length) throw new Error(`${summary.failures.length} request(s) failed. Inspect SUMMARY.failures. Partial dataset items may exist.`);
        summary.status = summary.limits_reached.length ? 'limited' : 'succeeded';
        return summary;
    } catch (error) {
        summary.status = 'failed';
        if (!summary.failures.length) summary.failures.push({ url: '', message: error instanceof Error ? error.message : String(error) });
        throw error;
    } finally {
        summary.finished_at = new Date().toISOString();
        await sinks.saveSummary(summary);
    }
}
