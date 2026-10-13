import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { describeErrorResponse } from './public-error-observability';

const OBSERVATION = {
	timestamp: '2026-08-30T00:00:00.000Z',
	status: 500,
	method: 'POST',
	pathname: '/api/export/sessions',
	search: '?slug=quarterly-numbers&pack=syntax',
	body: 'Export encoding failed at /var/lib/gfx/export/gfx-export-abc/out.mov',
	reportedByErrorHandler: false
} as const;

describe('describeErrorResponse', () => {
	it('keeps the query string and the raw body on a development host', () => {
		const report = describeErrorResponse({ ...OBSERVATION, profile: 'development' });

		assert.ok(report.line.includes('?slug=quarterly-numbers&pack=syntax'));
		assert.equal(report.diagnostic?.body, OBSERVATION.body);
		assert.equal(report.diagnostic?.search, OBSERVATION.search);
	});

	it('drops the query string on a public host', () => {
		const report = describeErrorResponse({ ...OBSERVATION, profile: 'public' });

		assert.ok(!report.line.includes('quarterly-numbers'));
		assert.ok(report.line.includes('500 POST /api/export/sessions'));
		assert.equal(report.diagnostic?.search, '');
	});

	it('strips the work directory out of a public body while keeping the failure', () => {
		const report = describeErrorResponse({ ...OBSERVATION, profile: 'public' });

		assert.ok(!report.diagnostic?.body.includes('/var/lib/gfx/export'));
		assert.ok(report.diagnostic?.body.startsWith('Export encoding failed at '));
	});

	it('promotes nothing when there was no body to read', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			status: 404,
			body: null,
			profile: 'public'
		});

		assert.equal(report.diagnostic, null);
		assert.equal(report.line, '[2026-08-30T00:00:00.000Z] 404 POST /api/export/sessions');
	});

	// GFX-COMPUTER-2C: an unready host filed a High-priority Sentry error for the
	// readiness contract answering exactly as ADR-0052 specifies.
	it('logs but never promotes the readiness 503', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			profile: 'public',
			status: 503,
			method: 'GET',
			pathname: '/api/health',
			search: '',
			body: '{"status":"unavailable","release":"gfx@6143cc6","checks":{"ffmpeg":"ok","temporaryDisk":"unavailable"}}'
		});

		assert.equal(report.diagnostic, null);
		assert.ok(report.line.includes('503 GET /api/health'));
		assert.ok(report.line.includes('"temporaryDisk":"unavailable"'));
	});

	it('still promotes a genuine failure from the readiness route', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			profile: 'public',
			status: 500,
			method: 'GET',
			pathname: '/api/health',
			search: '',
			body: 'Internal Error'
		});

		assert.equal(report.diagnostic?.body, 'Internal Error');
	});

	// GFX-COMPUTER-2A: one aborted frame upload filed twice — GFX-COMPUTER-27
	// carried the `Error: aborted` stack, this one carried nothing, and both share
	// trace 9bbc416425d84d5cb3a10912f2ce1c9b.
	it('logs but never promotes a failure the error handler already reported', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			profile: 'development',
			method: 'PUT',
			pathname: '/api/export/sessions/J6Z9uq/frames/1',
			search: '',
			body: 'Error: aborted',
			reportedByErrorHandler: true
		});

		assert.equal(report.diagnostic, null);
		assert.ok(report.line.includes('500 PUT /api/export/sessions/J6Z9uq/frames/1'));
		assert.ok(report.line.includes('Error: aborted'));
	});

	// The other half of the rule: an intentional error(5xx, ...) is an HttpError,
	// which SvelteKit answers without ever calling handleError, so promoting it
	// here is the only Sentry event that failure will ever get.
	it('still promotes an intentional 5xx, which the error handler never sees', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			profile: 'development',
			method: 'GET',
			pathname: '/api/user-compositions/chart-09',
			search: '',
			body: 'Corrupt user composition file',
			reportedByErrorHandler: false
		});

		assert.equal(report.diagnostic?.body, 'Corrupt user composition file');
	});

	it('bounds what one failure can write', () => {
		const report = describeErrorResponse({
			...OBSERVATION,
			profile: 'development',
			body: 'x'.repeat(5000)
		});

		assert.equal(report.diagnostic?.body.length, 2000);
	});
});
