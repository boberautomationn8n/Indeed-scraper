import { Actor } from 'apify';
import { parseInput } from './input.js';
import { runResearch } from './research.js';

await Actor.main(async () => {
    const input = parseInput(await Actor.getInput());
    const cache = await Actor.openKeyValueStore('job-research-public-feed-cache');
    const summary = await runResearch(input, {
        cache,
        saveJobs: jobs => Actor.pushData(jobs),
        saveSummary: summary => Actor.setValue('SUMMARY', summary),
    });
    console.log(JSON.stringify(summary));
});
