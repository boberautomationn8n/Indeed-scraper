import type { Input } from './input.js';
import type { Job } from './types.js';

export function evaluateJob(job: Job, input: Input, now = new Date()): string[] {
    const reasons: string[] = [];
    const allowUnknown = input.includeUnknownMetadata;
    const words = (s: string) => s.toLocaleLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];
    const haystack = new Set(words(`${job.title} ${input.searchInDescription ? job.description_text : ''}`));
    if (!input.jobTitles.some(query => {
        const tokens = words(query);
        return tokens.length > 0 && tokens.every(token => haystack.has(token));
    })) reasons.push('keywords');
    if (input.locations.length && !input.locations.some(value =>
        job.location_text?.toLocaleLowerCase().includes(value.toLocaleLowerCase()))) reasons.push('location');
    if (job.quality_flags.includes('expired')) reasons.push('expired');
    if (input.workplaceTypes.length && !input.workplaceTypes.includes(job.workplace_type as Input['workplaceTypes'][number])
        && !(allowUnknown && job.workplace_type === 'unknown')) reasons.push('workplace');
    if (input.jobTypes.length && !job.employment_types.some(type => input.jobTypes.includes(type))
        && !(allowUnknown && !job.employment_types.length)) reasons.push('job_type');
    if (input.experienceLevels.length && !input.experienceLevels.includes(job.seniority as Input['experienceLevels'][number])
        && !(allowUnknown && job.seniority === 'unknown')) reasons.push('experience');
    if (input.datePosted !== 'any') {
        if (!job.posted_at) { if (!allowUnknown) reasons.push('unknown_posted_date'); }
        else {
            const age = now.getTime() - Date.parse(job.posted_at);
            // No extra day is silently added to the selected window. Date-only/rounded
            // source values remain marked as approximate in the output.
            if (age < 0 || age > Number(input.datePosted) * 86400000) reasons.push('posted_date');
        }
    }
    if (input.minimumSalary != null && input.minimumSalary > 0) {
        const upper = job.salary_max ?? job.salary_min;
        const comparable = upper != null && job.salary_currency === input.salaryCurrency
            && job.salary_period === input.salaryPeriod && !job.quality_flags.includes('salary_range_reversed');
        if (!comparable) { if (!input.includeUnknownSalary) reasons.push('salary_not_comparable'); }
        else if (upper < input.minimumSalary) reasons.push('salary_below_minimum');
    }
    return reasons;
}
