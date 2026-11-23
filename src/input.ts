import { z } from 'zod';
export const SOURCES = ['arbeitnow', 'remotive'] as const;
export const JOB_TYPES = ['full-time', 'part-time', 'contract', 'temporary', 'internship'] as const;
export const WORKPLACES = ['remote', 'hybrid', 'onsite'] as const;
export const LEVELS = ['entry', 'mid', 'senior'] as const;
export const PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
const strings = z.array(z.string().trim().min(1)).max(20).transform(v => [...new Set(v)]);
const schema = z.object({
    sources: z.array(z.enum(SOURCES)).min(1).default(['arbeitnow', 'remotive']).transform(v => [...new Set(v)]),
    jobTitles: strings.pipe(z.array(z.string()).min(1)),
    searchInDescription: z.boolean().default(false),
    locations: strings.default([]),
    workplaceTypes: z.array(z.enum(WORKPLACES)).default([]),
    jobTypes: z.array(z.enum(JOB_TYPES)).default([]),
    experienceLevels: z.array(z.enum(LEVELS)).default([]),
    datePosted: z.enum(['any', '1', '3', '7', '14']).default('any'),
    minimumSalary: z.number().finite().min(0).optional(),
    salaryCurrency: z.enum(['USD', 'GBP', 'PLN', 'EUR']).default('EUR'),
    salaryPeriod: z.enum(PERIODS).default('YEAR'),
    includeUnknownSalary: z.boolean().default(true),
    includeUnknownMetadata: z.boolean().default(false),
    maxResults: z.number().int().min(1).max(1000).default(50),
    maxPages: z.number().int().min(1).max(10).default(3),
}).strict();
export const parseInput = (raw: unknown) => schema.parse(raw);
export type Input = ReturnType<typeof parseInput>;
