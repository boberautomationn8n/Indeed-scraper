import { Actor } from 'apify';
import { parseInput } from './input.js';
import { runResearch } from './crawler.js';

await Actor.main(async () => {
    const input = parseInput(await Actor.getInput());
    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration) : undefined;
    await runResearch(input, {
        saveJob: job => Actor.pushData(job),
        saveSummary: summary => Actor.setValue('SUMMARY', summary),
    }, proxyConfiguration);
});
