import { mkdir, writeFile } from 'node:fs/promises';
const select = (title, description, values, defaultValue) => ({title, description, type:'string', editor:'select', enum:values, ...(defaultValue === undefined ? {} : {default:defaultValue})});
const multi = (title, description, values, defaultValue = []) => ({title, description, type:'array', editor:'select', items:{type:'string', enum:values}, default:defaultValue});
const flag = (title, description, value) => ({title, description, type:'boolean', default:value});
const integer = (title, description, value, maximum) => ({title,description,type:'integer',editor:'number',minimum:1,maximum,default:value});
const input = {
    title:'Public Job Research', type:'object', schemaVersion:1, additionalProperties:false,
    description:'Search public feeds across employers. Arbeitnow primarily covers Germany/Europe; Remotive provides a limited, delayed remote-job feed. No Indeed scraping, company list, or applications. Results retain source attribution. Feeds are cached for six hours.',
    properties:{
        sources:multi('Job sources','Select feeds to combine. These do not cover the entire job market.', ['arbeitnow','remotive'],['arbeitnow','remotive']),
        jobTitles:{title:'Job titles or keywords',description:'One alternative per entry. Every word within an entry must match (case insensitive, whole words). Example: AI automation requires both words; separate AI and automation entries match either. Title only by default.',type:'array',editor:'stringList',items:{type:'string'},minItems:1,maxItems:20,prefill:['AI','automation']},
        searchInDescription:flag('Also search descriptions','Include description words in keyword matching; this can return less relevant jobs.',false),
        locations:{title:'Location text',description:'Optional alternatives matched against the source location text. No radius, country inference, or eligibility checking. Remote Worldwide will not match Poland automatically. Empty means no location restriction.',type:'array',editor:'stringList',items:{type:'string'},default:[],maxItems:20},
        workplaceTypes:multi('Work arrangement','Empty means all. Non-remote is not assumed to mean onsite. Hybrid/onsite require an explicit label.', ['remote','hybrid','onsite']),
        jobTypes:multi('Job types','Empty means all. Multiple selections are alternatives.', ['full-time','part-time','contract','temporary','internship']),
        experienceLevels:multi('Experience level','Uses explicit title/feed labels. Unlabelled roles remain unknown.', ['entry','mid','senior']),
        datePosted:select('Feed publication date','Feed dates can differ from the original employer posting date. Remotive has date-only precision and a 24-hour feed delay.', ['any','1','3','7','14'],'any'),
        minimumSalary:{title:'Minimum salary',description:'Optional. A range matches when its upper bound reaches the minimum. No exchange-rate or period conversion. Salary data is sparse; Arbeitnow has no structured salary field.',type:'integer',editor:'number',minimum:0},
        salaryCurrency:select('Salary currency','Only explicit currencies are compared. A bare dollar sign is ambiguous.', ['USD','GBP','PLN','EUR'],'EUR'),
        salaryPeriod:select('Salary period','Only explicit periods are compared; annual pay is not inferred.', ['HOUR','DAY','WEEK','MONTH','YEAR'],'YEAR'),
        includeUnknownSalary:flag('Keep unknown or non-comparable salaries','When a minimum is set, keep undisclosed, ambiguous, or different-currency/period salaries. Switch off to require a comparable salary.',true),
        includeUnknownMetadata:flag('Keep unknown filter values','When an arrangement, job type, experience or date filter is selected, retain jobs missing that metadata.',false),
        maxResults:integer('Maximum matching jobs','Newest matches saved, up to this limit. Deduplication is within a run using source ID and listing URL.',50,1000),
        maxPages:integer('Maximum Arbeitnow pages','Fetch these pages once, then filter locally. Remotive uses one feed request regardless of this value. Strict filters may return zero matches.',3,10),
    },
    required:['jobTitles'],
};
const stringFields = ['source','source_name','source_url','source_job_id','listing_key','title','company_name','job_url','application_method','workplace_type','seniority','description_text','posted_at_precision','feed_fetched_at','scraped_at'];
const nullable = ['location_text','workplace_evidence','remote_restrictions_text','seniority_evidence','salary_text','salary_currency','salary_period','posted_at'];
const fields = {type:'object',required:['listing_key','title','job_url','source_name'],properties:{
    schema_version:{type:'integer',const:2},
    ...Object.fromEntries(stringFields.map(k=>[k,{type:'string'}])),
    ...Object.fromEntries(nullable.map(k=>[k,{type:['string','null']}])),
    apply_url:{type:'null'},easy_apply:{type:'null'},
    salary_min:{type:['number','null']},salary_max:{type:['number','null']},
    employment_types:{type:'array',items:{type:'string'}},quality_flags:{type:'array',items:{type:'string'}},
}};
const columns=['title','company_name','location_text','workplace_type','employment_types','seniority','salary_text','posted_at','source_name','job_url'];
const dataset={actorSpecification:1,fields,views:{jobs:{title:'Matching jobs',transformation:{fields:columns},display:{component:'table',properties:Object.fromEntries(columns.map(k=>[k,{label:k.replaceAll('_',' '),format:k==='job_url'?'link':'text'}]))}}}};
const actor={actorSpecification:1,name:'public-job-research',title:'Public Job Research',version:'0.2',dockerfile:'../Dockerfile',input:'./input_schema.json',storages:{dataset:'./dataset_schema.json'},output:'./output_schema.json'};
const output={actorOutputSchemaVersion:1,title:'Public job research results',properties:{jobs:{type:'string',title:'Matching jobs',template:'{{links.apiDefaultDatasetUrl}}/items'},summary:{type:'string',title:'Run summary',template:'{{links.apiDefaultKeyValueStoreUrl}}/records/SUMMARY'}}};
await mkdir('.actor',{recursive:true});
for(const [name,data] of Object.entries({'actor.json':actor,'input_schema.json':input,'dataset_schema.json':dataset,'output_schema.json':output})) await writeFile('.actor/'+name,JSON.stringify(data,null,2)+'\n');
