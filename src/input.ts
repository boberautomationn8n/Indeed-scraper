import { z } from 'zod';

export const MARKETS = {
    us: { host: 'www.indeed.com', currency: 'USD', distanceUnit: 'miles', experimental: false },
    gb: { host: 'uk.indeed.com', currency: 'GBP', distanceUnit: 'miles', experimental: true },
    pl: { host: 'pl.indeed.com', currency: 'PLN', distanceUnit: 'km', experimental: true },
} as const;
export type Country = keyof typeof MARKETS;
export const JOB_TYPES = ['full-time', 'part-time', 'contract', 'temporary', 'internship'] as const;
export const WORKPLACES = ['remote', 'hybrid', 'onsite'] as const;
export const LEVELS = ['entry', 'mid', 'senior'] as const;
export const PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

const strings = z.array(z.string().trim().min(1)).transform(values => [...new Set(values)]);
const schema = z.object({
    country: z.enum(['us', 'gb', 'pl']).default('us'),
    jobTitles: strings.pipe(z.array(z.string()).min(1).max(20)),
    locations: z.array(z.string().trim()).max(10).default([]),
    radius: z.number().int().min(0).max(100).default(25),
    workplaceTypes: z.array(z.enum(WORKPLACES)).default([]),
    jobTypes: z.array(z.enum(JOB_TYPES)).default([]),
    experienceLevels: z.array(z.enum(LEVELS)).default([]),
    easyApplyOnly: z.boolean().default(false),
    datePosted: z.enum(['any', '1', '3', '7', '14']).default('any'),
    sortBy: z.enum(['date', 'relevance']).default('date'),
    minimumSalary: z.number().finite().min(0).optional(),
    salaryCurrency: z.enum(['USD', 'GBP', 'PLN', 'EUR']).optional(),
    salaryPeriod: z.enum(PERIODS).default('YEAR'),
    includeUnknownSalary: z.boolean().default(true),
    includeUnknownMetadata: z.boolean().default(false),
    maxResults: z.number().int().min(1).max(1000).default(50),
    maxCandidates: z.number().int().min(1).max(5000).default(200),
    maxPagesPerSearch: z.number().int().min(1).max(20).default(5),
    maxConcurrency: z.number().int().min(1).max(5).default(2),
    maxRequestsPerMinute: z.number().int().min(1).max(60).default(10),
    retrievalMode: z.enum(['browser', 'http']).default('browser'),
    proxyConfiguration: z.object({
        useApifyProxy: z.boolean().optional(),
        apifyProxyGroups: z.array(z.string()).optional(),
        apifyProxyCountry: z.string().optional(),
        proxyUrls: z.array(z.url()).optional(),
    }).strict().optional(),
}).strict();

export function parseInput(raw: unknown) {
    const parsed = schema.parse(raw);
    const locations = [...new Set(parsed.locations)];
    if (parsed.jobTitles.length * Math.max(locations.length, 1) > 100) {
        throw new Error('At most 100 title/location combinations are allowed per run.');
    }
    if (parsed.maxCandidates < parsed.maxResults) {
        throw new Error('maxCandidates must be at least maxResults.');
    }
    return { ...parsed, locations, salaryCurrency: parsed.salaryCurrency ?? MARKETS[parsed.country].currency };
}
export type Input = ReturnType<typeof parseInput>;
