import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/input.js';
import { normalizeFeed, htmlText, salary } from '../src/extract.js';
import { evaluateJob } from '../src/filter.js';
import { getFeed, runResearch, type Cache } from '../src/research.js';
import type { Job } from '../src/types.js';

const now = new Date('2026-11-23T12:00:00Z');
const row = {slug:'junior-ai',title:'Junior AI Automation Engineer',company_name:'Example',
    description:'&lt;p&gt;Build workflows&lt;/p&gt;',url:'https://www.arbeitnow.com/view/junior-ai',
    remote:false,location:'Berlin',created_at:now.getTime()/1000-3600,tags:[],job_types:['Full time']};
const feed = (rows = [row], next: string | null = null) => ({data:rows,links:{next}});
const job = () => normalizeFeed('arbeitnow',feed(),now.toISOString(),now).jobs[0]!;
function cache(): Cache {
    const values = new Map<string,unknown>();
    return { async getValue<T>(key:string){ return values.get(key) as T ?? null; }, async setValue(k,v){values.set(k,v);} };
}
const response = (data:unknown) => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('normalizes feed and preserves attribution without inventing onsite or application links',()=>{
    const j=job();
    assert.equal(j.listing_key,'arbeitnow:junior-ai');
    assert.equal(j.description_text,'Build workflows');
    assert.equal(j.workplace_type,'unknown');
    assert.equal(j.apply_url,null);
    assert.equal(j.source_name,'Arbeitnow');
    assert.equal(j.seniority,'entry');
    assert.deepEqual(j.employment_types,['full-time']);
});
test('strips executable markup and decodes escaped descriptions',()=>{
    assert.equal(htmlText('<p>Hello</p><script>bad()</script><style>bad{}</style>'),'Hello');
    assert.equal(htmlText('&lt;div&gt;Hello &amp;amp; welcome&lt;/div&gt;'),'Hello & welcome');
});
test('Remotive restrictions are not treated as worldwide eligibility; date timezone is not invented',()=>{
    const data={jobs:[{id:123,title:'Senior Data Engineer',company_name:'Example',url:'https://remotive.com/remote-jobs/data/123',
        description:'<p>Data</p>',job_type:'full_time',publication_date:'2026-11-22T15:00:00',
        candidate_required_location:'USA',salary:'USD 100k - 120k / year'}]};
    const j=normalizeFeed('remotive',data,now.toISOString(),now).jobs[0]!;
    assert.equal(j.workplace_type,'remote');assert.equal(j.remote_restrictions_text,'USA');
    assert.equal(j.posted_at,'2026-11-22');assert.equal(j.posted_at_precision,'date');
    assert.equal(j.salary_max,120000);
});
test('malformed feed fails visibly while a valid empty feed is allowed',()=>{
    assert.throws(()=>normalizeFeed('arbeitnow',{data:'blocked'},now.toISOString(),now));
    assert.throws(()=>normalizeFeed('arbeitnow',feed([{...row,url:'https://other.example/job'}]),now.toISOString(),now));
    assert.equal(normalizeFeed('arbeitnow',feed([]),now.toISOString(),now).jobs.length,0);
});
test('Arbeitnow feed can link to its documented country domains',()=>{
    for (const host of ['www.arbeitnow.co.uk','www.arbeitnow.fr','www.arbeitnow.ch','www.arbeitnow.nl']) {
        const url='https://'+host+'/jobs/example';
        assert.equal(normalizeFeed('arbeitnow',feed([{...row,url}]),now.toISOString(),now).jobs[0]!.job_url,url);
    }
});
test('keywords are whole words, AND within entry, OR across entries; location is independent',()=>{
    const j=job();
    assert.deepEqual(evaluateJob(j,parseInput({jobTitles:['AI automation','marketing']}),now),[]);
    assert.ok(evaluateJob(j,parseInput({jobTitles:['AI marketing']}),now).includes('keywords'));
    assert.ok(evaluateJob({...j,title:'Retail Engineer'},parseInput({jobTitles:['AI']}),now).includes('keywords'));
    assert.ok(evaluateJob(j,parseInput({jobTitles:['AI'],locations:['Poland']}),now).includes('location'));
    assert.deepEqual(evaluateJob(j,parseInput({jobTitles:['workflows'],searchInDescription:true,locations:['berlin']}),now),[]);
});
test('metadata filters require evidence unless keeping unknowns is explicit',()=>{
    assert.ok(evaluateJob(job(),parseInput({jobTitles:['AI'],workplaceTypes:['onsite']}),now).includes('workplace'));
    assert.deepEqual(evaluateJob(job(),parseInput({jobTitles:['AI'],workplaceTypes:['onsite'],includeUnknownMetadata:true}),now),[]);
});
test('salary has explicit currency and period; international formats and missing values are handled',()=>{
    assert.deepEqual(salary('EUR 60.000 - 80.000 per year'),{salary_min:60000,salary_max:80000,salary_currency:'EUR',salary_period:'YEAR'});
    assert.equal(salary('$85k - $155k').salary_currency,null);
    assert.equal(salary('$85k - $155k').salary_period,null);
    assert.equal(salary('USD 35,3k - 52k per year').salary_min,35300);
    const j={...job(),...salary('USD 50k - 70k / year')};
    assert.ok(evaluateJob(j,parseInput({jobTitles:['AI'],minimumSalary:80000,salaryCurrency:'USD',includeUnknownSalary:false}),now).includes('salary_below_minimum'));
    assert.ok(evaluateJob(j,parseInput({jobTitles:['AI'],minimumSalary:60000,salaryCurrency:'EUR',includeUnknownSalary:false}),now).includes('salary_not_comparable'));
    assert.deepEqual(evaluateJob(j,parseInput({jobTitles:['AI'],minimumSalary:60000,salaryCurrency:'USD'}),now),[]);
});
test('date window has no silently added extra day',()=>{
    const input=parseInput({jobTitles:['AI'],datePosted:'1'});
    assert.deepEqual(evaluateJob(job(),input,now),[]);
    assert.ok(evaluateJob({...job(),posted_at:'2026-11-22T11:59:59Z'},input,now).includes('posted_date'));
});
test('cache avoids a second request within six hours; stale cache refreshes',async()=>{
    const c=cache();let requests=0;
    const request:typeof fetch=async()=>{requests++;return response(feed());};
    assert.equal((await getFeed('arbeitnow',1,c,now,request)).cached,false);
    assert.equal((await getFeed('arbeitnow',1,c,now,request)).cached,true);
    await getFeed('arbeitnow',1,c,new Date(now.getTime()+6*3600000),request);
    assert.equal(requests,2);
});
test('HTTP failures do not get cached or turn into empty results',async()=>{
    const c=cache();
    await assert.rejects(getFeed('remotive',1,c,now,async()=>new Response('blocked',{status:403})),/HTTP 403/);
    assert.equal(await c.getValue('remotive-1'),null);
});
test('pipeline fetches once per page, deduplicates, sorts, filters and saves bounded results',async()=>{
    const requests:string[]=[];let saved:Job[]=[];let summary:unknown;
    const newer={...row,slug:'new',url:'https://www.arbeitnow.com/view/new',created_at:row.created_at+30};
    const result=await runResearch(parseInput({sources:['arbeitnow'],jobTitles:['AI'],maxPages:2,maxResults:1}),{
        cache:cache(),now,request:async(url)=>{requests.push(String(url));return response(requests.length===1?feed([row],'next'):feed([row,newer]));},
        saveJobs:async(jobs)=>{saved=jobs;},saveSummary:async(value)=>{summary=value;},
    });
    assert.equal(requests.length,2);assert.equal(result.duplicates,1);assert.equal(result.matched,2);
    assert.equal(saved.length,1);assert.equal(saved[0]!.source_job_id,'new');assert.equal(result.saved,1);
    assert.ok(summary);
});
test('partial source failure saves available jobs and summary but fails the run visibly',async()=>{
    let summary:any;let saved=0;
    await assert.rejects(runResearch(parseInput({jobTitles:['AI'],maxPages:1}),{
        cache:cache(),now,request:async(url)=>String(url).includes('arbeitnow')?response(feed()):new Response('bad',{status:503}),
        saveJobs:async(jobs)=>{saved=jobs.length;},saveSummary:async(value)=>{summary=value;},
    }),/PARTIAL/);
    assert.equal(saved,1);assert.equal(summary.status,'partial');assert.equal(summary.errors.length,1);
});
test('unsupported old Indeed fields are rejected rather than silently ignored',()=>{
    assert.throws(()=>parseInput({jobTitles:['AI'],easyApplyOnly:true}));
});
