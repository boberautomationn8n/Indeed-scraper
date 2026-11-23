import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const target = process.argv[2] || 'https://www.indeed.com/jobs?q=software+engineer+internship&l=New+York%2C+NY';
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage(); // A fresh isolated context; no user browser profile or cookies.
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response?.status();
    let title = await page.title();
    if (status === 200 && !/security check|just a moment|access denied/i.test(title)) {
        await page.locator('a[data-jk]').first().waitFor({ timeout: 15000 }).catch(() => {});
        title = await page.title();
    }
    const html = await page.content();
    await mkdir('tmp', { recursive: true });
    await writeFile('tmp/browser-probe.html', html);
    console.log(JSON.stringify({ status, title, url: page.url(), jobs: await page.locator('a[data-jk]').count(), bytes: html.length }, null, 2));
} finally { await browser.close(); }
