import { Actor } from 'apify';
await Actor.main(async () => {
    await Actor.setValue('SUMMARY', {
        status: 'SETUP_REQUIRED', collection_enabled: false,
        message: 'This version previews the Indeed US input form. It makes no requests to Indeed. An authorized data source has not been connected.',
    });
    throw new Error('FORM_PREVIEW_ONLY: job collection is disabled. No jobs were collected.');
});
