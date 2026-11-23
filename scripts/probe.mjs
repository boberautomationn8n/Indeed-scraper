import { mkdir, writeFile } from 'node:fs/promises';
const target = process.argv[2] || 'https://www.indeed.com/jobs?q=software+engineer+internship&l=New+York%2C+NY';
const response = await fetch(target, { signal: AbortSignal.timeout(30000), headers: { 'accept': 'text/html' } });
const html = await response.text();
await mkdir('tmp', { recursive: true });
await writeFile('tmp/probe.html', html);
console.log(JSON.stringify({ status: response.status, url: response.url, bytes: html.length,
  title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  jobMarkers: /data-jk|job_\w+|JobPosting/.test(html),
  challenge: /just a moment|verify you are human|additional verification|captcha/i.test(html)
}, null, 2));
